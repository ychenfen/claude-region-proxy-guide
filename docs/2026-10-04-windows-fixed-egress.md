# 2026-10-04：Windows 固定出口、中转备用与订阅刷新

今天在 Windows 上完成了单中转到三条备用中转的配置，并处理了 AdsPower 自行连接 SOCKS5、系统断网保护、DNS、时区和网页语言。本文是脱敏后的实施说明；真实出口、订阅链接、认证信息、个人路径与原始截图不随仓库公开。

验证环境：Windows 11、Clash Verge Rev 2.4.7、Mihomo v1.19.21。没有升级客户端或内核。Windows 的现场测试和早先 macOS 的结果分开记录。

## 三条中转，共用一个最终出口

```text
                       ┌─ 中转 1 ─ 同一 SOCKS5 出口 ─┐
本机 → 完整链路备用组 ──┼─ 中转 2 ─ 同一 SOCKS5 出口 ─┼─ HTTPS 目标
                       └─ 中转 3 ─ 同一 SOCKS5 出口 ─┘
```

给每条中转建立一个 SOCKS5 节点副本，服务器、端口和认证信息相同，只有 `dialer-proxy` 不同。将这些完整链路放入 `fallback` 组，按优先级选可用线路。这样检测包含 SOCKS5 认证和最终 HTTPS 请求，不只检测中转能否上网。

正式配置每 60 秒检查一次，单次超时 8 秒，使用 `https://www.gstatic.com/generate_204` 并要求状态码 `204`。探测间隔不等于精确切换用时；已有连接不会自动迁移，需要应用重新连接。不要在界面中手动锁定组里的某条线路，也不要切换成全局模式绕开业务规则。

三条线路来自同一供应商，部分服务器地址重合。它们能缓解单条线路故障，不能应对整家供应商停用。**订阅到期、额度耗尽、最终 SOCKS5 账号到期都需要续费或处理账号，刷新不能延长有效期。**

## 使用模板

模板：[examples/fixed-egress-failover.js](../examples/fixed-egress-failover.js)。这是今天正式配置的通用化版本，示例地址全部替换为文档保留地址；这份公开模板本身未在真实网络上部署。

1. 先备份客户端配置。在本地客户端保存已有的三条中转，以及一条最终 SOCKS5 节点。账号密码只填在本地节点中，不发到 issue、提交或截图里。
2. 修改模板顶部的 `TARGET`：最终节点名称、预期服务器 IPv4、端口、三条中转的名称／域名／端口。`192.0.2.10`、`example.invalid` 都是占位地址，不能联网。中转顺序就是优先顺序。
3. 确认客户端将完整节点列表传入脚本。本次版本使用**当前订阅的增强脚本**，在最终处理时可读取附加 SOCKS5 节点；只放在更早执行的全局脚本里可能找不到该节点。
4. 先查看生成配置，使用现有 Mihomo 的 `-t` 检查语法，再加载。缺少最终节点或所有中转时，模板生成拒绝连接的业务组；最终端点改变、节点重名或端口冲突时会报错，需要人工核对。
5. 确认系统代理、TUN、业务 DNS 都使用同一条固定出口路径。模板保留已有 `tun.enable`、`auto-route` 等开关，不负责安装驱动、启用系统 TUN 或设置 Windows 防火墙。
6. 分别测三条链路，再进行独立实例的故障模拟。验收通过后重新生成一次配置，确认订阅刷新不会丢掉规则。

模板只支持本次验证的 AnyTLS 中转并严格匹配端点，不会自动收录整个订阅。供应商变更名称、域名、协议或端口时，变更节点会被排除，需要重新核对允许范围。模板从本地节点复制认证与 TLS 设置；若原节点跳过证书验证，该例外会被保留，模板不会把它变为可信证书。

该模板替换业务规则，拒绝公网 UDP 和 IPv6，可能影响依赖这些协议的应用。已有自定义分流、provider、tunnel 和 listener 策略需要先审阅；不能把它当成适配任意订阅的一键脚本。

本地结构测试，无需网络或凭据：

```shell
node --test tests/fixed-egress-failover.test.cjs
```

## 订阅为什么不会再靠频繁手动刷新

这次成功下载并核对了当前订阅，将 Clash Verge 的 `allow_auto_update` 设为 `true`、`update_interval` 设为 `60`。**2.4.7 中该值的单位是分钟。** 客户端已重启加载配置；下一次整小时定时执行尚未现场观察，不能把“已设置”写成“已连续自动刷新多轮”。

订阅刷新、线路健康检查、中转域名解析是三件事：

| 任务 | 本次周期 | 作用 |
|---|---|---|
| 下载订阅 | 60 分钟 | 获得供应商提供的节点和认证更新 |
| 完整链路检查 | 60 秒 | 发现故障并选择可用备用链路 |
| 系统允许列表的域名解析 | 2 分钟 | 让受限防火墙地址跟随已验证中转域名变化 |

原始订阅和未选用节点均保留。增强脚本只筛选运行配置，不删除供应商原始列表。已过期的旧订阅未被当作有效备用线路。

