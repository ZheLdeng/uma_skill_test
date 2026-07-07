#!/usr/bin/env node
/**
 * 生成支援卡数据库 + 技能中日对照表。
 *
 * 用法：
 *   npm run update-support-cards            # 拉取并重建 support-cards.json / skill-cn.json
 *   npm run update-support-cards -- --dry   # 只看差异不写文件
 *
 * 数据源：
 * - GameTora（gametora.com）：支援卡结构（hint_skills 技能 ID、release 等）、技能日文名。
 *   数据经 /data/manifests/umamusume.json 的 key->hash 映射到 /data/umamusume/<key>.<hash>.json。
 * - bilibili wiki（wiki.biligame.com）：官方简体中文技能名 / 支援卡名。
 *   技能与支援卡都用同一套游戏内 ID，GameTora 与 bwiki 的 ID 一致，可直接 join。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../src/data");
const CARDS_PATH = path.join(DATA_DIR, "support-cards.json");
const SKILL_CN_PATH = path.join(DATA_DIR, "skill-cn.json");
const SKILLS_PATH = path.join(DATA_DIR, "skills.json");

const GT = "https://gametora.com";
const BW = "https://wiki.biligame.com/umamusume/api.php";
const UA = { "User-Agent": "Mozilla/5.0 (uma-score-tool data updater)" };
const DRY_RUN = process.argv.includes("--dry");

const normName = (v) =>
  String(v ?? "").normalize("NFKC").replace(/[◯〇]/g, "○").replace(/&amp;/g, "&").replace(/＆/g, "&");

async function fetchJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`拉取失败 ${url}: HTTP ${res.status}`);
  return res.json();
}

/** 枚举 bwiki 中引用某模板的所有页面（简中技能 / 简中支援卡），返回 Map<ID, 中文名>。 */
async function fetchBwikiIdMap(templateTitle, stripPrefix = "简/") {
  const titles = [];
  let cont;
  do {
    const url = new URL(BW);
    url.search = new URLSearchParams({
      action: "query",
      list: "embeddedin",
      eititle: templateTitle,
      einamespace: "0",
      eilimit: "500",
      format: "json",
      ...(cont ? { eicontinue: cont } : {}),
    });
    const data = await fetchJson(url);
    for (const p of data.query?.embeddedin ?? []) titles.push(p.title);
    cont = data.continue?.eicontinue;
  } while (cont);

  const map = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const url = new URL(BW);
    url.search = new URLSearchParams({
      action: "query",
      prop: "revisions",
      rvprop: "content",
      rvslots: "main",
      formatversion: "2",
      titles: batch.join("|"),
      format: "json",
    });
    const data = await fetchJson(url);
    for (const page of data.query?.pages ?? []) {
      const content = page.revisions?.[0]?.slots?.main?.content ?? "";
      const m = content.match(/\|\s*ID\s*=\s*(\d+)/);
      if (m) map.set(m[1], page.title.replace(new RegExp(`^${stripPrefix}`), ""));
    }
  }
  return map;
}

async function main() {
  // ---- GameTora ----
  console.log("[data] 读取 GameTora manifest");
  const manifest = await fetchJson(`${GT}/data/manifests/umamusume.json`);
  const cardHash = manifest["support-cards"];
  const skillHash = manifest["skills"];
  if (!cardHash || !skillHash) throw new Error("GameTora manifest 结构变化，找不到 support-cards / skills");

  const cards = await fetchJson(`${GT}/data/umamusume/support-cards.${cardHash}.json`);
  const gtSkills = await fetchJson(`${GT}/data/umamusume/skills.${skillHash}.json`);
  console.log(`[data] GameTora 支援卡 ${cards.length}，技能 ${gtSkills.length}`);

  // ---- bilibili wiki 中文名 ----
  console.log("[data] 读取 bwiki 简中技能名…");
  const skillCnById = await fetchBwikiIdMap("Template:简中技能");
  console.log(`[data] bwiki 技能中文名 ${skillCnById.size} 条`);
  console.log("[data] 读取 bwiki 简中支援卡名…");
  const cardCnById = await fetchBwikiIdMap("Template:简中支援卡");
  console.log(`[data] bwiki 支援卡中文名 ${cardCnById.size} 条`);

  const id2jp = new Map(gtSkills.map((s) => [s.id, s.jpname]));
  const ourSkills = JSON.parse(fs.readFileSync(SKILLS_PATH, "utf8"));
  const ourSet = new Set(ourSkills.map((o) => normName(o.n)));

  // 技能中日对照：jp -> 简中（bwiki ID join）
  const skillCn = {};
  for (const s of gtSkills) {
    const jp = normName(s.jpname);
    if (!ourSet.has(jp)) continue;
    const cn = skillCnById.get(String(s.id));
    if (cn) skillCn[jp] = cn;
  }
  // ◎ 档若缺，用 ○ 版推导
  for (const o of ourSkills) {
    const n = normName(o.n);
    if (skillCn[n] || !n.endsWith("◎")) continue;
    const low = `${n.slice(0, -1)}○`;
    if (skillCn[low]) skillCn[n] = skillCn[low].replace(/○$/, "◎");
  }
  console.log(`[data] 技能中日对照 ${Object.keys(skillCn).length}/${ourSkills.length}`);

  // 支援卡
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
      const cnFull = cardCnById.get(String(c.support_id)) ?? "";
      const charCn = cnFull.includes("】") ? cnFull.split("】").pop() : cnFull;
      return {
        id: c.support_id,
        name: `${c.title_ja ?? ""}${c.name_jp ?? c.char_name ?? ""}`,
        nameCn: cnFull,
        char: c.name_jp ?? c.char_name ?? "",
        charCn, // 无 bwiki 中文时留空，UI 回退显示日文
        type: c.type ?? "",
        rarity: Number(c.rarity) || 0,
        release: c.release ?? "",
        skills: [...new Set(skillNames)],
      };
    })
    .filter((c) => c.id)
    .sort((a, b) => (b.release || "").localeCompare(a.release || "") || b.rarity - a.rarity);

  console.log(`[data] 生成 ${out.length} 张卡，跳过未匹配技能 ${skipped}`);

  if (fs.existsSync(CARDS_PATH)) {
    const old = JSON.parse(fs.readFileSync(CARDS_PATH, "utf8"));
    const oldIds = new Set(old.map((c) => c.id));
    const added = out.filter((c) => !oldIds.has(c.id)).map((c) => c.nameCn || c.name);
    console.log(`\n➕ 新增卡（${added.length}）: ${added.slice(0, 40).join(", ")}`);
  }

  if (DRY_RUN) {
    console.log("\n[data] --dry 模式，不写文件。");
    return;
  }
  fs.writeFileSync(CARDS_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  fs.writeFileSync(SKILL_CN_PATH, JSON.stringify(skillCn, null, 2) + "\n", "utf8");
  console.log(`\n[data] 已写入:\n  ${CARDS_PATH}\n  ${SKILL_CN_PATH}`);
}

main().catch((error) => {
  console.error(`\n[data] 失败: ${error.message}`);
  process.exit(1);
});
