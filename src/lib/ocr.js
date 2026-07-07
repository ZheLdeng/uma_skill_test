import Tesseract, { createWorker, PSM } from "tesseract.js";
import {
  DEFAULT_ADAPTABILITY,
  GRADES,
  inferHintFromDiscountRatio,
  inferHintFromPrice,
} from "./scoring.js";

const NORMALIZE_REPLACEMENTS = [
  [/〇/g, "○"],
  [/◯/g, "○"],
  [/◎/g, "◎"],
  [/！/g, "!"],
  [/＆/g, "&"],
  [/&amp;/g, "&"],
  [/長/g, "长"],
  [/マイル/g, "英"],
  [/ダート/g, "泥"],
  [/タート/g, "泥"],
];

const APTITUDE_ALIASES = [
  ["track", "芝", ["芝"]],
  ["track", "泥", ["泥", "ダート", "タート", "Dirt"]],
  ["dist", "短", ["短距離", "短距离", "短"]],
  ["dist", "英", ["マイル", "英", "mile", "Mile"]],
  ["dist", "中", ["中距離", "中距离", "中"]],
  ["dist", "长", ["長距離", "长距离", "長", "长"]],
  ["style", "逃", ["逃げ", "逃"]],
  ["style", "先", ["先行", "先"]],
  ["style", "差", ["差し", "差"]],
  ["style", "追", ["追込", "追い込み", "追"]],
];

export function normalizeText(value) {
  let text = String(value ?? "").normalize("NFKC");
  // 先去掉空白与标点：OCR 常把「マイ ルコ」拆开，去空格后 replacements 才能命中。
  text = text.replace(/[\s\r\n\t"'`“”‘’「」『』【】［］\[\]()（）{}<>〈〉・･,，.。:：;；/\\|_-]/g, "");
  for (const [pattern, replacement] of NORMALIZE_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/([一-龯ぁ-んァ-ン])(?:O|0)(?=ヒント|Lv|LV|$|[一-龯ぁ-んァ-ン])/g, "$1○");
}

export function createSkillIndex(skills) {
  return skills.map((skill) => ({
    skill,
    normalized: normalizeText(skill.n),
  }));
}

export async function recognizeScreenshot(image, onProgress) {
  const preparedImage = await prepareImage(image);
  const result = await Tesseract.recognize(preparedImage, "jpn+eng", {
    logger: (message) => {
      if (message.status) {
        onProgress?.({
          status: message.status,
          progress: message.progress ?? 0,
        });
      }
    },
  });

  // 第二遍：数字白名单，专门读现价 PT 与 %OFF（游戏字号小，主识别读不准数字）。
  const numberTokens = await recognizeNumbers(preparedImage);

  return { data: result.data, numberTokens };
}

let digitWorkerPromise = null;

function getDigitWorker() {
  if (!digitWorkerPromise) {
    digitWorkerPromise = (async () => {
      const worker = await createWorker("eng");
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789%",
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      });
      return worker;
    })().catch((error) => {
      digitWorkerPromise = null;
      throw error;
    });
  }
  return digitWorkerPromise;
}

/** 用数字白名单识别现价 PT / %OFF，返回带 bbox 的数字 token（供按行关联到技能）。 */
export async function recognizeNumbers(preparedImage) {
  try {
    const worker = await getDigitWorker();
    const { data } = await worker.recognize(preparedImage);
    return buildNumberTokens(data);
  } catch {
    return [];
  }
}

export function buildNumberTokens(data) {
  const tokens = [];
  const sources = (data?.words?.length ? data.words : data?.lines) ?? [];
  for (const item of sources) {
    const text = String(item.text ?? "");
    const regex = /(\d{1,4})\s*(%?)/g;
    let match;
    while ((match = regex.exec(text))) {
      const value = Number(match[1]);
      if (!Number.isFinite(value)) continue;
      tokens.push({ value, isPercent: match[2] === "%", bbox: item.bbox ?? null });
    }
  }
  return tokens;
}

