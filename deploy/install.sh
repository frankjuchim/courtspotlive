#!/bin/bash
# Installiert (oder aktualisiert) den CourtSpot Liveticker in einem Debian-Container.
# Als root im Container ausführen:
#   curl -fsSL https://raw.githubusercontent.com/frankjuchim/courtspotlive/main/deploy/install.sh | bash
set -euo pipefail

REPO="${REPO:-https://github.com/frankjuchim/courtspotlive.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/courtspotlive
DATA_DIR=/var/lib/courtspotlive
ENV_FILE=/etc/courtspotlive.env

[ "$(id -u)" = 0 ] || { echo "Bitte als root ausführen." >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
# Pakete nur installieren, wenn etwas fehlt (Updates bleiben so schnell und schlank)
if ! command -v node >/dev/null || ! command -v git >/dev/null || ! command -v curl >/dev/null; then
  echo "==> Pakete installieren (nodejs, git)"
  apt-get update -qq
  apt-get install -y -qq nodejs git ca-certificates curl >/dev/null
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js $NODE_MAJOR ist zu alt (mindestens 18 nötig) – bitte Debian 12 oder neuer verwenden." >&2
  exit 1
fi

echo "==> Programm nach $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$APP_DIR"
fi
# Installierte Version merken (Anzeige und Update-Prüfung im Admin-Panel)
REPO_SLUG=$(git -C "$APP_DIR" remote get-url origin | sed -E 's#^.*github\.com[:/]##; s#\.git$##')
printf '{"commit":"%s","date":"%s","repo":"%s","branch":"%s"}\n' \
  "$(git -C "$APP_DIR" rev-parse HEAD)" "$(git -C "$APP_DIR" log -1 --format=%cI)" "$REPO_SLUG" "$BRANCH" \
  > "$APP_DIR/.version.json"
# Keine npm-Abhängigkeiten – Node.js genügt

echo "==> Benutzer und Datenverzeichnis"
id courtspotlive >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin courtspotlive
mkdir -p "$DATA_DIR"
chown courtspotlive:courtspotlive "$DATA_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "==> Konfiguration $ENV_FILE anlegen"
  PASSWORD=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
  cat > "$ENV_FILE" <<CONF
# CourtSpot Liveticker – nach Änderungen: systemctl restart courtspotlive
PORT=80
DATA_DIR=$DATA_DIR

# Passwort, das im CourtSpot-Menü beim Liveticker eingetragen wird
# (im Admin-Panel änderbar – das geht dann vor)
TICKER_PASSWORD=$PASSWORD

# Erscheinungsbild (Standardwerte; im Admin-Panel geändert geht vor)
TITLE="Badminton"
SUBTITLE="Liveticker"
ACCENT="#1f5f99"
# Logo, Titel und Farbe lassen sich auch im Admin-Panel (/admin) ändern.
# Logo alternativ als Dateipfad:
#LOGO_FILE=/pfad/zum/logo.png
CONF
  chmod 640 "$ENV_FILE"
  chown root:courtspotlive "$ENV_FILE"
fi

echo "==> Dienst einrichten"
install -m 644 "$APP_DIR/deploy/courtspotlive.service" /etc/systemd/system/courtspotlive.service
# Update-Knopf im Admin-Panel: der Liveticker (ohne root) legt eine Anfrage-Datei an,
# diese Einheiten starten daraufhin deploy/update.sh als root
install -m 644 "$APP_DIR/deploy/courtspotlive-update.service" /etc/systemd/system/courtspotlive-update.service
install -m 644 "$APP_DIR/deploy/courtspotlive-update.path" /etc/systemd/system/courtspotlive-update.path
systemctl daemon-reload
systemctl enable -q courtspotlive
systemctl enable -q --now courtspotlive-update.path
systemctl restart courtspotlive

PORT=$(sed -n 's/^PORT=//p' "$ENV_FILE" | tail -1)
PORT=${PORT:-80}
# Bis zu 30 s warten – auf kleinen Containern braucht der Start manchmal etwas
OK=""
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then OK=1; break; fi
  sleep 1
done
if [ -n "$OK" ]; then
  echo "==> Läuft."
else
  echo "!! Dienst antwortet nicht. Letzte Log-Zeilen:" >&2
  journalctl -u courtspotlive -n 20 --no-pager >&2 || true
  exit 1
fi

TPW=$(sed -n 's/^TICKER_PASSWORD=//p' "$ENV_FILE")
# im Admin-Panel geändert? Dann gilt das
if [ -f "$DATA_DIR/ticker-password.json" ]; then
  TPW=$(sed -n 's/.*"password":"\([^"]*\)".*/\1/p' "$DATA_DIR/ticker-password.json")
fi
IP=$(hostname -I | awk '{print $1}')
SUFFIX=""; [ "$PORT" = 80 ] || SUFFIX=":$PORT"
cat <<INFO

  Liveticker:        http://$IP$SUFFIX/
  Admin-Panel:       http://$IP$SUFFIX/admin
                     Passwort courtspotadmin (falls noch nicht geändert – bitte im Admin-Panel ändern)
  In CourtSpot:      1. Erweiterung im CourtSpot-Container installieren (als root):
                        curl -fsSL http://$IP$SUFFIX/courtspot/install.sh | bash
                     2. CourtSpot-Hauptmenü → „3. Liveticker“ → Einstellungen:
                        Adresse  http://$IP$SUFFIX   Passwort $TPW
  Konfiguration:     $ENV_FILE
  Update:            im Admin-Panel oder bash $APP_DIR/deploy/update.sh

INFO
