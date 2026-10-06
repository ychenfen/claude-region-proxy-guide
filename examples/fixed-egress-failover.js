// Clash Verge subscription enhancement template; not a complete configuration.
// Replace DOCUMENTATION addresses/names below. Keep credentials in local nodes.
const TARGET = Object.freeze({
  enabled: false,
  exitNode: "Fixed-US-SOCKS5",
  expectedIPv4: "192.0.2.10",
  exitPort: 1080,
  group: "Claude-Fixed-Egress",
  relayGroup: "Relay-Auto",
  httpPort: 17897,
  relays: [
    {name: "Relay-1", server: "relay-1.example.invalid", port: 7001, suffix: "R1"},
    {name: "Relay-2", server: "relay-2.example.invalid", port: 7001, suffix: "R2"},
    {name: "Relay-3", server: "relay-3.example.invalid", port: 7001, suffix: "R3"},
    {name: "Relay-4", server: "relay-4.example.invalid", port: 7001, suffix: "R4"}
  ]
});

function main(input) {
  if (!TARGET.enabled) return input;
  for (const key of ["name", "suffix"]) {
    if (new Set(TARGET.relays.map(r => r[key])).size !== TARGET.relays.length) {
      throw new Error("Duplicate relay allowlist name or suffix");
    }
  }
  if (TARGET.relays.some(r => r.name === TARGET.exitNode || r.name === TARGET.group || r.name === TARGET.relayGroup ||
      r.name.startsWith(TARGET.exitNode + "-via-") || !r.suffix || !Number.isInteger(r.port) || r.port < 1 || r.port > 65535)) {
    throw new Error("Invalid relay allowlist");
  }
  const config = JSON.parse(JSON.stringify(input));
  const byName = new Map();
  for (const p of config.proxies || []) {
    if (byName.has(p.name)) throw new Error("Duplicate proxy names: inspect locally");
    byName.set(p.name, p);
  }
  const exit = byName.get(TARGET.exitNode);
  if (exit && (exit.type !== "socks5" || exit.server !== TARGET.expectedIPv4 || Number(exit.port) !== TARGET.exitPort)) {
    throw new Error("Fixed endpoint changed: inspect before applying");
  }
  const relays = TARGET.relays.filter(r => {
    const p = byName.get(r.name);
    // Explicit allowlist: align with the separately reviewed OS firewall rules.
    return p && p.type === "anytls" && p.server === r.server && Number(p.port) === r.port && !p["dialer-proxy"];
  });
  const available = !!exit && relays.length > 0;
  const chainNames = [];
  config.proxies = [];
  if (available) {
    // Keep a fixed-endpoint anchor so reapplying to generated output is safe.
    // This node is not a fallback to bare relay egress.
    config.proxies.push(Object.assign({}, exit, {"dialer-proxy": TARGET.relayGroup, udp: false, "skip-cert-verify": false}));
    for (const r of relays) {
      // Preserve existing authentication/TLS settings; do not add TLS bypasses.
      config.proxies.push(byName.get(r.name));
      const chain = JSON.parse(JSON.stringify(exit));
      chain.name = TARGET.exitNode + "-via-" + r.suffix;
      chain["dialer-proxy"] = r.name;
      chain.udp = false;
      chain["skip-cert-verify"] = false;
      config.proxies.push(chain);
      chainNames.push(chain.name);
    }
  }
  const health = {type: "fallback", url: "https://www.gstatic.com/generate_204", interval: 60, timeout: 8000,
    lazy: false, "max-failed-times": 2, "expected-status": "204", "disable-udp": true};
  config["proxy-groups"] = available ? [
    // Checks include relay + authenticated final SOCKS5 + target HTTPS.
    Object.assign({name: TARGET.group, proxies: chainNames}, health),
    // Apps authenticating to SOCKS5 themselves need relay transport only.
    Object.assign({name: TARGET.relayGroup, proxies: relays.map(r => r.name)}, health)
  ] : [{name: TARGET.group, type: "select", proxies: ["REJECT"]},
       {name: TARGET.relayGroup, type: "select", proxies: ["REJECT"]}];
  for (const key of ["proxy-providers", "rule-providers", "sub-rules", "tunnels"]) delete config[key];
  config.mode = "rule";
  config["allow-lan"] = false;
  config["bind-address"] = "127.0.0.1";
  for (const key of ["port", "socks-port", "mixed-port", "redir-port", "tproxy-port"]) {
    if (Number(config[key]) === TARGET.httpPort) throw new Error("HTTP port conflict");
  }
  const listeners = config.listeners || [];
  for (const listener of listeners) {
    const clashes = String(listener.port).split(",").some(part => {
      const range = /^(\d+)-(\d+)$/.exec(part.trim());
      return range ? TARGET.httpPort >= Number(range[1]) && TARGET.httpPort <= Number(range[2]) : Number(part) === TARGET.httpPort;
    });
    if (listener.name !== "claude-local-http" && clashes) throw new Error("HTTP listener conflict");
  }
  config.listeners = listeners.filter(x => x.name !== "claude-local-http").map(x => {
    delete x.proxy; delete x["rule-set"]; return x;
  });
  config.listeners.push({name: "claude-local-http", type: "http", listen: "127.0.0.1", port: TARGET.httpPort});
  config.rules = [
    "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve", "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve", "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
    "IP-CIDR,169.254.0.0/16,DIRECT,no-resolve", "IP-CIDR,224.0.0.0/4,DIRECT,no-resolve",
    "IP-CIDR6,::1/128,DIRECT,no-resolve", "IP-CIDR6,fe80::/10,DIRECT,no-resolve",
    "IP-CIDR6,ff02::/16,DIRECT,no-resolve",
    "AND,((IP-CIDR,223.5.5.5/32),(DST-PORT,443),(NETWORK,TCP)),DIRECT",
    "NETWORK,UDP,REJECT", "IP-CIDR6,::/0,REJECT,no-resolve",
    `AND,((NETWORK,TCP),(IP-CIDR,${TARGET.expectedIPv4}/32),(DST-PORT,${TARGET.exitPort})),${available ? TARGET.relayGroup : "REJECT"}`,
    "MATCH," + TARGET.group
  ];
  config.ipv6 = true;
  // Preserve platform device name and enable state; PF may depend on utunN on macOS.
  config.tun = Object.assign({}, config.tun, {"strict-route": true, "dns-hijack": ["any:53", "tcp://any:53"]});
  config.dns = Object.assign({}, config.dns, {enable: true, ipv6: false, "prefer-h3": false, "respect-rules": false,
    "skip-cert-verify": false, "default-nameserver": ["1.1.1.1"],
    nameserver: ["https://1.1.1.1/dns-query#" + TARGET.group, "https://8.8.8.8/dns-query#" + TARGET.group],
    fallback: [], "nameserver-policy": {}, "direct-nameserver": [], "proxy-server-nameserver": ["https://223.5.5.5/dns-query"]});
  delete config.dns["proxy-server-nameserver-policy"];
  return config;
}
