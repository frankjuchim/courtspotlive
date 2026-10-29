# CourtSpot Liveticker

Öffentlicher **Liveticker** und **Stream-Overlays (OBS)** für **CourtSpot**, das Zählsystem für
Badminton-Mannschaftswettkämpfe. Für jeden Verein: läuft als kleiner Container auf einem
**Proxmox**-Server, Erscheinungsbild (Titel, Farbe, Logo) im Admin-Panel einstellbar.

- Liveticker für Zuschauer: Gesamtstand, beide laufenden Courts, alle Spiele mit Satzergebnissen
- Transparente Overlays für den Stream: Court 1 links, Court 2 rechts, optional Gesamtstand in der Mitte;
  feste Boxbreiten, Platz für alle Sätze, das zuletzt beendete Spiel bleibt stehen, bis das nächste beginnt
- **CourtSpot-Erweiterung** für die Halle: kleiner Dienst, der die CourtSpot-Datenbank liest und den
  Stand an den Liveticker schickt – **Adresse und Passwort trägt man im CourtSpot-Hauptmenü ein**,
  dort gibt es auch einen Ein-/Aus-Schalter mit Statusanzeige. Kein offenes Browserfenster nötig,
  funktioniert auch mit manuell angelegten Begegnungen (ohne courtspot.de)
- Admin-Panel mit Passwort: Verbindungsstatus, Einrichtung, Ticker-Passwort, Overlay-Links,
  Erscheinungsbild mit Designs und Vorschau, Update per Knopf
- Keine Datenbank, keine Cloud, keine npm-Abhängigkeiten: Node.js + ein paar JSON-Dateien

```
 Halle: CourtSpot (Proxmox-LXC o. ä.)              Proxmox: LXC-Container           Zuschauer / OBS
 ┌──────────────────────────────────────┐  HTTP(S) ┌────────────────────────┐  SSE  ┌──────────────────┐
 │ bup ─► MariaDB (Spiele, Courts, …)   │ ───────► │ courtspotlive (Node)   │ ────► │ /  /courts       │
 │         ▲                            │ /api/    │ + Admin-Panel /admin   │       │ /court/1 /court/2│
 │         └─ courtspot-liveticker      │ update   └────────────────────────┘       └──────────────────┘
 │            (Dienst, Menü-Schalter)   │
 └──────────────────────────────────────┘
```

Die Halle baut die Verbindung **zum Liveticker** auf. Im Hallennetz muss nichts freigegeben werden;
der Liveticker muss nur von CourtSpot aus erreichbar sein (im selben Netz oder öffentlich).

## 1. Liveticker auf Proxmox installieren

