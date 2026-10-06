# Claude / Claude Code 固定出口与链式代理配置指南

记录如何把“本机应用 → 中转 → 固定 SOCKS5 出口”配置成可检查、可回滚的网络路径，以及 AdsPower 自行管理 SOCKS5 时如何避免重复代理。

**本项目讨论网络连通性与出口一致性，不提供绕过账号封禁、地区资格或服务条款的方法，也不承诺“住宅 IP 防封”。** 请仅在服务允许的地区和授权范围内使用；账号问题通过官方支持处理。

本文使用公开占位符：`203.0.113.10` 是文档保留地址，`relay.example.invalid` 是不可用的示例域名，不能直接连接。真实凭据只保存在自己的客户端或安全存储中。

## 从哪里开始

| 需求 | 文档 |
| --- | --- |
| 中转、固定出口、VPS 分别做什么 | 本页“方案原理”和“成本” |
| 固定整机业务出口、处理 DNS / UDP / IPv6 | [固定出口与系统保护](docs/fixed-egress.md) |
| AdsPower 自配 SOCKS5，电脑仅提供中转 | [AdsPower 双层代理接法](docs/adspower.md) |
| 配置另一台 Windows 电脑 | [Windows 接手清单](docs/windows.md) |
| 中转失效自动切换，最终出口不变 | [macOS 四路备用与验收](docs/2026-10-06-macos-relay-failover.md) · [四路模板](examples/fixed-egress-failover.js) |
| 查看已有 Windows 三路实测 | [实施记录](docs/2026-10-04-windows-fixed-egress.md) · [验收边界](docs/2026-10-04-verification.md) |
| 验收、排障、公开分享前脱敏 | [验收与隐私清单](docs/verification-and-privacy.md) |
| 给本地 Codex 接手 | [本地助手任务模板](docs/local-agent-handoff.md) |
| 检查模板和文档 | `node tests/verify.cjs`（不修改网络） |

## 方案原理

```text
本机应用 → 本地 HTTP / TUN → 中转节点 → 固定 SOCKS5 出口 → 目标网站
```

- **本机入口**接收应用流量。HTTP 系统代理不覆盖所有程序；TUN 能扩大覆盖范围，但排除规则、其他 VPN 和系统防火墙仍会影响路径。
- **中转节点**负责到代理服务器的传输，可以是已有合法代理服务、自建 VPS 或其他获授权的连接，不一定要新买服务器。
- **固定出口**是目标网站通常看到的最后一跳。服务器地址不一定等于对所有网站的回显地址，需要实测。

“静态”不等于真实家庭住宅、独享、低风险或支持 UDP/IPv6。ASN、第三方评分和供应商标签都不能代替能力验证。SOCKS5 是否需要中转、机房 IP 能否正常使用，均应实测，不能仅凭 IP 类型推断封禁原因。

额外一跳可能改善路由，也可能增加延迟和故障点；网络优化不改变账号资格。

## 前置条件

- 支持所需字段的 Mihomo 客户端，例如兼容版本的 Clash Verge Rev；先核对版本，不要求盲目升级。
- 合法可用的中转与固定 SOCKS5 服务，已核对有效期、并发、认证和协议支持。
- 配置备份、明确回滚入口，以及必要时的正常管理员授权。
- 目标应用本身具有合法访问资格。网络测试通过不等于账号可用。

## 第一步：买静态住宅 IP

这一步**不是必选项**。先判断现有服务能否满足固定出口和连通性需求，不按品牌、套餐名或 IP 评分购物。

购买前核对：固定期限、独享程度、实际出口位置、认证方式、UDP/IPv6 能力、并发限制、中转支持，以及故障/退款规则。“静态 ISP”标签不能自动证明它是真实家庭宽带。

用户名、密码和订阅链接都是秘密。**不要发给聊天机器人或在线转换网站，也不要写入公开 Issues、截图或代码仓库。** 在可信本机客户端填写即可。

## 第二步：把住宅 IP 加进 Clash

无论购买的是住宅还是其他固定出口，都先在客户端私有配置中添加 SOCKS5 节点，示例名为 `US_EXIT`；在同一配置中保留中转节点 `RELAY_NODE`。

需要中转时，出口节点使用：

```yaml
# 配置片段，不是完整订阅；真实节点与凭据在本机填写。
name: US_EXIT
type: socks5
server: 203.0.113.10
port: 1080
dialer-proxy: RELAY_NODE
udp: false
```

`dialer-proxy` 表示连接这个代理服务器时经哪个节点。不要让中转依赖出口自身，也不要把出口放入它自己的上游选择组。

`udp: false` 是“尚未验证 UDP，因此不启用”的保守示例。付费开通 UDP 不证明每一跳都支持它；确有需要时单独验收。

