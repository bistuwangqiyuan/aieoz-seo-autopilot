# AI SEO + GEO Autopilot · 中科存储 (goni.top)

全自动、无人值守的 **AI 驱动 SEO / GEO 优化平台**。面向 **中科存储 ZK-Storage WS5000** 官网（`https://goni.top`），
平台 **7×24 小时、每 4 小时一轮** 自动运行，全流程零人工参与。

## 两条自动化流水线

### 1. SEO 闭环（扫描 → 评分 → 优化 → 写回）

1. **抓取** 目标页面、`sitemap.xml`、`robots.txt`
2. **审计 + 评分**：基于 7 大类、约 20 项 SEO 规则计算 0–100 分
3. **AI 优化**：通过 **Vercel AI Gateway** 生成可直接落地的优化产物
4. **自动写回**：将缺失的 meta/JSON-LD/sitemap 以最小 diff 自动 commit 回源码仓库（可开关/演练）
5. **可视化**：仪表盘展示分数、趋势、分项明细与优化产物

### 2. GEO 四步循环（生成式引擎优化，每 4 小时）

1. **AI 挖词**：挖掘欧美企业买家在 ChatGPT/Perplexity 中高频提问的英文长尾词
   （如 "best all-flash storage for gpu cluster training"），词池去重、优先级排序
2. **AI 写文**：为最高优先级词批量生产「问题解答型」权威英文长文
   （1200+ 词，含数据、对比表、行业术语、FAQ），自然带出 WS5000 与 goni.top 链接（带 UTM 归因）
3. **多平台自动分发**：
   - **goni.top 博客**：渲染为独立 HTML 页（Article JSON-LD + canonical），GitHub commit 自动上线，自动追加 sitemap
   - **Dev.to / Hashnode / Telegraph / Reddit**：官方 API 全自动发布（canonical 指回博客页）
   - **Medium / Quora**：无官方发布 API，自动生成平台格式成稿进入仪表盘一键复制队列
4. **GA4 信号检测**：检查近 7 天流量来源中是否出现
   `reddit.com`（Referral）、`perplexity`、`chatgpt/openai` —— GEO 生效的三大信号，
   仪表盘信号灯展示首次出现时间与会话数

## 架构

```
Vercel Cron (每4小时) ──► /api/cron/scan ──┬── SEO: crawl → audit → AI optimize → writeback → Blob
Dashboard 手动按钮 ──► /api/scan /api/geo ─┴── GEO: mine keywords → write article → distribute → GA4 signals → Blob
                                                            │
                    goni.top blog (GitHub commit) ◄─────────┤
                    Dev.to / Hashnode / Telegraph / Reddit ◄┤ (官方 API)
                    Medium / Quora 成稿队列 (仪表盘复制) ◄──┘
```

## 技术栈

- **Next.js 15**（App Router, TypeScript）+ Tailwind CSS
- **Vercel AI SDK 5** + **AI Gateway**（`generateObject` + zod 结构化输出）
- **cheerio**（HTML 解析）、**marked**（Markdown 渲染）、**@vercel/blob**（持久化）、**recharts**（趋势图）
- **GitHub Contents/Git Data API**（写回 + 博客发布）、**GA4 Data API**（服务账号 RS256 JWT，无重依赖）
- **Vercel Cron** 调度 + `CRON_SECRET` 鉴权

## 本地开发

```bash
npm install
cp .env.example .env.local   # 填入密钥（无密钥也可运行，自动降级为启发式分析）
npm run dev                  # http://localhost:3000
```

优雅降级策略：未配置 `AI_GATEWAY_API_KEY` → 启发式内容；未配置 `BLOB_READ_WRITE_TOKEN` → 内存存储（仅本地）；
未配置平台密钥 → 对应平台自动跳过；未配置 GA4 → 信号面板显示等待凭据，其余照常。

## 环境变量

### 核心

