'use strict';

// CourtSpot Liveticker – nimmt den Stand der CourtSpot-Datenbank aus der Halle
// entgegen (POST /api/update vom CourtSpot-Push-Dienst, siehe courtspot/) und
// verteilt ihn per Server-Sent Events an Ticker- und Overlay-Seiten.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalize } = require('./lib/normalize');
const branding = require('./lib/branding');
const authLib = require('./lib/auth');
const updaterLib = require('./lib/updater');

const PORT = parseInt(process.env.PORT || '80', 10);
const ENV_TICKER_PASSWORD = process.env.TICKER_PASSWORD || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const COURTSPOT_DIR = path.join(__dirname, 'courtspot');
const MAX_BODY = 512 * 1024;
// Der Push-Dienst meldet sich spätestens alle 30 s – danach gilt CourtSpot als getrennt
const ONLINE_MS = 75 * 1000;

// Erscheinungsbild: Konfiguration + Design + Einstellungen aus dem Admin-Panel
const DESIGNS = branding.loadDesigns(path.join(__dirname, 'designs'));
let settings = {};
try {
  settings = branding.cleanSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')), DESIGNS);
} catch (e) {
  if (e.code !== 'ENOENT') console.warn('Einstellungen verworfen:', e.message);
}
let BRAND = branding.load(process.env, DATA_DIR, settings, DESIGNS);
let brandVersion = Date.now().toString(36);
// ADMIN_PASSWORD gesetzt → festes Admin-Passwort (im Panel nicht änderbar)
const auth = authLib.create(DATA_DIR, process.env.ADMIN_PASSWORD);
const updater = updaterLib.create(__dirname, DATA_DIR);

// Ticker-Passwort für CourtSpot: im Admin-Panel geändert (ticker-password.json) oder TICKER_PASSWORD
const TICKER_PW_FILE = path.join(DATA_DIR, 'ticker-password.json');
let tickerPasswordSet = '';
try {
  const t = JSON.parse(fs.readFileSync(TICKER_PW_FILE, 'utf8'));
  if (t && typeof t.password === 'string') tickerPasswordSet = t.password;
} catch (e) { /* nicht im Admin-Panel geändert */ }
const tickerPassword = () => tickerPasswordSet || ENV_TICKER_PASSWORD;

if (!tickerPassword()) {
  console.warn('WARNUNG: Kein Ticker-Passwort gesetzt (TICKER_PASSWORD oder Admin-Panel) – CourtSpot kann nichts senden.');
}

let raw = null;          // letzte Rohdaten aus CourtSpot (+ courtHistory)
let stateJson = 'null';
const clients = new Set();

// Verbindung zu CourtSpot (für Status im Admin-Panel und „zuletzt aktualisiert“)
const source = { lastPushAt: null, lastChangeAt: null, agent: null, from: null };

function sourceInfo() {
  const last = source.lastPushAt ? Date.parse(source.lastPushAt) : 0;
  return {
    connected: Boolean(last) && Date.now() - last < ONLINE_MS,
    lastPushAt: source.lastPushAt,
    lastChangeAt: source.lastChangeAt,
    agent: source.agent,
    from: source.from,
    off: Boolean(raw && raw.aus),
  };
}

function rebuild() {
  const history = (raw && raw.courtHistory) || {};
  const v = raw ? normalize(raw, history) : normalize({ aus: false, verwaltung: {}, spiele: [], courts: [] }, {});
  if (raw) raw.courtHistory = history;
  v.source = sourceInfo();
  v.link = settings.link || '';
  stateJson = JSON.stringify(v);
}

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!saved || !Array.isArray(saved.spiele)) throw new Error('unbekanntes Format');
    raw = saved;
    if (saved.source) Object.assign(source, saved.source);
    console.log('Letzten Stand geladen:', STATE_FILE);
  } catch (e) {
    raw = null;
    if (e.code !== 'ENOENT') console.warn('Gespeicherter Stand verworfen:', e.message);
  }
  rebuild();
}

