'use strict';
// Synthetic fixtures only. Never reads live proxy/Claude configs or changes networking.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, '链式代理脚本.js');
const source = fs.readFileSync(script, 'utf8');
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }
function compile(overrides = {}) {
  let code = source;
  for (const [key, value] of Object.entries(overrides)) {
    const matcher = new RegExp('^  ' + key + ': [^\\n]+', 'm');
    assert.ok(matcher.test(code), 'Unknown setting');
    code = code.replace(matcher, '  ' + key + ': ' + JSON.stringify(value) + ',');
  }
  const context = vm.createContext({});
  vm.runInContext(code + '\nthis.run = main;', context);
  return context.run;
}
function fixture() {
  return {
    'mixed-port':7897,mode:'global',ipv6:false,
    proxies:[
      {name:'US_EXIT',type:'socks5',server:'203.0.113.10',port:1080,username:'fixture-user',password:'TEST_ONLY_NOT_A_SECRET'},
      {name:'RELAY_NODE',type:'anytls',server:'relay.example.invalid',port:443,password:'TEST_ONLY_NOT_A_SECRET','skip-cert-verify':true},
      {name:'OTHER_NODE',type:'socks5',server:'192.0.2.20',port:1080}
    ],
    'proxy-groups':[{name:'old',type:'select',proxies:['DIRECT']}],
    'proxy-providers':{old:{}},'rule-providers':{old:{}},'sub-rules':{old:[]},tunnels:[],
    tun:{enable:false,stack:'mixed'},dns:{'skip-cert-verify':true,fallback:['system'],'nameserver-policy':{'*':'system'}},
    listeners:[{name:'other-local',type:'http',listen:'127.0.0.1',port:17896,proxy:'DIRECT'}],rules:['MATCH,DIRECT']
  };
}
const plain = value => JSON.parse(JSON.stringify(value));
const run = (input, overrides = {}) => plain(compile({enabled:true,...overrides})(input));
const normal = run(fixture()), ads = run(fixture(), {appManagedSocks:true});
test('default disabled leaves original input unchanged', () => {
  const input=fixture(); assert.equal(compile()(input), input);
});
test('single fixed chain and no fallback providers/groups', () => {
  assert.equal(normal.mode,'rule'); assert.equal(normal.proxies.length,2);
  assert.equal(normal.proxies[0]['dialer-proxy'],'RELAY_NODE');
  assert.deepEqual(normal['proxy-groups'],[{name:'Fixed-Egress',type:'select',proxies:['US_EXIT']}]);
  for(const key of ['proxy-providers','rule-providers','sub-rules','tunnels'])assert.equal(normal[key],undefined);
  assert.equal(normal.listeners[0].proxy,undefined);
});
test('TLS on, DNS through fixed group, TUN enable/stack preserved', () => {
  assert.equal(normal.tun.enable,false); assert.equal(normal.tun.stack,'mixed');
  assert.equal(normal.dns.ipv6,false); assert.equal(normal.ipv6,true);
  assert.ok(normal.proxies.every(p=>p['skip-cert-verify']===false));
  assert.equal(normal.dns['skip-cert-verify'],undefined);
  assert.ok(normal.dns.nameserver.every(n=>n.endsWith('#Fixed-Egress')));
  assert.deepEqual(normal.dns.fallback,[]);
});
test('UDP and IPv6 rejection precede fixed public TCP', () => {
  assert.deepEqual(normal.rules.slice(-3),['NETWORK,UDP,REJECT','IP-CIDR6,::/0,REJECT,no-resolve','MATCH,Fixed-Egress']);
  assert.ok(!normal.rules.some(r=>r.includes('GEOIP,CN')||r.includes('PROCESS-NAME')));
});
test('AdsPower only exact endpoint TCP to relay before MATCH', () => {
  assert.equal(ads.rules.at(-2),'AND,((NETWORK,TCP),(IP-CIDR,203.0.113.10/32),(DST-PORT,1080)),RELAY_NODE');
  assert.deepEqual(ads.rules.filter(r=>!r.startsWith('AND,')), normal.rules);
});
test('enabled transforms are idempotent and input stays intact', () => {
  const f=fixture(),copy=JSON.stringify(f);run(f);assert.equal(JSON.stringify(f),copy);
  assert.deepEqual(run(normal),normal);assert.deepEqual(run(ads,{appManagedSocks:true}),ads);
});
for(const name of ['US_EXIT','RELAY_NODE'])test('missing '+name+' rejects, including app-managed path', () => {
  const f=fixture();f.proxies=f.proxies.filter(p=>p.name!==name);const result=run(f,{appManagedSocks:true});
  assert.deepEqual(result.proxies,[]);assert.deepEqual(result['proxy-groups'][0].proxies,['REJECT']);
  assert.ok(result.rules.at(-2).endsWith(',REJECT'));
});
test('cycle, unresolved dependency, duplicate, wrong type, endpoint mismatch reject', () => {
  const cases=[];
  let f=fixture();f.proxies[1]['dialer-proxy']='US_EXIT';cases.push(f);
  f=fixture();f.proxies[1]['dialer-proxy']='MISSING';cases.push(f);
  f=fixture();f.proxies.push({...f.proxies[0]});cases.push(f);
  f=fixture();f.proxies[0].type='http';cases.push(f);
  f=fixture();f.proxies[0].port=1081;cases.push(f);
  f=fixture();f.proxies[1].type='direct';cases.push(f);
  for(const c of cases)assert.deepEqual(run(c)['proxy-groups'][0].proxies,['REJECT']);
});
test('invalid target address and ports cannot create invalid exception', () => {
  for(const options of [{exitServer:'invalid.example.invalid'},{exitServer:'999.0.0.1'},{exitPort:0},{exitPort:70000}]) {
    const r=run(fixture(),{...options,appManagedSocks:true});
    assert.deepEqual(r['proxy-groups'][0].proxies,['REJECT']);assert.ok(!r.rules.some(x=>x.startsWith('AND,')));
  }
});
test('port collisions stop; no silent listener replacement', () => {
  for(const port of [17897,'17890-17900']) {const f=fixture();f.listeners[0].port=port;assert.throws(()=>run(f),/conflict/);}
  const f=fixture();f['mixed-port']=17897;assert.throws(()=>run(f),/conflict/);
});
test('bootstrap URL cannot disable TLS or carry credentials', () => {
  assert.throws(()=>run(fixture(),{bootstrapDoh:'http://1.1.1.1/dns-query'}),/HTTPS/);
});
test('Claude proxy fragment preserves eight case-sensitive env keys', () => {
  const fragment=JSON.parse(fs.readFileSync(path.join(root,'examples/claude-env.json'),'utf8'));
  assert.equal(Object.keys(fragment.env).length,8);
  for(const key of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy'])assert.equal(fragment.env[key],'http://127.0.0.1:17897');
  assert.equal(fragment.env.NO_PROXY,'localhost,127.0.0.1,::1');assert.equal(fragment.env.no_proxy,fragment.env.NO_PROXY);
});
// Use Git's publishable file set so ignored, preserved private screenshots are never opened.
const listing=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'});
if(listing.status!==0)throw Error('Run tests from a Git checkout; cannot enumerate publishable files.');
const files=[...new Set(listing.stdout.split('\0').filter(Boolean))].filter(f=>fs.existsSync(path.join(root,f)));
test('no private images, IDE metadata or recovery archives in publishable tree', () => {
  for(const f of files)assert.ok(!/^(?:images|链式代理脚本images|\.idea|private|reports|backups)\/|\.(?:png|jpe?g|zip|bak|before|ledger\.json)$/i.test(f),'Review file: '+f);
});
// Public resolver only: documented bootstrap exception, not a private endpoint.
const allowedIPs=new Set(['127.0.0.1','127.0.0.0','10.0.0.0','172.16.0.0','192.168.0.0','169.254.0.0','224.0.0.0','1.1.1.1','8.8.8.8','223.5.5.5']);
function isPublicExampleIP(ip) {return allowedIPs.has(ip)||/^(?:192\.0\.2|198\.51\.100|203\.0\.113)\./.test(ip);}
test('privacy scan: IP allowlist, private paths, credential patterns', () => {
  for(const f of files) {
    const text=fs.readFileSync(path.join(root,f),'utf8');
    for(const ip of text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)||[]) {
      // The invalid-address unit test is deliberately non-routable, not a real deployment.
      assert.ok(isPublicExampleIP(ip)||(f==='tests/verify.cjs'&&ip==='999.0.0.1'),'Review IP in '+f);
    }
    for(const expression of [/\/(?:Users|home)\/[A-Za-z0-9._-]+\//,/\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/https?:\/\/[^\s/@]+:[^\s/@]+@/])assert.ok(!expression.test(text),'Sensitive pattern in '+f);
    for(const match of text.matchAll(/\b(?:password|token|secret)\s*[:=]\s*['"]([^'"\r\n]+)['"]/g))assert.ok(
      (f==='tests/verify.cjs'&&match[1]==='TEST_ONLY_NOT_A_SECRET') ||
      (f==='tests/fixed-egress-failover.test.cjs'&&['TEST_ONLY_PASSWORD','TEST_ONLY_RELAY'].includes(match[1])),
      'Credential assignment in '+f);
  }
});
test('Markdown fences and relative links resolve', () => {
  for(const f of files.filter(f=>f.endsWith('.md'))) {
    const text=fs.readFileSync(path.join(root,f),'utf8');assert.equal((text.match(/^```/gm)||[]).length%2,0,f);
    const prose=text.replace(/```[^\n]*\n[\s\S]*?```/g,'');
    for(const match of prose.matchAll(/\]\(([^)]+)\)/g)) {
      const href=match[1];if(/^(?:https?:|#)/.test(href))continue;
      assert.ok(fs.existsSync(path.resolve(root,path.dirname(f),decodeURIComponent(href.split('#')[0]))),'Broken link in '+f);
    }
  }
});
test('all JavaScript parses without installing dependencies', () => {
  for(const f of files.filter(f=>/\.(js|cjs)$/.test(f))) {
    const r=spawnSync(process.execPath,['--check',path.join(root,f)],{encoding:'utf8'});assert.equal(r.status,0,f);
  }
});
if(process.argv.includes('--mihomo')) {
  const core=process.argv[process.argv.indexOf('--mihomo')+1];if(!core)throw Error('Provide an existing core path.');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'proxy-guide-test-'));
  try {
    for(const [label,config] of [['normal',normal],['adspower',ads],['missing',run({proxies:[]},{appManagedSocks:true})]]) {
      const candidate=path.join(temporary,label+'.json');fs.writeFileSync(candidate,JSON.stringify(config),{mode:0o600});
      const r=spawnSync(core,['-t','-f',candidate,'-d',temporary],{encoding:'utf8',timeout:15000});
      test('existing Mihomo syntax: '+label,()=>assert.equal(r.status,0,'Synthetic config failed; inspect core compatibility.'));
    }
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
}
console.log('Passed '+checks+' checks. Synthetic/local only; not Windows, browser, account or live-network acceptance.');
