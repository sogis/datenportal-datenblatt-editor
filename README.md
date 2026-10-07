# datenblatt-editor

Lokaler, vollständig offline-fähiger Metadateneditor für genau ein `Dataset` oder eine `DatasetSeries` pro XTF/XML-Datei.

Die Anwendung ist als clientseitige SPA umgesetzt. Es gibt kein Backend, keine Anmeldung und keine Server-Persistenz. Alle Arbeitsstände bleiben lokal im Browser und werden in IndexedDB gespeichert.

## Funktionsumfang des MVP

- Bearbeitung einzelner `Dataset`
- Bearbeitung hierarchischer `DatasetSeries` mit Serienkopf und Ausgaben
- Import von XTF/XML-Dateien für `Dataset` und `DatasetSeries`
- Offline-"Endpunkte" über gebündelte Snapshot-Dateien
- Lokale Entwürfe in IndexedDB
- Debounced Autosave
- Fachliche und strukturelle Validierung
- Export als XTF 2.4
- Installierbare PWA

Nicht Teil der aktuellen Ausbaustufe:

- Materialisierung einzelner `DatasetIssue` als getrennte `Dataset`
- Serien-Wizard für Bulk-Operationen
- Backend-Einreichung
- Login
- CSV-Analyse
- LLM-Integration

## Technologie-Stack

- Vue 3
- Vite
- TypeScript
- Pinia
- Vue Router
- Dexie
- AJV
- vite-plugin-pwa
- Vitest
- Playwright

Die aktuelle UI ist an der reduzierten, hellen Jenkins-Anmutung orientiert: feine Borders, kleine Radien, rote Primäraktionen, kompakte Werkzeugleisten.

## Schnellstart

### Voraussetzungen

- Node.js 22 empfohlen
- npm 10 empfohlen

Die Implementierung wurde lokal mit Node `22.13.0` und npm `10.9.2` verifiziert.

### Installation

```bash
npm install
```

### Entwicklungsserver

```bash
npm run dev
```

Danach ist die App standardmässig unter `http://localhost:5173` verfügbar.

### Produktionsbuild

```bash
npm run build
```

Der gebaute Stand liegt danach unter `dist/`.

### Dockerimage

Das produktive Image baut die Anwendung und liefert den Inhalt von `dist/` über
NGINX auf Port `8080` aus. Das Runtime-Image läuft unprivilegiert und benötigt
kein Backend.

Das Image wird prefix-neutral gebaut. Die relativen URLs funktionieren direkt
unter `/` und hinter dem bestehenden API-Gateway auch unter einem öffentlichen
Prefix:

```bash
docker build --build-arg VITE_BASE_PATH=./ -t datenblatt-editor:local .
docker run --rm --user 12345:0 -p 8080:8080 datenblatt-editor:local
```

Lokal liefert der Container die Anwendung direkt unter
`http://localhost:8080/` aus. Produktiv entfernt der Gateway den öffentlichen
Prefix vor der Weiterleitung und setzt `X-FORWARDED-PREFIX`; NGINX erzeugt
daraus zur Laufzeit den passenden HTML-Base-Pfad. Das gleiche Image kann damit
beispielsweise unter `/metadaten-editor/` betrieben werden. Die vollständige
Gateway-Konfiguration steht in
[docs/container-deployment.md](docs/container-deployment.md).

`VITE_BASE_PATH=./` ist deshalb der produktive Build-Wert. Der öffentliche
Prefix wird nicht in das Image einprogrammiert.

### GitHub Action und Container-Registries

Der Workflow
[publish-container.yml](.github/workflows/publish-container.yml) führt bei jedem
Push zuerst `npm ci`, `npm test` und `npm run build` aus. Anschliessend wird das
Image gebaut und veröffentlicht auf:

- Docker Hub: `sogis/datenportal-datenblatt-editor`
- GHCR: `ghcr.io/<github-owner>/<github-repository>`

Das veröffentlichte Image ist ein Multiarch-Image für `linux/amd64` und
`linux/arm64`. Docker wählt beim Pull automatisch die passende Architektur.
Die Plattformen können beispielsweise mit folgendem Befehl geprüft werden:

```bash
docker buildx imagetools inspect sogis/datenportal-datenblatt-editor:latest
```

Für Docker Hub müssen im GitHub-Repository die Secrets `DOCKERHUB_USERNAME` und
`DOCKERHUB_TOKEN` hinterlegt werden. GHCR verwendet den automatisch verfügbaren
`GITHUB_TOKEN`.

Jeder erfolgreiche Workflow-Lauf erzeugt zusätzlich einen Versionstag wie
`0.1.42`. Die Nummer basiert auf `github.run_number`; Git-Tags und
`package.json` bestimmen die Container-Version nicht.
Zusätzlich werden ein `sha-<kurzer-commit-sha>`-Tag und auf dem Default-Branch
`latest` veröffentlicht.

Der Codeberg-Spiegel muss die Commits nach GitHub pushen. Dadurch wird der
GitHub-Workflow automatisch ausgelöst. Die Tag-Strategie und die vollständige
Einrichtung sind in
[docs/container-deployment.md](docs/container-deployment.md) beschrieben.

### Lokale Vorschau des Produktionsbuilds

```bash
npm run preview
```

### Tests

```bash
npm test
npm run test:e2e
```

Hinweis zu Playwright:

- Wenn lokal noch kein Browser installiert ist, kann ein zusätzlicher Schritt nötig sein:

```bash
npx playwright install
```

## Skripte