## AdsPower 自己认证 SOCKS5 的情况

如果应用自己持有 SOCKS5 账号并向最终代理端点发起认证，电脑只需要将**连接那个端点的 TCP 传输**送过中转。它不应再套一层相同的最终 SOCKS5 节点。

因此保留独立的中转备用组 `Relay-Auto`，并在公网 UDP／IPv6 拒绝规则之后、最终 `MATCH` 之前放一条精确规则。示意地址仍为文档占位：

```yaml
- AND,((NETWORK,TCP),(IP-CIDR,192.0.2.10/32),(DST-PORT,1080)),Relay-Auto
- MATCH,Claude-Fixed-Egress
```

本次已测试应用自行认证的 SOCKS5 请求，并检查运行连接确实命中这条规则。没有使用 AdsPower 本地 API 密钥，因此不能声称已逐个检查全部 AdsPower 浏览器环境。该中转组的健康检查只检查中转上网，不能单独证明最终 SOCKS5 认证正常。

## DNS 与 Windows 断网保护

业务 DNS 通过固定出口的 Cloudflare／Google DoH，保持 HTTPS 证书验证。TUN 接管 DNS 53，关闭业务 AAAA 结果，并另行拒绝公网 IPv6；只关闭 AAAA 不足以阻止 IPv6 直连。

中转域名引导使用证书验证开启的 `223.5.5.5:443` HTTPS 解析，这是明确的直连例外。中转备用组的自身探测从中转出站，因此不能宣称电脑所有底层数据包都从美国出站。

代理规则无法保护已经退出代理的电脑。本次另外使用 Windows 防火墙实现受限出站：

- 先记录现有策略、规则及接口，建立正常 UAC 授权的管理员恢复程序、独立撤回计时器和手动恢复入口。
- 将可能允许普通公网直连的既有允许规则限定到 TUN 接口，保留经过核对的局域网窄范围规则；没有全局清空规则。
- 默认出站阻止，仅为指定 Mihomo 程序放行已核对中转的 TCP 端口，为引导 HTTPS、TUN 内业务和必要本地通信设明确例外。
- 更新器仅解析指定中转域名并更新同一受限规则。单域名解析失败时保留其上次确认的地址，不开放任意目标。
- 正向联网测试通过后，再受控测试关闭 TUN、停止内核；恢复成功后正式提交并停用试运行撤回计时器。

这部分依赖现场网卡、局域网、软件路径、已有规则和恢复方式，**公开模板没有附带一键修改全机防火墙的安装器**。不要只设置默认出站阻止，也不要照抄别人的接口索引或服务器 IP。Windows 的阻止规则优先级与 macOS PF 不同。

## 时区、语言与网站检测

本次按用户明确要求设置 Windows 系统时区为 `Eastern Standard Time`（纽约，自动夏令时），当前用户首选语言为英语优先，保留中文输入法，并通过 Edge 的网页语言策略设置英语优先。没有改变系统 UTC 时钟，没有在测试页面注入语言或时区伪装。

“系统时区”“用户首选语言”“区域格式”“Windows 界面语言”是不同设置：区域格式在当前登录会话仍有缓存，需下次重新登录后再核对；Windows 中文界面保留，没有安装英语界面语言包或强制注销。

[Net.Coffee Claude 检测](https://ip.net.coffee/claude/)当次显示纽约时区和英语一致，评分 65、Hosting，DNS 未检测到泄露，WebRTC 未暴露公网出口。这是第三方网站当次结果，不能证明住宅属性、长期稳定性、账号可用性或没有任何网络泄露。

## 备份与已知范围

本机秘密配置在受限私有目录保留修改前副本与最终文件哈希。无凭据报告和验收摘要整理到 Obsidian，再复制到另一块磁盘，核对 SHA-256；大型行情数据和视频素材继续原位保存并建立索引。

现场短测、隔离故障模拟、公开模板结构测试分别记录在 [验收摘要](2026-10-04-verification.md)。未验证冷启动、休眠唤醒、网络切换、WSL／虚拟机、长期高峰稳定性或真实 Claude 登录会话。线路检查成功也不检查“回显 IP 是否仍等于预期”；供应商可能改变真实出口，应另外实际核对。

## 依据

- [Mihomo fallback](https://wiki.metacubex.one/en/config/proxy-groups/fallback/) 与 [v1.19.21 实现](https://github.com/MetaCubeX/mihomo/blob/v1.19.21/adapter/outboundgroup/fallback.go)
- [Clash Verge Rev 2.4.7 定时器](https://github.com/clash-verge-rev/clash-verge-rev/blob/v2.4.7/src-tauri/src/core/timer.rs)与[配置增强顺序](https://github.com/clash-verge-rev/clash-verge-rev/blob/v2.4.7/src-tauri/src/enhance/mod.rs)
- [Windows 防火墙规则优先级](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)
- [Windows 用户语言设置](https://learn.microsoft.com/en-us/powershell/module/international/set-winuserlanguagelist)与 [Edge 网页语言策略](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/definepreferredlanguages)
