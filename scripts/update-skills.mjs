#!/usr/bin/env node
/**
 * 从 gamewith 评价点模拟器（article/show/279309）刷新技能数据库。
 *
 * 用法：
 *   npm run update-skills            # 从 gamewith 拉取并全量重建
 *   npm run update-skills -- --dry   # 只打印差异，不写文件
 *   SKILLS_HTML=/path/to/uma.html npm run update-skills   # 用本地 HTML 调试
 *
 * gamewith 为唯一权威源，脚本每次都全量重建 skills.json / upgrade-map.json，
 * 并打印与本地现有数据的差异（新增 / 移除 / 数值变更）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../src/data");
const SKILLS_PATH = path.join(DATA_DIR, "skills.json");
const UPGRADE_PATH = path.join(DATA_DIR, "upgrade-map.json");
const SOURCE_URL = "https://gamewith.jp/uma-musume/article/show/279309";

const DRY_RUN = process.argv.includes("--dry");

// r（适性限制码）-> 条件
const R_MAP = {
  1: "芝", 2: "泥", 3: "短", 4: "英", 5: "中", 6: "长",
  7: "逃", 8: "先", 9: "差", 10: "追",
};

/** 统一技能名规范化：圆圈 / 连接符 */
export function normName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[◯〇]/g, "○")
    .replace(/&amp;/g, "&")
    .replace(/＆/g, "&");
}