let saveTimer = null;
function saveState() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdir(DATA_DIR, { recursive: true }, (err) => {
      if (err) return console.warn('DATA_DIR nicht anlegbar:', err.message);
      const tmp = STATE_FILE + '.tmp';
      const out = raw ? Object.assign({}, raw, { source: { lastChangeAt: source.lastChangeAt, agent: source.agent } }) : null;
      fs.writeFile(tmp, JSON.stringify(out), (err2) => {
        if (err2) return console.warn('Speichern fehlgeschlagen:', err2.message);
        fs.rename(tmp, STATE_FILE, () => {});
      });
    });
  }, 1000);
}

// ---------------------------------------------------------------- SSE

function sendAll(event, json) {
  for (const res of clients) res.write(`event: ${event}\ndata: ${json}\n\n`);
}

function changed() {
  rebuild();
  sendAll('state', stateJson);
}

// Herzschlag hält Reverse-Proxies offen; Verbindungsstatus regelmäßig neu bewerten
let lastConnected = null;
setInterval(() => {
  for (const res of clients) res.write(`: ping\n\n`);
  const c = sourceInfo().connected;
  if (c !== lastConnected) {
    lastConnected = c;
    changed();
  }
}, 15000).unref();

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(`retry: 3000\nevent: state\ndata: ${stateJson}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

// ---------------------------------------------------------------- Daten von CourtSpot

function tokenOk(req) {
  const pw = tickerPassword();
  if (!pw) return false;
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(pw).digest();
  return crypto.timingSafeEqual(a, b);
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

// Ohne Zeitstempel vergleichen: nur echte Änderungen speichern und verschicken
const contentKey = (o) => JSON.stringify(Object.assign({}, o, { sentAt: null, agent: null, courtHistory: null }));

function handleUpdate(req, res) {
  if (!tokenOk(req)) {
    console.warn('Daten mit falschem Ticker-Passwort von', clientIp(req));
    return send(res, 401, '{"error":"Ticker-Passwort falsch"}');
  }
  readBody(req, (body) => {
    if (body == null) return send(res, 413, '{"error":"zu groß"}');
    let input;
    try {
      input = JSON.parse(body);
      if (!input || !Array.isArray(input.spiele)) throw new Error('spiele fehlt');
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: 'Ungültige Daten: ' + e.message }));
    }
    const now = new Date().toISOString();
    const wasConnected = sourceInfo().connected;
    source.lastPushAt = now;
    source.from = clientIp(req);
    if (input.agent && typeof input.agent === 'object') {
      source.agent = { version: Number(input.agent.version) || null, db: String(input.agent.db || '').slice(0, 60) || null };
    }
    const next = {
      aus: input.aus === true,
      verwaltung: input.verwaltung && typeof input.verwaltung === 'object' ? input.verwaltung : {},
      spiele: input.spiele,
      courts: Array.isArray(input.courts) ? input.courts : [],
      sentAt: typeof input.sentAt === 'string' ? input.sentAt : null,
      courtHistory: (raw && raw.courtHistory) || {},
    };
    const isChange = !raw || contentKey(raw) !== contentKey(next);
    raw = next;
    if (isChange) {
      source.lastChangeAt = now;
      saveState();
      changed();
    } else if (!wasConnected) {
      changed();   // Verbindung wieder da
    } else {
      rebuild();
      sendAll('alive', JSON.stringify({ source: sourceInfo() }));
    }
    send(res, 200, '{"ok":true}');
  }, MAX_BODY);
}

// Verbindungstest aus dem CourtSpot-Menü: Passwort prüfen, ohne Daten zu ändern
function handlePing(req, res) {
  if (!tokenOk(req)) return send(res, 401, '{"error":"Ticker-Passwort falsch"}');
  send(res, 200, JSON.stringify({ ok: true, app: 'courtspotlive', title: BRAND.title }));
}

// ---------------------------------------------------------------- HTTP

function send(res, status, body, type, extra) {
  res.writeHead(status, Object.assign({
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }, extra || {}));
  res.end(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

// Hübsche URLs → HTML-Dateien
const ROUTES = {
  '/': 'index.html',
  '/courts': 'courts.html',
};

function serveStatic(req, res, pathname) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  // Admin-Panel nur nach Anmeldung, sonst die Login-Seite
  if (clean === '/admin' || clean === '/admin.html') {
    return serveFile(res, auth.loggedIn(req) ? 'admin.html' : 'login.html', {
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
    });
  }
  let file = ROUTES[clean];
  if (!file && /^\/court\/[^/]+$/.test(clean)) file = 'court.html';
  if (!file) file = clean.replace(/^\/+/, '');
  serveFile(res, file);
}

function serveFile(res, file, headers) {
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(full, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    const ext = path.extname(full);
    res.writeHead(200, Object.assign({
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }, headers || {}));
    // Titel/Logo aus der Konfiguration einsetzen
    res.end(ext === '.html' ? branding.render(buf.toString('utf8'), BRAND) : buf);
  });
}

// Eigenes Logo (LOGO_FILE, Design oder im Admin-Panel hochgeladen)
function serveBrandLogo(req, res) {
  if (!BRAND.logoFile) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(BRAND.logoFile, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(BRAND.logoFile).toLowerCase()] || 'application/octet-stream', {
      'Cache-Control': 'no-cache',
      // hochgeladene SVGs dürfen keine Skripte ausführen, auch nicht bei direktem Aufruf
      'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    });
  });
}

// Logo eines Designs (Vorschau im Admin-Panel)
function serveDesignLogo(req, res, id) {
  const d = DESIGNS[id];
  if (!d || !d.logoFile) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(d.logoFile, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(d.logoFile).toLowerCase()] || 'application/octet-stream', {
      'Cache-Control': 'public, max-age=3600',
    });
  });
}

// CourtSpot-Erweiterung zum Herunterladen in der Halle (enthält keine Geheimnisse).
// install.sh bekommt die Adresse dieses Servers eingesetzt, damit es die übrigen
// Dateien von hier lädt (passend zur Version des Tickers).
const COURTSPOT_FILES = new Set([
  'install.sh', 'push.php', 'courtspot-liveticker.service', 'liveTickerSchalter.php', 'liveTickerSchalter.js',
]);
function serveCourtspotFile(req, res, name) {
  if (!COURTSPOT_FILES.has(name)) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(path.join(COURTSPOT_DIR, name), 'utf8', (err, text) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    if (name === 'install.sh') {
      const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
      text = text.split('__SOURCE_URL__').join(`${proto}://${req.headers.host}/courtspot`);
    }
    send(res, 200, text, 'text/plain; charset=utf-8');
  });
}