| 变量 | 说明 |
| --- | --- |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway 密钥（AI 产物 + GEO 挖词写文） |
| `AI_MODEL` | 通过 Gateway 调用的模型，默认 `openai/gpt-4o-mini` |
| `BLOB_READ_WRITE_TOKEN` | 在 Vercel 创建 Blob 存储后自动注入 |
| `CRON_SECRET` | 保护 `/api/cron/scan` |
| `TARGET_URLS` / `TARGET_ORIGIN` | 优化目标页面 / 根域 |

### SEO 写回 + GEO 博客发布

| 变量 | 说明 |
| --- | --- |
| `GITHUB_TOKEN` | 对目标源码仓库有 contents:write 权限的 PAT |
| `GONI_REPO` / `GONI_BRANCH` / `GONI_PUBLISH_DIR` | goni.top 源码仓库 owner/name、分支、发布目录 |
| `SEO_WRITEBACK_ENABLED` / `SEO_WRITEBACK_DRYRUN` | 写回开关 / 演练模式 |

### GEO 多平台分发

| 变量 | 获取方式 |
| --- | --- |
| `GEO_ENABLED` / `GEO_ARTICLES_PER_RUN` | GEO 开关（默认开）/ 每轮文章数（默认 1） |
| `DEVTO_API_KEY` | dev.to → Settings → Extensions → Generate API Key |
| `HASHNODE_PAT` + `HASHNODE_PUBLICATION_ID` | hashnode.com → Settings → Developer；publication id 见博客后台 URL |
| `REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD` | reddit.com/prefs/apps 创建 **script** 应用（发布到自己 profile，合规） |
| `GA4_MEASUREMENT_ID` | G- 开头的测量 ID（默认 `G-SZCSMKM793`），自动注入博客页与写回页面做前端埋点 |
| `GA4_PROPERTY_ID` + `GA4_SERVICE_ACCOUNT_JSON` | **纯数字**属性 ID（管理 → 媒体资源设置）+ base64 服务账号 JSON（授予属性 Viewer 权限），用于读取报表 |

Telegraph 零配置自动发布（匿名 API，token 自动创建并保存）。

## 部署到 Vercel

```bash
git push                                     # 推送后 Vercel 自动部署（已关联仓库）
vercel blob store add ai-seo-autopilot       # 创建 Blob 存储
vercel env add AI_GATEWAY_API_KEY
vercel env add CRON_SECRET
# 按需添加 GITHUB_TOKEN / DEVTO_API_KEY / REDDIT_* / GA4_* 等
vercel --prod
```

### 自动调度

`vercel.json` 已配置每 4 小时一次的 Cron：

```json
{ "crons": [{ "path": "/api/cron/scan", "schedule": "0 */4 * * *" }] }
```

> **注意**：高频 Cron 需要 **Vercel Pro** 套餐。Hobby 免费套餐请改为 `0 0 * * *`（每日一次）。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/cron/scan` | Cron 入口：先跑 SEO 扫描+写回，再跑 GEO 四步循环 |
| `POST` | `/api/scan` | 手动触发 SEO 扫描 |
| `POST` | `/api/geo` | 手动触发 GEO 循环 |

## SEO 评分维度

元数据、Open Graph / Twitter、内容结构（H1/层级/字数/图片 alt）、
结构化数据（JSON-LD）、国际化与索引（lang/hreflang/robots）、
移动端与 PWA（viewport/manifest/favicon/theme-color）、链接与性能（内链/锚文本/资源提示/sitemap）。

## GEO 生效判定（第 4 步）

GA4 近 7 天流量来源中出现以下任一信号即表示 GEO 开始生效：

- **Referral** 中出现 `reddit.com`
- **来源** 中出现 `perplexity` 相关（Perplexity 引用站点）
- **来源** 中出现 `chatgpt` / `openai` 相关（ChatGPT 引用站点）

未出现时平台会继续按 4 小时节奏积累内容与平台覆盖密度 —— GEO 是信号积累过程，而非一次性操作。
