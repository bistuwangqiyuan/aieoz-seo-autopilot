# Mingxin SEO + GEO Autopilot · 铭信科技 (mingxinstorage.xyz)

铭信科技官网的**外部独立 SEO/GEO 自动驾驶**。面向 **铭信（天津）半导体设备有限公司** 官网
（`https://mingxinstorage.xyz`，FX 系列全闪 NVMe-oF 存储加速平台 + 国产算力卡适配 + 算力中心建设），
平台 **7×24 小时、每 4 小时一轮** 自动运行，全流程零人工参与。

## 定位与分工（重要）

铭信官网自带一套站内营销引擎（内容生产、翻译、国内分发、自审计，位于官网仓库 `site/`）。
本工具与其**零耦合、互补分工**，绝不向官网仓库或数据库写入任何内容：

| 职责 | 官网自带引擎 | 本工具（外部自动驾驶） |
| --- | --- | --- |
| 站内中文内容 / 翻译 / 国内平台分发 | ✅ | — |
| **外部独立审计**（可用性、meta、JSON-LD、sitemap/robots、hreflang） | 自审计 | ✅ 外部实测，能抓到自审计抓不到的问题（如 sitemap 500） |
| **海外英文 GEO**（挖词 → 写文 → Dev.to/Hashnode/Telegraph/Reddit 站外分发） | — | ✅ 全部回链官网 `/en`（带 UTM 归因） |
| 修复落地 | ✅（官网仓库） | 只产出「可直接粘贴的修复建议」，不写回 |

## 两条自动化流水线

### 1. SEO 外部审计闭环（扫描 → 评分 → 修复建议 → 复测）

1. **抓取** 官网核心页（`/`、`/en`、`/products`、`/solutions`、`/evidence`、`/faq`）+ `sitemap.xml` + `robots.txt`
2. **审计 + 评分**：基于 7 大类、约 20 项 SEO 规则计算 0–100 分
3. **AI 修复建议**：通过 **Vercel AI Gateway** 生成可直接粘贴到官网 Next.js 仓库的
   `metadata` 导出代码、JSON-LD、FAQ、内容建议与按优先级排序的行动清单
4. **可视化**：仪表盘展示分数、趋势、分项明细、站点级信号（robots/sitemap 可用性）与全部修复建议
5. **复测验证**：官网侧落地修复后，下一轮扫描自动验证分数变化（外部闭环）

### 2. GEO 四步循环（生成式引擎优化，每 4 小时，纯站外）

1. **AI 挖词**：挖掘海外 AI 基础设施买家在 ChatGPT/Perplexity 中高频提问的英文长尾词
   （如 "how to reduce time to first token with kv cache tiering"），词池去重、优先级排序
