# Windows 接手清单

[返回 README](../README.md)

这是跨机器接手清单，不是安装包。仓库已有一台 Windows 的[三路固定出口实施](2026-10-04-windows-fixed-egress.md)和[有限验收记录](2026-10-04-verification.md)；不能将那台机器的结果视为所有 Windows、WSL 或当前四路公开模板均已验收。

## 只读清点

- Windows、Codex、Claude Code、代理客户端/内核版本与配置入口。
- 原生 Windows、WSL、容器或虚拟机：分别确定配置范围。
- 监听端口、TUN、网卡/路由、DNS/IPv6、其他 VPN 和有效防火墙规则。
- 管理员授权、域/GPO/EDR、是否依赖唯一远程连接。

只记录必要字段，不输出完整订阅、进程命令行、Cookie 或所有环境变量。

## 实施顺序

1. 本机安全准备同一中转/出口凭据，核对多设备并发限制。
2. 备份配置和 settings.json，确认备份目录 ACL，不回传敏感备份。
3. 适配脚本私有副本，用实际内核做语法检查。
4. 使用正常授权流程启用/核对 TUN，保留工作和组织策略。
5. 验证本机入口后，合并 [Claude env 片段](../examples/claude-env.json)。
6. 系统断网保护先安排并验证独立恢复，再加载限制。
7. 按 [验收清单](verification-and-privacy.md) 检查正向、负向、恢复与持久性。

不为凑结果盲目升级软件。缺权限或恢复手段时明确“应用层完成、系统保护未完成”。

## 平台陷阱

- 明确使用 `curl.exe`，不要混淆 PowerShell 别名。
- Windows 的回环地址不必然适用于 WSL；区分 NAT/mirrored 模式，不把代理直接暴露到整个局域网。
- PowerShell 5.1 JSON 处理可能丢失大小写同名键。保留原配置其他字段，使用合适的合并工具。
- 显式 Block 通常优先于 Allow；只改默认动作也不会使旧 Allow 自动失效。
- 不复制 PF、launchd、Unix socket 或固定 TUN 名，不清空防火墙或规避组织管理。

## 交付

本机报告应记录改动、私有备份/回滚位置、各项证据、未验证项和下一步。

Node 测试、Mac 内核语法、Windows 原生连通、WSL 连通、开机恢复和真实账号会话是不同的完成阶段，不能相互替代。