// 预处理参数：游戏内技能名字号小、对比度低，需要大幅放大并加强对比。
// 目标是把较短边放大到 ~1600px（截图裁得越小放得越大），并做灰度 + 强对比。
const PREP_TARGET_MIN = 1600;
const PREP_MAX_DIM = 4200;
const PREP_MAX_SCALE = 4;
const PREP_CONTRAST = 2.4;

export function computePrepScale(width, height) {
  const minDim = Math.min(width, height);
  let scale = PREP_TARGET_MIN / minDim;
  scale = Math.max(1, Math.min(PREP_MAX_SCALE, scale));
  const maxDim = Math.max(width, height) * scale;
  if (maxDim > PREP_MAX_DIM) scale *= PREP_MAX_DIM / maxDim;
  return scale;
}

async function prepareImage(file) {
  const source = await loadImage(file);
  const scale = computePrepScale(source.naturalWidth, source.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.naturalWidth * scale);
  canvas.height = Math.round(source.naturalHeight * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const boosted = Math.max(0, Math.min(255, (gray - 128) * PREP_CONTRAST + 128));
    data[i] = boosted;
    data[i + 1] = boosted;
    data[i + 2] = boosted;
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL("image/png");
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = reject;
    image.src = url;
  });
}

export function extractGameState(ocrData, skillIndex, numberTokens = []) {
  const rawText = ocrData.text ?? "";
  const lines = buildLines(ocrData);
  const textForSearch = normalizeText(rawText);
  const recognizedSkills = detectSkills(lines, textForSearch, skillIndex, numberTokens);

  return {
    rawText,
    lines,
    hasCut: detectCut(textForSearch) || recognizedSkills.some((s) => s.hasCut),
    adaptability: detectAdaptability(lines, rawText),
    recognizedSkills,
  };
}

function buildLines(ocrData) {
  const sourceLines = Array.isArray(ocrData.lines) && ocrData.lines.length
    ? ocrData.lines
    : String(ocrData.text ?? "")
      .split(/\n+/)
      .map((text) => ({ text, confidence: 0, bbox: null }));

  return sourceLines
    .map((line, index) => ({
      index,
      text: String(line.text ?? "").trim(),
      normalized: normalizeText(line.text ?? ""),
      confidence: Number(line.confidence ?? 0),
      bbox: line.bbox ?? null,
    }))
    .filter((line) => line.text);
}

function detectCut(text) {
  return /切れ者|切者|切れ物/.test(text);
}

function detectAdaptability(lines, rawText) {
  const next = JSON.parse(JSON.stringify(DEFAULT_ADAPTABILITY));
  const searchableLines = [
    ...lines.map((line) => line.text),
    String(rawText ?? ""),
  ];

  for (const [type, key, aliases] of APTITUDE_ALIASES) {
    const grade = findGradeForAliases(searchableLines, aliases);
    if (grade) next[type][key] = grade;
  }

  return next;
}

function findGradeForAliases(lines, aliases) {
  for (const text of lines) {
    const normalized = String(text ?? "").normalize("NFKC").replace(/長/g, "长");
    for (const alias of aliases) {
      const aliasText = alias.normalize("NFKC").replace(/長/g, "长");
      const index = normalized.indexOf(aliasText);
      if (index === -1) continue;

      const nearby = normalized.slice(index + aliasText.length, index + aliasText.length + 12);
      const direct = nearby.match(/[SABCDEFG]/i);
      if (direct) return direct[0].toUpperCase();

      const before = normalized.slice(Math.max(0, index - 5), index);
      const reverse = before.match(/[SABCDEFG]/i);
      if (reverse) return reverse[0].toUpperCase();
    }
  }
  return null;
}

