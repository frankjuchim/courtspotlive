'use strict';

// Erscheinungsbild aus der Konfiguration (Umgebungsvariablen):
//   TITLE      Überschrift im Kopf, z. B. Vereinsname     (Standard „Badminton“)
//   SUBTITLE   Zeile darunter                             (Standard „Liveticker“)
//   ACCENT     Akzentfarbe als Hex, z. B. #960000         (Standard neutrales Blau)
//   LOGO_FILE  Pfad zu einem eigenen Logo (PNG/SVG/JPG/WebP)
// Titel, Untertitel und Farbe lassen sich zusätzlich im Admin-Panel ändern
// (gespeichert in <DATA_DIR>/settings.json) – diese Werte haben Vorrang.
// Ein im Admin-Panel hochgeladenes Logo liegt als <DATA_DIR>/logo.<ext> und hat
// Vorrang vor LOGO_FILE; ohne beides erscheint ein Federball-Symbol.
//
// Designs: fertige Pakete aus Titel, Untertitel, Farbe und Logo im Ordner
// designs/<id>/design.json (+ Logo-Datei). Auswahl im Admin-Panel, Voreinstellung
// über DESIGN=<id>. Reihenfolge: Admin-Panel > Design > Konfiguration > Standard.

const fs = require('fs');
const path = require('path');

const DEFAULT_ACCENT = '#1f5f99';

// Farbvorschläge im Admin-Panel (alle mit gut lesbarer weißer Schrift)
const PRESETS = [
  { name: 'Blau', color: '#1f5f99' },
  { name: 'Dunkelblau', color: '#1b2f5b' },
  { name: 'Petrol', color: '#00707a' },
  { name: 'Grün', color: '#0a7d3b' },
  { name: 'Rot', color: '#b00020' },
  { name: 'Weinrot', color: '#960000' },
  { name: 'Orange', color: '#b84d00' },
  { name: 'Violett', color: '#5b2a86' },
  { name: 'Anthrazit', color: '#3a3f47' },
  { name: 'Schwarz', color: '#16191d' },
];

function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