Auf dem **Proxmox-Host** als root (Shell im Web-UI: *Datacenter → Knoten → Shell*):

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/frankjuchim/courtspotlive/main/deploy/proxmox-create-lxc.sh)"
```

Voraussetzung: Proxmox VE 8 oder neuer (7.4 mit allen Updates sollte auch gehen). Das Skript lädt eine
Debian-12-Vorlage, legt einen unprivilegierten LXC-Container an (1 Kern, 512 MB RAM, 4 GB Platte, DHCP,
startet mit dem Host) und installiert den Liveticker. Am Ende stehen Adresse, Ticker-Passwort, der
Befehl für CourtSpot und das Admin-Passwort (`courtspotadmin`, bitte gleich ändern) im Terminal.

Einstellungen über Variablen, z. B. feste IP und anderer Speicher:

```sh
CTID=121 IP=192.168.1.51/24 GW=192.168.1.1 STORAGE=local-zfs \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/frankjuchim/courtspotlive/main/deploy/proxmox-create-lxc.sh)"
```

| Variable | Standard | |
| --- | --- | --- |
| `CTID` | nächste freie ID | Container-ID |
| `CT_HOSTNAME` | `courtspotlive` | Hostname |
| `STORAGE` | `local-lvm` | Speicher für die Container-Platte |
| `TEMPLATE_STORAGE` | `local` | Speicher für die Debian-Vorlage |
| `BRIDGE` | `vmbr0` | Netzwerkbrücke |
| `IP` / `GW` | `dhcp` | z. B. `192.168.1.51/24` und Gateway |
| `VLAN` | – | VLAN-Tag |
| `ROOT_PASSWORD` | zufällig | root-Passwort für die Container-Konsole (wird am Ende angezeigt) |
| `DEBIAN` | `12` | Debian-Version des Containers (`13` nur mit aktuellem Proxmox) |
| `DISK` / `MEMORY` | `4` / `512` | GB / MB |

**Schon einen Container oder eine VM?** (Debian 12 oder 13, Ubuntu 24.04) – darin als root:

```sh
apt-get update && apt-get install -y curl
curl -fsSL https://raw.githubusercontent.com/frankjuchim/courtspotlive/main/deploy/install.sh | bash
```

## 2. CourtSpot anbinden

### Erweiterung in CourtSpot installieren

Auf dem **Rechner bzw. Container, auf dem CourtSpot läuft** (z. B. in Proxmox: CourtSpot-Container →
*Console*, als root) – die Adresse ist die des Liveticker, der Befehl steht auch im Admin-Panel:

```sh
curl -fsSL http://<liveticker>/courtspot/install.sh | bash
```

oder direkt von GitHub:

```sh
curl -fsSL https://raw.githubusercontent.com/frankjuchim/courtspotlive/main/courtspot/install.sh | bash
```

Das Skript

- sucht CourtSpot (Verzeichnis mit `DB_connection.php` und `Update-Verzeichnis` unter `/var/www`
  bzw. `/srv`; anders: `COURTSPOT_DIR=/var/www/html/<ordner>` voranstellen),
- installiert den Dienst `courtspot-liveticker` (`/opt/courtspot-liveticker/push.php`, läuft als
  `www-data`, startet automatisch mit),
- baut im **CourtSpot-Hauptmenü** den Bereich **„3. Liveticker“** ein (ersetzt den Link zum
  courtspot.de-Ticker; Sicherung `Menue.php.vor-liveticker`).

Erneut ausführen = Update, Einstellungen bleiben erhalten.
Voraussetzung: CourtSpot unter Linux mit Apache und PHP (`php-mysql`, `php-curl`), z. B. die
Proxmox-Version von CourtSpot (Debian 11). Windows/macOS (XAMPP) wird nicht unterstützt.

### Im CourtSpot-Hauptmenü einrichten

Bei **„3. Liveticker“** auf **„Liveticker einrichten“** bzw. **„Einstellungen“**:

1. **Liveticker-Adresse** eintragen, z. B. `https://live.meinverein.de` oder `http://192.168.1.51`
2. **Ticker-Passwort** eintragen (steht im Admin-Panel unter „Einrichtung in CourtSpot“)
3. **„Speichern & testen“** – meldet sofort „Verbindung in Ordnung“ oder was nicht stimmt
   (Adresse nicht erreichbar, Passwort falsch, kein Liveticker unter der Adresse)
4. Mit dem Knopf **AN/AUS** wird übertragen bzw. nicht. Ausgeschaltet zeigt der Ticker
   „Liveticker derzeit nicht aktiv“ und die Overlays bleiben leer – praktisch für Tests.

Darunter steht der Status („Überträgt – zuletzt 14:03:12 Uhr“, „Dienst läuft nicht!“,
„Ticker-Passwort falsch“ …) und ein Link zum Ticker. Am Spieltag wird wie gewohnt gearbeitet:
Datenbank zurücksetzen, Begegnung anlegen (auch manuell), Aufstellung in bup, zählen.

Gespeichert wird in `/var/lib/courtspot-liveticker/config.json` (nur für `www-data` lesbar).
Ältere Installationen mit `/etc/courtspot-liveticker.conf.php` (`$PUSH_URL`, `$PUSH_TOKEN`)
funktionieren weiter; im Menü gespeicherte Werte gehen vor.

