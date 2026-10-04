// 初版参考：包含 DIRECT 兜底、国内直连和绕过固定出口的选项。
// 2026-10-04 固定出口与中转自动切换方案见 examples/fixed-egress-failover.js。
function main(config) {
  // ================= 1. 核心配置区域 =================
  const staticProxyConfig = {
    name: "🔒 静态IP (出口)",
    server: "xxx.xxx.xxx.xxx",
    port: xxx,
    username: "xxxxx",
    password: "xxxxx",
    type: "socks5",
    udp: true,
    "skip-cert-verify": true, // 优化：跳过证书验证，提高链式代理连通性
  };

  const groupAirportName = "✈️ 机场中转池";
  const groupFinalName = "🚀 最终出口选择";

  // ================= 2. 规则优化 (使用 GEOSITE 替代冗长列表) =================
  // 优化点 1: 移除硬编码的几百个域名，使用 Meta 内核的 GEOSITE 数据库
  const optimizedDirectRules = [
    // --- 强制直连与局域网 ---
    "GEOSITE,private,DIRECT",
    "GEOSITE,category-ads-all,REJECT", // 顺便拦截一下广告

    // --- IP 段 (核心网络) ---
    "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
    "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
    "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,100.64.0.0/10,DIRECT,no-resolve",
    "IP-CIDR,224.0.0.0/4,DIRECT,no-resolve",

    // --- 进程匹配 ---
    "PROCESS-NAME,Thunder,DIRECT",
    "PROCESS-NAME,Transmission,DIRECT",
    "PROCESS-NAME,uTorrent,DIRECT",
    "PROCESS-NAME,qBittorrent,DIRECT",
    "PROCESS-NAME,aria2c,DIRECT",

    // --- 核心优化：国内域名统配 ---
    // 包含 baidu, qq, alibaba, apple.cn, microsoft.cn 等所有国内常见域名
    "GEOSITE,cn,DIRECT",

    // --- 游戏平台国内CDN ---
    "GEOSITE,steam@cn,DIRECT",
    "GEOSITE,category-games@cn,DIRECT",

    // --- 兜底国内 IP ---
    "GEOIP,CN,DIRECT",
  ];

  // ================= 3. 提取与构建节点 (优化节点清洗) =================

  // 优化点 3: 过滤节点，排除特殊节点和静态IP自身，防止循环引用
  // 只提取出网协议节点 (SS/VMess/Trojan/HTTP/Socks5等)，排除 DIRECT/REJECT 等
  const validNodeTypes = [
    "ss",
    "vmess",
    "vless",
    "trojan",
    "hysteria",
    "hysteria2",
    "tuic",
    "ssr",
    "snell",
    "socks5",
    "http",
  ];

  // 确保 config.proxies 存在
  if (!config.proxies) config.proxies = [];

  const airportProxies = config.proxies
    .filter(
      (p) =>
        validNodeTypes.includes(p.type) && p.name !== staticProxyConfig.name
    )
    .map((p) => p.name);

  // 防错：如果没找到任何节点，给一个 DIRECT 防止报错
  if (airportProxies.length === 0) airportProxies.push("DIRECT");

  // 添加静态 IP (设置 dialer-proxy 指向机场池)
  staticProxyConfig["dialer-proxy"] = groupAirportName;
  // 使用 unshift 将静态节点加到列表最前，方便调试
  config.proxies.unshift(staticProxyConfig);

  // ================= 4. 分组策略优化 (自动容灾) =================

  config["proxy-groups"] = [
    {
      name: groupFinalName,
      type: "select",
      proxies: [
        staticProxyConfig.name, // 默认：走静态IP链式代理
        groupAirportName, // 备用：不走静态IP，直接走机场
      ],
    },
    {
      // 优化点 2: 将 Select 改为 url-test，实现自动容灾
      // 静态 IP 依赖这个池子出网，必须保证这个池子里的节点永远是通的
      name: groupAirportName,
      type: "url-test",
      url: "http://www.gstatic.com/generate_204",
      interval: 300,
      tolerance: 150,
      lazy: true,
      proxies: airportProxies,
    },
  ];

  // ================= 5. 规则逻辑优化 (高效清洗) =================

  // 优化点 4: 更高效的规则合并与清洗逻辑
  const finalRules = [...optimizedDirectRules];

  if (config.rules && config.rules.length > 0) {
    config.rules.forEach((rule) => {
      // 快速分割
      const parts = rule.split(",");
      if (parts.length < 2) return;

      const ruleType = parts[0].trim().toUpperCase();
      // 获取策略部分（处理 no-resolve 的情况）
      const isNoResolve =
        parts[parts.length - 1].trim().toLowerCase() === "no-resolve";
      const policyIndex = isNoResolve ? parts.length - 2 : parts.length - 1;
      const originalPolicy = parts[policyIndex].trim();

      // 逻辑：保留 DIRECT 和 REJECT，其他的全部重定向到 groupFinalName
      if (
        originalPolicy === "DIRECT" ||
        originalPolicy === "REJECT" ||
        originalPolicy.startsWith("REJECT")
      ) {
        finalRules.push(rule);
      } else if (ruleType !== "MATCH") {
        // 修改目标策略
        parts[policyIndex] = groupFinalName;
        finalRules.push(parts.join(","));
      }
    });
  }

  // 确保最后一条是 MATCH 且指向最终分组
  finalRules.push(`MATCH,${groupFinalName}`);

  // 应用新规则
  config.rules = finalRules;

  return config;
}
