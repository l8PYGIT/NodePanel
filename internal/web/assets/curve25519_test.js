const assert = require('assert');
const app = require('./app.js');

console.log('Testing RFC 7748 test vector...');
const secBytes = Buffer.from('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a', 'hex');
const k = new Uint8Array(secBytes);
k[0] &= 248; k[31] &= 127; k[31] |= 64;
let sc = 0n;
for (let i = 0; i < 32; i++) sc += BigInt(k[i]) << (8n * BigInt(i));

const pubBig = app.curve25519(sc, 9n);
const pubBytes = Buffer.alloc(32);
for (let i = 0; i < 32; i++) pubBytes[i] = Number((pubBig >> (8n * BigInt(i))) & 0xffn);

const expectedHex = '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a';
assert.strictEqual(pubBytes.toString('hex'), expectedHex, 'RFC 7748 test vector failed!');
console.log('✓ RFC 7748 test vector passed');

console.log('Testing generateRealityKeys()...');
for (let i = 0; i < 5; i++) {
  const keys = app.generateRealityKeys();
  assert(keys.privateKey && keys.privateKey.length === 43, 'Invalid private key format: ' + keys.privateKey);
  assert(keys.publicKey && keys.publicKey.length === 43, 'Invalid public key format: ' + keys.publicKey);
  assert(keys.shortId && /^[0-9a-f]{16}$/.test(keys.shortId), 'Invalid shortId format: ' + keys.shortId);
}
console.log('✓ generateRealityKeys() passed with valid 43-char Base64RawURL and 16-hex shortId');
