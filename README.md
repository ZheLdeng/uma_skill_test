# Uma Score Tool

赛马娘凹分工具。选择本次编成的支援卡，自动带出这些卡可获取（Hint）的技能，再按需手动添加其它技能，工具按凹分/技能测验公式计算每个技能的性价比，帮你决定该点哪些技能。

## 功能

- 马娘选择：选中育成马娘后自动带入其**适性**（场地/距离/脚质）、**自带白技能**（初期技能）并显示**固有金技能**。
- 支援卡编成：搜索并选择最多 6 张支援卡（可按类型/稀有筛选），自动把这些卡的 Hint 技能 + 事件技能（含连续事件金技能）加入候选。
- 手动添加技能：搜索技能名一键加入候选，覆盖上述之外的情况。
- 中日对照：技能与卡名支持中/日双语显示与搜索（中文取自 bilibili wiki）。
- 参数可调：切者、凹分/技能测验模式、适性、每个技能的 Hint 等级都能手动改。
- 一键 Hint：支援卡技能一键 Hint5、马娘自带技能一键 Hint3、清空 Hint。
- 结果表：按性价比/评价分/PT 排序，可只看已持有技能；「来源」列用头像显示该技能来自哪张卡/哪只马娘；金技能黄色、白技能灰色。

## 计算规则

- 黄色技能：技能测验分 = 适应性评价分 + 1200。
- 白色技能：技能测验分 = 适应性评价分 + 400。
- 凹分性价比 = 适应性评价分 / 现价。
- 技能测验性价比 = 技能测验分 / 现价。
- 适应性评价分 = 评价分 × 适性系数（SA/A ×1.1，BC ×0.9，DEF ×0.8，G ×0.7）；默认全 S 时黄条技能即为 gamewith 展示的评价点。
- 现价折扣按 Hint 等级：1级 10%、2级 20%、3级 30%、4级 35%、满级 40%（切者各档再便宜一级）。

## 数据来源与更新

技能与支援卡数据都由脚本从官方数据源生成，可一键刷新并打印差异：

```bash
npm run update-skills            # 技能库：gamewith 评价点模拟器
npm run update-skills -- --dry   # 只看差异不写文件

npm run update-support-cards            # 支援卡库：GameTora（含每张卡的 Hint 技能）
npm run update-support-cards -- --dry   # 只看差异不写文件
```

- 技能库来自 [gamewith 评价点模拟器](https://gamewith.jp/uma-musume/article/show/279309)：解析 `skillDatas`，按 `c` 判稀有度、按 `r` 映射适性、按升级链（`p`）累加评价点与价格、绿技能双档拆成 `○`/`◎`。
- 支援卡库 / 马娘库来自 [GameTora](https://gametora.com/umamusume/supports)：读取 `support-cards`、`skills`、`character-cards`；支援卡取 `hint_skills`+`event_skills`，马娘取适性、初期技能、固有技能。
- 中文名来自 [bilibili wiki](https://wiki.biligame.com/umamusume)：技能按日文名对应中文名（日服技能页 `Template:技能`），支援卡/角色按 ID 对应，生成 `skill-cn.json`。

> 数据是构建时打包进去的静态 JSON。更新数据需维护者本地跑上面的脚本后重新提交（浏览器端跨域无法直接抓取）。

## 本地运行

```bash
npm install
npm run dev
```

打开 Vite 输出的本地地址，通常是：

```text
http://localhost:5173/
```

## 构建

```bash
npm run build
```

构建产物会输出到 `dist/`。

## 在线版本（GitHub Pages，免安装）

本项目是纯前端 SPA，可直接部署到 GitHub Pages，用户打开网址即用、无需安装任何依赖，也不依赖任何后端。

- 已内置 GitHub Actions 工作流 `.github/workflows/deploy.yml`：推送到 `main` 会自动构建并部署。
- 首次启用：仓库 `Settings → Pages → Build and deployment → Source` 选 **GitHub Actions**。
- 部署地址：`https://zheldeng.github.io/uma_skill_test/`（`vite.config.js` 里的 `base` 已按仓库名 `uma_skill_test` 设置；换仓库名要同步改）。

## 使用说明

1. 在"马娘"里选择本次育成的马娘，适性与自带技能自动带入。
2. 在"支援卡编成"里点选本次的支援卡（最多 6 张），候选技能自动带出。
3. 需要额外技能时用"手动添加技能"加入。
4. 设置切者/模式；用「支援卡 Hint5」「马娘自带 Hint3」批量设 Hint，或在结果表里逐个改。
5. 按性价比排序，决定优先点哪些技能。

## 参考

- 技能数据来自 [gamewith 评价点模拟器](https://gamewith.jp/uma-musume/article/show/279309)，通过 `npm run update-skills` 生成。
- 支援卡数据来自 [GameTora](https://gametora.com/umamusume/supports)，通过 `npm run update-support-cards` 生成。