Im Container prüfen: `journalctl -u courtspot-liveticker -f`,
`php /opt/courtspot-liveticker/push.php --dry-run` (zeigt die Daten, sendet nichts).

## Admin-Panel

`http://<IP>/admin` ist durch ein **Admin-Passwort** geschützt.

- **Standardpasswort: `courtspotadmin`** – gilt, bis es geändert wird; solange zeigt das Panel einen Hinweis.
- **Ändern:** unten im Abschnitt **„Admin-Passwort ändern“** (mindestens 8 Zeichen).
- Angemeldet bleibt man 7 Tage. Nach 10 falschen Versuchen in 15 Minuten wird die Adresse 15 Minuten gesperrt.
- Gespeichert wird nur ein Hash in `/var/lib/courtspotlive/admin.json`. Alternativ fest über
  `ADMIN_PASSWORD` in `/etc/courtspotlive.env` (dann im Panel nicht änderbar).

**Admin-Passwort vergessen?** Auf dem Proxmox-Host zurück auf `courtspotadmin` setzen:

```sh
pct exec <CTID> -- bash -c "rm -f /var/lib/courtspotlive/admin.json && systemctl restart courtspotlive"
```

Das Panel zeigt außerdem:

- **Status:** CourtSpot verbunden/getrennt (meldet sich mindestens alle 30 s), Ticker in CourtSpot
  ein/aus, Begegnung mit Gesamtstand, Spiele, letzte Daten/Änderung, Version der Erweiterung und Datenbank
- **Einrichtung in CourtSpot:** Installationsbefehl, Adresse und Ticker-Passwort zum Eintragen
- **Ticker-Passwort für CourtSpot:** anzeigen, ändern, zufällig erzeugen
- **Seiten & Overlays:** alle Links und Parameter
- **Erscheinungsbild:** Design, Titel, Untertitel, optionaler Link, Logo und Farbe (zehn Vorgaben oder
  frei) mit Vorschau. Offene Ticker-Seiten und OBS-Overlays übernehmen Änderungen sofort, ohne Neuladen.
- **Anzeige leeren** (z. B. nach Testspielen) und **Update** per Knopf

### Designs

Ein Design ist ein fertiges Paket aus Titel, Untertitel, Farbe und Logo, auswählbar im Admin-Panel
(sichtbar, sobald es neben „Standard“ mindestens eins gibt). Siehe [designs/README.md](designs/README.md).

## Update

Konfiguration, Passwörter, Logo und Farben bleiben bei einem Update erhalten.

- **Liveticker:** im Admin-Panel unter **„Update“** → **„Jetzt aktualisieren“** (etwa eine Minute nicht
  erreichbar; CourtSpot sendet danach von selbst weiter). Oder vom Proxmox-Host:
  `pct exec <CTID> -- bash /opt/courtspotlive/deploy/update.sh`
- **CourtSpot-Erweiterung:** den Installationsbefehl im CourtSpot-Container erneut ausführen.

Root-Login im Container: Benutzer `root`, Passwort zeigt das Proxmox-Skript am Ende an. Vergessen?
Auf dem Host `pct enter <CTID>`, dann `passwd`.

## Konfiguration

`/etc/courtspotlive.env` im Container, danach `systemctl restart courtspotlive`. Werte aus dem
Admin-Panel haben Vorrang.

| Variable | Standard | |
| --- | --- | --- |
| `TICKER_PASSWORD` | zufällig erzeugt | Passwort, das in CourtSpot eingetragen wird (im Admin-Panel änderbar) |
| `PORT` | `80` | HTTP-Port |
| `TITLE` | `Badminton` | Überschrift im Kopf, z. B. Vereinsname |
| `SUBTITLE` | `Liveticker` | Zeile darunter |
| `ACCENT` | `#1f5f99` | Akzentfarbe (Kopf, Court-Karten, Overlays) |
| `DESIGN` | `standard` | Voreingestelltes Design |
| `LOGO_FILE` | – | Pfad zu einem eigenen Logo (einfacher: im Admin-Panel hochladen) |
| `ADMIN_PASSWORD` | – | Festes Admin-Passwort |
| `DATA_DIR` | `/var/lib/courtspotlive` | gespeicherter Stand und Einstellungen |

