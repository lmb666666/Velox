# Velox（itdog 测速与 IP 优选平台）

<p align="center">
  <img src="assets/brand/logo.svg" width="96" alt="Velox" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%E2%89%A518-22D3EE" alt="node >= 18" />
  <img src="https://img.shields.io/badge/License-MIT-22D3EE" alt="MIT License" />
  <img src="https://img.shields.io/badge/%E7%9B%91%E6%B5%8B%E7%82%B9-290%2B-38BDF8" alt="290+ 监测点" />
</p>

**Velox** —— 全国监测节点测速与 IP/CDN 优选平台。输入 IP/域名，自动调用 [itdog.cn](https://www.itdog.cn) 全国 290+ 监测点（电信/联通/移动/港澳台海外）完成测速，无需打开网页。提供 **CLI** 与 **Web 控制台** 两种使用方式，支持 ping / tcping / http / dns / traceroute 与批量多目标测试，为后续 Cloudflare/多 CDN 自动优选预留架构。

> 非官方接口工具，仅供个人测速学习使用；请控制频率，勿用于压测或批量抓取。
> **Inspect. Select. Accelerate.** —— 测速发现问题，优选解决问题。

## 快速开始

```bash
pnpm install
pnpm build && pnpm web:build

# Web 控制台（推荐）：浏览器打开 http://localhost:8818
pnpm serve

# 命令行（pulse 或 itdog 均可）
node dist/cli.js ping www.baidu.com
node dist/cli.js batch-ping 1.1.1.1 8.8.8.8 --nodes '北京,上海'
```

## Web 控制台

`pnpm serve` 后浏览器访问 `http://localhost:8818`：

- 7 种模式图形化配置，节点快捷预设 + 逐节点多选弹窗
- SSE 帧级实时结果流（波形 Logo 加载动效、数据行滑入过渡）
- 汇总指标卡、分线路条形图、最快 TopN、JSON/CSV 一键下载
- 历史记录（最近 50 次）回看、深浅色主题切换、响应式布局
- 基于 React 18 + Vite + Tailwind + shadcn/ui 组件体系 + framer-motion

详见 [docs/WEB.md](docs/WEB.md)。

## CLI 用法

```
node dist/cli.js <mode> <目标...> [选项]
  mode: ping（默认）| tcping | http | dns | traceroute | batch-ping | batch-tcping

  --nodes all|telecom|unicom|mobile|overseas|<关键词>|<节点ID>
  --port 443 --timeout 90 --top 5 --sort latency|loss
  --json FILE --csv FILE --proxy URL --quiet --refresh-nodes
```

完整命令参考与脚本集成示例见 [docs/TUTORIAL.md](docs/TUTORIAL.md)。退出码：0 成功 / 1 全部失败 / 2 协议错误。

## 品牌标识

品牌手册（命名故事、Logo 构造规格、色彩/字体/动效/语气规范）见 [docs/BRAND.md](docs/BRAND.md)，矢量资产位于 `assets/brand/`（logo.svg / logo-mono.svg / favicon.svg / lockup.svg）。

## 项目结构

```
src/
├── cli.ts          # CLI 入口（测速模式 + serve 子命令）
├── service.ts      # runTest 共用服务（CLI 与 Web 复用）
├── web/server.ts   # Web 后端：REST + SSE + 串行队列 + 历史
├── client.ts       # 任务创建：guard 重试状态机、HTML 解析
├── ws.ts           # 结果流：握手、空闲重发、重连
├── modes.ts        # 各模式路径与表单构造
├── nodes.ts        # 节点表：静态快照 + 自动刷新 + 选择器
├── aggregate.ts    # 帧归一化与聚合（运营商/省份/大区）
├── render.ts       # 终端表格、汇总、JSON/CSV
├── guard/solver.ts # guardret 求解（vm 沙箱 + 公式兜底）
web/                # Web 前端（React + Vite + Tailwind + shadcn/ui）
assets/
├── brand/          # 品牌 SVG 资产
├── nodes.json      # 节点表快照（294 监测点）
└── guard-auto.js   # itdog 官方 WAF 脚本快照
docs/
├── TUTORIAL.md     # CLI 完整使用教程
├── WEB.md          # Web 控制台指南
└── BRAND.md        # 品牌手册
scripts/
├── refresh-guard.mjs    # 更新 WAF 快照
└── extract-strings.mjs  # 从官方混淆 JS 提取 WS 盐等常量
```

## 协议实现（逆向说明）

工具直接复刻 itdog.cn 网页前端的调用链，未使用浏览器：

1. **创建任务**：带浏览器头 POST 表单到 `/ping/<host>`、`/tcping/<host>:<port>`、`/http/`、`/dns/<domain>`、`/traceroute/`、`/batch_ping/`、`/batch_tcping`
2. **反爬 WAF**：响应为 `/_guard/auto.js` 挑战时，取 `guard` cookie，在 node:vm 沙箱执行官方 auto.js 快照求出 `guardret` 回写重试（沙箱失败时退回公式：前 8 位作密钥 + 数字×2+16，与「密钥+`PTNo2n3Ev5`」异或后 base64）
3. **结果流**：从响应 HTML 提取 `task_id` 与 `wss_url`，连接 `wss://www.itdog.cn/websockets/<task_id>/<md5(task_id+盐)[8:24]>`（盐：`What this is is no longer important.`），握手 `{"task_id":...}`，收到 `{"type":"finished"}` 结束；空闲重发握手、零帧自动重连（复刻官方前端行为）

**维护提示**：若出现「WS 鉴权被拒 403」或大量节点无数据，多为 itdog 轮换了 token 盐或 guard 算法：盐值重新提取用 `pnpm extract-strings /tmp/icmp_ping.js --ws`（详见教程维护手册）；guard 算法运行 `pnpm refresh-guard` 即可。

## 免责声明 / Disclaimer

- 本项目为**非官方**工具，与 itdog.cn 无任何隶属、合作或授权关系；「itdog」名称及相关权益归其权利人所有，引用仅作数据来源说明。
- 项目通过分析网页前端接口实现自动化调用，**接口可能随时变更**；作者不对可用性、实时性、准确性作任何担保，因接口变更导致的功能失效请参考文档自行修复或等待更新。
- 本项目仅供**学习研究**与个人网络诊断使用。严禁用于高频抓取、压力测试、拒绝服务攻击或其他违反法律法规及目标网站服务条款的用途；因使用本项目产生的一切后果由使用者自行承担。
- 请合理控制调用频率（单机串行、间隔 ≥ 1 分钟）。如 itdog.cn 权利人对本项目有任何异议，请通过 Issue 联系，将及时调整或下线相关功能。

- This is an **unofficial** tool with no affiliation to itdog.cn. It is provided for educational purposes only, without any warranty. Do not use it for scraping, load testing, or any abusive/illegal activity. Use at your own risk.

## 贡献

欢迎 Issue / PR：修复协议变更、补充节点表、优化 UI 均可。提交前请运行 `pnpm build && pnpm web:build && pnpm check:web` 确保通过。

## 参考

协议还原过程参考了多个开源项目：[Sn0wo2/itdog-web-api](https://github.com/Sn0wo2/itdog-web-api)（TypeScript 库，guard 沙箱思路）、[6Kmfi6HP/itdog-skill](https://github.com/6Kmfi6HP/itdog-skill)、[wojiaoyishang/itdog-batch-ping](https://github.com/wojiaoyishang/itdog-batch-ping)、[Yingyya/itdog-api](https://github.com/Yingyya/itdog-api)。
