// Scoreboard-Baustein für die Stream-Overlays (/court/1, /court/2, /courts)
(function () {
  'use strict';
  var el = CS.el;
  // Breiten (in em der Zeile) – passend zu .set und .points in overlay.css
  var SET_W = 1.87;
  var POINTS_W = 2.65;

  // Baut die Anzeige für einen Court. opts: { short, sets, title }
  function courtBoard(state, courtNr, opts) {
    var court = (state && state.courts || []).filter(function (c) { return c.court === courtNr; })[0];
    var game = court && court.game && state.games.filter(function (g) { return g.id === court.game; })[0];

    var box = el('div', 'board');
    box.dataset.court = courtNr;

    if (!state || !state.match || !state.match.ready || !court || court.idle || !game) {
      box.classList.add('idle');
      var idle = el('div', 'board-idle');
      idle.appendChild(el('span', 'tag', 'Court ' + courtNr));
      idle.appendChild(el('span', null, 'Kein laufendes Spiel'));
      box.appendChild(idle);
      return box;
    }

    if (!court.active) box.classList.add('paused');

    var head = el('div', 'board-head');
    head.appendChild(el('span', 'tag', 'Court ' + courtNr));
    head.appendChild(el('span', 'disc', game.name));
    if (game.winner) head.appendChild(el('span', 'state done', 'Beendet'));
    else if (court.active) head.appendChild(el('span', 'state live', 'Live'));
    box.appendChild(head);

    // Satz-Spalten: abgeschlossene Sätze + aktueller Satz (groß)
    var sets = game.sets.slice();
    var current = null;
    if (!game.winner && sets.length && !sets[sets.length - 1].winner) current = sets.pop();
    if (!game.winner && court.active && !current) current = { home: 0, away: 0 };

    ['home', 'away'].forEach(function (side) {
      var row = el('div', 'row ' + side);
      if (game.winner === side) row.classList.add('winner');

      row.appendChild(el('span', 'serve' + (court.serving === side && !game.winner ? ' on' : '')));

      var team = el('div', 'team');
      team.appendChild(el('span', 'club', side === 'home' ? state.match.homeShort : state.match.awayShort));
      var names = CS.players(game[side], opts.short);
      team.appendChild(el('span', 'names', names.length ? names.join(' / ') : '–'));
      row.appendChild(team);

      // Fester Bereich für alle möglichen Sätze (3 bzw. 5): laufender Satz ganz
      // außen, fertige Sätze rücken davor nach innen – die Box bleibt gleich breit.
      var slots = opts.sets === false ? 1 : (state.rules && state.rules.bestOf) || 3;
      var scores = el('div', 'scores');
      scores.style.width = ((slots - 1) * SET_W + POINTS_W) + 'em';
      if (opts.sets !== false) {
        sets.forEach(function (s) {
          var c = el('span', 'set', String(s[side]));
          if (s.winner === side) c.classList.add('won');
          scores.appendChild(c);
        });
      }
      if (current) scores.appendChild(el('span', 'points', String(current[side])));
      row.appendChild(scores);
      box.appendChild(row);
    });

    return box;
  }

  function totalBar(state) {
    var bar = el('div', 'totalbar');
    if (!state || !state.match || !state.match.ready) return bar;
    var logo = el('img', 'logo');
    var meta = document.querySelector('meta[name="brand-logo"]');
    logo.src = (meta && meta.content) || '/shuttle.svg';
    logo.setAttribute('data-brand-logo', '');
    logo.alt = '';
    bar.appendChild(logo);
    bar.appendChild(el('span', 'club home', state.match.homeShort));
    var score = el('span', 'score');
    score.appendChild(el('b', null, String(state.total.home)));
    score.appendChild(document.createTextNode(':'));
    score.appendChild(el('b', null, String(state.total.away)));
    bar.appendChild(score);
    bar.appendChild(el('span', 'club away', state.match.awayShort));
    return bar;
  }

  window.Overlay = { courtBoard: courtBoard, totalBar: totalBar };
})();