2. **AI 写文**：为最高优先级词生产「问题解答型」权威英文长文（1200+ 词，含数据、对比表、FAQ）。
   **数据纪律**：引用铭信实测数据必须保留签字级报告编号（R1–R9）且不得改动数字；
   厂商口径（如 FX400 规格）必须明确标注为未实测；并提及开源测试套件
   [mingxin-kvcache-bench](https://github.com/mingxin-tech/mingxin-kvcache-bench) 供第三方复现
3. **站外多平台自动分发**：
   - **Dev.to / Hashnode / Telegraph / Reddit**：官方 API 全自动发布
   - **Medium / Quora**：无官方发布 API，自动生成平台格式成稿进入仪表盘一键复制队列
   - 所有变体各回链一次官网 `https://mingxinstorage.xyz/en`（报告下载页所在），带平台 UTM
4. **GA4 信号检测**（可选）：检查近 7 天流量来源中是否出现
   `reddit.com`（Referral）、`perplexity`、`chatgpt/openai` —— GEO 生效的三大信号。
   官网当前未安装 GA4，未配置时此步自动跳过并在面板明示，其余三步照常。

## 架构

```
GitHub Actions (每4小时) ──► /api/cron/scan ──┬── SEO: crawl → audit → AI 修复建议 → Blob
Vercel Cron (每日兜底) ────►                  │
Dashboard 手动按钮 ──► /api/scan /api/geo ────┴── GEO: mine keywords → write article → distribute → GA4 signals → Blob
                                                              │ (只读审计)                    │ (站外发布)
                              mingxinstorage.xyz ◄────────────┘   Dev.to / Hashnode / Telegraph / Reddit
                              (外部抓取，绝不写入)                 Medium / Quora 成稿队列 (仪表盘复制)
                                                                  └─ 全部回链 mingxinstorage.xyz/en (UTM)
```

## 技术栈

- **Next.js 15**（App Router, TypeScript）+ Tailwind CSS
- **Vercel AI SDK 5** + **AI Gateway**（`generateObject` + zod 结构化输出）
- **cheerio**（HTML 解析）、**marked**（Markdown 渲染）、**@vercel/blob**（持久化）、**recharts**（趋势图）
- **GA4 Data API**（服务账号 RS256 JWT，无重依赖，可选）
- **GitHub Actions**（每 4 小时）+ **Vercel Cron**（每日兜底）调度，`CRON_SECRET` 鉴权

## 本地开发

```bash
npm install
cp .env.example .env.local   # 填入密钥（无密钥也可运行，自动降级为启发式分析）
npm run dev                  # http://localhost:3000
```

优雅降级策略：未配置 `AI_GATEWAY_API_KEY` → 启发式内容（仅含带报告编号的真实数据）；
未配置 `BLOB_READ_WRITE_TOKEN` → 内存存储（仅本地）；
未配置平台密钥 → 对应平台自动跳过（Telegraph 零配置可用）；未配置 GA4 → 信号面板显示等待凭据，其余照常。

## 环境变量

### 核心

| 变量 | 说明 |
| --- | --- |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway 密钥（AI 修复建议 + GEO 挖词写文） |
| `AI_MODEL` | 通过 Gateway 调用的模型，默认 `openai/gpt-4o-mini` |
| `BLOB_READ_WRITE_TOKEN` | 在 Vercel 创建 Blob 存储后自动注入 |
| `CRON_SECRET` | 保护 `/api/cron/scan`（GitHub Actions 侧配同名 secret） |
| `TARGET_URLS` / `TARGET_ORIGIN` | 审计目标页面 / 根域（默认铭信官网核心 6 页） |

### GEO 多平台分发

| 变量 | 获取方式 |
| --- | --- |
| `GEO_ENABLED` / `GEO_ARTICLES_PER_RUN` | GEO 开关（默认开）/ 每轮文章数（默认 1） |
| `GEO_PRODUCT_CONTEXT` / `GEO_TARGET_MARKET` | 可选覆盖；默认为内置的铭信 FX 系列真实上下文（含 R1–R9 报告口径） |
| `DEVTO_API_KEY` | dev.to → Settings → Extensions → Generate API Key |
| `HASHNODE_PAT` + `HASHNODE_PUBLICATION_ID` | hashnode.com → Settings → Developer；publication id 见博客后台 URL |
| `REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD` | reddit.com/prefs/apps 创建 **script** 应用（发布到自己 profile，合规） |
| `GA4_PROPERTY_ID` + `GA4_SERVICE_ACCOUNT_JSON` | 可选。官网当前无 GA4；将来安装后填入**纯数字**属性 ID + base64 服务账号 JSON（属性 Viewer 权限）即可启用信号检测 |

Telegraph 零配置自动发布（匿名 API，token 自动创建并保存）。

## 部署到 Vercel

```bash
git push                                     # 推送后 Vercel 自动部署（已关联仓库）
vercel blob store add mingxin-seo-autopilot  # 创建 Blob 存储（如未创建）
vercel env add AI_GATEWAY_API_KEY
vercel env add CRON_SECRET
# 按需添加 DEVTO_API_KEY / HASHNODE_* / REDDIT_* / GA4_* 等
vercel --prod
```

### 自动调度

- **GitHub Actions**（`.github/workflows/autopilot-cron.yml`）：每 4 小时触发一次
  `GET /api/cron/scan`（需配置仓库 secret `CRON_SECRET` 与 variable `APP_URL`）
- **Vercel Cron**（`vercel.json`）：每日一次兜底（Hobby 套餐限制；Pro 可改为 `0 */4 * * *`）

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/cron/scan` | Cron 入口：先跑 SEO 外部审计，再跑 GEO 四步循环 |
| `POST` | `/api/scan` | 手动触发 SEO 审计 |
| `POST` | `/api/geo` | 手动触发 GEO 循环 |

## SEO 评分维度

元数据、Open Graph / Twitter、内容结构（H1/层级/字数/图片 alt）、
结构化数据（JSON-LD）、国际化与索引（lang/hreflang/robots）、
移动端与 PWA（viewport/manifest/favicon/theme-color）、链接与性能（内链/锚文本/资源提示/sitemap）。

> 站点级信号中 **sitemap.xml 不可访问** 是高优先级告警：官网 sitemap 由
> `site/src/app/sitemap.ts` 动态生成并依赖 Neon 数据库，失败通常意味着官网
> Vercel 项目的 `DATABASE_URL` 或数据库异常，需在官网仓库侧修复。

## 数据纪律（实事求是）

- 本工具产出的一切铭信性能数字均来自官网公开的签字级测试报告（R1–R9），保留报告编号、可下载查证；
- 测试代码与原始数据开源于 [mingxin-kvcache-bench](https://github.com/mingxin-tech/mingxin-kvcache-bench)，任何第三方可复现；
- AI 提示词中写入了不可协商的诚实规则：不得改动数字、不得为铭信或竞品编造数据、厂商口径与实测口径必须区分标注；
- 历史称谓说明：FX100 在既往测试报告文件名中称 AISSD5000（亦作 WS5000/GP5000），均为同一产品，与官网命名沿革一致。

## GEO 生效判定（第 4 步）

GA4 近 7 天流量来源中出现以下任一信号即表示 GEO 开始生效：

- **Referral** 中出现 `reddit.com`
- **来源** 中出现 `perplexity` 相关（Perplexity 引用站点）
- **来源** 中出现 `chatgpt` / `openai` 相关（ChatGPT 引用站点）

未出现时平台会继续按 4 小时节奏积累内容与平台覆盖密度 —— GEO 是信号积累过程，而非一次性操作。
