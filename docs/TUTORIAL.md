# itdog-cli 完整使用教程

> 本工具现已升级为 **Velox** 品牌（IP/CDN 网络优选平台），品牌规范见 [docs/BRAND.md](BRAND.md)；除命令行外还提供 Web 控制台，见 [docs/WEB.md](WEB.md)。

本工具在本地命令行直接调用 [itdog.cn](https://www.itdog.cn) 的全国监测节点（290+ 个，覆盖电信/联通/移动/港澳台海外）进行测速：输入 IP 或域名，自动完成「创建测速任务 → 连接 WebSocket 收流 → 汇总输出」全过程，无需打开网页。适合日常网络诊断、CDN/IP 优选、脚本化监控等场景。

---

## 目录

1. [安装](#1-安装)
2. [30 秒上手](#2-30-秒上手)
3. [七种模式详解](#3-七种模式详解)
4. [节点选择 --nodes 完全指南](#4-节点选择---nodes-完全指南)
5. [输出结果解读](#5-输出结果解读)
6. [JSON / CSV 导出](#6-json--csv-导出)
7. [脚本化与自动化（cron / IP 优选）](#7-脚本化与自动化)
8. [代理与网络环境](#8-代理与网络环境)
9. [故障排查 FAQ](#9-故障排查-faq)
10. [维护手册（接口变动自救）](#10-维护手册)
11. [环境变量参考](#11-环境变量参考)
12. [已知限制与合规](#12-已知限制与合规)

---

## 1. 安装

### 1.1 环境要求

- **Node.js ≥ 18**（用了内置 fetch/vm，建议 20+；WSL2/Windows/macOS/Linux 均可）
- **pnpm**（包管理；`npm i -g pnpm` 或 corepack 自带）

检查环境：

```bash
node --version   # 应 ≥ v18
pnpm --version
```

### 1.2 安装步骤

```bash
cd /home/liang/project/better-ip
pnpm install          # 安装依赖
pnpm build            # TypeScript 编译到 dist/
```

### 1.3 三种调用方式（任选）

```bash
# 方式一：直接运行（无需任何配置）
node dist/cli.js ping www.baidu.com

# 方式二：全局软链为 itdog 命令（推荐，一次性配置）
pnpm link --global
itdog ping www.baidu.com

# 方式三：shell alias（加入 ~/.bashrc 或 ~/.zshrc）
alias itdog='node /home/liang/project/better-ip/dist/cli.js'
```

> 下文示例统一用 `itdog` 代替 `node dist/cli.js`。

### 1.4 修改代码后重新构建

```bash
pnpm build            # 重新编译；运行时读的是 dist/ 下的产物
```

---

## 2. 30 秒上手

```bash
# 全网 290+ 节点 ping 一个域名（约 30~45 秒）
itdog ping www.baidu.com

# 只测电信节点，静默模式，只看汇总
itdog ping www.baidu.com --nodes telecom --quiet

# 批量 ping 多个候选 IP，只测北京上海的节点（IP 优选场景）
itdog batch-ping 1.1.1.1 8.8.8.8 9.9.9.9 --nodes '北京,上海'

# 测一个网站在各节点的 HTTP 打开速度
itdog http https://www.baidu.com --nodes telecom
```

输出结构固定为三段：**实时逐节点进度 → 明细表格 → 汇总（总体/分线路/最快 TopN）**。

---

## 3. 七种模式详解

所有模式共用「通用选项」（见第 4、5 节），部分模式有专属选项。

### 3.1 ping —— 多节点 ICMP ping

```bash
itdog ping <域名或IP> [选项]
itdog <域名或IP>          # 首个参数不是子命令时，自动按 ping 处理
```

- 每个监测点对目标发 ICMP ping，返回一个代表性延迟值（毫秒）。
- 节点 DNS 解析失败时该节点标记 `✗ DNS 解析失败`。

```bash
itdog ping www.baidu.com                       # 全部节点
itdog ping 223.5.5.5 --nodes telecom,unicom    # 只测电信+联通
itdog ping www.baidu.com --nodes 上海 --top 10 # 名称含"上海"的线路，Top10
```

### 3.2 tcping —— TCP 端口连通性/延迟

```bash
itdog tcping <域名或IP> --port <端口>
```

- 监测点对 `目标:端口` 做 TCP 握手并返回耗时；连接失败的结果为 `-1`，工具显示为失败。
- 常用端口：`443`（HTTPS）、`80`（HTTP）、`22`（SSH）。

```bash
itdog tcping www.baidu.com --port 443 --nodes telecom
itdog tcping myserver.example.com --port 22 --nodes all
```

> 注意：`8.8.8.8:443`、`1.1.1.1:443` 这类境外 IP 的 TCP 连接受国际链路/防火墙影响，国内节点出现大量 `-1` 属正常现象。

### 3.3 http —— 网站打开速度测速

```bash
itdog http <URL> [专属选项]
```

- 各监测点模拟浏览器发起真实 HTTP 请求，返回状态码与分阶段耗时（DNS/连接/SSL/下载）。
- 目标没写协议时自动补 `https://`；跟随重定向默认 5 次。

专属选项：

| 选项 | 说明 | 默认 |
|---|---|---|
| `--check-mode fast\|slow` | fast=快速测试；slow=缓慢测试（更精细） | fast |
| `--method <m>` | 请求方法（get/post/...） | get |
| `--referer <url>` | 模拟的 Referer 头 | 空 |
| `--cookie <c>` | 模拟的 Cookie | 空 |
| `--redirects <n>` | 跟随重定向次数 | 5 |
| `--http-version <v>` | auto / http_1_1 / http_2 / http_3 | auto |

```bash
itdog http https://www.baidu.com --nodes telecom --quiet
itdog http my-api.example.com/health --method get --check-mode slow
itdog http https://example.com --http-version http_2
```

### 3.4 dns —— DNS 解析

```bash
itdog dns <域名> [--type <记录类型>] [--dns-server <服务器>]
```

- 各监测点用当地运营商 DNS（或自定义 DNS）解析域名，返回解析结果与耗时。

```bash
itdog dns www.baidu.com                          # A 记录，走各节点 ISP DNS
itdog dns example.com --type mx
itdog dns example.com --type a --dns-server 223.5.5.5
```

### 3.5 traceroute —— 路由跟踪（单节点 mtr）

```bash
itdog traceroute <域名或IP> [--nodes <选择器>]
```

- itdog 的 traceroute 为 **mtr 式持续探测**：选**一个**监测点，持续对路径上每一跳探测并汇报。
- `--nodes` 匹配到多个节点时取**第一个**；不传则用节点表第一个节点。
- 工具运行到 `--timeout` 截止（建议 60~90 秒），输出逐跳明细：TTL、IP、延迟、归属运营商/ASN/PTR。
- 星号 `*` 行表示该跳无响应（防火墙拦截或设备不回 ICMP/TTL 超时包），属正常现象。

```bash
itdog traceroute www.baidu.com --nodes 上海 --timeout 60
itdog traceroute 1.1.1.1 --nodes telecom
```

### 3.6 batch-ping —— 批量 ping（IP 优选核心）

```bash
itdog batch-ping <目标1> <目标2> ... [--nodes <选择器>] [--port 仅 batch-tcping]
```

- 一次任务测**多个目标**（IP、域名、CIDR 网段可混合，服务端展开），每个 (目标 × 节点) 一个结果行。
- itdog 限制**单任务最多 5 个节点**，工具自动把所选节点按 5 个一组**分片串行**执行并合并结果（每片间隔 0.6 秒）。
- 目标上限：256 个 / 1 万字符。
- 支持 CIDR/网段（由 itdog 服务端展开，`cidr_filter=true` 自动剔除网络地址/广播地址）。

```bash
itdog batch-ping 1.1.1.1 8.8.8.8 9.9.9.9 --nodes '北京,上海'
itdog batch-ping 104.16.0.0/24 --nodes 'telecom,unicom'   # 网段优选（节点多时会分很多片，慎用）
```

### 3.7 batch-tcping —— 批量 TCP 测试

```bash
itdog batch-tcping <目标1> <目标2> ... --port <端口> [--nodes <选择器>]
```

- 目标未写端口时自动追加 `--port` 指定端口。

```bash
itdog batch-tcping cdn-a.example.com cdn-b.example.com --port 443 --nodes '北京,上海,广州'
```

---

## 4. 节点选择 --nodes 完全指南

### 4.1 四种语法

| 写法 | 含义 | 示例 |
|---|---|---|
| `all`（默认） | 全部 290+ 节点 | `--nodes all` |
| **线路分组**：`telecom` / `unicom` / `mobile` / `overseas`（或中文 `电信`/`联通`/`移动`/`海外`），可逗号组合 | 按运营商线路选择 | `--nodes telecom,unicom` |
| **节点 ID**：逗号分隔的随机串 | 精确指定（批量模式生效） | `--nodes 5r3q67qdmmvd0jpb,ojsofw0ovm3ovimf` |
| **名称关键词**：任意子串 | 匹配节点名（城市/地区名） | `--nodes 上海`、`--nodes '北京,广州,深圳'` |

### 4.2 单目标模式与批量模式的粒度差异（重要）

| | ping / tcping / http / dns | batch-ping / batch-tcping |
|---|---|---|
| 线路分组 | ✅ 支持 | ✅ 支持 |
| 名称关键词 | ⚠️ 协议不支持逐节点选择，工具**自动降级**为对应线路分组（终端会提示）；匹配不到线路时用全部节点 | ✅ 支持 |
| 节点 ID | ⚠️ 同上（降级） | ✅ 支持 |
| 节点数量 | 由 itdog 决定（该线路全部节点） | 每任务 5 个，自动分片 |

### 4.3 查看可用节点

节点表缓存于 `~/.cache/itdog-cli/nodes.json`（内置快照位于项目 `assets/nodes.json`）：

```bash
# 列出全部节点：分类 / ID / 名称
jq -r 'to_entries[] | .key as $c | .value[] | "\($c)\t\(.id)\t\(.name)"' \
  ~/.cache/itdog-cli/nodes.json | column -t -s $'\t' | less

# 没装 jq 的话用 python
python3 -c "
import json
d = json.load(open('$HOME/.cache/itdog-cli/nodes.json'))
[print(cat, n['id'], n['name']) for cat, ns in d.items() for n in ns]"
```

节点表会随任务响应自动刷新；也可手动强制刷新：

```bash
itdog ping example.com --refresh-nodes
```

### 4.4 分片耗时预估

批量模式的总耗时 ≈ 分片数 × 单任务耗时（10~30 秒/片）。例如 `--nodes '北京,上海'`（约 10 个节点 → 2 片）约 1 分钟；选 40 个节点 → 8 片 → 约 4~5 分钟。**选节点越精准，总耗时越短。**

---

## 5. 输出结果解读

### 5.1 实时进度（--quiet 可关闭）

```
  [  1] ✓ 天津5联通  110.242.70.57  8ms
  [  3] ✗ 某节点  Not Found          ← ✗ 表示该节点失败
```

- `✓` 成功；`✗` 失败（DNS 解析失败 / 连接失败 / HTTP 非 2xx 等）。
- http 模式显示总耗时；ping/tcping 显示延迟。

### 5.2 明细表格（各模式的列）

| 模式 | 列 |
|---|---|
| ping / tcping | # · 节点 · 运营商 · 省份/区域 · 响应IP · 延迟 · 归属（目标 IP 的地理/ASN 归属） |
| http | # · 节点 · 运营商 · 响应IP · 状态码 · 总耗时 · DNS · 连接 · SSL · 下载 · 归属 |
| dns | # · 节点 · 运营商 · 耗时 · 解析结果 |
| traceroute | 按节点分块的逐跳明细：TTL · IP · 延迟 · 归属/ASN/PTR |
| batch-* | 同 ping/tcping，「响应IP」即目标本身；多目标时同一节点出现多行 |

### 5.3 汇总段

```
目标: www.baidu.com｜模式: ping｜结果: 已完成
节点: 295｜成功: 293｜失败: 2｜平均: 49.6 ms｜最快: 0 ms｜最慢: 567 ms
分线路: 移动 90/91 均值27.1 ms｜联通 80/80 均值30.1 ms｜电信 80/80 均值24.5 ms｜境外 43/44 均值179.5 ms
最快 Top5: 中国香港 0ms、中国香港2 0ms、...
```

- `结果: 已完成` = 收到服务端 finished 帧；`超时截断(部分结果)` = 到达 --timeout，输出已收到的部分（traceroute 常见，属预期行为）。
- `分线路`：`成功数/节点数 均值`。
- `--sort loss` 可把失败节点排到表格最前，便于排查。

### 5.4 失败原因对照表

| 显示 | 含义 |
|---|---|
| `失败(DNS 解析失败)` | 该节点无法解析目标域名 |
| `失败(IP 无效(0.0.0.0))` | 解析结果异常 |
| `失败(无延迟数据（可能超时）)` | ping/tcping 探测超时或结果为 -1 |
| `失败(HTTP 0)` | http 模式请求未完成（连接失败/超时） |
| `失败(HTTP 5xx)` | http 模式收到错误状态码（成功=2xx） |
| `节点不可用(node_error)` | traceroute 所选节点临时不可用，换一个节点即可 |

---

## 6. JSON / CSV 导出

```bash
itdog ping www.baidu.com --json out.json --csv out.csv
```

### 6.1 JSON 结构

```jsonc
{
  "summary": {
    "mode": "ping",
    "targets": ["www.baidu.com"],
    "totalNodes": 295, "okNodes": 293, "failedNodes": 2,
    "overallAvg": 49.6, "overallMin": 0, "overallMax": 567,
    "carriers": [ { "carrier": "电信", "nodes": 80, "ok": 80, "avg": 24.5, "min": 0, "max": 210 } ],
    "top":    [ { "name": "中国香港", "latencyMs": 0, "...": "..." } ],
    "stats":  [ { "nodeId": "…", "name": "天津5联通", "carrier": "联通", "province": "天津",
                  "region": "华北", "ip": "110.242.70.57", "ok": true, "latencyMs": 8,
                  "address": "中国/河北/保定/联通", "raw": { } } ]
  },
  "finished": true,
  "reason": "finished",
  "frames": [ /* 服务端原始 WS 帧，逐条保留 */ ]
}
```

- `stats` 数组即表格数据（已按 `--sort` 排序）；http 模式每项多一个 `detail` 对象（`httpCode/allTime/dnsTime/connectTime/sslTime/downloadTime`）；traceroute 模式多一个 `hops` 数组。
- `frames` 保留服务端原始字段（`line`/`province`/`region` 为数字编码），便于复查。

### 6.2 CSV 列

```
node_id, name, carrier, province, region, ip, ok, latency_ms, address, fail_reason
```

---

## 7. 脚本化与自动化

### 7.1 退出码

| 码 | 含义 |
|---|---|
| 0 | 有成功节点 |
| 1 | 任务完成但全部节点失败 |
| 2 | 协议/网络错误（任务创建失败、WS 失败等） |

```bash
itdog ping example.com --quiet && echo "网络正常" || echo "网络异常"
```

### 7.2 取最快节点（jq）

```bash
itdog batch-ping 1.1.1.1 8.8.8.8 104.16.1.1 --nodes '北京,上海,广州' --quiet --json out.json >/dev/null
jq -r '.summary.stats[:5][] | "\(.ip)  \(.latencyMs)ms  \(.name)"' out.json
```

### 7.3 IP 优选工作流（配合 better-ip 场景）

```bash
#!/bin/bash
# 从候选 IP 列表里优选：按三网核心节点平均延迟排序
itdog batch-ping $(cat candidates.txt | head -20) \
  --nodes '北京,上海,广州,深圳' --quiet --json优选.json
jq -r '.summary.stats
      | map(select(.latencyMs != null))
      | group_by(.ip)
      | map({ip: .[0].ip, avg: (([.[].latencyMs] | add) / length)})
      | sort_by(.avg) | .[] | "\(.ip)\t\(.avg)"' 优选.json | head -5
```

### 7.4 cron 定时拨测

```bash
# 每 30 分钟测一次主站连通性，异常时写日志
*/30 * * * * cd /home/liang/project/better-ip && node dist/cli.js ping www.example.com \
  --nodes telecom,unicom,mobile --quiet --json /var/log/itdog/$(date +\%H\%M).json
```

> 频率建议：单目标全节点测试间隔 ≥ 1 分钟；批量任务请控制分片总数，避免高频滥用。

---

## 8. 代理与网络环境

```bash
itdog ping example.com --proxy http://127.0.0.1:7890    # 任务创建与 WebSocket 都走代理
```

- 默认**不走**环境变量代理（`http_proxy` 等对内置 fetch 无效），需要时用 `--proxy` 显式指定。
- 在 WSL2 中如无法直连 itdog，检查 Windows 侧代理软件是否开启「允许局域网连接」，然后用 `--proxy http://<Windows IP>:<端口>`。
- itdog 服务器在国内，直连通常最优；代理反而可能因出口在境外导致测速节点不可用。

---

## 9. 故障排查 FAQ

| 现象 | 原因与处理 |
|---|---|
| `错误: 创建任务失败（HTTP 200）：xxx` | 冒号后是 itdog 返回的原始提示（如「检测节点应选择1~5个」「目标格式」）。按提示修正参数即可 |
| `WebSocket 连接失败（WS 鉴权被拒：403…）` | 大概率 itdog **轮换了 token 盐**。按第 10 节重新提取并更新 `src/config.ts` 的 `WS_SALT` |
| 任务创建成功但所有节点无数据/0 帧 | 同上，盐值或 WS 地址变更；开 `ITDOG_DEBUG=1` 观察 WS URL 是否被立刻关闭 |
| `WAF guard 求解失败` | itdog 更新了 guard 算法。运行 `pnpm refresh-guard` 更新官方 auto.js 快照后重试 |
| 大量节点显示失败/节点 ID 无效 | 节点表过期。加 `--refresh-nodes` 刷新缓存 |
| 海外节点大量失败 | 正常，境外节点偶发不可用。用 `--nodes telecom,unicom,mobile` 排除 |
| `超时截断(部分结果)` | 到达 `--timeout`。全节点 ping 建议 ≥ 90s；traceroute 建议 ≥ 60s；加大超时或减少节点 |
| 目标为境外 IP 时延迟普遍偏高 | 真实链路状况（国际出口），非工具问题 |
| `command not found: itdog` | 全局软链未配置，见 1.3；或构建产物不存在，先 `pnpm build` |
| 批量模式很慢 | 分片串行是正常机制；减少节点数或目标数 |

---

## 10. 维护手册

itdog 是网页反爬较强的服务，以下两处可能随时间失效，均可在**不改架构**的前提下自救：

### 10.1 WS token 盐轮换（症状：403 / 全部节点无数据）

盐值在 `src/config.ts` 的 `WS_SALT`。重新提取步骤：

```bash
# 1. 下载官方前端 JS（版本号以 https://www.itdog.cn/ping/ 页面源码里的 ?v= 为准）
curl -s --compressed 'https://www.itdog.cn/frame/js/pages/icmp_ping.js?v=20260609B' \
     -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140' \
     -o /tmp/icmp_ping.js

# 2. 解码 WebSocket 调用点的混淆串（按出现顺序拼接即为新盐）
node scripts/extract-strings.mjs /tmp/icmp_ping.js --ws

# 3. 修改 src/config.ts 的 WS_SALT → pnpm build → 重测
```

### 10.2 guard 反爬算法轮换（症状：`WAF guard 求解失败`）

guard 求解优先执行 itdog 官方 auto.js 快照，算法变了只需重新抓快照：

```bash
pnpm refresh-guard      # 重新下载 https://www.itdog.cn/_guard/auto.js 到 assets/guard-auto.js
pnpm build
```

也可用环境变量 `ITDOG_GUARD_JS=/path/to/auto.js` 临时指定快照文件（无需重新构建）。

### 10.3 节点表刷新

```bash
itdog ping example.com --refresh-nodes      # 每次运行前刷新
# 或直接重抓 batch_ping 页面解析（缓存写入 ~/.cache/itdog-cli/nodes.json）
```

---

## 11. 环境变量参考

| 变量 | 作用 |
|---|---|
| `ITDOG_DEBUG=1` | 打印任务创建请求、WS 连接/关闭事件等协议调试信息 |
| `ITDOG_GUARD_JS` | 指定 guard-auto.js 快照路径（覆盖内置快照） |
| `ITDOG_ASSETS_DIR` | 指定 assets 目录（含 nodes.json / guard-auto.js） |

---

## 12. 已知限制与合规

- 本工具复刻 itdog.cn 网页前端的非官方接口，**接口可能随时变化**（自救方法见第 10 节）。
- 单目标模式（ping/tcping/http/dns）由 itdog 决定节点范围，只能按线路分组筛选；逐节点选择仅批量模式支持。
- 每次运行创建真实测速任务，**请勿高频/并发滥用**（建议单机串行、间隔 ≥1 分钟），否则可能触发验证码或 IP 封禁。
- 测速结果仅供个人参考，商用决策请以官方服务为准。
