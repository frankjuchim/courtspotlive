'use strict';

// Wandelt die Rohdaten aus der CourtSpot-Datenbank (Tabellen Verwaltung,
// Spiele, Courts) in ein für die Anzeige aufbereitetes Objekt um.

const NAMES = {
  '1.HD': '1. Herrendoppel',
  '2.HD': '2. Herrendoppel',
  DD: 'Damendoppel',
  '1.HE': '1. Herreneinzel',
  '2.HE': '2. Herreneinzel',
  '3.HE': '3. Herreneinzel',
  DE: 'Dameneinzel',
  GD: 'Gemischtes Doppel',
};

const SINGLES = new Set(['1.HE', '2.HE', '3.HE', 'DE']);

function int(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function str(v) {
  return v == null ? '' : String(v).trim();
}

function fullName(first, last) {
  return (str(first) + ' ' + str(last)).trim();
}

function rules(bundesliga) {
  return bundesliga
    ? { bestOf: 5, gamesToWin: 3, points: 11, cap: 15 }
    : { bestOf: 3, gamesToWin: 2, points: 21, cap: 30 };
}

function setWinner(h, g, r) {
  if ((h >= r.points && h - g >= 2) || h === r.cap) return 'home';
  if ((g >= r.points && g - h >= 2) || g === r.cap) return 'away';
  return null;
}

// history: { [court]: gameId } – welches Spiel zuletzt auf dem Feld gespielt
// wurde. CourtSpot speichert das nicht; der Server reicht es zwischen den
// Aufrufen weiter (wird hier aktualisiert).
function normalize(input, history) {
  history = history || {};
  const v = input.verwaltung || {};
  const bundesliga = int(v.Bundesliga, 0) === 1;
  const r = rules(bundesliga);

  // Courts: welches Spiel läuft gerade auf welchem Feld
  const courts = (input.courts || [])
    .map((c) => {
      const detail = str(c.Detail);
      const oben = str(c.oben);
      const aufgabe = int(c.Aufgabe, 0);
      let serving = null;
      if (detail === 'alles' && aufgabe >= 1 && aufgabe <= 4) {
        // siehe ballPos() in php/dbStandEintrag.php
        serving = (aufgabe <= 2) === (oben === 'heim') ? 'home' : 'away';
      }
      return {
        court: int(c.AnzeigeID, 0),
        game: str(c.Anzeige) || null,
        active: detail === 'alles' || detail === 'punkte',
        detail,
        currentSet: int(c.Satz, 1),
        serving,
      };
    })
    .filter((c) => c.court > 0)
    .sort((a, b) => a.court - b.court);

  const activeCourt = {};
  for (const c of courts) if (c.active && c.game) activeCourt[c.game] = c.court;

  const games = (input.spiele || [])
    .map((s) => {
      const id = str(s.Spiel);
      const doubles = !SINGLES.has(id);
      const home = [fullName(s.Heimspieler1VN, s.Heimspieler1NN)];
      const away = [fullName(s.Gastspieler1VN, s.Gastspieler1NN)];
      if (doubles) {
        home.push(fullName(s.Heimspieler2VN, s.Heimspieler2NN));
        away.push(fullName(s.Gastspieler2VN, s.Gastspieler2NN));
      }

      const sets = [];
      const setsWon = [0, 0];
      for (let i = 1; i <= r.bestOf; i++) {
        const h = int(s['HeimSatz' + i], -1);
        const g = int(s['GastSatz' + i], -1);
        if (h < 0 || g < 0) break;
        const w = setWinner(h, g, r);
        if (w === 'home') setsWon[0]++;
        if (w === 'away') setsWon[1]++;
        sets.push({ home: h, away: g, winner: w });
      }

      let winner = null;
      if (setsWon[0] >= r.gamesToWin) winner = 'home';
      else if (setsWon[1] >= r.gamesToWin) winner = 'away';

      const court = activeCourt[id] || null;
      let status = 'open';
      if (winner) status = 'finished';
      else if (court || sets.length) status = 'live';

      return {
        id,
        name: NAMES[id] || id,
        order: int(s.Reihenfolge, 99),
        doubles,
        home: home.map((n) => n || null),
        away: away.map((n) => n || null),
        sets,
        setsWon,
        winner,
        status,
        court,
      };
    })
    .sort((a, b) => a.order - b.order);

  const total = { home: 0, away: 0 };
  for (const g of games) {
    if (g.winner === 'home') total.home++;
    if (g.winner === 'away') total.away++;
  }

  const byId = {};
  for (const g of games) byId[g.id] = g;
  for (const c of courts) {
    let g = c.game && byId[c.game];
    const started = Boolean(g) && (c.active || g.sets.length > 0);
    if (started) {
      history[c.court] = g.id;
    } else {
      // Neues Spiel ist ausgewählt, aber noch nicht gestartet: das zuletzt
      // auf diesem Feld beendete Spiel weiter anzeigen
      const last = history[c.court] && byId[history[c.court]];
      if (last && last.winner && last !== g) {
        g = last;
        c.game = last.id;
        c.showingLast = true;
      }
    }
    // Ein Court gilt als frei, wenn dort nichts läuft und das zuletzt
    // angezeigte Spiel weder Namen noch Ergebnisse hat.
    c.idle = !c.active && (!g || (!g.sets.length && !g.home.some(Boolean) && !g.away.some(Boolean)));
  }

  const homeName = str(v.Heim);
  const awayName = str(v.Gast);

  return {
    match: {
      home: homeName,
      away: awayName,
      homeShort: str(v.HeimCourt) || homeName,
      awayShort: str(v.GastCourt) || awayName,
      date: str(v.Datum) || null,
      start: str(v.Startzeit) || null,
      venue: str(v.Ort) || null,
      matchday: int(v.Spieltag, 0) || null,
      ready: Boolean(homeName && awayName) && !input.aus,
    },
    // im CourtSpot-Menü ausgeschaltet
    active: !input.aus,
    rules: r,
    games,
    courts,
    total,
    totalGames: games.length,
    finished: games.length > 0 && games.every((g) => g.winner),
    sentAt: input.sentAt || null,
    receivedAt: input.receivedAt || null,
  };
}

module.exports = { normalize, NAMES };
