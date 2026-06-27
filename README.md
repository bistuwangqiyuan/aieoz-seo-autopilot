# AI SEO Autopilot · 中科存储 (goni.top)

全自动、无人值守的 **AI 驱动 SEO 优化平台**。面向 **中科存储 ZK-Storage WS5000** 官网（`https://goni.top`），
平台 **7×24 小时** 自动运行，全流程零人工参与：

1. **抓取** 目标页面、`sitemap.xml`、`robots.txt`
2. **审计 + 评分**：基于 7 大类、约 20 项 SEO 规则计算 0–100 分
3. **AI 优化**：通过 **Vercel AI Gateway** 生成可直接落地的优化产物
4. **持久化**：评分快照与历史趋势存入 **Vercel Blob**
5. **可视化**：实时仪表盘展示分数、趋势、分项明细与优化产物

> 说明：平台对 goni.top 仅做 **分析 + 产物生成**（不直接写入目标站点）。
> 它输出可一键复制、直接粘贴到目标页面 `<head>` 或站点根目录的优化产物。

## 架构

```
Vercel Cron (每小时)  ─┐
Dashboard「立即运行」 ─┼─►  /api/(cron/)scan
                        │        │
                        │   crawl (cheerio)
                        │        ▼
                        │   audit + score
                        │        ▼
                        │   AI optimize (AI Gateway · generateObject)
                        │        ▼
                        └─►  Vercel Blob (latest.json + history.json) ─► Dashboard /
```

## 技术栈

- **Next.js 15**（App Router, TypeScript）+ Tailwind CSS
- **Vercel AI SDK 5** + **AI Gateway**（`generateObject` + zod 结构化输出）
- **cheerio**（HTML 解析）、**@vercel/blob**（持久化）、**recharts**（趋势图）
- **Vercel Cron** 调度 + `CRON_SECRET` 鉴权

## 本地开发

```bash
npm install
cp .env.example .env.local   # 填入密钥（无密钥也可运行，自动降级为启发式分析）
npm run dev                  # http://localhost:3000
```

未配置 `AI_GATEWAY_API_KEY` 时，AI 引擎会自动降级为内置的启发式产物生成，
未配置 `BLOB_READ_WRITE_TOKEN` 时，使用进程内内存存储（仅本地）。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway 密钥（用于 AI 生成优化产物） |
| `AI_MODEL` | 通过 Gateway 调用的模型，默认 `openai/gpt-4o-mini` |
| `BLOB_READ_WRITE_TOKEN` | 在 Vercel 创建 Blob 存储后自动注入 |
| `CRON_SECRET` | 保护 `/api/cron/scan`，Vercel Cron 以 Bearer Token 形式发送 |
| `TARGET_URLS` | 待优化页面（逗号分隔），默认 goni.top 中/英文首页 |
| `TARGET_ORIGIN` | 目标站点根域，用于 sitemap/robots 检查 |

## 部署到 Vercel

```bash
# 1. 推送到 GitHub
git init && git add -A && git commit -m "feat: AI SEO autopilot"
git remote add origin <your-repo-url>
git push -u origin main

# 2. 在 Vercel 关联该仓库（或使用 CLI）
vercel link
vercel blob store add ai-seo-autopilot     # 创建 Blob 存储，自动注入 BLOB_READ_WRITE_TOKEN
vercel env add AI_GATEWAY_API_KEY           # 粘贴 AI Gateway 密钥
vercel env add CRON_SECRET                  # 任意长随机字符串
vercel --prod
```

### 自动调度

`vercel.json` 中已配置每小时一次的 Cron：

```json
{ "crons": [{ "path": "/api/cron/scan", "schedule": "0 * * * *" }] }
```

> **注意**：每小时 Cron 需要 **Vercel Pro** 套餐。若使用 Hobby 免费套餐，
> 请将 `schedule` 改为 `0 0 * * *`（每日一次）。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/cron/scan` | Vercel Cron 调用，需 `Authorization: Bearer $CRON_SECRET` |
| `POST` | `/api/scan` | 仪表盘「立即运行」手动触发 |

## SEO 评分维度

元数据、Open Graph / Twitter、内容结构（H1/层级/字数/图片 alt）、
结构化数据（JSON-LD）、国际化与索引（lang/hreflang/robots）、
移动端与 PWA（viewport/manifest/favicon/theme-color）、链接与性能（内链/锚文本/资源提示/sitemap）。