| Skript | Zweck |
| --- | --- |
| `npm run dev` | Lokaler Entwicklungsserver |
| `npm run build` | Typecheck + Produktionsbuild |
| `npm run preview` | Vorschau des Produktionsbuilds |
| `npm test` | Unit- und Komponenten-Tests mit Vitest |
| `npm run test:e2e` | Playwright-Smoke-Test gegen lokale App |

## Projektstruktur

```text
src/
  app/          App-Shell und Routing
  components/   UI-Komponenten und Dialoge
  config/       Quellen- und Vokabular-Konfiguration
  domain/       Typen, Normalisierung, Validierung
  services/     Import, Export, Offline-Quellen, IndexedDB
  stores/       Pinia-Store für App- und Draft-State
  styles/       Tokens und Jenkins-inspirierte Styling-Layer

public/
  icons/        PWA-Icons
  mock-sources/ Offline-Snapshot-Daten für Quellen

e2e/            Playwright-Smoke-Test
docs/           Entwickler- und Betreiberdokumentation
spec/           Eingangsspezifikation und Mockups
```

## Java-MCP

Der separate [Datenblatt-MCP](mcp-java/README.md) unterstützt stdio und Streamable
HTTP über Spring-Profile. Sein eigenes Docker-Image enthält auch die Originalmodelle
für externe Validierung; der Webeditor bleibt eine clientseitige Anwendung.

## Dokumentation

- [Architektur](docs/architecture.md)
- [Entwicklung](docs/development.md)
- [Betrieb und Deployment](docs/operations.md)
- [Container-Deployment](docs/container-deployment.md)

## Architektur in Kurzform

- Die Startseite bietet Ladewege für Quellen, Dateiimport, neue Einzel-Datasets, neue Serien und lokale Entwürfe.
- Jeder erfolgreich übernommene Eintrag wird in ein kanonisches Root-Format für `Dataset` oder `DatasetSeries` normalisiert.
- Entwürfe werden unter der Dexie-Datenbank `datenblatt-editor` gespeichert.
- Formularänderungen werden mit `750 ms` Debounce nach IndexedDB geschrieben.
- Der Export ist bei Validierungsfehlern blockiert.
- Die PWA cached App-Shell, Assets und die gemockten XTF-Snapshots für kompletten Offline-Betrieb.

## Quellenmodell im MVP

Ohne abweichende Konfiguration verwendet die App einen ausgelieferten XTF-Snapshot:

```text
public/mock-sources/dataset.index.xtf
```

Zusätzlich wird der Datenherr-Katalog als XTF mit ausgeliefert:

```text
public/mock-sources/offices.xtf
```

Diese gebündelten Quellen stehen nach dem ersten erfolgreichen Laden offline
zur Verfügung. Änderungen **gebündelter** Quellen benötigen einen neuen Build
und ein neues Deployment. Remote-XTF und Manifestquellen werden dagegen beim
Laden aktuell abgerufen; neue Inhalte unter derselben Adresse benötigen keinen
neuen App-Build.

## Veröffentlichte Datenblattsammlung

`VITE_METADATA_SOURCE_URL` kann beim Vite-/Docker-Build eine öffentliche
`current.json` als Standardquelle setzen. Der Quellenlader unterstützt sowohl
Manifest-URLs (Pfad endet auf `.json`) als auch direkte XTF-Adressen. Er liest
den Verweis einmal und lädt dessen `datasheets`-Datei; `catalog: null` ist zulässig.
Ungültige Verweise oder fehlende Dateien werden als Fehler angezeigt und nicht
durch einen veralteten Snapshot ersetzt. Der Abruf verwendet `cache: no-store`;
Remote-Verweise werden vom Service Worker nicht vorab gespeichert.
Lokale Entwürfe, Dateiimporte und gebündelte Offline-Quellen bleiben erhalten.
Es werden keine S3-Zugangsdaten im Browser benötigt.
Die im Quellen-Dialog gespeicherte Adresse hat Vorrang vor dem Builddefault.
Nach Umstellung eines Deployments dort die Quelle gezielt ändern; lokale
Entwürfe dafür nicht löschen. Konfiguration und CORS sind in
[Betrieb](docs/operations.md#quellen-konfigurieren) und
[Container-Deployment](docs/container-deployment.md#quellenadresse-beim-build) beschrieben.

## Datenhaltung

Lokale Entwürfe werden in IndexedDB gehalten. Es gibt zwei Stores:

- `datasets`
- `settings`

`datasets` speichert den kompletten Draft inklusive Herkunftsinformationen und dem internen Objektmodell. `settings` speichert zuletzt verwendete URL und Filter für den Quellen-Dialog.

## Validierung

Die App verwendet zwei Ebenen:

1. Strukturvalidierung
2. Fachliche Validierung

Geprüft werden unter anderem:

- Root `type === "Dataset"` oder `type === "DatasetSeries"`
- Pflichtfelder
- Datumsformat
- bei Issues `modified >= issued`
- gültiger `temporalCoverage`
- doppelte Attributnamen
- Warnung bei Attributen ohne Beschreibung

## Wichtige Betriebsgrenzen

- Kein Mehrbenutzerbetrieb
- Keine Synchronisation zwischen Browsern
- Kein automatisches Backup ausserhalb des Browsers
- Remote-Quellen benötigen öffentliche HTTP(S)-Zugriffe und gegebenenfalls CORS

## Weiterentwicklung

Die wichtigsten Erweiterungspunkte sind:

- kontrollierte Vokabulare aus externer Konfiguration
- stärkere Formularsegmentierung
- weitere E2E-Szenarien
- konfigurierbare Feldverteilung zwischen Serienkopf und Ausgaben