// a nach b mischen (t = Anteil von b)
function mix(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

const LOGO_EXTS = ['png', 'svg', 'jpg', 'jpeg', 'webp'];
const MAX_LOGO = 10 * 1024 * 1024;

function uploadedLogo(dataDir) {
  for (const ext of LOGO_EXTS) {
    const f = path.join(dataDir, 'logo.' + ext);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function findLogo(dataDir, logoFile) {
  return uploadedLogo(dataDir) || (logoFile && fs.existsSync(logoFile) ? logoFile : null);
}

// Bildtyp am Inhalt erkennen (nicht an Dateiname oder Angabe des Browsers)
function detectImage(buf) {
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  const head = buf.slice(0, 4096).toString('utf8').replace(/^\uFEFF/, '');
  if (!/[\x00-\x08]/.test(head) && /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

// Hochgeladenes Logo speichern (ersetzt ein vorheriges); wirft bei ungültigen Daten
function saveLogo(dataDir, buf) {
  if (!buf.length) throw new Error('Leere Datei');
  if (buf.length > MAX_LOGO) throw new Error('Logo ist zu groß (max. 10 MB)');
  const ext = detectImage(buf);
  if (!ext) throw new Error('Nur PNG, JPG, WebP oder SVG');
  fs.mkdirSync(dataDir, { recursive: true });
  removeLogo(dataDir);
  fs.writeFileSync(path.join(dataDir, 'logo.' + ext), buf);
  return ext;
}

function removeLogo(dataDir) {
  for (const ext of LOGO_EXTS) fs.rmSync(path.join(dataDir, 'logo.' + ext), { force: true });
}

// Designs aus designs/<id>/design.json laden. „standard“ gibt es immer (neutral).
//   { "name": "TV Metjendorf", "title": "…", "subtitle": "…", "accent": "#960000", "logo": "logo.png" }
function loadDesigns(dir) {
  const designs = { standard: { id: 'standard', name: 'Standard (neutral)' } };
  let ids = [];
  try { ids = fs.readdirSync(dir); } catch (e) { return designs; }
  for (const id of ids.sort()) {
    if (!/^[a-z0-9-]+$/.test(id)) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, id, 'design.json'), 'utf8'));
      const design = { id, name: String(d.name || id) };
      for (const k of ['title', 'subtitle']) if (d[k]) design[k] = String(d[k]);
      if (d.accent && parseHex(d.accent)) design.accent = hex(parseHex(d.accent));
      if (d.logo) {
        const f = path.join(dir, id, path.basename(String(d.logo)));
        if (fs.existsSync(f)) design.logoFile = f;
      }
      designs[id] = design;
    } catch (e) {
      console.warn(`Design „${id}“ übersprungen:`, e.message);
    }
  }
  return designs;
}

// Kontrast zu weißer Schrift (WCAG); unter 3 wird Text auf der Farbe schwer lesbar
function contrastWithWhite(c) {
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  return 1.05 / (L + 0.05);
}

// Einstellungen aus dem Admin-Panel prüfen; wirft bei ungültigen Werten
function cleanSettings(input, designs) {
  const out = {};
  if (input.design != null && String(input.design).trim()) {
    const id = String(input.design).trim();
    if (!designs || !designs[id]) throw new Error('Unbekanntes Design: ' + id);
    out.design = id;
  }
  for (const key of ['title', 'subtitle']) {
    if (input[key] == null) continue;
    const v = String(input[key]).trim();
    if (v.length > 80) throw new Error(`${key} ist zu lang (max. 80 Zeichen)`);
    if (v) out[key] = v;
  }
  // Optionaler Link im Ticker, z. B. zur Liga auf turnier.de
  if (input.link != null && String(input.link).trim()) {
    const v = String(input.link).trim();
    let ok = false;
    try { ok = /^https?:$/.test(new URL(v).protocol); } catch (e) { /* ungültig */ }
    if (!ok || v.length > 500) throw new Error('Link muss eine Adresse sein, die mit https:// beginnt');
    out.link = v;
  }
  if (input.accent != null && String(input.accent).trim()) {
    const c = parseHex(input.accent);
    if (!c) throw new Error('Farbe muss eine Hex-Farbe sein, z. B. #1f5f99');
    out.accent = hex(c);
  }
  return out;
}

function load(env, dataDir, overrides, designs) {
  overrides = overrides || {};
  designs = designs || {};
  const design = designs[overrides.design] || designs[env.DESIGN] || designs.standard || {};
  const accentRaw = overrides.accent || design.accent || env.ACCENT || DEFAULT_ACCENT;
  let accent = parseHex(accentRaw);
  if (!accent) {
    console.warn(`ACCENT „${accentRaw}“ ist keine Hex-Farbe – nehme ${DEFAULT_ACCENT}`);
    accent = parseHex(DEFAULT_ACCENT);
  }
  const dark = mix(accent, [0, 0, 0], 0.3);
  const white = [255, 255, 255];
  const night = [15, 20, 27];

  const css = `/* aus der Konfiguration erzeugt (ACCENT) */
:root {
  --club: ${hex(accent)};
  --club-dark: ${hex(dark)};
  --live: ${hex(accent)};
  --win-bg: ${hex(mix(accent, white, 0.88))};
  --link: ${hex(accent)};
  --panel: ${rgba(accent, 0.94)};
  --panel-2: ${rgba(dark, 0.97)};
}
@media (prefers-color-scheme: dark) {
  :root {
    --live: ${hex(mix(accent, white, 0.15))};
    --win-bg: ${hex(mix(night, accent, 0.3))};
    --link: ${hex(mix(accent, white, 0.5))};
  }
}
`;

  const logo = uploadedLogo(dataDir) || design.logoFile || findLogo(dataDir, env.LOGO_FILE);
  return {
    design: design.id || 'standard',
    title: overrides.title || design.title || env.TITLE || 'Badminton',
    subtitle: overrides.subtitle || design.subtitle || env.SUBTITLE || 'Liveticker',
    accent: hex(accent),
    css,
    logoFile: logo,
    logoUploaded: Boolean(uploadedLogo(dataDir)),
    // ?v= sorgt dafür, dass Browser ein neues Logo sofort laden
    logoUrl: logo ? '/brand-logo' + path.extname(logo) + '?v=' + Math.round(fs.statSync(logo).mtimeMs).toString(36) : '/shuttle.svg',
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Platzhalter in den HTML-Seiten ersetzen
function render(html, b) {
  return html
    .split('{{TITLE}}').join(escapeHtml(b.title))
    .split('{{SUBTITLE}}').join(escapeHtml(b.subtitle))
    .split('{{LOGO}}').join(escapeHtml(b.logoUrl));
}

module.exports = {
  load, loadDesigns, render, cleanSettings, contrastWithWhite, parseHex, mix, detectImage, saveLogo, removeLogo,
  PRESETS, DEFAULT_ACCENT, MAX_LOGO,
};
