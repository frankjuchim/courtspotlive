'use strict';

// Simuliert CourtSpot: spielt einen Mannschaftswettkampf (8 Spiele, 3x21) auf zwei
// Courts durch und schickt den Stand wie der Push-Dienst an den Liveticker.
//
//   node tools/fake-courtspot.js http://localhost:8080 <ticker-passwort> [ms-pro-punkt]

const [url = 'http://localhost:8080', token = 'test', msArg = '400'] = process.argv.slice(2);
const MS = Math.max(50, parseInt(msArg, 10) || 400);

const GAMES = [
  ['1.HD', ['Jonas Becker', 'Lukas Wagner'], ['Felix Hoffmann', 'Tim Schulz']],
  ['DD', ['Anna Müller', 'Lea Schmidt'], ['Marie Weber', 'Sophie Fischer']],
  ['2.HD', ['Paul Meyer', 'Max Koch'], ['Jan Richter', 'Ben Klein']],
  ['1.HE', ['Lukas Wagner'], ['Felix Hoffmann']],
  ['DE', ['Lea Schmidt'], ['Marie Weber']],
  ['GD', ['Jonas Becker', 'Anna Müller'], ['Tim Schulz', 'Sophie Fischer']],
  ['2.HE', ['Max Koch'], ['Ben Klein']],
  ['3.HE', ['Paul Meyer'], ['Jan Richter']],
];

const spiele = GAMES.map(([id, home, away], i) => {
  const r = { Spiel: id, Reihenfolge: String(i + 1) };
  const put = (k, n) => { const p = (n || '').split(' '); r[k + 'NN'] = p.pop() || ''; r[k + 'VN'] = p.join(' '); };
  put('Heimspieler1', home[0]); put('Heimspieler2', home[1]);
  put('Gastspieler1', away[0]); put('Gastspieler2', away[1]);
  for (let s = 1; s <= 5; s++) { r['HeimSatz' + s] = '-1'; r['GastSatz' + s] = '-1'; }
  return r;
});

const courts = [1, 2].map((n) => ({
  AnzeigeID: String(n), Anzeige: '', Detail: 'leer', Satz: '1', oben: 'heim', linksheim: 'Spieler1', linksgast: 'Spieler2', Aufgabe: '1',
}));
const queue = spiele.slice();
const running = [null, null];

function setWon(h, a) { return (h >= 21 && h - a >= 2) || h === 30 || (a >= 21 && a - h >= 2) || a === 30; }

function step() {
  courts.forEach((c, i) => {
    let g = running[i];
    if (!g) {
      g = running[i] = queue.shift() || null;
      if (!g) { c.Detail = 'leer'; return; }
      c.Anzeige = g.Spiel;
      c.Detail = 'alles';
      g.HeimSatz1 = '0';
      g.GastSatz1 = '0';
    }
    let s = 1;
    while (s < 3 && g['HeimSatz' + (s + 1)] !== '-1') s++;
    let h = +g['HeimSatz' + s];
    let a = +g['GastSatz' + s];
    const homeScores = Math.random() < 0.52;
    if (homeScores) h++; else a++;
    g['HeimSatz' + s] = String(h);
    g['GastSatz' + s] = String(a);
    c.Satz = String(s);
    c.Aufgabe = homeScores ? (h % 2 ? '2' : '1') : (a % 2 ? '3' : '4');
    if (!setWon(h, a)) return;
    let wonH = 0;
    let wonA = 0;
    for (let k = 1; k <= s; k++) {
      const x = +g['HeimSatz' + k];
      const y = +g['GastSatz' + k];
      if (x > y) wonH++; else wonA++;
    }
    if (wonH === 2 || wonA === 2) {
      c.Detail = 'leer';
      running[i] = null;   // nächstes Spiel beim nächsten Schritt
    } else {
      g['HeimSatz' + (s + 1)] = '0';
      g['GastSatz' + (s + 1)] = '0';
    }
  });
}

async function send() {
  const body = {
    verwaltung: { Heim: 'TSV Musterstadt', HeimCourt: 'Musterstadt', Gast: 'BC Beispielhausen', GastCourt: 'Beispielhausen', Bundesliga: '0', Spieltag: '1' },
    spiele, courts, sentAt: new Date().toISOString(), agent: { version: 2, db: 'simulation' },
  };
  const r = await fetch(url.replace(/\/+$/, '') + '/api/update', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('Liveticker antwortet ' + r.status + ' ' + (await r.text()));
}

(async function loop() {
  try {
    step();
    await send();
  } catch (e) {
    console.error(e.message);
  }
  if (!queue.length && !running[0] && !running[1]) return console.log('Spieltag beendet.');
  setTimeout(loop, MS);
})();
console.log(`Simuliere CourtSpot → ${url} (alle ${MS} ms ein Punkt pro Court) – Abbruch mit Strg+C`);