function detectSkills(lines, textForSearch, skillIndex, numberTokens = []) {
  const recognized = new Map();

  const register = (skill, score, line, discount) => {
    const previous = recognized.get(skill.n);
    if (!previous || score > previous.score) {
      recognized.set(skill.n, {
        name: skill.n,
        hint: discount.hint,
        hasCut: discount.hasCut,
        score,
        confidence: line?.confidence ?? 0,
        sourceText: line?.text ?? "全文匹配",
      });
    } else {
      if (discount.hint > previous.hint) previous.hint = discount.hint;
      if (discount.hasCut) previous.hasCut = true;
    }
  };

  for (const line of lines) {
    if (isLikelyAptitudeLine(line.text, line.normalized)) continue;

    const matches = findSkillMatches(line.normalized, skillIndex);
    for (const match of matches) {
      const discount = extractRowDiscount(match.skill, line, lines, numberTokens);
      const score = match.score + (line.confidence || 0) / 1000;
      register(match.skill, score, line, discount);
    }
  }

  for (const entry of skillIndex) {
    if (entry.normalized.length >= 4 && textForSearch.includes(entry.normalized)) {
      if (!recognized.has(entry.skill.n)) {
        register(entry.skill, 1, null, { hint: 0, hasCut: false });
      }
    }
  }

  return [...recognized.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 80);
}

/** 收集与某行处于同一"技能卡"行带内的所有 OCR 行（技能名 / 描述 / 折扣 / 现价可能分行）。 */
function collectRowLines(line, lines) {
  const result = [line];
  if (line.bbox && Number.isFinite(line.bbox.y0)) {
    const height = Math.max(12, line.bbox.y1 - line.bbox.y0);
    const center = (line.bbox.y0 + line.bbox.y1) / 2;
    const window = height * 3;
    for (const other of lines) {
      if (other === line || !other.bbox) continue;
      const oy = (other.bbox.y0 + other.bbox.y1) / 2;
      if (Math.abs(oy - center) <= window) result.push(other);
    }
  } else {
    for (const idx of [line.index - 1, line.index + 1, line.index + 2]) {
      const other = lines[idx];
      if (other) result.push(other);
    }
  }
  return result;
}

/**
 * 从技能所在行带里推断 Hint / 切者：
 * 1. "N%OFF" 折扣文本；
 * 2. 现价 PT 数字（用原价反算折扣）；
 * 3. "ヒント Lv N" 文本。
 * 取误差最小的候选。
 */
function extractRowDiscount(skill, line, lines, numberTokens = []) {
  const text = collectRowLines(line, lines)
    .map((item) => item.text)
    .join(" ")
    .normalize("NFKC");
  const candidates = discountCandidatesFromText(text, skill);

  // 数字白名单 pass 的 token：按 bbox 行带关联到当前技能
  if (line.bbox && Number.isFinite(line.bbox.y0)) {
    const height = Math.max(12, line.bbox.y1 - line.bbox.y0);
    const center = (line.bbox.y0 + line.bbox.y1) / 2;
    const window = height * 3;
    for (const token of numberTokens) {
      if (!token.bbox) continue;
      const ty = (token.bbox.y0 + token.bbox.y1) / 2;
      if (Math.abs(ty - center) > window) continue;
      if (token.isPercent) {
        const info = inferHintFromDiscountRatio(1 - token.value / 100);
        if (info) candidates.push(info);
      } else if (skill?.p) {
        const info = inferHintFromPrice(skill.p, token.value);
        if (info) candidates.push(info);
      }
    }
  }

  return chooseDiscount(candidates);
}

/** 只从文本推断（用于测试与无 bbox 场景）。 */
export function inferDiscount(text, skill) {
  return chooseDiscount(discountCandidatesFromText(text, skill));
}

function discountCandidatesFromText(text, skill) {
  const candidates = [];
  let match;

  // 1) N%OFF（允许 OFF 被误识别成 0FF / OFE 等）
  const offRe = /(\d{1,3})\s*%\s*[oO0FfEe]{0,3}/g;
  while ((match = offRe.exec(text))) {
    const pct = Number(match[1]);
    if (pct > 0 && pct <= 60) {
      const info = inferHintFromDiscountRatio(1 - pct / 100);
      if (info) candidates.push(info);
    }
  }

  // 2) 现价 PT 反算（需要原价）
  if (skill?.p) {
    const numRe = /\d{2,4}/g;
    while ((match = numRe.exec(text))) {
      const info = inferHintFromPrice(skill.p, Number(match[0]));
      if (info) candidates.push(info);
    }
  }

  // 3) ヒント Lv N 直接文本
  const lvRe = /(?:ヒント|hint|Lv|LV|レベル)\s*\.?\s*([1-5])/gi;
  while ((match = lvRe.exec(text))) {
    candidates.push({ hint: clampHint(match[1]), hasCut: false, error: 0.03 });
  }

  return candidates;
}

