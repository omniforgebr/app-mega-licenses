import { webcrypto as c } from 'node:crypto';
const kp = await c.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const pkcs8 = Buffer.from(await c.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
const raw = Buffer.from(await c.subtle.exportKey('raw', kp.publicKey)).toString('base64');
console.log('# SIGNING_KEY (Worker Secret, pkcs8 base64):\n' + pkcs8);
console.log('\n# PUBLIC KEY (raw base64 — embed in app, record with kid):\n' + raw);
