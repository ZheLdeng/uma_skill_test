# Uma Score Tool

赛马娘凹分工具。选择本次编成的支援卡，自动带出这些卡可获取（Hint）的技能，再按需手动添加其它技能，工具按凹分/技能测验公式计算每个技能的性价比，帮你决定该点哪些技能。

## 功能

- 支援卡编成：搜索并选择支援卡（可按类型/稀有筛选），自动把这些卡的 Hint 技能加入候选。
- 手动添加技能：搜索技能名一键加入候选，覆盖支援卡之外的情况。
- 参数可调：切者、凹分/技能测验模式、场地/距离/脚质适性、每个技能的 Hint 等级都能手动改。
- 结果表：按性价比/评价分/PT 排序，可只看已持有技能。

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
- 支援卡库来自 [GameTora](https://gametora.com/umamusume/supports)：读取其数据清单里的 `support-cards` 与 `skills`，把每张卡的 `hint_skills`（技能 ID）映射成日文名，并只保留本地技能库中存在的技能。

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

1. 在"支援卡编成"里搜索并点选本次的支援卡，候选技能会自动带出。
2. 需要额外技能时，用"手动添加技能"搜索并加入。
3. 设置切者、模式、适性；在结果表里按需修改每个技能的 Hint 等级。
4. 按性价比排序，决定优先点哪些技能。

## 参考

- 技能数据来自 [gamewith 评价点模拟器](https://gamewith.jp/uma-musume/article/show/279309)，通过 `npm run update-skills` 生成。
- 支援卡数据来自 [GameTora](https://gametora.com/umamusume/supports)，通过 `npm run update-support-cards` 生成。
