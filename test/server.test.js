'use strict';

// Startet den Server und prüft den Weg CourtSpot → Liveticker über HTTP
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sample = require('./sample.json');

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'test-passwort';
let proc;

test.before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-'));
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), TICKER_PASSWORD: PW, DATA_DIR: dataDir }),
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/healthz')).ok) return; } catch (e) { /* startet noch */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server startet nicht');
});

test.after(() => proc && proc.kill());

const push = (body, pw) => fetch(BASE + '/api/update', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + (pw || PW), 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const state = async () => (await fetch(BASE + '/api/state')).json();

test('falsches Passwort wird abgelehnt, Ping prüft das Passwort', async () => {
  assert.strictEqual((await push(sample, 'falsch')).status, 401);
  assert.strictEqual((await fetch(BASE + '/api/ping', { headers: { Authorization: 'Bearer falsch' } })).status, 401);
  const r = await fetch(BASE + '/api/ping', { headers: { Authorization: 'Bearer ' + PW } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).app, 'courtspotlive');
});

test('Daten von CourtSpot erscheinen im Stand, Verbindung wird angezeigt', async () => {
  assert.strictEqual((await push(Object.assign({}, sample, { agent: { version: 2, db: 'courtspot1' } }))).status, 200);
  const s = await state();
  assert.strictEqual(s.match.home, 'TSV Musterstadt');
  assert.deepStrictEqual(s.total, { home: 1, away: 1 });
  assert.strictEqual(s.source.connected, true);
  assert.deepStrictEqual(s.source.agent, { version: 2, db: 'courtspot1' });
});

test('ausgeschaltet: keine Begegnung sichtbar', async () => {
  await push({ aus: true, verwaltung: {}, spiele: [], courts: [] });
  const s = await state();
  assert.strictEqual(s.active, false);
  assert.strictEqual(s.match.ready, false);
  assert.strictEqual(s.source.off, true);
});

test('zuletzt beendetes Spiel bleibt auf dem Feld, bis das neue startet', async () => {
  const d = JSON.parse(JSON.stringify(sample));
  Object.assign(d.spiele.find((r) => r.Spiel === '2.HD'), { HeimSatz2: '21', GastSatz2: '18' });
  d.courts[0].Detail = 'leer';
  await push(d);
  Object.assign(d.courts[0], { Anzeige: 'DE', Detail: 'leer' });
  await push(d);
  let s = await state();
  assert.strictEqual(s.courts[0].game, '2.HD');
  d.courts[0].Detail = 'alles';
  await push(d);
  s = await state();
  assert.strictEqual(s.courts[0].game, 'DE');
});

test('Admin-API nur mit Anmeldung, Seiten mit Erscheinungsbild', async () => {
  assert.strictEqual((await fetch(BASE + '/api/admin')).status, 401);
  assert.strictEqual((await fetch(BASE + '/api/brand', { method: 'POST', body: '{}' })).status, 401);
  const login = await fetch(BASE + '/api/login', { method: 'POST', body: JSON.stringify({ password: 'courtspotadmin' }) });
  assert.strictEqual(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const r = await fetch(BASE + '/api/brand', {
    method: 'POST', headers: { cookie }, body: JSON.stringify({ title: 'BC Test', accent: '#0a7d3b' }),
  });
  assert.strictEqual(r.status, 200);
  const html = await (await fetch(BASE + '/')).text();
  assert.match(html, /BC Test/);
  assert.match(await (await fetch(BASE + '/config.css')).text(), /--club: #0a7d3b;/);
});

test('CourtSpot-Erweiterung wird mit der Adresse des Servers ausgeliefert', async () => {
  const sh = await (await fetch(BASE + '/courtspot/install.sh')).text();
  assert.match(sh, new RegExp('SRC="\\$\\{SOURCE_URL:-http://127.0.0.1:' + PORT + '/courtspot\\}"'));
  assert.strictEqual((await fetch(BASE + '/courtspot/../server.js')).status, 404);
  assert.strictEqual((await fetch(BASE + '/courtspot/push.php')).status, 200);
});
