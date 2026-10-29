# Designs

Ein Design ist ein fertiges Paket aus Titel, Untertitel, Farbe und Logo, das sich im
Admin-Panel unter **Erscheinungsbild → Design** auswählen lässt (die Auswahl erscheint, sobald
es neben „Standard (neutral)“ mindestens ein weiteres Design gibt).

Neues Design anlegen: einen Ordner `designs/<id>/` (nur Kleinbuchstaben, Ziffern, `-`) mit

```
designs/meinverein/design.json
designs/meinverein/logo.png
```

```json
{
  "name": "Mein Verein",
  "title": "BC Musterstadt",
  "subtitle": "Badminton · Liveticker",
  "accent": "#0a7d3b",
  "logo": "logo.png"
}
```

Alle Felder außer `name` sind optional. Danach den Dienst neu starten. Mit `DESIGN=<id>` in der
Konfiguration wird das Design voreingestellt; im Admin-Panel gewählte Werte haben Vorrang.
