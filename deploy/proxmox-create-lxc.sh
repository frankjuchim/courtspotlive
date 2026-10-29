#!/bin/bash
# Legt auf einem Proxmox-VE-Host einen Debian-LXC-Container an und installiert
# darin den CourtSpot Liveticker. Auf dem Proxmox-Host als root ausführen:
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/frankjuchim/courtspotlive/main/deploy/proxmox-create-lxc.sh)"
#
# Einstellungen per Umgebungsvariable, z. B.:
#   CTID=120 IP=192.168.1.50/24 GW=192.168.1.1 STORAGE=local-zfs bash -c "$(curl …)"
#
#   CTID        Container-ID                (Standard: nächste freie)
#   CT_HOSTNAME Hostname                    (Standard: courtspotlive)
#   STORAGE     Speicher für das Root-FS    (Standard: local-lvm)
#   TEMPLATE_STORAGE  Speicher für Vorlagen (Standard: local)
#   BRIDGE      Netzwerkbrücke              (Standard: vmbr0)
#   IP          dhcp oder z. B. 192.168.1.50/24 (Standard: dhcp)
#   GW          Gateway bei fester IP
#   VLAN        VLAN-Tag (optional)
#   DEBIAN      Debian-Version der Vorlage  (Standard: 12 – läuft auf allen
#               Proxmox-Versionen; 13 braucht ein aktuelles Proxmox)
#   DISK        Größe Root-FS in GB         (Standard: 4)
#   MEMORY      RAM in MB                   (Standard: 512)
#   ROOT_PASSWORD  root-Passwort für die Konsole des Containers
#               (Standard: wird zufällig erzeugt und am Ende angezeigt)
set -euo pipefail

CTID="${CTID:-$(pvesh get /cluster/nextid)}"
CT_HOSTNAME="${CT_HOSTNAME:-courtspotlive}"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
BRIDGE="${BRIDGE:-vmbr0}"
IP="${IP:-dhcp}"
DISK="${DISK:-4}"
MEMORY="${MEMORY:-512}"
DEBIAN="${DEBIAN:-12}"
# root-Passwort für die Konsole im Web-UI (ohne Passwort ginge nur „pct enter“ vom Host)
ROOT_PASSWORD="${ROOT_PASSWORD:-$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 16)}"
INSTALL_URL="${INSTALL_URL:-https://raw.githubusercontent.com/frankjuchim/courtspotlive/main/deploy/install.sh}"

command -v pct >/dev/null || { echo "Dieses Skript läuft auf dem Proxmox-Host (pct nicht gefunden)." >&2; exit 1; }
[ "$(id -u)" = 0 ] || { echo "Bitte als root ausführen." >&2; exit 1; }
if pct status "$CTID" >/dev/null 2>&1; then
  echo "Container $CTID existiert bereits – andere CTID wählen (CTID=…)." >&2
  exit 1
fi

echo "==> Debian-$DEBIAN-Vorlage suchen"
pveam update >/dev/null
TEMPLATE=$(pveam available --section system | awk '{print $2}' | grep -E "^debian-${DEBIAN}-standard_.*amd64" | sort -V | tail -1)
[ -n "$TEMPLATE" ] || { echo "Keine Vorlage für Debian $DEBIAN gefunden (pveam available --section system)." >&2; exit 1; }
echo "    $TEMPLATE"
if ! pveam list "$TEMPLATE_STORAGE" | grep -q "$TEMPLATE"; then
  echo "==> Lade $TEMPLATE"
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE" >/dev/null
fi

NET="name=eth0,bridge=$BRIDGE,ip=$IP"
[ "$IP" != dhcp ] && [ -n "${GW:-}" ] && NET="$NET,gw=$GW"
[ -n "${VLAN:-}" ] && NET="$NET,tag=$VLAN"

echo "==> Container $CTID ($CT_HOSTNAME) anlegen"
# Ältere Proxmox-Versionen kennen neue Debian-Versionen noch nicht
# („unsupported debian version“) – dann mit DEBIAN=12 oder Proxmox aktualisieren.
if ! pct create "$CTID" "$TEMPLATE_STORAGE:vztmpl/$TEMPLATE" \
  --hostname "$CT_HOSTNAME" \
  --cores 1 --memory "$MEMORY" --swap 256 \
  --rootfs "$STORAGE:$DISK" \
  --net0 "$NET" \
  --unprivileged 1 --features nesting=1 \
  --onboot 1 \
  --password "$ROOT_PASSWORD" \
  --description "CourtSpot Liveticker – https://github.com/frankjuchim/courtspotlive" >/dev/null; then
  echo "!! Container konnte nicht angelegt werden." >&2
  echo "   Bei „unsupported debian version“: Proxmox aktualisieren (apt update && apt full-upgrade)" >&2
  echo "   oder eine ältere Debian-Version wählen, z. B. DEBIAN=12." >&2
  exit 1
fi
pct start "$CTID"

echo "==> Warte auf Netzwerk"
for i in $(seq 1 30); do
  if pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1; then break; fi
  sleep 2
  [ "$i" = 30 ] && { echo "Container hat kein Netzwerk/DNS." >&2; exit 1; }
done

echo "==> Installiere den Liveticker im Container"
pct exec "$CTID" -- bash -c "apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null && curl -fsSL '$INSTALL_URL' | bash"

echo "==> Fertig. Container $CTID startet automatisch mit dem Host."
echo "    Konsole des Containers im Web-UI:  Benutzer root, Passwort $ROOT_PASSWORD"
echo "    (bitte notieren – ändern im Container mit: passwd)"
echo "    Update später (hier auf dem Host): pct exec $CTID -- bash /opt/courtspotlive/deploy/update.sh"