Log: `journalctl -u courtspotlive -f`

## Von außen erreichbar machen

Im Vereinsnetz reicht die IP des Containers. Für Zuschauer von unterwegs braucht es eine öffentliche
Adresse mit HTTPS:

- **Reverse-Proxy** (Nginx Proxy Manager, Caddy, Traefik, …) auf den Container, Port 80. Für die
  Live-Updates Pufferung aus (`proxy_buffering off;`), für den Logo-Upload `client_max_body_size 20m;`.
  ```nginx
  location / {
      proxy_pass http://192.168.1.51;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_buffering off;          # Server-Sent Events
      proxy_read_timeout 1h;
      client_max_body_size 20m;     # Logo-Upload
  }
  ```
- **Cloudflare Tunnel** (ohne Portfreigabe): `cloudflared` im Container, Public Hostname auf `http://localhost:80`.

In CourtSpot dann die öffentliche Adresse (oder die interne, wenn beide im selben Netz sind) eintragen.

## Seiten

| URL | Inhalt |
| --- | --- |
| `/` | Liveticker: Gesamtstand, laufende Courts, alle Spiele |
| `/courts` | Overlay: Court 1 links, Court 2 rechts (transparent) |
| `/court/1`, `/court/2` | Overlay für einen Court |
| `/admin` | Admin-Panel |
| `/api/state` | Aktueller Stand als JSON |

### Parameter für die Overlays

| Parameter | Wirkung | Beispiel |
| --- | --- | --- |
| `total=1` | Gesamtstand mit Logo in der Mitte (`/courts`) bzw. über dem Court | `/courts?total=1` |
| `pos=bottom` | Anzeigen unten statt oben (`/courts`) | `/courts?pos=bottom` |
| `layout=stack` | Courts untereinander statt links/rechts (`/courts`) | `/courts?layout=stack` |
| `scale` | Größe skalieren | `?scale=1.2` |
| `names=full` | Volle Vornamen statt „M. Mustermann“ | `?names=full` |
| `sets=0` | Fertige Sätze ausblenden | `?sets=0` |
| `showIdle=1` | Freien Court als „Kein laufendes Spiel“ zeigen | `?showIdle=1` |
| `bg` | Hintergrundfarbe statt transparent (z. B. Chroma-Key) | `?bg=00ff00` |

In OBS: *Quelle hinzufügen → Browser*, URL eintragen, 1920 × 1080. Anzeige: weißer Punkt = Aufschlag,
Spalten = fertige Sätze, weißes Feld = Punkte im laufenden Satz, ✓ = Sieger.

## Was CourtSpot schickt

Der Dienst liest jede Sekunde die Tabellen `Verwaltung` (Vereine, Datum, Ort – ohne Passwort),
`Spiele` (Spieler, Satzergebnisse) und `Courts` (welches Spiel auf welchem Court läuft, Aufschlag) und
schickt sie bei Änderungen, sonst alle 30 s als Lebenszeichen, per `POST /api/update` mit dem
Ticker-Passwort als Bearer-Token. Der Liveticker berechnet daraus Sätze, Sieger und Gesamtstand
(3×21 bzw. 5×11 je nach Begegnung).

## Entwicklung

```sh
PORT=8080 TICKER_PASSWORD=test node server.js
node tools/fake-courtspot.js http://localhost:8080 test     # simuliert einen Spieltag
npm test
```

Aufbau, Admin-Panel und Proxmox-Skripte folgen dem [BTS Liveticker](https://github.com/frankjuchim/bts-liveticker-v2).
