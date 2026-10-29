#!/bin/bash
# Aktualisiert den CourtSpot Liveticker auf den neuesten Stand (als root im Container).
# Konfiguration und gespeicherte Ergebnisse bleiben erhalten.
set -euo pipefail
APP_DIR=/opt/courtspotlive
BRANCH="${BRANCH:-main}"
git -C "$APP_DIR" fetch -q origin "$BRANCH"
git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
# Installationsskript aus einer Kopie starten (es aktualisiert sein eigenes Verzeichnis)
TMP=$(mktemp)
cp "$APP_DIR/deploy/install.sh" "$TMP"
exec bash "$TMP"