function chooseDiscount(candidates) {
  if (!candidates.length) return { hint: 0, hasCut: false };
  candidates.sort((a, b) => (a.error ?? 1) - (b.error ?? 1));
  const best = candidates[0];
  return { hint: best.hint, hasCut: Boolean(best.hasCut) };
}

function isLikelyAptitudeLine(rawText, normalized) {
  const labels = [
    "芝",
    "泥",
    "ダート",
    "短距離",
    "短距离",
    "マイル",
    "中距離",
    "中距离",
    "長距離",
    "长距离",
    "逃げ",
    "先行",
    "差し",
    "追込",
  ];
  const text = String(rawText ?? "");
  const labelCount = labels.reduce(
    (count, label) => count + (text.includes(label) || normalized.includes(normalizeText(label)) ? 1 : 0),
    0,
  );
  return labelCount >= 2 && /[SABCDEFG]/i.test(text);
}

function findSkillMatches(text, skillIndex) {
  if (!text) return [];
  const exactMatches = [];
  const matches = [];

  for (const entry of skillIndex) {
    const name = entry.normalized;
    if (name.length < 2) continue;

    if (text.includes(name)) {
      exactMatches.push({ skill: entry.skill, score: 1 });
      continue;
    }
    if (!hasAnchorOverlap(name, text)) continue;

    const score = bestSimilarity(name, text);

    const threshold = name.length <= 4 ? 0.88 : 0.74;
    if (score >= threshold) {
      // 前缀锚点加成：区分开头不同、词尾相同的近似技能（如マイルコーナー vs ダートコーナー）
      const anchorBonus = text.includes(name.slice(0, 2)) ? 0.06 : 0;
      matches.push({ skill: entry.skill, score: score + anchorBonus });
    }
  }

  if (exactMatches.length) {
    return exactMatches.sort((a, b) => b.skill.n.length - a.skill.n.length).slice(0, 6);
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 1);
}

function hasAnchorOverlap(skillName, text) {
  if (text.includes(skillName)) return true;
  if (skillName.length <= 4) return true;
  const anchor = skillName.slice(0, Math.min(3, skillName.length));
  return [...anchor].some((char) => text.includes(char));
}

function bestSimilarity(needle, haystack) {
  if (!needle || !haystack) return 0;
  if (haystack.includes(needle)) return 1;
  const minLen = Math.max(2, needle.length - 2);
  const maxLen = Math.min(haystack.length, needle.length + 4);
  let best = diceCoefficient(needle, haystack);

  for (let len = minLen; len <= maxLen; len += 1) {
    for (let start = 0; start + len <= haystack.length; start += 1) {
      best = Math.max(best, diceCoefficient(needle, haystack.slice(start, start + len)));
      if (best >= 0.98) return best;
    }
  }
  return best;
}

function diceCoefficient(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  if (a.length === 1 || b.length === 1) return a === b ? 1 : 0;

  const grams = new Map();
  for (let i = 0; i < a.length - 1; i += 1) {
    const gram = a.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }

  let hits = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const gram = b.slice(i, i + 2);
    const count = grams.get(gram) ?? 0;
    if (count > 0) {
      grams.set(gram, count - 1);
      hits += 1;
    }
  }

  return (2 * hits) / (a.length + b.length - 2);
}

function clampHint(value) {
  const hint = Number.parseInt(value, 10);
  return Number.isFinite(hint) ? Math.min(5, Math.max(0, hint)) : 0;
}

export function gradeOptions() {
  return GRADES;
}