GUI 的“前置代理”“链式代理”与增强脚本可能修改同一字段，不应机械地全部叠加。以生成配置和运行态连接为准。

## 第三步：在链式代理里连接

选择一种配置入口：GUI 或增强脚本。确认生成链路恰好是 `RELAY_NODE → US_EXIT`，再从实际应用入口发起请求。示例端口必须与自己的客户端一致：

```sh
curl -q --fail --silent --show-error --connect-timeout 5 --max-time 15 \
  --proxy http://127.0.0.1:17897 \
  --noproxy __proxy_test_never_match__.invalid \
  https://www.cloudflare.com/cdn-cgi/trace
```

Windows 使用 `curl.exe`，不要误用 PowerShell 别名。保持 TLS 校验；回显包含公网 IP，分享前脱敏。

`Timeout` 只说明那次探测失败，不是“配置正确的正常现象”。延迟数字也不证明真实业务路径、长期稳定性或账号可用。

## 补充链式代理脚本(一段JS代码，更加方便进行配置！)

保留原有入口：[链式代理脚本.js](链式代理脚本.js)。本次在社区贡献基础上收敛为固定出口模板，不再静默回退到中转出口或 DIRECT，也不再关闭证书校验。

默认 `enabled: false`，原样返回输入。模板不含真实节点和凭据，不会启用 TUN、购买服务或安装防火墙。

1. 备份配置与增强脚本，确认目标节点已存在。
2. 在私有副本设置 `exitNode`、`relayNode`、`exitServer`、`exitPort`、可达的 `bootstrapDoh`。不要提交这个私有副本。
3. 确认采用单出口模式：脚本会替换运行态分流规则与分组、移除其他运行态节点及规则源，不删除原订阅文件。
4. 应用自管 SOCKS5 时启用 `appManagedSocks`，参见 [AdsPower 接法](docs/adspower.md)。
5. 设置 `enabled: true`，用本机内核校验候选配置，通过后加载并验收。

缺节点、类型不符、依赖环或重复名称会输出拒绝公网业务的配置，不自动换出口。端口冲突会抛出错误，此时必须停止部署；**客户端可能保留旧配置，脚本报错不等于系统断网保护。**

## 常见问题

**AdsPower 报 `ERR_SOCKS_CONNECTION_FAILED`**

检查代理类型、端点、认证，再确认“连接 SOCKS5 服务器”是否又被套了一次 SOCKS5。参见 [精确中转例外](docs/adspower.md)；仅凭截图不能确定根因。

**检测页仍出现国内 DNS、UDP 或 IPv6**

TCP、DNS、UDP/STUN、IPv6、WebRTC 分开检查。HTTP 出口正确不证明其他协议也正确，禁用 AAAA 不等于禁止 IPv6 字面地址直连。见 [验收清单](docs/verification-and-privacy.md)。

**网络通了，网站仍提示地区或账号问题**

分清网络错误、网站验证、地区资格和账号状态。匿名 API 的 401 不是登录/对话成功；不要通过借账号、清指纹或伪造时区处理封禁，使用官方支持渠道。

**经常卡住，优化线路 VPS 会不会好？**

可能改善本机到中转的路由，但不能修复出口拥堵、服务端故障或浏览器配置。记录故障时的 DNS、失败率、请求耗时和长连接中断，再比较同一出口、同一时段的候选中转。没有对照测试就不能给出提速比例。

## 成本

成本由已有中转、可选 VPS 和可选固定出口组成。不存在必须购买的“约 50 美元套餐”；计费周期、流量、线路和退款政策以当时条款为准。现有中转稳定时，不必为多加一层买 VPS。优先短期测试，再决定续费。

## 验证与公开分享

```sh
node tests/verify.cjs
```

该命令检查合成配置、规则顺序、缺节点拒绝、AdsPower 例外、文档链接和公开文件脱敏；不读取真实代理配置，不修改网络。

案例边界见 [验收与隐私清单](docs/verification-and-privacy.md)。旧截图已从本次拟提交文件中移除，改用文本示例；**旧 Git 历史、缓存、fork 和旧 ZIP 不会自动清除**。真实凭据曾公开时，先撤销/轮换，再单独处理历史。

## 参考

- [Claude Code 网络配置](https://code.claude.com/docs/en/network-config)
- [Mihomo 配置文档](https://wiki.metacubex.one/)
- [Windows 防火墙规则](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)
- [WSL 网络模式](https://learn.microsoft.com/en-us/windows/wsl/networking)
- [GitHub：移除敏感数据](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)

按实际软件版本复核字段支持；参考链接不是账号资格或服务可用性的保证。