// Liest den Request-Body; bei mehr als max Bytes wird null übergeben
function readBody(req, cb, max) {
  max = max || 64 * 1024;
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size <= max) chunks.push(c);
  });
  req.on('end', () => cb(size > max ? null : Buffer.concat(chunks).toString('utf8')));
}

function brandInfo() {
  // Werte ohne eigene Anpassungen (für das gewählte Design) – Platzhalter im Admin-Panel
  const defaults = branding.load(process.env, DATA_DIR, { design: settings.design }, DESIGNS);
  return {
    design: BRAND.design,
    designs: Object.values(DESIGNS).map((d) => {
      const b = branding.load(process.env, DATA_DIR, { design: d.id }, DESIGNS);
      return {
        id: d.id, name: d.name, title: b.title, subtitle: b.subtitle, accent: b.accent,
        logoUrl: d.logoFile ? '/design-logo/' + d.id : null,
      };
    }),
    title: BRAND.title,
    subtitle: BRAND.subtitle,
    accent: BRAND.accent,
    logoUrl: BRAND.logoUrl,
    logoUploaded: BRAND.logoUploaded,
    version: brandVersion,
    custom: settings,
    defaults: { title: defaults.title, subtitle: defaults.subtitle, accent: defaults.accent },
    presets: branding.PRESETS,
  };
}

// Erscheinungsbild neu laden und offenen Seiten mitteilen
function brandChanged() {
  BRAND = branding.load(process.env, DATA_DIR, settings, DESIGNS);
  brandVersion = Date.now().toString(36);
  const info = JSON.stringify(brandInfo());
  sendAll('brand', info);
  changed();   // Link steckt im Stand
  return info;
}

// Admin-Aktionen nur mit Anmeldung; sonst 401 (die Seite zeigt dann den Login)
function requireAdmin(req, res) {
  if (auth.loggedIn(req)) return true;
  send(res, 401, '{"error":"Nicht angemeldet – bitte neu anmelden","login":true}');
  return false;
}

