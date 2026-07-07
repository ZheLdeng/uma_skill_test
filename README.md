# Uma OCR Score Tool

赛马娘 OCR 凹分工具。它可以通过浏览器窗口共享持续监控游戏窗口，把监控期间识别到的技能、Hint、适性和切者状态累积到结果表，并按凹分/技能测验公式计算性价比。

## 功能

- 持续监控窗口：点击 `监控窗口` 后选择赛马娘窗口，工具会定时 OCR 当前画面。
- 累积技能：监控期间扫到的技能会按技能名合并，Hint 取最高识别等级。
- 自动参数识别：尽量识别技能名、Hint、场地/距离/脚质适性，以及是否有切者。
- 手动修正：所有 Hint、适性、切者状态都可以在界面里手动改。
- 备用输入：支持上传截图和粘贴剪贴板截图。

## 计算规则

- 黄色技能：技能测验分 = 适应性评价分 + 1200。
- 白色技能：技能测验分 = 适应性评价分 + 400。
- 凹分性价比 = 适应性评价分 / 现价。
- 技能测验性价比 = 技能测验分 / 现价。
- 适应性评价分 = 评价分 × 适性系数（SA/A ×1.1，BC ×0.9，DEF ×0.8，G ×0.7）；默认全 S 时黄条技能即为 gamewith 展示的评价点。

## 更新技能数据库

技能数据以 [gamewith 评价点模拟器](https://gamewith.jp/uma-musume/article/show/279309) 为唯一权威源。运行更新脚本即可全量重建并打印与本地数据的差异：

```bash
npm run update-skills          # 拉取 gamewith 并重建 skills.json / upgrade-map.json
npm run update-skills -- --dry # 只看差异不写文件
```

脚本会解析页面里的 `skillDatas`，按 `c` 判定稀有度、按 `r` 映射适性、按升级链（`p` 字段）累加评价点与价格，并从绿技能的双档数值拆出 `○`/`◎` 两行。

## OCR 折扣（Hint）识别

截图里技能的 Hint 等级通过"现价 PT 反算"得到：读出画面显示的现价，与技能原价比对折扣档位（1级 10%、2级 20%、3级 30%、4级 35%、满级 40%）反推 Hint；若折扣比无切者最大档还低，则判定为切者。数字用独立的数字白名单 OCR pass 识别以提升准确率。

离线验证 OCR（需要 `pngjs`，已作为 devDependency 安装）：

```bash
node scripts/ocr-pipeline.mjs /path/to/screenshot.png
```

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

本项目是纯前端 SPA，可直接部署到 GitHub Pages，用户打开网址即用、无需安装任何依赖。

- 已内置 GitHub Actions 工作流 `.github/workflows/deploy.yml`：推送到 `main` 会自动构建并部署。
- 首次启用：仓库 `Settings → Pages → Build and deployment → Source` 选 **GitHub Actions**。
- 部署地址：`https://zheldeng.github.io/uma_skill_test/`（`vite.config.js` 里的 `base` 已按仓库名 `uma_skill_test` 设置；换仓库名要同步改）。

说明：

- 窗口监控（`getDisplayMedia`）与剪贴板读取需要 HTTPS，GitHub Pages 自带 HTTPS，满足要求。建议用 Chrome / Edge。
- 首次 OCR 会从 CDN 下载日文/英文识别模型（几 MB），需要联网；之后浏览器会缓存。
- 技能数据是构建时打包进去的静态 JSON，更新数据需维护者本地跑 `npm run update-skills` 后重新推送（浏览器端因跨域无法直接抓 gamewith）。

## 使用说明

1. 打开赛马娘技能页或适性页。
2. 在工具里点击 `监控窗口`。
3. 在浏览器弹窗中选择游戏窗口。
4. 慢慢滚动技能列表，等待工具多轮 OCR。
5. 识别结果会累积在表格中；必要时手动修正 Hint 或适性。

## 参考

- OCR 与持续监控思路参考 [Cilda/UmaUmaChecker](https://github.com/Cilda/UmaUmaChecker)。
- 技能数据来自 [gamewith 评价点模拟器](https://gamewith.jp/uma-musume/article/show/279309)，通过 `npm run update-skills` 生成。
