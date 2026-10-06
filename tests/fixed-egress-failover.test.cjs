const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../examples/fixed-egress-failover.js'), 'utf8');
function transform(input) {
  const context = vm.createContext({input});
  return JSON.parse(vm.runInContext(source.replace('enabled: false', 'enabled: true') + '\nJSON.stringify(main(input));', context));
}
function fixture() {
  return {
    'mixed-port': 7897, tun: {enable: true, 'auto-route': true},
    proxies: [
      {name: 'Fixed-US-SOCKS5', type: 'socks5', server: '192.0.2.10', port: 1080, username: 'TEST_ONLY_USER', password: 'TEST_ONLY_PASSWORD'},
      ...[1,2,3,4].map(i => ({name: `Relay-${i}`, type: 'anytls', server: `relay-${i}.example.invalid`, port: 7001, password: 'TEST_ONLY_RELAY'}))
    ]
  };
}
test('all selectable business chains keep the same authenticated endpoint', () => {
  const input = fixture(), before = JSON.stringify(input), out = transform(input);
  const business = out['proxy-groups'][0];
  assert.equal(business.type, 'fallback');
  assert.equal(business.proxies.length, 4);
  for (const name of business.proxies) {
    const p = out.proxies.find(p => p.name === name);
    assert.equal(p.server, '192.0.2.10');
    assert.equal(p.port, 1080);
    assert.equal(p.password, 'TEST_ONLY_PASSWORD');
    assert.equal(p.username, 'TEST_ONLY_USER');
    assert.ok(p['dialer-proxy'].startsWith('Relay-'));
    assert.equal(p.udp, false);
  }
  assert.equal(JSON.stringify(input), before);
});
test('a removed primary relay preserves ordered backup chains', () => {
  const input = fixture(); input.proxies = input.proxies.filter(p => p.name !== 'Relay-1');
  const out = transform(input);
  assert.deepEqual(out['proxy-groups'][1].proxies, ['Relay-2', 'Relay-3', 'Relay-4']);
  assert.equal(out['proxy-groups'][0].proxies.length, 3);
});
test('missing all relays or final credentials node rejects business traffic', () => {
  for (const keep of [p => p.type === 'socks5', p => p.type !== 'socks5']) {
    const input = fixture(); input.proxies = input.proxies.filter(keep);
    const out = transform(input);
    assert.equal(out.proxies.length, 0);
    assert.ok(out['proxy-groups'].every(g => g.proxies.length === 1 && g.proxies[0] === 'REJECT'));
    assert.ok(out.rules.at(-2).endsWith(',REJECT'));
  }
});
test('subscription endpoint changes cannot silently extend the relay allowlist', () => {
  const input = fixture();
  input.proxies[1].server = 'unexpected.example.invalid';
  input.proxies[2].port = 9999;
  input.proxies[3]['dialer-proxy'] = 'unexpected-chain';
  input.proxies[4].server = 'changed.example.invalid';
  assert.equal(transform(input).proxies.length, 0);
});
test('changed final endpoint and ambiguous duplicate names require review', () => {
  const changed = fixture(); changed.proxies[0].server = '198.51.100.20';
  assert.throws(() => transform(changed), /Fixed endpoint changed/);
  const duplicate = fixture(); duplicate.proxies.push({...duplicate.proxies[1]});
  assert.throws(() => transform(duplicate), /Duplicate proxy names/);
});
test('inherited public direct routes and provider/listener overrides are removed', () => {
  const input = fixture();
  Object.assign(input, {rules: ['DOMAIN,example.com,DIRECT', 'MATCH,DIRECT'],
    'proxy-providers': {unreviewed: {}}, 'rule-providers': {unreviewed: {}}, 'sub-rules': {}, tunnels: [],
    listeners: [{name: 'legacy', type: 'http', port: 18080, proxy: 'DIRECT', 'rule-set': 'unreviewed'}]});
  const out = transform(input);
  for (const key of ['proxy-providers','rule-providers','sub-rules','tunnels']) assert.equal(out[key], undefined);
  assert.equal(out.listeners[0].proxy, undefined);
  assert.equal(out.listeners[0]['rule-set'], undefined);
  assert.equal(out.rules.includes('DOMAIN,example.com,DIRECT'), false);
  assert.equal(out.rules.at(-1), 'MATCH,Claude-Fixed-Egress');
  assert.ok(out.rules.includes('NETWORK,UDP,REJECT'));
  assert.ok(out.rules.includes('IP-CIDR6,::/0,REJECT,no-resolve'));
});
test('health checks use HTTPS with matching expected status, without adding TLS exceptions', () => {
  const out = transform(fixture());
  assert.ok(out['proxy-groups'].every(g => g.url === 'https://www.gstatic.com/generate_204' && g['expected-status'] === '204' && g.interval === 60));
  assert.equal(out.dns['skip-cert-verify'], false);
  assert.ok(out.proxies.filter(p => p.type === 'anytls').every(p => p['skip-cert-verify'] !== true));
});
test('reserved HTTP port conflicts are detected, including ranges', () => {
  const input = fixture(); input.listeners = [{name: 'other', port: '17890-17900'}];
  assert.throws(() => transform(input), /HTTP listener conflict/);
  const mixed = fixture(); mixed['mixed-port'] = 17897;
  assert.throws(() => transform(mixed), /HTTP port conflict/);
});
test('default is disabled; enabling preserves macOS TUN and is idempotent', () => {
  const input=fixture();input.tun.device='utun10';input.tun.enable=false;
  const untouched=JSON.parse(vm.runInNewContext(source+'\nJSON.stringify(main(input))',{input}));
  assert.deepEqual(untouched,input);
  const once=transform(input);assert.deepEqual(transform(once),once);
  assert.equal(once.tun.device,'utun10');assert.equal(once.tun.enable,false);
});
test('duplicate suffixes and relay names cannot create ambiguous chains', () => {
  for(const [before,after] of [['suffix: "R4"','suffix: "R3"'],['name: "Relay-4"','name: "Relay-3"']]) {
    const bad=source.replace('enabled: false','enabled: true').replace(before,after);
    assert.throws(()=>vm.runInNewContext(bad+'\nmain(input)',{input:fixture()}),/Duplicate relay allowlist/);
  }
});
