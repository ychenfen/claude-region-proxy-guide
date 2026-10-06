// Public template. Real nodes/credentials stay in the client's private config.
// Not a complete subscription or an OS kill switch. Read README before enabling.
const SETTINGS = Object.freeze({
  enabled: false,
  exitNode: "US_EXIT",
  relayNode: "RELAY_NODE",
  exitServer: "203.0.113.10", // Documentation address; replace LOCALLY.
  exitPort: 1080,
  group: "Fixed-Egress",
  httpPort: 17897,
  appManagedSocks: false,
  bootstrapDoh: "https://1.1.1.1/dns-query"
});

function main(input) {
  if (!SETTINGS.enabled) return input;
  const config = JSON.parse(JSON.stringify(input));
  const proxies = config.proxies || [];
  const byName = new Map();
  let valid = SETTINGS.exitNode !== SETTINGS.relayNode;
  const reservedNames = new Set(["DIRECT", "REJECT", "GLOBAL", SETTINGS.group]);
  for (const proxy of proxies) {
    if (byName.has(proxy.name)) valid = false;
    byName.set(proxy.name, proxy);
  }
  const exit = byName.get(SETTINGS.exitNode), relay = byName.get(SETTINGS.relayNode);
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(SETTINGS.exitServer) && SETTINGS.exitServer.split(".").every(n => Number(n) <= 255);
  valid = valid && ipv4 && Number.isInteger(SETTINGS.exitPort) && SETTINGS.exitPort > 0 && SETTINGS.exitPort <= 65535 &&
    !!exit && exit.type === "socks5" && !!relay && exit.server === SETTINGS.exitServer && Number(exit.port) === SETTINGS.exitPort;
  if (exit) exit["dialer-proxy"] = SETTINGS.relayNode;
  const kept = new Set(), visiting = new Set();
  function retain(name) {
    if (reservedNames.has(name) || visiting.has(name)) return false;
    if (kept.has(name)) return true;
    const proxy = byName.get(name);
    if (!proxy || ["direct", "reject", "pass"].includes(proxy.type)) return false;
    visiting.add(name);
    if (proxy["dialer-proxy"] && !retain(proxy["dialer-proxy"])) return false;
    visiting.delete(name);
    kept.add(name);
    return true;
  }
  valid = valid && retain(SETTINGS.exitNode);
  config.proxies = valid ? proxies.filter(p => kept.has(p.name)).map(p => {
    p["skip-cert-verify"] = false;
    if (p.name === SETTINGS.exitNode) p.udp = false;
    return p;
  }) : [];
  config["proxy-groups"] = [{name: SETTINGS.group, type: "select", proxies: [valid ? SETTINGS.exitNode : "REJECT"]}];
  delete config["proxy-providers"];
  delete config["rule-providers"];
  delete config["sub-rules"];
  delete config.tunnels;
  config.mode = "rule";
  config["allow-lan"] = false;
  config["bind-address"] = "127.0.0.1";
  for (const key of ["port", "socks-port", "mixed-port", "redir-port", "tproxy-port"]) {
    if (Number(config[key]) === SETTINGS.httpPort) throw new Error("Local HTTP port conflicts with an existing inbound; stop deployment.");
  }
  const listeners = config.listeners || [];
  for (const listener of listeners) {
    if (listener.name === "fixed-egress-http") continue;
    const conflict = String(listener.port).split(",").some(part => {
      const range = /^(\d+)-(\d+)$/.exec(part.trim());
      return range ? SETTINGS.httpPort >= Number(range[1]) && SETTINGS.httpPort <= Number(range[2]) : Number(part) === SETTINGS.httpPort;
    });
    if (conflict) throw new Error("Local HTTP listener port conflict; stop deployment.");
  }
  config.listeners = listeners.filter(p => p.name !== "fixed-egress-http").map(p => {
    delete p.proxy;
    delete p["rule-set"];
    return p;
  });
  config.listeners.push({name: "fixed-egress-http", type: "http", listen: "127.0.0.1", port: SETTINGS.httpPort});
  config.rules = [
    "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
    "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
    "IP-CIDR,169.254.0.0/16,DIRECT,no-resolve",
    "IP-CIDR,224.0.0.0/4,DIRECT,no-resolve",
    "IP-CIDR6,::1/128,DIRECT,no-resolve",
    "IP-CIDR6,fe80::/10,DIRECT,no-resolve",
    "IP-CIDR6,ff02::/16,DIRECT,no-resolve",
    "NETWORK,UDP,REJECT",
    "IP-CIDR6,::/0,REJECT,no-resolve"
  ];
  if (SETTINGS.appManagedSocks && ipv4 && Number.isInteger(SETTINGS.exitPort) && SETTINGS.exitPort > 0 && SETTINGS.exitPort <= 65535) {
    config.rules.push(`AND,((NETWORK,TCP),(IP-CIDR,${SETTINGS.exitServer}/32),(DST-PORT,${SETTINGS.exitPort})),${valid ? SETTINGS.relayNode : "REJECT"}`);
  }
  config.rules.push(`MATCH,${SETTINGS.group}`);
  config.ipv6 = true; // Keep IPv6 capture; disabling AAAA alone is not a firewall.
  config.tun = Object.assign({}, config.tun, {
    "strict-route": true, "dns-hijack": ["any:53", "tcp://any:53"]
  }); // Preserve enable/stack/device; inspect route/process exclusions separately.
  if (!/^https:\/\/(\d{1,3}\.){3}\d{1,3}(:\d+)?\/dns-query$/.test(SETTINGS.bootstrapDoh)) {
    throw new Error("Use a locally validated literal-IP HTTPS bootstrap resolver; stop deployment.");
  }
  config.dns = Object.assign({}, config.dns, {
    enable: true, ipv6: false, "prefer-h3": false, "respect-rules": false,
    "default-nameserver": ["1.1.1.1"],
    nameserver: [`https://1.1.1.1/dns-query#${SETTINGS.group}`, `https://8.8.8.8/dns-query#${SETTINGS.group}`],
    fallback: [], "nameserver-policy": {}, "direct-nameserver": [],
    "proxy-server-nameserver": [SETTINGS.bootstrapDoh]
  });
  delete config.dns["proxy-server-nameserver-policy"];
  delete config.dns["skip-cert-verify"];
  return config;
}
