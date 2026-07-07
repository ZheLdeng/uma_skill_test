#!/usr/bin/env node
/** 端到端验证：预处理 -> 主OCR + 数字OCR -> extractGameState -> 打印命中技能与 Hint。 */
import fs from "node:fs";
import { PNG } from "pngjs";
import Tesseract, { createWorker, PSM } from "tesseract.js";
import skills from "../src/data/skills.json" with { type: "json" };
import {
  buildNumberTokens,
  computePrepScale,
  createSkillIndex,
  extractGameState,
} from "../src/lib/ocr.js";

const imgPath = process.argv[2] || "/Users/a/Desktop/3.png";

const src = PNG.sync.read(fs.readFileSync(imgPath));
const scale = process.argv[3] ? Number(process.argv[3]) : computePrepScale(src.width, src.height);
const contrast = Number(process.argv[4] || 2.4);

const w = Math.round(src.width * scale);
const h = Math.round(src.height * scale);
const out = new PNG({ width: w, height: h });
for (let y = 0; y < h; y++) {
  const y0 = Math.min(src.height - 1, Math.floor(y / scale));
  for (let x = 0; x < w; x++) {
    const x0 = Math.min(src.width - 1, Math.floor(x / scale));
    const i = (y0 * src.width + x0) * 4;
    const g = src.data[i] * 0.299 + src.data[i + 1] * 0.587 + src.data[i + 2] * 0.114;
    const v = Math.max(0, Math.min(255, (g - 128) * contrast + 128));
    const p = (y * w + x) * 4;
    out.data[p] = out.data[p + 1] = out.data[p + 2] = v;
    out.data[p + 3] = 255;
  }
}
const prep = "/Users/a/develop/Develop/Develop/uma/scripts/.tmp-pipe.png";
fs.writeFileSync(prep, PNG.sync.write(out));

const result = await Tesseract.recognize(prep, "jpn+eng", { logger: () => {} });

const digitWorker = await createWorker("eng");
await digitWorker.setParameters({
  tessedit_char_whitelist: "0123456789%",
  tessedit_pageseg_mode: PSM.SPARSE_TEXT,
});
const digit = await digitWorker.recognize(prep);
const numberTokens = buildNumberTokens(digit.data);
await digitWorker.terminate();

const index = createSkillIndex(skills);
const state = extractGameState(result.data, index, numberTokens);

console.log(`\n===== ${imgPath}  scale=${scale.toFixed(2)} contrast=${contrast} =====`);
console.log("切者:", state.hasCut);
console.log("数字token:", numberTokens.map((t) => `${t.value}${t.isPercent ? "%" : ""}`).join(" "));
console.log("识别技能:");
for (const s of state.recognizedSkills) {
  console.log(`  ${s.name}  Lv${s.hint}${s.hasCut ? "(切)" : ""}  (score=${s.score.toFixed(2)}, src="${s.sourceText}")`);
}