function jsonBody(req, cb, max) {
  readBody(req, (body) => {
    let input = {};
    try { input = JSON.parse(body) || {}; } catch (e) { /* leer */ }
    cb(input, body);
  }, max);
}

function handleLogin(req, res) {
  jsonBody(req, (input) => {
    const r = auth.login(input.password, clientIp(req));
    if (!r.token) {
      if (r.status === 401) console.warn('Admin-Login fehlgeschlagen von', clientIp(req));
      return send(res, r.status, JSON.stringify({ error: r.error }));
    }
    send(res, 200, JSON.stringify({ ok: true, defaultPassword: auth.isDefault() }), null, {
      'Set-Cookie': auth.cookie(req, r.token),
    });
  });
}

function handleLogout(req, res) {
  auth.logout(req);
  send(res, 200, '{"ok":true}', null, { 'Set-Cookie': auth.cookie(req, null) });
}

// Admin-Passwort ändern ({ current, next })
function handleAdminPassword(req, res) {
  if (!requireAdmin(req, res)) return;
  jsonBody(req, (input) => {
    let r;
    try {
      r = auth.change(input.current, input.next, req);
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: 'Speichern fehlgeschlagen: ' + e.message }));
    }
    if (!r.ok) return send(res, r.status, JSON.stringify({ error: r.error }));
    console.log('Admin-Passwort geändert');
    send(res, 200, '{"ok":true}');
  });
}

// Logo hochladen ({ data: Base64 }) oder entfernen ({ remove: true })
function handleLogo(req, res) {
  if (!requireAdmin(req, res)) return;
  jsonBody(req, (input, body) => {
    if (body == null) return send(res, 413, '{"error":"Logo ist zu groß (max. 10 MB)"}');
    try {
      if (input.remove) {
        branding.removeLogo(DATA_DIR);
        console.log('Logo entfernt');
      } else {
        const b64 = String(input.data || '').replace(/^data:[^,]*,/, '');
        const ext = branding.saveLogo(DATA_DIR, Buffer.from(b64, 'base64'));
        console.log('Logo hochgeladen:', ext);
      }
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: e.message }));
    }
    send(res, 200, brandChanged());
  }, Math.ceil(branding.MAX_LOGO * 1.4) + 4096);
}

// Design/Titel/Untertitel/Farbe/Link aus dem Admin-Panel speichern ({ reset: true } = Standard)
function handleBrand(req, res) {
  if (!requireAdmin(req, res)) return;
  jsonBody(req, (input) => {
    let next;
    try {
      next = input.reset ? {} : branding.cleanSettings(input, DESIGNS);
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: e.message }));
    }
    fs.mkdir(DATA_DIR, { recursive: true }, () => {
      fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), (err) => {
        if (err) return send(res, 500, JSON.stringify({ error: 'Speichern fehlgeschlagen: ' + err.message }));
        settings = next;
        console.log('Erscheinungsbild geändert:', JSON.stringify(settings));
        send(res, 200, brandChanged());
      });
    });
  });
}

// Angezeigten Stand leeren (z. B. nach Testspielen); CourtSpot schickt den aktuellen
// Stand mit der nächsten Änderung bzw. spätestens nach 30 s wieder
function handleReset(req, res) {
  if (!requireAdmin(req, res)) return;
  readBody(req, () => {
    raw = null;
    fs.rm(STATE_FILE, { force: true }, () => {});
    changed();
    console.log('Angezeigter Stand zurückgesetzt');
    send(res, 200, '{"ok":true}');
  });
}

// Update aus dem Admin-Panel: Stand abfragen (GET, ?check=1 fragt GitHub) bzw. starten (POST)
function handleUpdateInfo(req, res, check) {
  if (!requireAdmin(req, res)) return;
  const info = { mode: updater.mode(), installed: updater.installed(), running: updater.running(), log: updater.log() };
  const done = (latest, error) => send(res, 200, JSON.stringify(Object.assign(info, { latest, error })));
  if (!check || info.mode === 'docker' || info.mode === 'none') return done(null, null);
  updater.latest(check === 'force').then((l) => done(l, null), (e) => done(null, String(e.message || e)));
}

