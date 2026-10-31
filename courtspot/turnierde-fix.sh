#!/bin/bash
# CourtSpot: „Begegnung von turnier.de importieren“ robuster machen.
#
#  1. Ein Spieltermin, der nicht genau „Wochentag Datum Uhrzeit“ lautet (z. B. verlegt,
#     ohne Uhrzeit oder noch offen), bricht den Import nicht mehr mit
#     „Cannot find starttime“ ab – CourtSpot verwendet den Termin beim Import ohnehin nicht.
#  2. Die Importseite zeigt bei Fehlern die eigentliche Meldung statt nur
#     „Ein Fehler ist aufgetreten“.
#  3. Datum, Uhrzeit und Ort der Begegnung werden von turnier.de übernommen, soweit
#     vorhanden (selbst eintragen/ändern: CourtSpot-Menü „3. Liveticker“ → Termin).
#
# Auf dem Rechner/Container, auf dem CourtSpot läuft, als root:
#   curl -fsSL https://raw.githubusercontent.com/frankjuchim/courtspotlive/main/courtspot/turnierde-fix.sh | bash
#
# „bup updaten“ im CourtSpot-Menü ersetzt den bup-Ordner – danach diesen Befehl erneut
# ausführen. Mehrfaches Ausführen schadet nicht.
# Variablen: COURTSPOT_DIR  Verzeichnis mit DB_connection.php (sonst automatisch gesucht)
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Bitte als root ausführen." >&2; exit 1; }
command -v php >/dev/null 2>&1 || { echo "php fehlt – läuft CourtSpot auf diesem Rechner?" >&2; exit 1; }

if [ -n "${COURTSPOT_DIR:-}" ]; then
	DIRS="$COURTSPOT_DIR"
else
	DIRS=$(find /var/www /srv -maxdepth 5 -name DB_connection.php 2>/dev/null | while read -r f; do
		d=$(dirname "$f")
		[ -f "$d/Update-Verzeichnis/bup/http_proxy/tde_import.php" ] && echo "$d"
	done | sort -u || true)
fi
[ -n "$DIRS" ] || { echo "CourtSpot nicht gefunden – Verzeichnis mit COURTSPOT_DIR=… angeben." >&2; exit 1; }

