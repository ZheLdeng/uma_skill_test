# Requirements Document

## Introduction

赛马娘 OCR 凹分工具目前存在两个问题：

1. **技能数据库来源不透明且可能过期**：现有 `src/data/skills.json`（约 812 条）来自"用户提供的前端包"，与官方数据的对齐关系没有可复现的生成流程。已确认它与 gamewith 评价点模拟器约 99% 同步，但存在 11 个缺失技能、6 处数值差异，以及命名差异（`先` vs `先行`、圆圈字符 `◯/○`、`＆/&amp;` 等）。
2. **OCR 识别不准**：用户提供的截图 `/Users/a/Desktop/1.png`（656×546）里的技能名和折扣（Hint 等级）无法被正确识别。

本 spec 的目标是：建立一个**可复现的技能数据库生成流程**（数据源为 gamewith 评价点模拟器 `article/show/279309`），并**修复截图 OCR** 使其能稳定识别技能名与折扣等级。

数据源关键结论（已调研确认）：
- `skillDatas` 数组字段：`n`(名称)、`ap`(自身评价点)、`pt`(自身消耗 pt)、`c`(稀有度：1=普通/2=传说/3=固有)、`r`(适性限制码)、`p`(升级前低级技能名)。
- `r` → 适性映射：`1=芝 2=泥 3=短 4=英 5=中 6=长 7=逃 8=先 9=差 10=追`，组合如 `8/6`=先+长。
- 升级技能：总评价点 = `ap + 低级技能.ap`；总价 = `pt + 低级技能.pt`。
- 绿技能 `○/◎` 分级 `ap`/`pt` 用逗号分隔（低档,高档）。

## Requirements

### Requirement 1: 可复现的技能数据库生成流程（gamewith 为唯一权威）

**User Story:** 作为维护者，我希望有一个"更新脚本"，每次运行都以 gamewith 为准全量重建技能数据库，并打印与本地现有数据的差异，这样当官方更新技能时我能一键刷新并看到补充/变更了什么，而不用手工维护 JSON。

> 取舍决定：以 gamewith 为**唯一权威源**做**全量重建**（会采用 gamewith 规范名，如 `先→先行`；gamewith 中不存在的旧技能会被移除）。每次运行输出差异报告供复核。

#### Acceptance Criteria

1. WHEN 运行数据生成脚本 THEN 系统 SHALL 从 gamewith 评价点模拟器页面（`article/show/279309`）解析 `skillDatas`（及升级链所需的 `evoSkillDatas`）作为数据源。
2. WHEN 解析 `skillDatas` 中的一条技能 THEN 系统 SHALL 依据 `c` 字段映射稀有度（`1`→`普通`，`2`→`传说`），并 SHALL 跳过 `c=3`（固有技能，不可用技能点购买）。
3. WHEN 解析一条技能的 `r` 字段 THEN 系统 SHALL 使用映射 `{1:芝,2:泥,3:短,4:英,5:中,6:长,7:逃,8:先,9:差,10:追}` 生成 `c1`/`c2` 适性条件；WHEN `r` 缺失 THEN 系统 SHALL 将条件设为 `通用`。
4. WHEN 一条技能含 `p`（升级前低级技能）字段 THEN 系统 SHALL 计算总评价点为 `本技能.ap + 低级技能.ap`、总价为 `本技能.pt + 低级技能.pt`，并 SHALL 在 `upgrade-map.json` 中记录 `本技能名 → 低级技能名` 的映射。
5. WHEN 一条绿技能的 `ap`/`pt` 为逗号分隔的两档值 THEN 系统 SHALL 依据技能名后缀（`○` 取低档、`◎` 取高档）选取正确的数值。
6. WHEN 生成完成 THEN 系统 SHALL 输出 `skills.json` 与 `upgrade-map.json`，且字段结构 SHALL 与现有 `scoring.js` 使用的字段（`n,r,c,a,e,p,c1,c2`）兼容，使前端无需改动计算逻辑即可运行。
7. WHERE 生成结果与现有数据库对比 THE 系统 SHALL 输出一份差异报告（新增/删除/数值变更的技能清单），供维护者复核。
8. IF gamewith 页面结构发生变化导致解析失败 THEN 脚本 SHALL 以非零退出码报错并说明失败原因，而非静默产出空/错数据。

