# Velox 开发方案与实施计划（多上游统一调度版）

> 版本：1.0 · 2026-09-08
> **⚠️ 现状标注（2026-09-12）**：本文档中「多上游调度 / tcptest / ipip」相关章节已被实施决策取代——
> 上游已收敛为**仅 itdog**（provider 抽象骨架保留以备扩展），详见 `docs/PLAN-NODE-SELECTION.md`；
> 其余章节（前端体验/视觉/工程化）大部分已落地。本文保留作为决策历史。
> 定位：本文档是本项目下一步开发与重构的**总蓝图**，汇总了：现状评审结论、多上游抽象架构、统一调度策略、稳定 API 与部署、前端体验/视觉/无障碍优化、工程化补强，以及全部外部上游的实测接入评估。

---

## 目录

1. [项目现状与评审结论](#1-项目现状与评审结论)
2. [核心理念与范围界定](#2-核心理念与范围界定)
3. [部署形态决策：需要后端](#3-部署形态决策需要后端)
4. [外部上游接入可行性实测矩阵](#4-外部上游接入可行性实测矩阵)
5. [Provider 架构设计](#5-provider-架构设计)
6. [统一调度策略](#6-统一调度策略)
7. [稳定 API 与部署方案](#7-稳定-api-与部署方案)
8. [前端体验 / 交互 / 人文关怀优化](#8-前端体验--交互--人文关怀优化)
9. [前端视觉统一优化](#9-前端视觉统一优化)
10. [可访问性优化](#10-可访问性优化)
11. [工程化补强](#11-工程化补强)
12. [分阶段执行计划](#12-分阶段执行计划)
13. [风险与未知项](#13-风险与未知项)
14. [关于"优选"功能的明确界定](#14-关于优选功能的明确界定)

---

## 1. 项目现状与评审结论

### 1.1 项目是什么
**Velox**（原 itdog-cli，品牌在 `docs/BRAND.md`）—— 调用全国 290+ 监测点进行多节点测速的**非官方**平台，提供 **CLI** 与 **Web 控制台**两种形态，支持 ping / tcping / http / dns / traceroute / batch-ping / batch-tcping 7 种模式。

当前形态：TypeScript monorepo（pnpm workspace），后端协议层 + CLI + 独立 React 18 Web 前端。实测 `pnpm build`、`pnpm check:web`、`pnpm web:build` 全部通过，CLI 与 Web 对**线上 itdog 服务往返均成功**。

### 1.2 代码评审结论（P1–P4 问题清单）

| 优先级 | 问题 | 位置 |
|---|---|---|
| **P1** | 无任何单元测试（协议逆向逻辑最易回归） | 全项目 |
| **P2** | 品牌命名残留「Pulse」 | `tailwind.config.ts`、`web/package.json`、`docs/BRAND.md`、`index.html` |
| **P2** | 前端 bundle 偏大（962KB / gzip 300KB） | `web/vite.config.ts` 调高告警线至 1200KB |
| **P3** | Web 端逻辑重复（`downloadCsv`/`frameOk` 与后端 `toCsv`/`normalizeFrame` 口径不完全一致） | `ResultPanel.tsx` |
| **P3** | 部分错误处理静默吞错（节点表写入/历史/刷新 catch 空） | `nodes.ts`、`server.ts` |
| **P4** | 部署方式原始（手动 `node dist/cli.js serve`，无 Dockerfile / systemd / CI 发布） | 全项目 |
| **P4** | 依赖版本偏新（React 19 / Vite 8 / TS 5.9 / undici 8） | `package.json` |
| **P4** | README 监测点「290+」与实际快照 293 不一致 | `README.md` |
| **P4** | `pnpm-workspace.yaml` 的 `allowBuilds` 疑误改 | `pnpm-workspace.yaml` |
| **P4** | 协议常量（WS_SALT / GUARD_*）硬编码源码，接口变更需改代码+重发版 | `config.ts` |

### 1.3 优点（保留）
- 架构分层清晰：协议层 / CLI / Web 分离良好，`service.ts` 的 `runTest` 是 CLI 与 Web 共用唯一入口。
- 逆向工程质量高：WS 握手/退避/重连、guard 双层求解（vm 沙箱 + 公式兜底）、http 耗时单位换算、地图 GeoJSON 环绕向适配都处理到位且有注释。
- 安全意识成熟：输入校验、数值夹取、路径穿越防护、SSE 头部已发送兜底、请求体/内存/历史/并发上限。
- 类型严格（strict + 前后端 `--noEmit`），前后端类型契约镜像清晰。

---

## 2. 核心理念与范围界定

用户对本项目方向的明确界定：

- **本项目只做「测速」这一件事**，不做「优选」。
- **不单点依赖 itdog**，抽象 provider 层 + 统一调度器，支持多上游负载均衡。
- **「优选」功能由未来将开发的另一个新项目负责**，该新项目**依托本项目的 API** 进行优选。

因此本方案**明确移除**此前建议的 `optimize`（多 CDN 优选）模式，聚焦于把「测速」这一件事做成：多上游、统一调度、稳定 API、体验与视觉双优化。

---

## 3. 部署形态决策：需要后端

**结论：必须保留后端**，形态为「前端纯展示 + 后端多上游网关/调度器」（即现有 `src/web/server.ts` + `src/service.ts` 架构）。**不能纯前端**，原因：

1. **跨域（CORS）是硬约束**：itdog、tcptest.cn、tcping.cn、IPIP、t.bt.cn、antping.com 都是第三方站点，浏览器同源策略会拦截跨域 `fetch`/WS，且这些站点不会给本项目开 CORS 头。
2. **反爬/鉴权必须在服务端**：itdog 的 guard 需执行混淆 JS + cookie 罐 + node:vm 沙箱（浏览器无 vm 沙箱）；IPIP 需 `token`；tcping.cn 需 ALTCHA + PoW。这些都不能放前端。
3. **负载均衡是集中逻辑**：多上游的优先级、健康检查、故障切换、限频节流若放前端，等同每个标签页各自为战，会同时打爆多个上游且不可控。
4. **密钥/令牌不能暴露在浏览器端**：任何上游的 salt / token 都不能下发到前端。

**扩展点**：保持后端，在 `service.ts` 里把「itdog 单上游」抽象成「provider 接口 + 统一调度器」，前端完全不用改协议层。

---

## 4. 外部上游接入可行性实测矩阵

> 以下矩阵基于**实测/联网核对验证（非推测）**。

| 上游 | 功能 | 多节点/线路 | 无浏览器复现 | 鉴权 | 关键端点 | 反爬强度 | 结论 |
|---|---|---|---|---|---|---|---|
| **itdog**（现役） | ping/tcping/http/dns/traceroute/batch | ✅ 全国 290+ | ✅（已跑通） | 无（但走 guard 反爬） | `/ping/:host` 表单 + WSS 流 | 中（guard） | ✅ **现役保底** |
| **tcptest.cn**（Probex） | ping/tcping/http/mtr/dns/traceroute/ip | ✅ 全国+分运营商 | ✅ **纯 REST+轮询** | **无（实测直接建任务）** | `GET /api/v1/nodes`、`POST /api/v1/tasks`、`GET /api/v1/tasks/{id}/results` | **低-中（当前无验证码）** | ✅ **首选低成本接入** |
| **IPIP.net**（tools.ipip.net） | ping/trace/dig（DNS） | ✅ 全国+海外 | ✅ **HTTP GET REST** | **需 `?token=`** | `GET /v1/source`、`GET /v1/ping/{SourceID}/{HOST}/{ipv4}`、`GET /v1/trace/{...}`、`GET /v1/dig/{SourceID}/{HOST}` | 低（无 WS） | ✅ **可低成本接入**（需 token，单节点逐源查询） |
| **tcping.cn** | ping/tcping/http/dns/mtr/连续 | ✅ 全球 200+ | ⚠️ 每步被验证码包 | 无（被验证码拦） | `/api/probe/options|nodes|page|task|captcha-*` | **高（ALTCHA+PoW+WSS）** | ⚠️ 功能最全，逆向成本高 |
| **t.bt.cn** | http/ping/tcp/dns | 是（众包） | ❌ 未确认 | **疑似要登录** | 未发现公开端点 | 高 | ❌ 现阶段不可用 |
| **antping.com** | ip/ping/port | ❌ **非多节点拨测平台** | 不适用 | — | 无（仅天地图） | — | ❌ 无对等价值 |

### 4.1 上游要点归纳

**tcptest.cn（Probex）** —— 接入成本最低、确定性最高
- 多节点、分运营商，`POST /api/v1/tasks` 无鉴权即可建任务（实测成功），`GET /tasks/{id}/results` 拿逐节点结果。
- 纯 HTTP REST + 轮询，无浏览器可复现，无验证码（当前）。
- 节点带 `region/operator/province/city` 结构化字段，易于归一化。
- ⚠️ 需实测确认：`type` 合法枚举（ping/tcping/http/mtr/dns/traceroute 是否全支持）、配额/限流（`cost_units` 字段暗示计费模型）。

**IPIP.net（tools.ipip.net）** —— 从官方文档核对后可低成本接入
- 官方文档明确提供 4 个 HTTP GET 端点，返回 JSON：
  - `http://netbox.ipip.net/v1/source` —— 获取全部测试节点（如「天津(联通)」「重庆(电信)」+ 海外节点）
  - `http://netbox.ipip.net/v1/ping/{SourceID}/{HOST}/{IPVERSION}` —— 从指定节点 ping（`IPVERSION` 仅 ipv4/ipv6）
  - `http://netbox.ipip.net/v1/trace/{SourceID}/{HOST}/{IPVERSION}` —— 从指定节点 traceroute
  - `http://netbox.ipip.net/v1/dig/{SourceID}/{HOST}` —— 从节点做 DNS 解析（A/AAAA/CNAME）
- **所有请求需 `?token=TOKEN`**（`user.ipip.net` 可注册获取），无登录流、无 WebSocket。
- ⚠️ **与 itdog/tcptest 的差异**：IPIP 是**单节点逐源**查询（一次查一个 SourceID），不是「一次建任务收全部节点」。因此接入时需**并发或串行遍历多个 SourceID** 聚合，调度器要多一层「按节点展开 + 聚合」。
- ⚠️ **无 tcping API**（只有网页版 `portcheck.php`），故 IPIP 不提供 tcping/端口检测、也不提供 HTTP 测速。

**tcping.cn** —— 本次只留 provider 插槽，不做深逆
- 功能最全（含 mtr/连续 ping），但每步被 ALTCHA 验证码 + Proof-of-Work + 页面令牌 + WebSocket 包裹，直接无浏览器硬撬成本高。

**t.bt.cn / antping.com** —— 目前不具备接入价值
- t.bt.cn：页面抓取未发现任何公开 `/api`/`/monitor`/`/probe`/WS 端点，任务创建疑似需登录进 `/console`。
- antping.com：确认**不是**多节点全国拨测平台（是 IP 查询/Ping/端口检测小工具，依赖天地图），无对等上游价值。

### 4.2 上游接入优先级建议

| 优先级 | 上游 | 说明 |
|---|---|---|
| 1 | itdog | 现役保底，数据最成熟 |
| 2 | tcptest.cn | 首选低成本，纯 REST 无鉴权，本次实现 |
| 3 | IPIP.net | 可低成本接入（需 token），本次实现（仅 ping/trace/dig，单节点逐源） |
| 4 | tcping.cn | 功能最强但逆向成本高，**本期只留 provider 插槽**，后续可单独立项深度逆 |
| 5 | t.bt.cn / antping.com | **放弃**（不可用/无对等价值），不纳入 provider 实现 |

---

## 5. Provider 架构设计

### 5.1 新增文件
```
src/providers/types.ts        # Provider 统一接口 + 通用类型
src/providers/registry.ts     # 已注册 provider 列表 + 选择/调度逻辑
src/providers/itdog.ts        # 承接现有 client/ws/modes/nodes/guard（原样搬迁，改 import）
src/providers/tcptest.ts      # tcptest.cn（Probex）新实现
src/providers/ipip.ts         # IPIP.net 新实现（单节点逐源）
```

### 5.2 核心接口
```ts
interface SpeedTestProvider {
  id: string;                      // 'itdog' | 'tcptest' | 'ipip' | ...
  name: string;                    // 展示名
  supportedModes: Mode[];          // 各自支持哪些模式
  buildTaskSpec(modeOpts): ProviderTaskSpec;
  createTask(spec): Promise<ProviderTask>;
  streamKind: 'websocket' | 'http-poll' | 'per-node-poll';
  normalizeFrame(frame, mode): Frame;
  rateLimit: { createIntervalMs, chunkSleepMs, maxRetries };
}
```

### 5.3 关键决策
- **保留现有接口字段名**：`Task{taskId,wssUrl,html}` 与 `TaskSpec{path,referer,form,label}` 已是「provider 无关」的好形状，只把 `wssUrl` 广义化为 `streamEndpoint`、`path` 广义化为 `endpoint`，语义放宽。
- **结果获取差异**经 `streamKind` 判定：
  - `websocket` → 走现役 `streamTask`（itdog）
  - `http-poll` → 新增 `pollResults`（tcptest：`GET /tasks/{id}/results` 轮询）
  - `per-node-poll` → 新增 `runPerNode`（ipip：遍历 SourceID 单个查询聚合）

### 5.4 itdog provider 抽取（把硬编码分离）
把以下**全部下沉到 itdog provider**，让通用层（service/aggregate/selectNodes/web-server 状态机）不再依赖 itdog 语义：
- `config.ts`：`BASE_URL` / `WS_SALT` / `GUARD_XOR_SUFFIX` / `LINE_CODES` / `CARRIER_BY_LINE` / `PROVINCE_BY_CODE` / `REGION_BY_CODE`
- `modes.ts`：`buildTaskSpec` 的 path / referer / form
- `client.ts`：HTML 解析（task_id / wss_url）+ guard 求解 + `postForm` 头部
- `nodes.ts`：`updateFromHtml` 的 `<optgroup>/<option>` 解析 + `refreshNodesFromSite` 抓取源
- `aggregate.ts`：编码映射（`CARRIER_BY_LINE` 等）、`'Not Found'` 判定、`secondsToMs`（itdog http 单位秒）
- `service.ts:50` 的 `CATEGORY_TO_LINE`、`nodes.ts` 的 `specToLineValues`
- `src/guard/solver.ts`：整文件为 itdog WAF 专属，作为 itdog provider 内部实现，不外泄到通用层

---

## 6. 统一调度策略

**优先级 + 故障自动切换**（用户已确认）。

- **默认优先级**：`itdog → tcptest → ipip`（itdog 数据成熟、现役；tcptest 纯 REST 兜底；ipip 需 token 作补充）。
- **故障自动切换**：某 provider 创建任务失败（限频 429 / 创建任务失败 / 超时 / 上游报错）且重试耗尽时，记录 `provider_failed`，按优先级切到下一个；全部失败才向上抛错。
- **结果标注**：`RunResult` 增加 `provider?: string`（标注结果来自哪个上游），Web 端与历史记录都展示。
- **用户可指定**：`TestRequest` 增加 `provider?: 'auto' | 'itdog' | 'tcptest' | 'ipip'`，默认 `auto`（按优先级自动切换），允许手动指定某上游。
- **调度器**：外层新增调度逻辑，`runTest` 收 `provider` 选择后按上述策略执行。分片/间歇/重试常量按 provider 的 `rateLimit` 配置，而非全局写死。

---

## 7. 稳定 API 与部署方案

### 7.1 面向未来项目的 API 契约
未来优选项目**依托本项目的 API**，故把 `/api` 收敛成稳定契约（保持现有 `RunResult`/`TestSummary`/`Frame` 形状，不破坏 Web 前端）：

- 新增 `GET /api/meta/providers`：列出可用上游、各自能力（supportedModes）、当前健康度。
- `TestRequest` 支持 `provider` 字段（校验合法值）。
- 可选 **API-KEY 鉴权**：环境变量 `VELOX_API_KEY`，设置后 `/api/tests`、历史读写需带 `Authorization: Bearer <key>`；默认不开启（不影响 Web 本地使用）。
- 结果/历史保留不变，增加 `provider` 标注字段。
- 后续可扩展：`GET /api/meta/providers/:id/health`（备选方案）。

### 7.2 Dockerfile + docker-compose.yml
- **Dockerfile**：多阶段构建（`pnpm install` → `pnpm build && pnpm web:build` → 运行 `node dist/cli.js serve`），镜像内打包 `web/dist` 由后端服务。
- **docker-compose.yml**：暴露 8818 端口；`VOLUME` 持久化 `~/.cache/itdog-cli`（节点表 + 历史 + 未来各上游的节点/结果缓存）；环境变量注入 `VELOX_API_KEY`、各 provider 开关（如 `PROVIDER_TCPTEST_ENABLED`、`PROVIDER_IPIP_TOKEN`）。
- `package.json` 增加 `docker:build` / `docker:up` 脚本。

---

## 8. 前端体验 / 交互 / 人文关怀优化

### 8.1 上手难度与引导
- **首屏分步入门**：把单卡片流程改为清晰「1 输入目标 → 2 选择节点 → 3 开始测速」节奏。
- **模式解释**：7 种模式加 `HelpCircle` tooltip / 说明，解释「什么是 tcping / traceroute / 批量」的意义（现仅一行 hint）。
- **高级选项说明**：给「指定解析 / method / 重定向 / referer / cookie / UA」每个字段加说明 tooltip + 示例 placeholder（当前全是裸 Label）。
- **一键填入示例**：空态/首屏提供「填入示例」按钮，降低 0 输入门槛。

### 8.2 加载等待 + 可取消
- **接入闲置的 `Progress` 组件**（`ui/progress.tsx` 全项目未用）：运行卡显示「已收帧 / 总节点」真实进度，不再干等。
- **「停止本次测试」按钮**：前端加停止键 + 后端加 `DELETE /api/tests/:id`（取消任务）端点，用户配错参数可立即放弃，避免干等默认 90s。
- **排队提示优化**：加预计等待 / 队列位置提示。
- **SSE 断线提示**：运行卡加「连接中断，自动重连中…」。
- **长等待趣味**：显示品牌感加载文案/进度动画（BRAND ：「测速等待的几十秒是用户情绪最高点」）。

### 8.3 错误与人文关怀
- **错误必带动作**（BRAND 「错误必带动作」硬规则）：错误态 / 创建失败 / 限频 toast 都加「重试 / 用上次参数重跑 / 重置表单」按钮。
- **429 限频专项引导**：识别「检测频率过高」/ 上游限频，提示「建议稍候 1 分钟」而非笼统报错。
- **保留上次参数**：失败后可用一键重跑，避免重填。

---

## 9. 前端视觉统一优化

对照 `docs/BRAND.md` 规范修偏差：

1. **删页级光晕**：`App.tsx:183` 的 radial 渐变光晕（BRAND「不要」清单直踩；LOGO 自带光晕属品牌元素，保留）。
2. **字重**：`font-bold`(700) → `font-semibold`(600)（`BrandLogo.tsx` / `NavBar.tsx` / `ResultPanel.tsx` 三处；BRAND 限制 Inter 只用 400/500/600）。
3. **语义色 token 化**：
   - 地图硬编码 hex（`ChinaMap.tsx` 的 `GRADE_FILL` / `LEGEND`）改读 `--grade-*` token；
   - `badge.tsx` 的 emerald/sky/amber/red 命名色归一到 grade 语义 token；
   - 指标卡 / TopN 的 emerald/amber/sky 统一。
4. **圆角统一**：非必要 `rounded-full` 药丸改 8-10px（BRAND 8-12px 精密感），保留 NavBar 品牌胶囊。
5. **阴影弱化**：暗色下 Card/Button/Badge 阴影偏向 1px 描边（BRAND「1px 描边 > 阴影」）；浮层（dialog/popover/tooltip）保留阴影。
6. **补质量字标（无障碍硬性规则）**：地图省份 + tooltip、TopN 徽章、实时帧行、海外均值——全部补「优/良/中/差」文字，不只靠颜色（色盲用户）。
7. **清理死资产**：`Progress`（启用）、`Tabs` / `Separator` / `brand-gradient-text`（启用或移除）。

---

## 10. 可访问性优化

1. 给自定义 `<button>` 补 `focus-visible:ring-2 ring-ring`（`TestForm` 模式 / method / DNS、`NodePicker` 预设与瓷砖、`ResultPanel` 筛选清除）。
2. 地图省份 `<path>` 加 `tabindex` / `role="button"` / `onKeyDown`，或提供等价「省份列表」可点替代入口（当前仅 `onClick`/`onMouseMove`，键盘不可达）。
3. 模式 tablist 语义完整化：子按钮补 `role="tab"` + `aria-selected` + 方向键导航，或改用 `role="group"` + `aria-pressed`（当前 `role="tablist"` 下无 `role="tab"`）。
4. 运行成功/失败计数 `hidden sm:flex` 改移动端也可见。

---

## 11. 工程化补强

1. **补单元测试（最大短板）**：新增 `vitest`，用已抓样例帧/HTML 做 fixture，锁住 `provinceCodeFromName`（曾一次修 7 区划）、`buildSummary` 聚合、`selectNodes` 选择器、guard 公式兜底、tcptest/ipip 字段映射。
2. **拆前端 bundle**（962KB / gzip 300KB）：地图 `ChinaMap` 懒加载（`React.lazy`）、`lucide-react` 按需导入、framer-motion 换 `motion` 主包或按需；`chunkSizeWarningLimit:1200` 降到合理值。
3. **品牌残留 Pulse→Velox 全清**：`tailwind.config.ts` 注释、`web/package.json`（`pulse-web`→`velox-web`）、`docs/BRAND.md`、`index.html` 的 `pulse-theme` 兼容读取。
4. **`pnpm-workspace.yaml` 修复**：`allowBuilds` 疑误改 → 正确的 `onlyBuiltDependencies` 块。
5. **README 监测点数不一致**（290+ vs 实际 293）：改成动态/精确。
6. **协议常量运行时可配置**：`WS_SALT` / `GUARD_XOR_SUFFIX` / provider 开关支持环境变量或配置覆盖，源码留兜底值（降低接口变更发版成本）。

---

## 12. 分阶段执行计划

| 阶段 | 内容 | 验证方式 |
|---|---|---|
| **1** | provider 抽象 + itdog provider 抽取 + 调度器（**仅重构/搬迁，不改对外行为**） | `pnpm build` + CLI 冒烟回归（行为不变） |
| **2** | tcptest.cn 接入（先 ping，配置开关） | 跑一次 tcptest 测速 |
| **3** | IPIP.net 接入（ping/trace/dig，需 token，单节点逐源） | 跑一次 IPIP 测速（配置 `token` 后） |
| **4** | 稳定 API + API-KEY + Dockerfile/compose | `docker compose up` curl 冒烟 |
| **5** | 前端体验/视觉优化 + 可访问性 + 死资产清理 | `pnpm check:web` + 浏览器截图（深浅两主题） |
| **6** | 工程化补强 + README | `pnpm build && pnpm web:build && vite test` |

> 阶段 1 是纯重构、最低风险，先验证协议层没被抽坏；阶段 2 起才引入新功能与视觉变更。

---

## 13. 风险与未知项

1. **tcptest.cn 未完全实测**：`type` 合法枚举、限流/配额（`cost_units` 暗示计费模型）、能稳定白嫖的节点数。→ 做成配置开关，默认只开已验证的 ping 模式，其余模式逐步验证再开放。
2. **IPIP.net 需 token**：`token` 通过 `user.ipip.net` 注册获取；且 IPIP 是**单节点逐源**查询（一次一个 SourceID），需额外「按节点展开 + 聚合」层，且**无 tcping / 无 HTTP 测速**。→ 接入时明确只有 ping/trace/dig 能力，且需用户配置 token。
3. **tcping.cn 逆向成本高**：ALTCHA + PoW + 页面令牌 + WSS 包裹，**本期只留 provider 插槽，不实现**；后续可单独立项深度逆。
4. **t.bt.cn / antping.com 放弃**：不可用 / 无对等价值，不纳入 provider 实现。
5. **tcptest.cn 上游分页 cursor 有 bug（已实测确认）**：`/api/v1/nodes` 与 `/api/v1/tasks/{id}/results` 的 `next_cursor` 不前进、`has_more` 恒 true，导致翻页死循环。已用「翻页上限 + 按 uuid 去重 + cursor 不前进检测」规避；但节点表仅能抓到 93 个在线节点（任务 `expected_results:149`），结果中约 39 个节点的 uuid 不在节点表内，其延迟数据真实、节点名/运营商显示「未知」。这是 tcptest 上游数据完整性限制，非本项目缺陷，后续可深挖其正式 API 或直接消费任务全量结果。
6. **字体/圆角/色统一是主观取舍**：按 BRAND.md 收敛，但「地图省份是否保留药丸」「NavBar 胶囊是否维持」等纯品味项以品牌文档为准，用户可随时指出偏好。

---

## 14. 关于"优选"功能的明确界定

- **本项目（Velox）**：只做测速 + 多上游统一调度 + 稳定 API。**不做优选**。
- **未来新项目**：依托本项目的 API（`GET /api/tests`、`/api/history`、`/api/meta/providers` 等）做 IP/CDN 优选。
- 因此本方案的 API 设计（§7.1）已为未来优选项目预留稳定契约与 API-KEY 鉴权，但本项目内**不实现任何优选逻辑**。

---

*文档结束。本方案为后续所有开发的蓝图，详细实现阶段将按 §12 分阶段推进，每阶段独立验证后再进入下一阶段。*