echo "$DIRS" | while read -r CS; do
	[ -n "$CS" ] || continue
	echo ">> $CS"
	php -r '
		$cs = $argv[1];

		// 1. tde_import.php: Spieltermin optional
		$f = $cs . "/Update-Verzeichnis/bup/http_proxy/tde_import.php";
		$s = file_get_contents($f);
		if (strpos($s, "courtspotlive-fix") !== false) {
			echo "   Import (Spieltermin): schon angepasst\n";
		} else {
			$alt = "\t} else {\n\t\tthrow new \\Exception(\x27Cannot find starttime\x27);\n\t}";
			$neu = "\t} else if (\\preg_match(\x27/<th>[^<]*Spieltermin[^<]*<\\/th>\\s*<td>(.*?)<\\/td>/s\x27, \$tm_html, \$termin_m)) {\n"
				. "\t\t// courtspotlive-fix: abweichender Spieltermin (verlegt, ohne Uhrzeit, offen) bricht den Import nicht ab\n"
				. "\t\t\$termin = \\trim(\\preg_replace(\x27/\\s+/\x27, \x27 \x27, \\strip_tags(\$termin_m[1])));\n"
				. "\t\t\$res[\x27date\x27] = \\preg_match(\x27/([0-9]{1,2}\\.[0-9]{1,2}\\.[0-9]{2,4})/\x27, \$termin, \$d_m) ? \$d_m[1] : \x27\x27;\n"
				. "\t\tif (\\preg_match(\x27/([0-9]{1,2}:[0-9]{2})/\x27, \$termin, \$t_m)) {\n"
				. "\t\t\t\$res[\x27starttime\x27] = \$t_m[1];\n"
				. "\t\t}\n"
				. "\t} else {\n"
				. "\t\t// courtspotlive-fix: ohne Spieltermin trotzdem importieren\n"
				. "\t\t\$res[\x27date\x27] = \x27\x27;\n"
				. "\t}";
			if (substr_count($s, $alt) !== 1) {
				fwrite(STDERR, "   !! tde_import.php hat eine unbekannte Fassung – nicht geändert\n");
				exit(2);
			}
			copy($f, $f . ".vor-fix");
			file_put_contents($f, str_replace($alt, $neu, $s));
			echo "   Import (Spieltermin): angepasst (Sicherung tde_import.php.vor-fix)\n";
		}

		// 3. Importseite: Datum, Uhrzeit und Ort von turnier.de übernehmen (waren auskommentiert)
		$h = $cs . "/Update-Verzeichnis/html/spielerTurnierDeLaden.html";
		if (is_file($h)) {
			$s = file_get_contents($h);
			$alt = "+\x27&Ort=\x27//+match[\x27event\x27][\x27location\x27]\n"
				. "\t\t\t\t+\x27&Startzeit=\x27//+match[\x27event\x27][\x27starttime\x27]\n"
				. "\t\t\t\t+\x27&Datum=\x27//+match[\x27event\x27][\x27date\x27]";
			$alt = stripcslashes($alt);
			// Apostrophe entfernen: dbVerwaltungEintrag.php setzt die Werte direkt ins SQL ein
			$wert = function ($k) { return "encodeURIComponent(String(match[\x27event\x27][\x27" . $k . "\x27] || \x27\x27).replace(/\x27/g, \x27´\x27))"; };
			$neu = stripcslashes("+\x27&Ort=\x27+" . $wert("location") . " // courtspotlive-termin\n"
				. "\t\t\t\t+\x27&Startzeit=\x27+" . $wert("starttime") . "\n"
				. "\t\t\t\t+\x27&Datum=\x27+" . $wert("date"));
			if (strpos($s, "courtspotlive-termin") !== false) {
				echo "   Importseite (Termin übernehmen): schon angepasst\n";
			} elseif (substr_count($s, $alt) === 1) {
				if (!is_file($h . ".vor-fix")) copy($h, $h . ".vor-fix");
				file_put_contents($h, str_replace($alt, $neu, $s));
				echo "   Importseite (Termin übernehmen): angepasst\n";
			} else {
				echo "   Importseite (Termin): unbekannte Fassung – nicht geändert\n";
			}
		}

		// 2. Importseite: echte Fehlermeldung anzeigen
		$h = $cs . "/Update-Verzeichnis/html/spielerTurnierDeLaden.html";
		if (is_file($h)) {
			$s = file_get_contents($h);
			$alt = "alert(\"Ein Fehler ist aufgetreten\");";
			$neu = "var meldung = \x27\x27; try { meldung = JSON.parse(ajax_obj.responseText).message || \x27\x27; } catch (e) {} "
				. "alert(\"Ein Fehler ist aufgetreten\" + (meldung ? \":\\n\" + meldung : \"\")); // courtspotlive-fix";
			if (strpos($s, "courtspotlive-fix") !== false) {
				echo "   Importseite (Fehlermeldung): schon angepasst\n";
			} elseif (substr_count($s, $alt) === 1) {
				copy($h, $h . ".vor-fix");
				file_put_contents($h, str_replace($alt, $neu, $s));
				echo "   Importseite (Fehlermeldung): angepasst\n";
			} else {
				echo "   Importseite: unbekannte Fassung – nicht geändert\n";
			}
		}
	' "$CS"
	php -l "$CS/Update-Verzeichnis/bup/http_proxy/tde_import.php" >/dev/null || {
		echo "!! Syntaxfehler – stelle die Sicherung wieder her" >&2
		cp "$CS/Update-Verzeichnis/bup/http_proxy/tde_import.php.vor-fix" "$CS/Update-Verzeichnis/bup/http_proxy/tde_import.php"
		exit 1
	}
done
echo ">> Fertig. Die Begegnung jetzt erneut über „Begegnung von turnier.de importieren“ laden."
