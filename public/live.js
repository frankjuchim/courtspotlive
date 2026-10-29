// Gemeinsame Client-Logik: Verbindung zum Server (SSE mit Polling-Fallback)
// und kleine Hilfsfunktionen für alle Seiten.
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);

  function connect(onState, onAlive) {
    var pollTimer = null;

    function poll() {
      fetch('/api/state', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(onState)
        .catch(function () {})
        .finally(function () { pollTimer = setTimeout(poll, 3000); });
    }

    if (!window.EventSource) return poll();

    var es = new EventSource('/api/events');
    es.addEventListener('state', function (e) {
      onState(JSON.parse(e.data));
    });
    es.addEventListener('alive', function (e) {
      if (onAlive) onAlive(JSON.parse(e.data));
    });
    es.addEventListener('brand', function (e) { applyBrand(JSON.parse(e.data)); });
  }

  // Erscheinungsbild wurde im Admin-Panel geändert: Farben, Titel und Logo ohne Neuladen tauschen
  var brandListeners = [];
  function applyBrand(b) {
    var link = document.querySelector('link[href^="/config.css"]');
    if (link) link.href = '/config.css?v=' + encodeURIComponent(b.version);
    if (b.logoUrl) {
      document.querySelectorAll('img[data-brand-logo], link[rel="icon"]').forEach(function (n) {
        if (n.tagName === 'LINK') n.href = b.logoUrl;
        else n.src = b.logoUrl;
      });
      var meta = document.querySelector('meta[name="brand-logo"]');
      if (meta) meta.content = b.logoUrl;
    }
    document.querySelectorAll('[data-brand]').forEach(function (n) {
      var v = b[n.getAttribute('data-brand')];
      if (v != null) n.textContent = v;
    });
    brandListeners.forEach(function (fn) { fn(b); });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // „Max Mustermann“ → „M. Mustermann“
  function shortName(n) {
    if (!n) return n;
    var parts = n.split(/\s+/);
    if (parts.length < 2) return n;
    var last = parts.pop();
    return parts.map(function (p) { return p.charAt(0) + '.'; }).join(' ') + ' ' + last;
  }

  function players(list, short) {
    return list
      .map(function (n) { return n ? (short ? shortName(n) : n) : null; })
      .filter(Boolean);
  }

  // Farbparameter erlauben „A0522D“ oder „#A0522D“ oder Farbnamen
  function color(name, def) {
    var v = params.get(name);
    if (!v) return def;
    return /^[0-9a-f]{3,8}$/i.test(v) ? '#' + v : v;
  }

  function applyCommonParams() {
    var root = document.documentElement.style;
    // Teamfarben auf der Ticker-Seite: Standard Akzentfarbe (Heim) und Grau (Gast)
    if (params.get('home')) root.setProperty('--home', color('home'));
    if (params.get('away')) root.setProperty('--away', color('away'));
    var scale = parseFloat(params.get('scale'));
    if (scale > 0) root.setProperty('--scale', String(scale));
    var bg = params.get('bg');
    if (bg) document.body.style.setProperty('background', /^[0-9a-f]{3,8}$/i.test(bg) ? '#' + bg : bg, 'important');
  }

  window.CS = {
    params: params,
    connect: connect,
    el: el,
    shortName: shortName,
    players: players,
    applyCommonParams: applyCommonParams,
    onBrand: function (fn) { brandListeners.push(fn); },
  };
})();
