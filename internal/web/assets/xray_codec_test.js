const assert = require('assert');
const app = require('./app.js');

console.log('Testing Xray Codec with CONFIG_TEMPLATES...');

assert(app.CONFIG_TEMPLATES && app.CONFIG_TEMPLATES.length >= 5, 'CONFIG_TEMPLATES must exist and have at least 5 templates');

app.CONFIG_TEMPLATES.forEach((tmpl, i) => {
  console.log(`Testing template [${i}]: ${tmpl.label}...`);
  const rawJSON = JSON.stringify(tmpl.config, null, 2);
  const parsed = app.parseXrayConfig(rawJSON);
  
  assert(!parsed.error, `Parsing template ${i} returned error: ${parsed.error}`);
  assert.strictEqual(parsed.inbounds.length, 1, `Template ${i} should have 1 inbound`);
  
  const inb = parsed.inbounds[0];
  assert.strictEqual(inb.port, 443, 'Port should be 443');
  assert(inb.protocol, 'Protocol should be present');
  
  // Test serialization roundtrip
  const reJSON = app.serializeXrayConfig(parsed);
  const reObj = JSON.parse(reJSON);
  
  assert.strictEqual(reObj.inbounds.length, 1);
  assert.strictEqual(reObj.inbounds[0].protocol, inb.protocol);
  assert.strictEqual(reObj.inbounds[0].streamSettings.network, inb.network);
  assert.strictEqual(reObj.inbounds[0].streamSettings.security || 'none', inb.security);
  assert.deepStrictEqual(reObj.inbounds[0].settings.clients, [], 'Clients must remain empty array');
});

// Test Reality specific roundtrip
console.log('Testing Reality inbound serialization...');
const realityInbound = {
  tag: 'vless-reality',
  listen: '0.0.0.0',
  port: 8443,
  protocol: 'vless',
  network: 'tcp',
  security: 'reality',
  realityDest: 'yahoo.com:443',
  realityServerNames: 'yahoo.com, mail.yahoo.com',
  realityPrivateKey: 'TEST_PRIV_KEY',
  realityShortIds: 'abcd, 1234',
  sniffing: true,
};
const serialized = app.serializeXrayConfig({ inbounds: [realityInbound] });
const parsedBack = app.parseXrayConfig(serialized);
const backInb = parsedBack.inbounds[0];

assert.strictEqual(backInb.tag, 'vless-reality');
assert.strictEqual(backInb.port, 8443);
assert.strictEqual(backInb.security, 'reality');
assert.strictEqual(backInb.realityDest, 'yahoo.com:443');
assert(backInb.realityServerNames.includes('yahoo.com'));
assert.strictEqual(backInb.realityPrivateKey, 'TEST_PRIV_KEY');

console.log('Testing xhttp inbound serialization...');
const xhttpInbound = {
  tag: 'vless-xhttp',
  listen: '0.0.0.0',
  port: 443,
  protocol: 'vless',
  network: 'xhttp',
  security: 'reality',
  xhttpPath: '/my-xhttp',
  xhttpHost: 'cdn.example.com',
  xhttpMode: 'stream-up',
  realityDest: 'www.microsoft.com:443',
  realityServerNames: 'www.microsoft.com',
  realityPrivateKey: 'TEST_KEY',
  realityShortIds: '12345678',
  realitySpiderX: '/download',
  realityFingerprint: 'chrome',
  sniffing: true,
};
const xhttpSerialized = app.serializeXrayConfig({ inbounds: [xhttpInbound] });
const xhttpParsedBack = app.parseXrayConfig(xhttpSerialized);
const xhttpBack = xhttpParsedBack.inbounds[0];

assert.strictEqual(xhttpBack.network, 'xhttp');
assert.strictEqual(xhttpBack.xhttpPath, '/my-xhttp');
assert.strictEqual(xhttpBack.xhttpHost, 'cdn.example.com');
assert.strictEqual(xhttpBack.xhttpMode, 'stream-up');
assert.strictEqual(xhttpBack.realitySpiderX, '/download');
assert.strictEqual(xhttpBack.realityFingerprint, 'chrome');

console.log('Testing httpupgrade and kcp inbound serialization...');
const httpupgradeInbound = {
  tag: 'vless-upgrade',
  listen: '0.0.0.0',
  port: 80,
  protocol: 'vless',
  network: 'httpupgrade',
  security: 'none',
  httpupgradePath: '/upgrade-path',
  httpupgradeHost: 'upgrade.example.com',
};
const upgradeSerialized = app.serializeXrayConfig({ inbounds: [httpupgradeInbound] });
const upgradeParsedBack = app.parseXrayConfig(upgradeSerialized);
assert.strictEqual(upgradeParsedBack.inbounds[0].network, 'httpupgrade');
assert.strictEqual(upgradeParsedBack.inbounds[0].httpupgradePath, '/upgrade-path');

const kcpInbound = {
  tag: 'vless-kcp',
  listen: '0.0.0.0',
  port: 20000,
  protocol: 'vless',
  network: 'kcp',
  security: 'none',
  kcpHeaderType: 'wireguard',
  kcpSeed: 'secret-seed',
};
const kcpSerialized = app.serializeXrayConfig({ inbounds: [kcpInbound] });
const kcpParsedBack = app.parseXrayConfig(kcpSerialized);
assert.strictEqual(kcpParsedBack.inbounds[0].network, 'kcp');
assert.strictEqual(kcpParsedBack.inbounds[0].kcpHeaderType, 'wireguard');
assert.strictEqual(kcpParsedBack.inbounds[0].kcpSeed, 'secret-seed');

console.log('Testing raw PEM certificate inbound serialization...');
const pemCertInbound = {
  tag: 'vless-tls-pem',
  listen: '0.0.0.0',
  port: 443,
  protocol: 'vless',
  network: 'tcp',
  security: 'tls',
  tlsServerName: 'myvpn.com',
  tlsCertType: 'pem',
  tlsCertPem: '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----',
  tlsKeyPem: '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----',
};
const pemSerialized = app.serializeXrayConfig({ inbounds: [pemCertInbound] });
const pemParsed = JSON.parse(pemSerialized);
assert(Array.isArray(pemParsed.inbounds[0].streamSettings.tlsSettings.certificates[0].certificate));
assert(Array.isArray(pemParsed.inbounds[0].streamSettings.tlsSettings.certificates[0].key));

const pemParsedBack = app.parseXrayConfig(pemSerialized);
assert.strictEqual(pemParsedBack.inbounds[0].tlsCertPem, pemCertInbound.tlsCertPem);
assert.strictEqual(pemParsedBack.inbounds[0].tlsKeyPem, pemCertInbound.tlsKeyPem);
assert.strictEqual(pemParsedBack.inbounds[0].tlsCertType, 'pem');

console.log('✓ All Xray Codec tests passed successfully!');