async function loadHtml() {
  const local = process.env.SKILLS_HTML;
  if (local) {
    console.log(`[update-skills] 使用本地 HTML: ${local}`);
    return fs.readFileSync(local, "utf8");
  }
  console.log(`[update-skills] 拉取 ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (uma-ocr-score-tool skill updater)" },
  });
  if (!res.ok) throw new Error(`拉取失败: HTTP ${res.status}`);
  return res.text();
}

/** 从页面 HTML 中提取 skillDatas 数组 */
function parseSkillDatas(html) {
  const match = html.match(/skillDatas\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) {
    throw new Error("解析失败：未在页面中找到 skillDatas，数据源结构可能已变化");
  }
  let arr;
  try {
    // 数据是 JS 对象字面量（单引号），用 Function 安全求值
    // eslint-disable-next-line no-new-func
    arr = Function(`"use strict";return (${match[1]});`)();
  } catch (error) {
    throw new Error(`解析失败：skillDatas 无法求值 (${error.message})`);
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error("解析失败：skillDatas 为空");
  }
  return arr;
}

function conditionsFromR(r) {
  if (r === undefined || r === null || r === "") return ["通用", ""];
  const parts = String(r)
    .split("/")
    .map((p) => R_MAP[Number(p)])
    .filter(Boolean);
  return [parts[0] ?? "通用", parts[1] ?? ""];
}

/**
 * 构建技能行。
 * - c=3（固有技能）跳过，不可用技能点购买。
 * - 绿技能（ap 含逗号）拆成 ○（低档）与 ◎（高档）两行。
 * - 含 p（升级前低级技能）的技能：总评价点 = ap + 低级.ap，总价 = pt + 低级.pt。
 */
function buildSkills(skillDatas) {
  const formValues = new Map(); // 规范名 -> { ap, pt }
  const baseRows = [];

  for (const o of skillDatas) {
    if (String(o.c) === "3") continue;
    const apStr = String(o.ap);
    if (apStr.includes(",")) {
      const [apLow, apInc] = apStr.split(",").map(Number);
      const [ptLow, ptInc] = String(o.pt).split(",").map(Number);
      const base = normName(o.n).replace(/[○◎]$/, "");
      const lowName = `${base}○`;
      const highName = `${base}◎`;
      formValues.set(lowName, { ap: apLow, pt: ptLow });
      formValues.set(highName, { ap: apLow + apInc, pt: ptLow + ptInc });
      baseRows.push({ name: lowName, ap: apLow, pt: ptLow, c: o.c, r: o.r });
      baseRows.push({ name: highName, ap: apLow + apInc, pt: ptLow + ptInc, c: o.c, r: o.r });
    } else {
      const name = normName(o.n);
      formValues.set(name, { ap: Number(o.ap), pt: Number(o.pt) });
      baseRows.push({
        name,
        ap: Number(o.ap),
        pt: Number(o.pt),
        c: o.c,
        r: o.r,
        p: o.p ? normName(o.p) : undefined,
      });
    }
  }

  const unresolved = [];
  const seen = new Set();
  const skills = [];
  const upgradeMap = {};

  for (const row of baseRows) {
    if (seen.has(row.name)) continue;
    seen.add(row.name);

    let evalScore = row.ap;
    let price = row.pt;
    if (row.p) {
      const base = formValues.get(row.p);
      if (base) {
        evalScore += base.ap;
        price += base.pt;
        upgradeMap[row.name] = row.p;
      } else {
        unresolved.push(`${row.name} -> ${row.p}`);
      }
    }

    const [c1, c2] = conditionsFromR(row.r);
    const rarity = String(row.c) === "2" ? "传说" : "普通";
    const cond = c1 === "通用" ? "通用" : c2 ? `${c1}${c2}` : c1;
    const testScore = evalScore + (rarity === "传说" ? 1200 : 400);

    skills.push({
      n: row.name,
      r: rarity,
      c: cond,
      a: evalScore, // 未乘适性系数的原始评价点，scoring.js 会按适性再乘
      e: evalScore,
      p: price,
      t: testScore,
      c1,
      c2,
    });
  }

  return { skills, upgradeMap, unresolved };
}

function diff(oldSkills, newSkills) {
  const oldBy = new Map(oldSkills.map((o) => [normName(o.n), o]));
  const newBy = new Map(newSkills.map((o) => [normName(o.n), o]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const s of newSkills) {
    if (!oldBy.has(normName(s.n))) added.push(s.n);
  }
  for (const s of oldSkills) {
    const key = normName(s.n);
    if (!newBy.has(key)) {
      removed.push(s.n);
      continue;
    }
    const n = newBy.get(key);
    if (Math.round(s.e) !== Math.round(n.e) || Math.round(s.p) !== Math.round(n.p)) {
      changed.push(`${s.n}: 评价分 ${s.e}→${n.e}, 价 ${s.p}→${n.p}`);
    }
  }
  return { added, removed, changed };
}

function printList(title, items, limit = 60) {
  console.log(`\n${title}（${items.length}）`);
  if (!items.length) return;
  console.log("  " + items.slice(0, limit).join(", ") + (items.length > limit ? " …" : ""));
}

async function main() {
  const html = await loadHtml();
  const skillDatas = parseSkillDatas(html);
  console.log(`[update-skills] skillDatas 解析成功，共 ${skillDatas.length} 条`);

  const { skills, upgradeMap, unresolved } = buildSkills(skillDatas);
  console.log(`[update-skills] 生成技能 ${skills.length} 条，升级映射 ${Object.keys(upgradeMap).length} 条`);
  if (unresolved.length) {
    printList("⚠ 未能解析升级链的低级技能", unresolved);
  }

  let oldSkills = [];
  if (fs.existsSync(SKILLS_PATH)) {
    oldSkills = JSON.parse(fs.readFileSync(SKILLS_PATH, "utf8"));
  }
  const { added, removed, changed } = diff(oldSkills, skills);
  console.log("\n===== 差异报告 =====");
  printList("➕ 新增", added);
  printList("➖ 移除", removed);
  printList("✏ 数值变更", changed);

  if (DRY_RUN) {
    console.log("\n[update-skills] --dry 模式，不写入文件。");
    return;
  }

  fs.writeFileSync(SKILLS_PATH, JSON.stringify(skills, null, 2) + "\n", "utf8");
  fs.writeFileSync(UPGRADE_PATH, JSON.stringify(upgradeMap, null, 2) + "\n", "utf8");
  console.log(`\n[update-skills] 已写入:\n  ${SKILLS_PATH}\n  ${UPGRADE_PATH}`);
}

main().catch((error) => {
  console.error(`\n[update-skills] 失败: ${error.message}`);
  process.exit(1);
});
