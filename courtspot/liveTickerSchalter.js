// Liveticker im CourtSpot-Hauptmenü (gehört zu php/liveTickerSchalter.php):
// Status, Ein-/Ausschalter und Einstellungen (Adresse und Passwort des Liveticker)
(function ()
{
	var box = document.getElementById('csLiveticker');
	if (!box)
		return;

	var feld = 'display: block; font-size: medium; padding: 4px 6px; width: 100%; box-sizing: border-box; margin: 2px 0 8px;';
	var knopfStil = 'font-size: medium; padding: 4px 10px; margin: 2px 4px 2px 0; border-radius: 4px; border: 1px solid #555; cursor: pointer;';
	box.style.display = 'inline-block';
	box.innerHTML = '<b>3. Liveticker</b><br/>'
		+ '<input type="button" id="ltSchalter" value="..." style="font-size: large; min-width: 150px; margin: 4px 0; border-radius: 4px; border: 1px solid #555; cursor: pointer;"><br/>'
		+ '<span id="ltStatus" style="font-size: small;"></span><br/>'
		+ '<a id="ltLink" href="#" target="_blank" style="font-size: small; display: none;">Ticker öffnen</a> '
		+ '<a id="ltEinst" href="#" style="font-size: small;">Einstellungen</a><br/>'
		+ '<span id="ltTermin" style="font-size: small;"></span> <a id="ltTerminLink" href="#" style="font-size: small;">ändern</a>'
		+ '<div id="ltTerminForm" style="display: none; text-align: left; margin-top: 8px; padding: 8px; border: 1px solid #999; border-radius: 6px; background: #f6f6f6; font-size: small; max-width: 420px; white-space: normal;">'
		+ '<div id="ltBegegnung" style="font-weight: bold; margin-bottom: 6px;"></div>'
		+ '<label for="ltDatum" style="display: block;">Datum</label>'
		+ '<input type="date" id="ltDatum" placeholder="TT.MM.JJJJ" style="' + feld + '">'
		+ '<label for="ltZeit" style="display: block;">Uhrzeit (Spielbeginn)</label>'
		+ '<input type="time" id="ltZeit" placeholder="HH:MM" style="' + feld + '">'
		+ '<label for="ltOrt" style="display: block;">Ort / Halle</label>'
		+ '<input type="text" id="ltOrt" maxlength="100" placeholder="optional" style="' + feld + '">'
		+ '<input type="button" id="ltTerminSpeichern" value="Termin speichern" style="' + knopfStil + '">'
		+ '<div id="ltTerminErgebnis" style="margin-top: 6px;"></div>'
		+ '<div style="color: #666; margin-top: 6px;">Erscheint im Liveticker unter dem Spielstand. Wird beim Anlegen einer neuen Begegnung überschrieben.</div>'
		+ '</div>'
		+ '<div id="ltForm" style="display: none; text-align: left; margin-top: 8px; padding: 8px; border: 1px solid #999; border-radius: 6px; background: #f6f6f6; font-size: small; max-width: 420px; white-space: normal;">'
		+ '<label for="ltUrl" style="display: block;">Liveticker-Adresse</label>'
		+ '<input type="text" id="ltUrl" placeholder="z. B. https://live.meinverein.de" style="' + feld + '">'
		+ '<label for="ltPw" style="display: block;">Ticker-Passwort</label>'
		+ '<input type="text" id="ltPw" autocomplete="off" spellcheck="false" style="' + feld + '">'
		+ '<div><input type="button" id="ltSpeichern" value="Speichern &amp; testen" style="' + knopfStil + '">'
		+ '<input type="button" id="ltTesten" value="Nur testen" style="' + knopfStil + '"></div>'
		+ '<div id="ltErgebnis" style="margin-top: 6px;"></div>'
		+ '<div style="color: #666; margin-top: 6px;">Adresse und Passwort stehen im Admin-Panel des Liveticker unter „Einrichtung in CourtSpot“.</div>'
		+ '</div>';

	var knopf = document.getElementById('ltSchalter');
	var text = document.getElementById('ltStatus');
	var link = document.getElementById('ltLink');
	var form = document.getElementById('ltForm');
	var urlFeld = document.getElementById('ltUrl');
	var pwFeld = document.getElementById('ltPw');
	var ergebnis = document.getElementById('ltErgebnis');
	var terminText = document.getElementById('ltTermin');
	var terminForm = document.getElementById('ltTerminForm');
	var datumFeld = document.getElementById('ltDatum');
	var zeitFeld = document.getElementById('ltZeit');
	var ortFeld = document.getElementById('ltOrt');
	var terminErgebnis = document.getElementById('ltTerminErgebnis');
	var terminBearbeitet = false;
	var aktiv = null;
	var erstesMal = true;
	// Solange der Nutzer die Adresse bearbeitet, nicht mit dem gespeicherten Wert überschreiben
	var adresseBearbeitet = false;
	var nachSpeichern = false;
	urlFeld.oninput = function () { adresseBearbeitet = true; };

	function farbig(t, farbe)
	{
		var s = document.createElement('span');
		s.style.color = farbe;
		s.textContent = t;
		return s;
	}

	// ohne replaceChildren, damit es auch in älteren Browsern an Hallenrechnern läuft
	function setze(ziel, kind)
	{
		ziel.textContent = '';
		if (kind)
			ziel.appendChild(kind);
	}

	// „TT.MM.JJJJ“ (Datenbank) ↔ „JJJJ-MM-TT“ (Datumsfeld); ältere Browser zeigen ein Textfeld
	function fuersFeld(datum)
	{
		var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(datum || '');
		return m && datumFeld.type === 'date' ? m[3] + '-' + m[2] + '-' + m[1] : (datum || '');
	}

	function terminAnzeigen(b)
	{
		if (!b)
		{
			terminText.textContent = '';
			document.getElementById('ltTerminLink').style.display = 'none';
			return;
		}
		document.getElementById('ltTerminLink').style.display = '';
		var t = [b.datum, b.startzeit ? b.startzeit + ' Uhr' : '', b.ort].filter(function (x) { return x; }).join(', ');
		terminText.textContent = 'Termin: ' + (t || 'nicht eingetragen');
		terminText.style.color = t ? '' : '#b36b00';
		document.getElementById('ltBegegnung').textContent = b.heim && b.gast ? b.heim + ' – ' + b.gast : 'Noch keine Begegnung angelegt';
		if (!terminBearbeitet)
		{
			datumFeld.value = fuersFeld(b.datum);
			zeitFeld.value = b.startzeit || '';
			ortFeld.value = b.ort || '';
		}
	}

	function anzeigen(d)
	{
		if (d.installiert)
			terminAnzeigen(d.begegnung);
		if (d.terminGespeichert)
		{
			terminBearbeitet = false;
			terminAnzeigen(d.begegnung);
			setze(terminErgebnis, farbig('✓ Termin gespeichert', 'green'));
		}
		else if (d.fehler && terminForm.style.display !== 'none' && terminErgebnis.textContent === 'Speichere …')
			setze(terminErgebnis, farbig(d.fehler, 'red'));
		if (!d.installiert)
		{
			knopf.style.display = 'none';
			text.textContent = 'Liveticker-Dienst ist nicht installiert.';
			return;
		}
		aktiv = d.eingerichtet ? d.aktiv : null;
		knopf.disabled = false;
		knopf.value = !d.eingerichtet ? 'Liveticker einrichten' : (d.aktiv ? 'AN  (ausschalten)' : 'AUS  (einschalten)');
		knopf.style.background = d.aktiv && d.eingerichtet ? '#1d7a33' : '#ddd';
		knopf.style.color = d.aktiv && d.eingerichtet ? '#fff' : '#000';

		setze(text);
		if (d.fehler)
			text.appendChild(farbig(d.fehler, 'red'));
		else if (!d.eingerichtet)
			text.appendChild(farbig('Noch nicht eingerichtet – Adresse und Passwort unter „Einstellungen“ eintragen.', '#b36b00'));
		else if (!d.dienstLaeuft)
			text.appendChild(farbig('Dienst läuft nicht!', 'red'));
		else if (d.dienstFehler)
			text.appendChild(farbig(d.dienstFehler, 'red'));
		else if (!d.aktiv)
			text.textContent = 'Es werden keine Spieldaten übertragen.';
		else
		{
			text.appendChild(farbig('Überträgt', 'green'));
			if (d.letzteUebertragung)
				text.appendChild(document.createTextNode(' – zuletzt ' + d.letzteUebertragung + ' Uhr'));
		}

		if (d.url)
		{
			link.href = d.url;
			link.style.display = '';
		}
		if (!adresseBearbeitet && document.activeElement !== urlFeld)
			urlFeld.value = d.url || '';
		pwFeld.placeholder = d.passwortGesetzt ? 'gespeichert – leer lassen = unverändert' : 'Passwort aus dem Admin-Panel';
		if (erstesMal)
		{
			erstesMal = false;
			if (!d.eingerichtet)
				form.style.display = '';
		}
		if (d.test && nachSpeichern && !d.fehler)
		{
			// gespeichert: ab jetzt wieder den gespeicherten Wert anzeigen
			adresseBearbeitet = false;
			nachSpeichern = false;
			urlFeld.value = d.url || '';
		}
		if (d.test)
		{
			setze(ergebnis, farbig((d.test.ok ? '✓ ' : '✗ ') + d.test.text, d.test.ok ? 'green' : 'red'));
		}
		else if (d.fehler && form.style.display !== 'none')
			setze(ergebnis, farbig(d.fehler, 'red'));
	}

	function laden(aktion, extra)
	{
		var x = new XMLHttpRequest();
		x.open(aktion ? 'POST' : 'GET', '../php/liveTickerSchalter.php', true);
		x.onreadystatechange = function ()
		{
			if (x.readyState != 4)
				return;
			if (x.status == 200)
			{
				try { anzeigen(JSON.parse(x.responseText)); }
				catch (e) { text.textContent = 'Statusabfrage fehlgeschlagen.'; }
			}
		};
		if (aktion)
		{
			x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
			x.send('aktion=' + aktion + (extra || ''));
		}
		else
			x.send(null);
	}

	knopf.onclick = function ()
	{
		if (aktiv === null)
		{
			// noch nicht eingerichtet: Einstellungen öffnen
			form.style.display = '';
			urlFeld.focus();
			return;
		}
		if (aktiv && !confirm('Liveticker ausschalten?\nIm Internet und im Stream werden dann keine Spielstände mehr angezeigt.'))
			return;
		knopf.disabled = true;
		laden(aktiv ? 'aus' : 'an');
		// Der Dienst übernimmt die Änderung innerhalb einer Sekunde
		setTimeout(laden, 1500);
	};

	document.getElementById('ltEinst').onclick = function (e)
	{
		e.preventDefault();
		form.style.display = form.style.display === 'none' ? '' : 'none';
	};

	function senden(aktion)
	{
		ergebnis.textContent = aktion == 'speichern' ? 'Speichere und teste …' : 'Teste …';
		laden(aktion, '&url=' + encodeURIComponent(urlFeld.value) + '&passwort=' + encodeURIComponent(pwFeld.value));
		if (aktion == 'speichern')
		{
			nachSpeichern = true;
			pwFeld.value = '';
			setTimeout(laden, 2500);
		}
	}
	document.getElementById('ltTerminLink').onclick = function (e)
	{
		e.preventDefault();
		terminForm.style.display = terminForm.style.display === 'none' ? '' : 'none';
	};
	datumFeld.oninput = zeitFeld.oninput = ortFeld.oninput = function () { terminBearbeitet = true; };
	document.getElementById('ltTerminSpeichern').onclick = function ()
	{
		terminErgebnis.textContent = 'Speichere …';
		laden('termin', '&datum=' + encodeURIComponent(datumFeld.value) + '&startzeit=' + encodeURIComponent(zeitFeld.value)
			+ '&ort=' + encodeURIComponent(ortFeld.value));
	};
	document.getElementById('ltSpeichern').onclick = function () { senden('speichern'); };
	document.getElementById('ltTesten').onclick = function () { senden('testen'); };

	laden();
	setInterval(laden, 5000);
})();