### Requirement 2: 技能名与字符规范化统一

**User Story:** 作为用户，我希望 OCR 识别出的技能名和数据库里的名字能对上，即使圆圈符号或全角符号不同，这样匹配才不会漏。

#### Acceptance Criteria

1. WHEN 比较或匹配技能名 THEN 系统 SHALL 统一规范化圆圈字符（`◯` U+25EF、`〇` → `○` U+25CB）。
2. WHEN 比较或匹配技能名 THEN 系统 SHALL 统一规范化连接符（`＆`、`&amp;` → `&`）。
3. WHERE 数据源使用 `先行` 前缀而现有命名使用缩写 `先` THE 生成流程 SHALL 采用数据源（gamewith）的规范名称作为权威名。
4. WHEN 规范化技能名 THEN 系统 SHALL 对新旧数据库保持一致的规范化规则，确保 OCR 匹配与数据展示使用同一套名称。

### Requirement 3: OCR 正确识别截图中的技能

**User Story:** 作为用户，我上传一张游戏技能页截图后，希望工具能把画面里的技能都识别并勾选出来，这样我不用手动逐个搜索。

#### Acceptance Criteria

1. WHEN 用户上传 `/Users/a/Desktop/1.png` 作为验证样本 THEN 系统 SHALL 识别出画面中出现的技能名（以该样本人工核对的技能清单为验收基准）。
2. WHEN 对截图做 OCR 前处理 THEN 系统 SHALL 采用适配小尺寸截图（如 656×546）的放大/增强策略，而非仅按固定 `maxWidth` 缩放。
3. WHEN OCR 输出文本存在常见误识别（如 `○`↔`O`/`0`、日文假名混淆）THEN 系统 SHALL 通过规范化与模糊匹配将其纠正到正确技能名。
4. WHEN 一个 OCR 文本行与多个候选技能相近 THEN 系统 SHALL 选取相似度最高且超过阈值的技能，避免误报无关技能。
5. WHERE 截图中包含适性行（场地/距离/脚质 + 等级）THE 系统 SHALL NOT 将适性行误判为技能。

### Requirement 4: OCR 正确识别折扣（Hint 等级）

**User Story:** 作为用户，我希望工具能读出每个技能对应的折扣/Hint 等级，这样凹分现价才能算对。

#### Acceptance Criteria

1. WHEN 截图中技能附近显示 Hint/折扣信息（如 `ヒント Lv.3`、`Lv3`、割引等级标识）THEN 系统 SHALL 提取出对应的 Hint 等级（0–5）。
2. WHEN Hint 等级识别成功 THEN 系统 SHALL 将其关联到正确的技能，并 SHALL 参与现价折扣计算。
3. IF 某技能未识别到 Hint THEN 系统 SHALL 默认其 Hint 为 0，而不影响其它技能。
4. WHEN Hint 数字被误识别为相近字符（如 `l`↔`1`、`S`↔`5`）THEN 系统 SHALL 在规范化后尽量纠正到有效等级。

### Requirement 5: 验证与回归

**User Story:** 作为维护者，我希望改动后能验证识别效果和数据正确性，这样才敢发布。

#### Acceptance Criteria

1. WHEN OCR 逻辑修改完成 THEN 系统 SHALL 提供一个可在 Node 环境运行的离线验证脚本，用 `1.png` 跑通识别流程并打印识别到的技能与 Hint。
2. WHEN 数据库生成脚本运行完成 THEN 系统 SHALL 校验输出 JSON 可被 `scoring.js` 的 `calculateSkillRows` 正常消费（无 `NaN`/缺字段导致的崩溃）。
3. WHEN 项目执行 `npm run build` THEN 构建 SHALL 成功通过，不因数据或代码改动而报错。
4. WHERE 存在识别未达标的技能 THE 验证脚本 SHALL 明确列出遗漏项，便于后续调参。
```
