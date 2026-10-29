'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const authLib = require('../lib/auth');

const req = (token) => ({ headers: { cookie: token ? 'x=1; csadmin=' + token : '' }, socket: {} });

function fresh() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'));
}

test('Standardpasswort gilt, solange nichts geändert wurde', () => {
  const a = authLib.create(fresh());
  assert.ok(a.isDefault());
  assert.strictEqual(a.login('falsch', '1.1.1.1').status, 401);
  const r = a.login('courtspotadmin', '1.1.1.1');
  assert.match(r.token, /^[0-9a-f]{64}$/);
  assert.ok(a.loggedIn(req(r.token)));
  assert.ok(!a.loggedIn(req('0'.repeat(64))));
  assert.ok(!a.loggedIn(req(null)));
  a.logout(req(r.token));
  assert.ok(!a.loggedIn(req(r.token)));
});

test('Passwort ändern: gespeichert als Hash, gilt nach Neustart, andere Sitzungen enden', () => {
  const dir = fresh();
  const a = authLib.create(dir);
  const t1 = a.login('courtspotadmin', 'ip').token;
  const t2 = a.login('courtspotadmin', 'ip').token;
  assert.strictEqual(a.change('falsch', 'neuesPasswort1', req(t1)).status, 401);
  assert.strictEqual(a.change('courtspotadmin', 'kurz', req(t1)).status, 400);
  assert.strictEqual(a.change('courtspotadmin', 'courtspotadmin', req(t1)).status, 400);
  assert.ok(a.change('courtspotadmin', 'neuesPasswort1', req(t1)).ok);
  assert.ok(!a.isDefault());
  assert.ok(a.loggedIn(req(t1)), 'eigene Sitzung bleibt');
  assert.ok(!a.loggedIn(req(t2)), 'andere Sitzung beendet');
  const raw = fs.readFileSync(path.join(dir, 'admin.json'), 'utf8');
  assert.ok(!raw.includes('neuesPasswort1'), 'kein Klartext');
  const b = authLib.create(dir);
  assert.strictEqual(b.login('courtspotadmin', 'ip').status, 401);
  assert.ok(b.login('neuesPasswort1', 'ip').token);
});

test('Nach zu vielen Fehlversuchen wird die IP gesperrt', () => {
  const a = authLib.create(fresh());
  for (let i = 0; i < 10; i++) a.login('falsch', '9.9.9.9');
  assert.strictEqual(a.login('courtspotadmin', '9.9.9.9').status, 429);
  assert.ok(a.login('courtspotadmin', '8.8.8.8').token, 'andere IP nicht betroffen');
});

test('Cookie: HttpOnly, SameSite=Strict, Secure nur bei HTTPS', () => {
  const a = authLib.create(fresh());
  const plain = a.cookie({ headers: {}, socket: {} }, 'abc');
  assert.match(plain, /HttpOnly/);
  assert.match(plain, /SameSite=Strict/);
  assert.doesNotMatch(plain, /Secure/);
  assert.match(a.cookie({ headers: { 'x-forwarded-proto': 'https' }, socket: {} }, 'abc'), /Secure/);
  assert.match(a.cookie({ headers: {}, socket: {} }, null), /Max-Age=0/);
});

test('ADMIN_PASSWORD: nur dieses gilt, nicht änderbar', () => {
  const a = authLib.create(fresh(), 'ausDerVariable');
  assert.ok(!a.isDefault());
  assert.ok(a.fromEnv());
  assert.strictEqual(a.login('courtspotadmin', 'ip').status, 401);
  const t = a.login('ausDerVariable', 'ip').token;
  assert.ok(t);
  assert.strictEqual(a.change('ausDerVariable', 'neuesPasswort1', req(t)).status, 409);
});
