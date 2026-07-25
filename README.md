# Mingxin SEO + GEO Autopilot · 铭信科技 (mingxinstorage.xyz)

铭信科技官网的**外部独立 SEO/GEO 自动驾驶**。面向 **铭信（天津）半导体设备有限公司** 官网
（`https://mingxinstorage.xyz`，FX 系列全闪 NVMe-oF 存储加速平台 + 国产算力卡适配 + 算力中心建设），
平台 **7×24 小时、每 4 小时一轮** 自动运行，全流程零人工参与。

当前实测口径：官网 sitemap 自动发现 **225 个 URL**，每轮审计 38 页、约 6 轮（≈1 天）覆盖全站；
GEO 文章主回链指向官网 **112 个英文页面**中最相关的深层落地页，而非一律倒进首页。

## 定位与分工（重要）

铭信官网自带一套站内营销引擎（内容生产、翻译、国内分发、自审计，位于官网仓库 `site/`）。
本工具与其**零耦合、互补分工**，绝不向官网仓库或数据库写入任何内容：

| 职责 | 官网自带引擎 | 本工具（外部自动驾驶） |
| --- | --- | --- |
| 站内中文内容 / 翻译 / 国内平台分发 | ✅ | — |
| **外部独立审计**（可用性、meta、JSON-LD、sitemap/robots、hreflang） | 自审计 | ✅ 外部实测，能抓到自审计抓不到的问题（如 sitemap 500、hreflang 缺 x-default） |
| **海外英文 GEO**（挖词 → 写文 → Dev.to/Hashnode/Telegraph/Reddit 站外分发） | — | ✅ 回链官网最相关的深层落地页（带 UTM 归因） |
| 修复落地 | ✅（官网仓库） | 只产出「可直接粘贴的修复建议」，不写回 |

## 两条自动化流水线

### 1. SEO 外部审计闭环（扫描 → 评分 → 修复建议 → 复测）

1. **发现目标**：抓取官网 `sitemap.xml` 自动发现全部 URL（实测 225 个），按
   `core / topic / compare / scenario / solution / insight` 分类缓存进 Postgres，官网新增页面零维护自动纳入
2. **规划本轮**：核心页每轮必审，其余按「最久未审优先」轮转，单轮 38 页；
   约 6 轮（≈1 天，按 4 小时节奏）扫完全站。轮转的原因是单轮全量会让存档快照膨胀数倍 —— 抓取本身实测仅需 3.5 秒
3. **审计 + 评分**：基于 7 大类、约 20 项 SEO 规则计算 0–100 分（并发上限 5，避免对官网造成突发压力）
4. **跨页检查**（单页审计看不到的问题）：canonical 是否自指、中英 hreflang 是否成对且有 `x-default`、
   sitemap 内 URL 轮转抽样可达性
5. **AI 修复建议**：生成可直接粘贴到官网 Next.js 仓库的 `metadata` 导出代码、JSON-LD、FAQ、
   内容建议与按优先级排序的行动清单
6. **可视化 + 复测**：仪表盘展示分数、趋势、覆盖率进度条、跨页问题与全部修复建议；
   官网侧落地修复后下一轮自动验证分数变化（外部闭环）

### 2. GEO 循环（生成式引擎优化，每 4 小时，纯站外）

1. **AI 挖词**：挖掘海外 AI 基础设施买家在 ChatGPT/Perplexity 中高频提问的英文长尾词。
   提示词注入官网现有 topic/compare/scenario slug，优先挖「官网有强落地页但站外无英文内容」的词；
   新词与存量文章做**语义去重**（重叠系数 ≥0.7 判为改写并丢弃），并禁止在关键词里写死报告编号
