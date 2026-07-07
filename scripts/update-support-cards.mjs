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

/** 取模板某字段值（截到换行/竖线/右花括号）。 */
function tplField(content, name) {
  const m = content.match(new RegExp(`\\|\\s*${name}\\s*=\\s*([^\\n|}]*)`));
  return m ? m[1].trim() : "";
}

/** 枚举 bwiki 中引用某模板的所有页面，返回其 wikitext 内容数组。 */
async function fetchBwikiPages(templateTitle) {
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

  const contents = [];
  for (let i = 0; i < titles.length; i += 50) {
    const url = new URL(BW);
    url.search = new URLSearchParams({
      action: "query",
      prop: "revisions",
      rvprop: "content",
      rvslots: "main",
      formatversion: "2",
      titles: titles.slice(i, i + 50).join("|"),
      format: "json",
    });
    const data = await fetchJson(url);
    for (const page of data.query?.pages ?? []) {
      const content = page.revisions?.[0]?.slots?.main?.content;
      if (content) contents.push(content);
    }
  }
  return contents;
}

/** 技能：日文名 -> 简体中文名（bwiki Template:技能，覆盖日服技能）。 */
async function fetchBwikiSkillCn() {
  const pages = await fetchBwikiPages("Template:技能");
  const map = new Map();
  for (const content of pages) {
    const jp = tplField(content, "技能名");
    const cn = tplField(content, "中文名");
    if (jp && cn) map.set(normName(jp), cn);
  }
  return map;
}

/** 支援卡：ID -> { cn 全名, charCn 角色名 }（bwiki Template:支援卡）。 */
async function fetchBwikiCardCn() {
  const pages = await fetchBwikiPages("Template:支援卡");
  const map = new Map();
  for (const content of pages) {
    const id = tplField(content, "ID");
    const cn = tplField(content, "中文名");
    const charCn = tplField(content, "关联角色");
    // 最新卡常只填了角色中文名(关联角色)而没填完整中文名(中文名)，也要收录
    if (id && (cn || charCn)) map.set(id, { cn, charCn });
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

  // ---- bilibili wiki 中文名（日服技能页，含中文译名）----
  console.log("[data] 读取 bwiki 技能中文名（Template:技能）…");
  const skillCnByJp = await fetchBwikiSkillCn();
  console.log(`[data] bwiki 技能中文名 ${skillCnByJp.size} 条`);
  console.log("[data] 读取 bwiki 支援卡中文名（Template:支援卡）…");
  const cardCnById = await fetchBwikiCardCn();
  console.log(`[data] bwiki 支援卡中文名 ${cardCnById.size} 条`);

  const id2jp = new Map(gtSkills.map((s) => [s.id, s.jpname]));
  const ourSkills = JSON.parse(fs.readFileSync(SKILLS_PATH, "utf8"));
  const ourSet = new Set(ourSkills.map((o) => normName(o.n)));

  // 技能中日对照：jp -> 简中（bwiki 按日文名直接对应）
  const skillCn = {};
  for (const o of ourSkills) {
    const jp = normName(o.n);
    const cn = skillCnByJp.get(jp);
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
      // Hint 技能 + 事件技能（含连续事件的金技能）合并
      const skillNames = [];
      const ids = [...(c.hints?.hint_skills ?? []), ...(c.event_skills ?? [])];
      for (const id of ids) {
        const jp = id2jp.get(id);
        if (!jp) {
          skipped += 1;
          continue;
        }
        const name = normName(jp);
        if (ourSet.has(name)) skillNames.push(name);
        else skipped += 1;
      }
      const cnInfo = cardCnById.get(String(c.support_id));
      return {
        id: c.support_id,
        name: `${c.title_ja ?? ""}${c.name_jp ?? c.char_name ?? ""}`,
        nameCn: cnInfo?.cn ?? "",
        char: c.name_jp ?? c.char_name ?? "",
        charCn: cnInfo?.charCn ?? "", // 无 bwiki 中文时留空，UI 回退显示日文
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
