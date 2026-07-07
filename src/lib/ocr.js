import Tesseract from "tesseract.js";
import { DEFAULT_ADAPTABILITY, GRADES } from "./scoring.js";

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
  for (const [pattern, replacement] of NORMALIZE_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/[\s\r\n\t"'`“”‘’「」『』【】［］\[\]()（）{}<>〈〉・･,，.。:：;；/\\|_-]/g, "");
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

  URL.revokeObjectURL(preparedImage);
  return result.data;
}

async function prepareImage(file) {
  const source = await loadImage(file);
  const maxWidth = 2600;
  const scale = Math.min(2, Math.max(1, maxWidth / source.naturalWidth));
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
    const boosted = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
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

export function extractGameState(ocrData, skillIndex) {
  const rawText = ocrData.text ?? "";
  const lines = buildLines(ocrData);
  const textForSearch = normalizeText(rawText);

  return {
    rawText,
    lines,
    hasCut: detectCut(textForSearch),
    adaptability: detectAdaptability(lines, rawText),
    recognizedSkills: detectSkills(lines, textForSearch, skillIndex),
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

function detectSkills(lines, textForSearch, skillIndex) {
  const recognized = new Map();

  for (const line of lines) {
    if (isLikelyAptitudeLine(line.text, line.normalized)) continue;

    const matches = findSkillMatches(line.normalized, skillIndex);
    for (const match of matches) {
      const previous = recognized.get(match.skill.n);
      const hint = extractHint(line.text, lines[line.index - 1]?.text, lines[line.index + 1]?.text);
      const score = match.score + (line.confidence || 0) / 1000;
      if (!previous || score > previous.score) {
        recognized.set(match.skill.n, {
          name: match.skill.n,
          hint,
          score,
          confidence: line.confidence,
          sourceText: line.text,
        });
      } else if (hint > previous.hint) {
        previous.hint = hint;
      }
    }
  }

  for (const entry of skillIndex) {
    if (entry.normalized.length >= 4 && textForSearch.includes(entry.normalized)) {
      const current = recognized.get(entry.skill.n);
      if (!current) {
        recognized.set(entry.skill.n, {
          name: entry.skill.n,
          hint: extractHintAroundSkill(entry.normalized, textForSearch),
          score: 1,
          confidence: 0,
          sourceText: "全文匹配",
        });
      }
    }
  }

  return [...recognized.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 80);
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
      matches.push({ skill: entry.skill, score });
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

function extractHint(current = "", prev = "", next = "") {
  const text = `${prev} ${current} ${next}`.normalize("NFKC");
  const patterns = [
    /(?:ヒント|hint)\s*(?:Lv|LV|lv|レベル)?\s*\.?\s*([1-5])/i,
    /(?:Lv|LV|lv)\s*\.?\s*([1-5])/,
    /([1-5])\s*(?:ヒント|hint)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return clampHint(match[1]);
  }

  return 0;
}

function extractHintAroundSkill(skillName, text) {
  const index = text.indexOf(skillName);
  if (index === -1) return 0;
  return extractHint(text.slice(Math.max(0, index - 20), index + skillName.length + 24));
}

function clampHint(value) {
  const hint = Number.parseInt(value, 10);
  return Number.isFinite(hint) ? Math.min(5, Math.max(0, hint)) : 0;
}

export function gradeOptions() {
  return GRADES;
}
