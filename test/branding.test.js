'use strict';

const test = require('node:test');
const assert = require('node:assert');
const branding = require('../lib/branding');

test('Standard: neutrales Blau, Federball-Symbol', () => {
  const b = branding.load({}, '/gibt-es-nicht');
  assert.strictEqual(b.title, 'Badminton');
  assert.strictEqual(b.logoUrl, '/shuttle.svg');
  assert.match(b.css, /--club: #1f5f99;/);
  assert.match(b.css, /--panel: rgba\(31, 95, 153, 0.94\);/);
});

test('Eigene Farbe und Titel, HTML wird maskiert', () => {
  const b = branding.load({ ACCENT: '#960000', TITLE: 'TV <Test>' }, '/gibt-es-nicht');
  assert.match(b.css, /--club: #960000;/);
  assert.match(b.css, /--club-dark: #690000;/);
  assert.strictEqual(branding.render('<b>{{TITLE}}</b>', b), '<b>TV &lt;Test&gt;</b>');
});

test('Ungültige Farbe fällt auf Standard zurück', () => {
  const b = branding.load({ ACCENT: 'rot' }, '/gibt-es-nicht');
  assert.match(b.css, /--club: #1f5f99;/);
});

test('Einstellungen aus dem Admin-Panel gehen vor, leere Felder nicht', () => {
  const s = branding.cleanSettings({ title: '  BC Test ', subtitle: '', accent: '0A7D3B', foo: 'x' });
  assert.deepStrictEqual(s, { title: 'BC Test', accent: '#0a7d3b' });
  const b = branding.load({ TITLE: 'Aus Datei', SUBTITLE: 'Unter' }, '/gibt-es-nicht', s);
  assert.strictEqual(b.title, 'BC Test');
  assert.strictEqual(b.subtitle, 'Unter');
  assert.strictEqual(b.accent, '#0a7d3b');
});

test('Ungültige Einstellungen werden abgelehnt', () => {
  assert.throws(() => branding.cleanSettings({ accent: 'rot' }));
  assert.throws(() => branding.cleanSettings({ title: 'x'.repeat(81) }));
});

test('Alle Farbvorschläge sind mit weißer Schrift gut lesbar', () => {
  for (const p of branding.PRESETS) {
    assert.ok(branding.contrastWithWhite(branding.parseHex(p.color)) >= 4.5, p.name);
  }
});

test('Logo-Upload: Typ am Inhalt erkennen, ersetzen, entfernen', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-'));
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  assert.strictEqual(branding.saveLogo(dir, png), 'png');
  let b = branding.load({}, dir);
  assert.ok(b.logoUploaded);
  assert.match(b.logoUrl, /^\/brand-logo\.png\?v=/);
  assert.strictEqual(branding.saveLogo(dir, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.deepStrictEqual(fs.readdirSync(dir), ['logo.svg'], 'altes Logo ersetzt');
  assert.throws(() => branding.saveLogo(dir, Buffer.from('<html><script>alert(1)</script>')), /Nur PNG/);
  assert.throws(() => branding.saveLogo(dir, Buffer.alloc(branding.MAX_LOGO + 1, 0x89)), /zu groß/);
  branding.removeLogo(dir);
  b = branding.load({}, dir);
  assert.strictEqual(b.logoUrl, '/shuttle.svg');
  assert.strictEqual(b.logoUploaded, false);
});

test('Link-Einstellung: nur http(s)-Adressen, leer = kein Link', () => {
  assert.deepStrictEqual(
    branding.cleanSettings({ link: ' https://dbv.turnier.de/sport/league/team?id=1 ' }),
    { link: 'https://dbv.turnier.de/sport/league/team?id=1' });
  assert.deepStrictEqual(branding.cleanSettings({ link: '' }), {});
  assert.throws(() => branding.cleanSettings({ link: 'javascript:alert(1)' }));
  assert.throws(() => branding.cleanSettings({ link: 'dbv.turnier.de' }));
});

test('Designs: laden, auswählen, eigene Werte gehen vor', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'designs-'));
  fs.mkdirSync(path.join(dir, 'tvm'));
  fs.writeFileSync(path.join(dir, 'tvm', 'logo.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  fs.writeFileSync(path.join(dir, 'tvm', 'design.json'), JSON.stringify({
    name: 'TV Metjendorf', title: 'TV Metjendorf', subtitle: 'Badminton', accent: '#960000', logo: 'logo.png',
  }));
  fs.mkdirSync(path.join(dir, 'kaputt'));
  fs.writeFileSync(path.join(dir, 'kaputt', 'design.json'), '{');
  const designs = branding.loadDesigns(dir);
  assert.deepStrictEqual(Object.keys(designs).sort(), ['standard', 'tvm']);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'data-'));
  let b = branding.load({}, data, {}, designs);
  assert.strictEqual(b.design, 'standard');
  assert.strictEqual(b.title, 'Badminton');
  b = branding.load({ DESIGN: 'tvm' }, data, {}, designs);
  assert.strictEqual(b.design, 'tvm');
  assert.strictEqual(b.title, 'TV Metjendorf');
  assert.strictEqual(b.accent, '#960000');
  assert.match(b.logoUrl, /^\/brand-logo\.png/);
  b = branding.load({ DESIGN: 'tvm' }, data, { design: 'standard' }, designs);
  assert.strictEqual(b.title, 'Badminton', 'Auswahl im Admin-Panel geht vor DESIGN');
  b = branding.load({}, data, { design: 'tvm', title: 'Eigener Titel', accent: '#0a7d3b' }, designs);
  assert.strictEqual(b.title, 'Eigener Titel');
  assert.strictEqual(b.accent, '#0a7d3b');
  assert.throws(() => branding.cleanSettings({ design: 'gibtsnicht' }, designs));
});
