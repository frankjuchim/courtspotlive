#!/bin/bash
# CourtSpot-Erweiterung für den CourtSpot Liveticker installieren oder aktualisieren.
# Auf dem Rechner/Container, auf dem CourtSpot läuft, als root:
#
#   curl -fsSL https://raw.githubusercontent.com/frankjuchim/courtspotlive/main/courtspot/install.sh | bash
#
# (oder vom eigenen Liveticker: curl -fsSL https://<liveticker>/courtspot/install.sh | bash)
#
# Danach im CourtSpot-Hauptmenü bei „3. Liveticker“ → Einstellungen die Adresse und
# das Passwort des Liveticker eintragen. Erneut ausführen = Update (Einstellungen bleiben).
#
# Variablen: COURTSPOT_DIR  Verzeichnis mit DB_connection.php (sonst automatisch gesucht)
set -euo pipefail

SRC="${SOURCE_URL:-__SOURCE_URL__}"
case "$SRC" in
	*__SOURCE*) SRC="https://raw.githubusercontent.com/frankjuchim/courtspotlive/main/courtspot" ;;
esac
APP=/opt/courtspot-liveticker
STATE=/var/lib/courtspot-liveticker

[ "$(id -u)" = 0 ] || { echo "Bitte als root ausführen." >&2; exit 1; }
for bin in php curl systemctl; do
	command -v "$bin" >/dev/null 2>&1 || { echo "$bin fehlt – läuft CourtSpot auf diesem Rechner?" >&2; exit 1; }
done
php -m | grep -qi '^mysqli$' || { echo "PHP-Modul mysqli fehlt (apt install php-mysql)." >&2; exit 1; }
php -m | grep -qi '^curl$' || { echo "PHP-Modul curl fehlt (apt install php-curl)." >&2; exit 1; }
id www-data >/dev/null 2>&1 || { echo "Benutzer www-data fehlt – ist Apache installiert?" >&2; exit 1; }

# ---- CourtSpot finden: Verzeichnis mit DB_connection.php und Update-Verzeichnis/html/Menue.php
if [ -n "${COURTSPOT_DIR:-}" ]; then
	DIRS="$COURTSPOT_DIR"
else
	DIRS=$(find /var/www /srv -maxdepth 5 -name DB_connection.php 2>/dev/null | while read -r f; do
		d=$(dirname "$f")
		[ -f "$d/Update-Verzeichnis/html/Menue.php" ] && echo "$d"
	done | sort -u || true)
fi
CS_DIR=$(echo "$DIRS" | head -1)
if [ -z "$CS_DIR" ] || [ ! -f "$CS_DIR/DB_connection.php" ]; then
	echo "CourtSpot nicht gefunden (gesucht: DB_connection.php mit Update-Verzeichnis unter /var/www und /srv)." >&2
	echo "Verzeichnis angeben:  COURTSPOT_DIR=/var/www/html/<ordner> bash install.sh" >&2
	exit 1
fi
if [ "$(echo "$DIRS" | wc -l)" -gt 1 ]; then
	echo ">> Mehrere CourtSpot-Installationen gefunden:"
	echo "$DIRS" | sed 's/^/     /'
	echo "   Verwende $CS_DIR (anderes mit COURTSPOT_DIR=… angeben)."
fi
echo ">> CourtSpot: $CS_DIR"

echo ">> Lade Dateien von $SRC"
mkdir -p "$APP"
curl -fsSL "$SRC/push.php" -o "$APP/push.php"
curl -fsSL "$SRC/courtspot-liveticker.service" -o /etc/systemd/system/courtspot-liveticker.service
php -l "$APP/push.php" >/dev/null

# Status-/Einstellungsverzeichnis (Apache und Dienst laufen beide als www-data)
mkdir -p "$STATE"
chown www-data:www-data "$STATE"
chmod 750 "$STATE"
# CourtSpot-Verzeichnis in den Einstellungen merken (Adresse/Passwort bleiben)
php -r '
	$f = $argv[1]; $c = @json_decode(@file_get_contents($f), true);
	if (!is_array($c)) $c = array();
	$c["courtspotDir"] = $argv[2];
	file_put_contents($f, json_encode($c, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
' "$STATE/config.json" "$CS_DIR"
chown www-data:www-data "$STATE/config.json"
chmod 600 "$STATE/config.json"

# ---- Bereich „3. Liveticker“ im CourtSpot-Hauptmenü
UV="$CS_DIR/Update-Verzeichnis"
curl -fsSL "$SRC/liveTickerSchalter.php" -o "$UV/php/liveTickerSchalter.php"
curl -fsSL "$SRC/liveTickerSchalter.js" -o "$UV/js/liveTickerSchalter.js"
chmod 644 "$UV/php/liveTickerSchalter.php" "$UV/js/liveTickerSchalter.js"
MENU="$UV/html/Menue.php"
if ! grep -q 'csLiveticker' "$MENU"; then
	cp "$MENU" "$MENU.vor-liveticker"
	if grep -q '<a href="../html/liveTicker.php" target="_blank">3. LiveTicker</a>' "$MENU"; then
		# Menüpunkt „3. LiveTicker“ (courtspot.de) durch den Schalter ersetzen
		sed -i 's#<a href="../html/liveTicker.php" target="_blank">3. LiveTicker</a>#<span id="csLiveticker"><a href="../html/liveTicker.php" target="_blank">3. LiveTicker</a></span><script src="../js/liveTickerSchalter.js"></script>#' "$MENU"
	else
		# Andere CourtSpot-Version: Bereich unten im Menü anfügen
		sed -i 's#</body>#<div id="csLiveticker" style="max-width: 460px; margin: 16px auto; padding: 10px; text-align: center; border: 1px solid \#999; border-radius: 8px; font-family: sans-serif;"></div><script src="../js/liveTickerSchalter.js"></script>\n</body>#' "$MENU"
	fi
fi
if grep -q 'csLiveticker' "$MENU"; then
	echo ">> Bereich „3. Liveticker“ im CourtSpot-Hauptmenü eingebaut (Sicherung: Menue.php.vor-liveticker)."
else
	echo "!! Menü konnte nicht angepasst werden ($MENU)." >&2
fi

echo ">> Dienst einrichten"
systemctl daemon-reload
systemctl enable -q courtspot-liveticker.service
systemctl restart courtspot-liveticker.service
sleep 2
systemctl is-active -q courtspot-liveticker.service && echo ">> Dienst courtspot-liveticker läuft." \
	|| { echo "!! Dienst läuft nicht – Log: journalctl -u courtspot-liveticker -n 30" >&2; exit 1; }

cat <<INFO

  Fertig. Jetzt im CourtSpot-Hauptmenü bei „3. Liveticker“ → Einstellungen
  die Adresse und das Passwort des Liveticker eintragen (stehen im Admin-Panel
  des Liveticker unter „Einrichtung in CourtSpot“), „Speichern & testen“ und
  den Liveticker einschalten. Ggf. die Menüseite neu laden (Strg+F5).

  Log:     journalctl -u courtspot-liveticker -f
  Update:  diesen Befehl erneut ausführen

INFO
