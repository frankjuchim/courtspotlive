'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalize } = require('../lib/normalize');
const sample = require('./sample.json');

test('berechnet Sätze, Sieger und Gesamtstand (3x21)', () => {
  const s = normalize(sample);
  assert.strictEqual(s.rules.bestOf, 3);
  const hd1 = s.games.find((g) => g.id === '1.HD');
  assert.strictEqual(hd1.winner, 'home');
  assert.deepStrictEqual(hd1.setsWon, [2, 0]);
  const dd = s.games.find((g) => g.id === 'DD');
  assert.strictEqual(dd.winner, 'away');
  assert.deepStrictEqual(s.total, { home: 1, away: 1 });
});

test('erkennt laufende Spiele auf den Courts und den Aufschlag', () => {
  const s = normalize(sample);
  const hd2 = s.games.find((g) => g.id === '2.HD');
  assert.strictEqual(hd2.status, 'live');
  assert.strictEqual(hd2.court, 1);
  const c1 = s.courts.find((c) => c.court === 1);
  assert.strictEqual(c1.active, true);
  assert.strictEqual(c1.serving, 'home');
  const c2 = s.courts.find((c) => c.court === 2);
  assert.strictEqual(c2.serving, 'away');
});

test('Einzel haben nur einen Spieler pro Seite', () => {
  const s = normalize(sample);
  const he = s.games.find((g) => g.id === '1.HE');
  assert.strictEqual(he.home.length, 1);
  assert.strictEqual(he.status, 'live');
});

test('Satz bis 30 bzw. Verlängerung', () => {
  const input = JSON.parse(JSON.stringify(sample));
  const row = input.spiele.find((r) => r.Spiel === '3.HE');
  Object.assign(row, { HeimSatz1: '30', GastSatz1: '29', HeimSatz2: '22', GastSatz2: '24', HeimSatz3: '21', GastSatz3: '20' });
  const g = normalize(input).games.find((x) => x.id === '3.HE');
  assert.deepStrictEqual(g.sets.map((x) => x.winner), ['home', 'away', null]);
  assert.strictEqual(g.winner, null);
});

test('ausgeschalteter Ticker zeigt nichts an', () => {
  const s = normalize({ aus: true, verwaltung: {}, spiele: [], courts: [] });
  assert.strictEqual(s.active, false);
  assert.strictEqual(s.match.ready, false);
  assert.strictEqual(s.games.length, 0);
});

test('zeigt das zuletzt beendete Spiel, bis das neue Spiel startet', () => {
  const history = {};
  const input = JSON.parse(JSON.stringify(sample));
  // 2.HD auf Court 1 beendet
  Object.assign(input.spiele.find((r) => r.Spiel === '2.HD'), { HeimSatz2: '21', GastSatz2: '18' });
  input.courts[0].Detail = 'leer';
  let s = normalize(input, history);
  assert.strictEqual(s.courts[0].game, '2.HD');
  // Nächstes Spiel (DE) ausgewählt, aber noch nicht gestartet
  Object.assign(input.courts[0], { Anzeige: 'DE', Detail: 'leer' });
  s = normalize(input, history);
  assert.strictEqual(s.courts[0].game, '2.HD');
  assert.strictEqual(s.courts[0].showingLast, true);
  assert.strictEqual(s.courts[0].idle, false);
  // DE startet
  input.courts[0].Detail = 'punkte';
  s = normalize(input, history);
  assert.strictEqual(s.courts[0].game, 'DE');
  assert.ok(!s.courts[0].showingLast);
  // Nach Zurücksetzen der Datenbank kein altes Spiel mehr
  const reset = JSON.parse(JSON.stringify(input));
  reset.spiele.forEach((r) => { for (let i = 1; i <= 5; i++) { r['HeimSatz' + i] = '-1'; r['GastSatz' + i] = '-1'; } });
  reset.courts[0].Detail = 'leer';
  s = normalize(reset, history);
  assert.ok(!s.courts[0].showingLast);
});

test('leere Datenbank (nach Zurücksetzen) zeigt freie Courts', () => {
  const s = normalize({ verwaltung: { Heim: ' ', Gast: ' ', Bundesliga: '1' }, spiele: [{ Spiel: '1.HD', Reihenfolge: '1', HeimSatz1: '-1', GastSatz1: '-1' }], courts: [{ AnzeigeID: '1', Anzeige: '1.HD', Detail: 'leer' }] });
  assert.strictEqual(s.match.ready, false);
  assert.strictEqual(s.courts[0].idle, true);
  assert.strictEqual(s.rules.bestOf, 5);
});