2. **AI 写文**：为最高优先级词生产「问题解答型」权威英文长文（1200+ 词，含数据、对比表、FAQ）。
   生成后有确定性质量闸门：字数、对比表、FAQ 三项任一不达标即带着具体缺陷描述回炉重写一次。
   **数据纪律**：引用铭信实测数据必须保留签字级报告编号（R1–R9）且不得改动数字；
   R1–R9 的被测设备统一是 FX100，不得把这些数字安到 FX200/FX300/FX400 头上；
   厂商口径（如 FX400 规格）必须明确标注为未实测；并提及开源测试套件
   [mingxin-kvcache-bench](https://github.com/mingxin-tech/mingxin-kvcache-bench) 供第三方复现
3. **站外多平台自动分发**：
   - **Dev.to** 首发（技术受众最对口、权重最高，不设 canonical），**Hashnode / Telegraph** 跨发时声明 Dev.to 为原发地，
     避免两份拷贝互相稀释；**Reddit** 发到账号自己的 profile
   - **Medium / Quora**：无官方发布 API，自动生成平台格式成稿进入仪表盘一键复制队列
   - **双链策略**：主回链指向官网最相关的深层落地页（由 slug 词面匹配 + IDF 加权 + AI 选页解析得出），
     次链指向 `/en/evidence`（R1–R9 报告下载入口），均带平台 UTM
4. **存量回链回溯**：早期文章全部回链首页；每轮用 Telegraph `editPage` 把一批存量文章改指对应深层页
5. **事实一致性巡检**：按「最久未检优先」复核已发布正文，命中违规规则时由 AI 依据已核实资料重写并回写平台；
   重写后仍不合规的文章会在面板列出，而不是被默认放过
6. **效果监测**：AI 引擎认知度 + 文章存活与回链（口径与局限见下文）
7. **GA4 信号检测**（可选）：检查近 7 天流量来源中是否出现
   `reddit.com`（Referral）、`perplexity`、`chatgpt/openai`。
   官网当前未安装 GA4，未配置时此步自动跳过并在面板明示，其余步骤照常。

## 架构

```
GitHub Actions (每4小时) ──► /api/cron/scan ──┬── SEO: sitemap 发现 → 轮转规划 → crawl → audit
Vercel Cron (每日2次兜底) ──►                 │        → 跨页检查 → AI 修复建议 → Postgres
Dashboard 手动按钮 ──► /api/scan /api/geo ────┴── GEO: 挖词 → 写文 → 分发 → 回链回溯
                                                       → 一致性巡检 → 效果监测 → Postgres
                                    │ (只读审计)                     │ (站外发布)
              mingxinstorage.xyz ◄──┘   Dev.to (首发) / Hashnode / Telegraph / Reddit
              (外部抓取，绝不写入)         Medium / Quora 成稿队列 (仪表盘复制)
                                          └─ 主链 → 官网深层落地页，次链 → /en/evidence (均带 UTM)
```

## 技术栈

- **Next.js 15**（App Router, TypeScript）+ Tailwind CSS
- **Vercel AI SDK 5** + **AI Gateway**（`generateObject` + zod 结构化输出）
- **持久化三级降级**：Neon Postgres（`DATABASE_URL`，JSONB KV 表 `autopilot_kv`）→ Vercel Blob → 内存（本地）
- **cheerio**（HTML 解析）、**marked**（Markdown 渲染）、**recharts**（趋势图）
- **GA4 Data API**（服务账号 RS256 JWT，无重依赖，可选）
- **GitHub Actions**（每 4 小时）+ **Vercel Cron**（每日 2 次兜底）调度，`CRON_SECRET` 鉴权

## 本地开发

```bash
npm install
cp .env.example .env.local   # 填入密钥（无密钥也可运行，自动降级为启发式分析）
npm run dev                  # http://localhost:3000
```

优雅降级策略：AI 引擎按 Gateway → DeepSeek → 通义 qwen-plus → GLM-4-flash → Moonshot kimi-k3
逐级自动切换（任一密钥可用即走 AI，全部失败才降级）；完全无 AI 密钥 → 启发式内容（仅含带报告编号的真实数据）；
持久化按 `DATABASE_URL`（Neon Postgres）→ `BLOB_READ_WRITE_TOKEN`（Vercel Blob）→ 内存（仅本地）三级降级；
未配置平台密钥 → 对应平台自动跳过（Telegraph 零配置可用）；未配置 GA4 → 信号面板显示等待凭据，其余照常。

## 环境变量

### 核心

| 变量 | 说明 |
| --- | --- |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway 密钥（主 AI 引擎：修复建议 + GEO 挖词写文） |
| `AI_MODEL` | 通过 Gateway 调用的模型，默认 `openai/gpt-4o-mini` |
| `DEEPSEEK_API_KEY` / `TONGYI_API_KEY` / `MOONSHOT_API_KEY` / `GLM_API_KEY` | 备用 AI 引擎（按此顺序自动 fallback，任意子集即可；全部 OpenAI 兼容） |
| `DATABASE_URL` | Neon Postgres 连接串（首选持久化，自动建 `autopilot_kv` 表） |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob（备用持久化） |
| `CRON_SECRET` | 保护 `/api/cron/scan`（GitHub Actions 侧配同名 secret） |
| `TARGET_URLS` / `TARGET_ORIGIN` | 根域，以及 sitemap 不可达时的降级审计清单（正常情况下审计目标由 sitemap 自动发现） |

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
vercel env add AI_GATEWAY_API_KEY
vercel env add CRON_SECRET
# 持久化：项目已挂 Neon 集成（DATABASE_URL 自动注入）；无 Neon 时可用 Blob
# 按需添加 DEVTO_API_KEY / HASHNODE_* / REDDIT_* / GA4_* 等
vercel --prod
```

### 自动调度

- **GitHub Actions**（`.github/workflows/autopilot-cron.yml`）：每 4 小时触发一次
  `GET /api/cron/scan`（需配置仓库 secret `CRON_SECRET` 与 variable `APP_URL`）。
  仓库为 public，Actions 免费额度不受私有仓库分钟数限制
- **Vercel Cron**（`vercel.json`）：**每日 2 次**兜底（`0 0 * * *` 与 `0 12 * * *`；Hobby 套餐限制，
  Pro 可改为 `0 */4 * * *`）。GitHub Actions 若因账号问题中断，这条兜底保证系统不会完全停摆

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/cron/scan` | Cron 入口：先跑 SEO 外部审计，再跑 GEO 循环 |
| `POST` | `/api/scan` | 手动触发 SEO 审计 |
| `POST` | `/api/geo` | 手动触发 GEO 循环（`{"dryRun":true}` 只写文不发布） |
| `GET` | `/api/status` | 只读运行状态：评分、覆盖率、逐篇落地页、效果指标与一致性巡检（`CRON_SECRET` 鉴权） |
| `GET` | `/api/progress` | 轻量进度查询，供面板按钮在长任务超时后恢复结果 |

## 自检脚本

均为只读或纯离线，可随时运行：

```bash
npx tsx scripts/test-integrity.ts                             # 一致性规则：拦截 34 条编造/错配 / 放行 21 条事实
npx tsx scripts/test-store.ts                                 # 存档往返：新增字段不被清洗函数悄悄丢弃
npx tsx scripts/test-backfill.ts                              # 回链改写：7 组边界用例，防止改坏线上文章
npx tsx --env-file=.env.local scripts/test-coverage.ts        # 审计轮转：覆盖率、并发、跨页检查（实抓官网）
npx tsx --env-file=.env.local scripts/test-keywords.ts        # 挖词去重 + 深层回链解析率
npx tsx --env-file=.env.local scripts/test-landing.ts         # 落地页解析器逐词对照
npx tsx --env-file=.env.local scripts/test-article.ts         # 端到端生成一篇并逐项校验（含零违规断言）
npx tsx --env-file=.env.local scripts/audit-live-articles.ts  # 线上正文合规核查（只读）
node scripts/verify-production.mjs                            # 对线上部署逐条核验各阶段验收标准
```

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

## 效果如何测量（以及测不到什么）

官网未部署 GA4，且本工具对官网保持零写入，因此**无法直接测量自然流量**。
与其把代理指标包装成结果，不如逐条讲清每个指标能回答什么、不能回答什么。

### 指标一：AI 引擎认知度

- **口径**：向 provider 链上每个模型提固定的 5 个买家问题（轮转，每轮 2 个），
  统计回答中出现 Mingxin / mingxinstorage.xyz / FX 系列 / mingxin-kvcache-bench 的比例。
- **局限（必须知道）**：当前 provider 链（DeepSeek / 通义 / GLM / Kimi）**均不联网检索**，
  测的是「模型训练数据里是否已有铭信」，不是「引擎刚刚读到了我们的文章」。
  这是**长期滞后指标**，数月内大概率维持在 0，**读数为 0 不代表分发无效**。
  若将来接入带检索的模型，其读数会以 `retrievalRate` 单独标注。

### 指标二：文章存活与回链

- **口径**：按发布时间轮转抽查已发布文章 URL，记录 HTTP 状态码，
  并检查页面正文里官网域名的回链是否仍然存在。
- **局限**：只能证明「文章还在、外链还在」，**不能证明搜索引擎已收录或有人点击**。
  它的价值在于兜住最坏情况 —— 平台删帖会让外链静默失效，不查就永远不会知道。

### 指标三：IndexNow —— 已评估为不可行

原计划的 IndexNow 自动提交**做不了，原因如下**（写在这里而不是悄悄跳过）：
IndexNow 要求提交方在**被提交 URL 所属域名**的根目录托管密钥文件。
我们的文章发布在 telegra.ph / dev.to / hashnode.dev 等第三方域名下，无法在这些域名放置密钥；
而官网 `mingxinstorage.xyz` 的密钥文件需由官网侧部署，超出本工具的零耦合边界。
本仓库 `public/` 下的密钥文件只对本仓库自身域名有效，用它提交上述任何 URL 都会被拒绝。

**替代**：指标二已经覆盖了「外链是否仍然有效」这一真正的风险点。
若需真实收录数据，需官网侧配置 Bing Webmaster / Search Console API —— 这属于官网团队的决策。

### GA4 信号（官网将来安装 GA4 后自动启用）

GA4 近 7 天流量来源中出现以下任一信号即表示 GEO 开始生效：
Referral 出现 `reddit.com`、来源出现 `perplexity`、来源出现 `chatgpt` / `openai`。

未出现时平台会继续按 4 小时节奏积累内容与平台覆盖密度 —— GEO 是信号积累过程，而非一次性操作。

## 事实一致性的自动兜底

提示词里的诚实规则是「请求」，不是「保证」—— 早期确实出现过一篇文章编造竞品实测数字。
因此加了一层确定性兜底（`lib/geo/integrity.ts`）：每轮复核一批已发布正文，
命中以下任一规则即判为违规，交给 AI 依据已核实资料重写并回写平台，全程无人工介入。

| 规则 | 判违规的理由 |
| --- | --- |
| 无法证实的最高级表述（only vendor / industry-first / best-in-class…） | 铭信公开口径中没有这类排名主张 |
| 未经实测的软硬件栈（CANN / MindSpore / Atlas 800） | 名称未出现在已核实资料中，属模型自行补全 |
| 未测过的模型（Llama-N） | 实测覆盖 DeepSeek 系列与 480B 模型，未测过 Llama |
| 未公开的组网细节（InfiniBand / RoCEvN） | 公开测试配置里没有互联技术，写出即为编造 |
| 精确版本号（vLLM x.y.z） | 公开材料未标注版本号，会造成不可复现的引用 |
| 夸大证据强度（cryptographically signed / tamper-proof） | 报告是第三方联合测试签署，不是密码学签名 |
| 固件版本号 | 未公开，写出即为编造 |
| **无出处的数值**（任何不在已核实资料中的带单位数字） | 文章的全部说服力来自「每个数字都可下载复现」；举例值与实测值在读者眼里无法区分 |
| **张冠李戴的实测值**（把 R1–R9 数字安到 FX200/FX300/FX400 上） | 见下 |
| **把 FX400 写成在售或已实测** | 官网口径为 2026 年底量产、当前仅厂商标称值 |
| **把 AISSD5000/WS5000/GP5000 当作独立在售型号** | 官网明示这是 FX100 的历史称谓，仅保留在报告文件名中 |
| **引用 4.8 Tb/s、1.4 亿 IOPS 不标厂商口径** | 官网对每个数字都标注来源（实测/厂商/公开/估算），不标注会把预期读成测量 |

其中「张冠李戴」是最难发现的一类：官网证据库明示 R1–R9 的被测设备统一是 **FX100**
（`Device under test: Mingxin FX100`），FX200/FX300/FX400 是真实产品但**没有任何公开实测数据**。
于是「FX300 把 TTFT 降低 26–32%」这句话——型号是真的、数字是真的、报告编号也是真的——整句却是假的，
逐词校验和数值白名单都拦不住它。因此规则改为**按句校验归属**：一句话里出现实测数值却只提到未实测型号即判违规；
而「R1–R9 测的是 FX100，FX300 尚无公开实测」这类交代出处的句子会被放行——
规则不能通过「闭口不谈这些型号」来满足，那本身就是另一种失真。

同一个前提在挖词阶段就被拦下：`what benchmarks are available for fx300` 这类问题**没有诚实的答案**，
照实回答等于否定问题、答得流畅就等于编数据，所以这类词在入池时直接丢弃，
并且每轮会清理一次存量词池——先于规则入库的词否则会继续生产规则本要阻止的文章。

规则的反向也做了校验：`scripts/test-integrity.ts` 同时验证 34 条编造/错配表述被拦下、
21 条已核实事实（R1–R9 数字、Ascend 910B / MI308X、NVMe-oF、开源仓库名、
「FX300 尚无公开实测」等诚实表述）不被误伤 —— 误伤会把正确内容改坏，和漏判一样有害。

线上正文的独立核查用 `npx tsx --env-file=.env.local scripts/audit-live-articles.ts`（只读，复用同一套规则）。
