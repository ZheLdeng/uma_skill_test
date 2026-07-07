#!/usr/bin/env node
/**
 * 从 GameTora 生成支援卡 -> 可获取技能（Hint 技能）数据库。
 *
 * 用法：
 *   npm run update-support-cards            # 拉取并重建 support-cards.json
 *   npm run update-support-cards -- --dry   # 只看差异不写文件
 *
 * 数据源：GameTora（gametora.com）。它的数据通过 /data/manifests/umamusume.json
 * 里的 key->hash 映射，实际文件在 /data/umamusume/<key>.<hash>.json。
 * 我们取 support-cards（含 hints.hint_skills 技能 ID）与 skills（含 jpname），
 * 把技能 ID 映射成日文名，并只保留本地 skills.json 里存在的技能，保证可用于算分。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../src/data");
const OUT_PATH = path.join(DATA_DIR, "support-cards.json");
const SKILLS_PATH = path.join(DATA_DIR, "skills.json");

const BASE = "https://gametora.com";
const MANIFEST_URL = `${BASE}/data/manifests/umamusume.json`;
const UA = { "User-Agent": "Mozilla/5.0 (uma-ocr-score-tool support-card updater)" };
const DRY_RUN = process.argv.includes("--dry");

const normName = (v) =>
  String(v ?? "").normalize("NFKC").replace(/[◯〇]/g, "○").replace(/&amp;/g, "&").replace(/＆/g, "&");

async function fetchJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`拉取失败 ${url}: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  console.log(`[support-cards] 读取 manifest ${MANIFEST_URL}`);
  const manifest = await fetchJson(MANIFEST_URL);
  const cardHash = manifest["support-cards"];
  const skillHash = manifest["skills"];
  if (!cardHash || !skillHash) {
    throw new Error("manifest 中找不到 support-cards / skills，GameTora 数据结构可能已变化");
  }

  const cards = await fetchJson(`${BASE}/data/umamusume/support-cards.${cardHash}.json`);
  const skills = await fetchJson(`${BASE}/data/umamusume/skills.${skillHash}.json`);
  console.log(`[support-cards] 支援卡 ${cards.length} 张，技能 ${skills.length} 条`);

  const id2jp = new Map(skills.map((s) => [s.id, s.jpname]));

  const ourSkills = JSON.parse(fs.readFileSync(SKILLS_PATH, "utf8"));
  const ourSet = new Set(ourSkills.map((o) => normName(o.n)));

  let skipped = 0;
  const out = cards
    .map((c) => {
      const skillNames = [];
      for (const id of c.hints?.hint_skills ?? []) {
        const jp = id2jp.get(id);
        if (!jp) {
          skipped += 1;
          continue;
        }
        const name = normName(jp);
        if (ourSet.has(name)) skillNames.push(name);
        else skipped += 1;
      }
      return {
        id: c.support_id,
        name: `${c.title_ja ?? ""}${c.name_jp ?? c.char_name ?? ""}`,
        char: c.name_jp ?? c.char_name ?? "",
        type: c.type ?? "",
        rarity: Number(c.rarity) || 0,
        skills: [...new Set(skillNames)],
      };
    })
    .filter((c) => c.id)
    .sort((a, b) => b.rarity - a.rarity || a.id - b.id);

  console.log(`[support-cards] 生成 ${out.length} 张卡，跳过未匹配技能 ${skipped} 个`);

  // 差异
  if (fs.existsSync(OUT_PATH)) {
    const old = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
    const oldIds = new Set(old.map((c) => c.id));
    const newIds = new Set(out.map((c) => c.id));
    const added = out.filter((c) => !oldIds.has(c.id)).map((c) => c.name);
    const removed = old.filter((c) => !newIds.has(c.id)).map((c) => c.name);
    console.log(`\n===== 差异 =====\n➕ 新增卡（${added.length}）: ${added.slice(0, 40).join(", ")}`);
    console.log(`➖ 移除卡（${removed.length}）: ${removed.slice(0, 40).join(", ")}`);
  }

  if (DRY_RUN) {
    console.log("\n[support-cards] --dry 模式，不写文件。");
    return;
  }
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`\n[support-cards] 已写入 ${OUT_PATH}`);
}

main().catch((error) => {
  console.error(`\n[support-cards] 失败: ${error.message}`);
  process.exit(1);
});