function handleUpdateStart(req, res) {
  if (!requireAdmin(req, res)) return;
  readBody(req, () => {
    try {
      updater.start();
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: e.message }));
    }
    console.log('Update aus dem Admin-Panel angefordert');
    send(res, 200, '{"ok":true}');
  });
}

// Ticker-Passwort für CourtSpot ändern ({ password }); leer = zurück zu TICKER_PASSWORD
function handleTickerPassword(req, res) {
  if (!requireAdmin(req, res)) return;
  jsonBody(req, (input) => {
    const pw = typeof input.password === 'string' ? input.password.trim() : '';
    if (pw && !/^[A-Za-z0-9._~-]{6,100}$/.test(pw)) {
      return send(res, 400, JSON.stringify({
        error: 'Bitte 6 bis 100 Zeichen, nur Buchstaben (ohne Umlaute), Ziffern und - _ . ~',
      }));
    }
    if (!pw && !ENV_TICKER_PASSWORD) {
      return send(res, 400, JSON.stringify({ error: 'Ohne TICKER_PASSWORD in der Konfiguration muss hier ein Passwort gesetzt sein.' }));
    }
    try {
      if (pw) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = TICKER_PW_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ password: pw, changedAt: new Date().toISOString() }), { mode: 0o600 });
        fs.renameSync(tmp, TICKER_PW_FILE);
      } else {
        fs.rmSync(TICKER_PW_FILE, { force: true });
      }
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: 'Speichern fehlgeschlagen: ' + e.message }));
    }
    tickerPasswordSet = pw;
    console.log(pw ? 'Ticker-Passwort im Admin-Panel geändert' : 'Ticker-Passwort auf TICKER_PASSWORD zurückgesetzt');
    send(res, 200, JSON.stringify({ ok: true, tickerPassword: tickerPassword(), tickerPasswordSource: pw ? 'admin' : 'env' }));
  });
}

const server = http.createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://x');
  if (req.method === 'POST') {
    switch (pathname) {
      case '/api/update': return handleUpdate(req, res);          // Daten von CourtSpot
      case '/api/reset': return handleReset(req, res);
      case '/api/app-update': return handleUpdateStart(req, res);
      case '/api/brand': return handleBrand(req, res);
      case '/api/logo': return handleLogo(req, res);
      case '/api/login': return handleLogin(req, res);
      case '/api/logout': return handleLogout(req, res);
      case '/api/admin-password': return handleAdminPassword(req, res);
      case '/api/ticker-password': return handleTickerPassword(req, res);
      default: return send(res, 404, '{"error":"not found"}');
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '{"error":"method"}');
  if (pathname === '/api/state') return send(res, 200, stateJson);
  if (pathname === '/api/events') return handleEvents(req, res);
  if (pathname === '/api/ping') return handlePing(req, res);
  if (pathname === '/api/brand') return send(res, 200, JSON.stringify(brandInfo()));
  if (pathname === '/api/admin') {
    if (!requireAdmin(req, res)) return;
    return send(res, 200, JSON.stringify({
      defaultPassword: auth.isDefault(), passwordFromEnv: auth.fromEnv(), tickerPassword: tickerPassword(),
      tickerPasswordSource: tickerPasswordSet ? 'admin' : (ENV_TICKER_PASSWORD ? 'env' : 'none'),
    }));
  }
  if (pathname === '/api/app-update') return handleUpdateInfo(req, res, searchParams.get('check'));
  if (pathname === '/config.css') return send(res, 200, BRAND.css, 'text/css; charset=utf-8', { 'Cache-Control': 'no-cache' });
  if (pathname.startsWith('/brand-logo')) return serveBrandLogo(req, res);
  if (pathname.startsWith('/design-logo/')) return serveDesignLogo(req, res, pathname.slice(13));
  if (pathname.startsWith('/courtspot/')) return serveCourtspotFile(req, res, pathname.slice(11));
  if (pathname === '/healthz') return send(res, 200, '{"ok":true}');
  serveStatic(req, res, pathname);
});

loadState();
server.listen(PORT, () => console.log(`CourtSpot Liveticker läuft auf Port ${PORT}`));
