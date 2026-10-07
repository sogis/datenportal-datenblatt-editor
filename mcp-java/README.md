# Datenblatt MCP 0.2.0

Lokaler Spring-Boot-/Spring-AI-MCP-Server zum Erstellen und Nachführen von
Datenblättern nach `SO_AGI_DataCatalog_Datasheet_20260523` und
`SO_AGI_DataCatalog_Base_20260529`. Das LLM läuft im MCP-Client; der Server
stellt fachliche Werkzeuge, XTF-Verarbeitung und INTERLIS-Validierung bereit.

## Start

JDK **25** installieren und für den Start auswählen (beispielsweise mit
`sdk use java 25.0.3-tem`, sofern diese SDKMAN-Version installiert ist).
Die Gradle-Toolchain findet ein installiertes JDK 25 automatisch; der
direkte JAR-Aufruf verwendet dagegen das mit `java -version` angezeigte JDK.

Alle folgenden Gradle-Befehle im Verzeichnis `mcp-java` ausführen:

```sh
./gradlew check bootJar
# Standard: STDIO, der MCP-Client hält stdin offen.
java -jar build/libs/datasheet-mcp.jar
# HTTP für Open WebUI, Health und Browser-Downloads:
java -jar build/libs/datasheet-mcp.jar --spring.profiles.active=http
```

Wie `../interlis-mcp` verwendet das JAR standardmässig das Spring-Profil
`stdio`; das Docker-Image setzt `SPRING_PROFILES_ACTIVE=http`. Umschalten ist
über `--spring.profiles.active=stdio|http` oder `SPRING_PROFILES_ACTIVE` möglich.
Genau eines der beiden Profile verwenden.

| Einstellung | `stdio` | `http` |
|---|---|---|
| Web-Anwendung | `none`, kein HTTP-Port | `servlet` |
| MCP-Transport | stdin/stdout | `STREAMABLE`, `/mcp` |
| Health und Downloads | nicht verfügbar | `/actuator/health`, `/api/exports/{token}` |
| Export | `include_xml=true`, Client speichert XML | Download-Link, XML optional |

Für Entwicklung: `./gradlew bootRun` reicht stdin durch. Für HTTP:
`./gradlew bootRun --args='--spring.profiles.active=http'`. MCP-Clients starten
mit `java -jar` oder Docker; Gradle-Ausgaben sind kein MCP-Protokoll.

- HTTP: `http://127.0.0.1:8000/mcp`; Health: `http://127.0.0.1:8000/actuator/health`.
  `DATASHEET_HOST`, `DATASHEET_PORT` und `DATASHEET_PUBLIC_BASE_URL` gelten für HTTP.
- Beide Transporte sind synchron, mit Request-Timeout `1h`. Banner sind aus;
  Logs gehen auf stderr, standardmässig mit Niveau `WARN`.
- **HTTP-Transportänderung:** `STREAMABLE` ersetzt den bisherigen `STATELESS`-
  Betrieb. Clients müssen initialisieren, `notifications/initialized` senden,
  den ausgehandelten `MCP-Protocol-Version`- und `Mcp-Session-Id`-Header bei
  Folgeaufrufen verwenden und ihre Sitzung mit `DELETE /mcp` schliessen.
- Entwürfe bleiben anwendungsseitig im Speicher über `draft_id` adressiert.
  Alle Clients und MCP-Sitzungen dieses Prozesses teilen denselben Entwurfsraum;
  IDs und Sitzungen sind keine Benutzer-Zugriffskontrolle.
- Keine Benutzerverwaltung, Datenbank, API-Schlüssel oder dauerhafte
  Entwurfsspeicherung. Neustart verwirft Entwürfe; `discard_datasheet` gibt sie
  gezielt frei. Es gibt keine automatische Ablaufzeit.
- Bei EOF auf stdin schliesst der stdio-Prozess seinen Spring-Kontext und
  beendet sich. stdout enthält ausschliesslich JSON-RPC-Zeilen.

## Versionen und Aufbau

Java 25, Gradle 9.7.1 (Groovy), Spring Boot 4.1.1, Dependency-Management-Plugin
1.1.7, Spring AI 2.0.1 und MCP-SDK 2.0.1 (explizite BOM). INTERLIS: ilivalidator
1.15.0, iox-ili 1.24.4, iox-api 1.0.4, ili2c-core/-tool 5.6.8 und ehibasics 1.4.1.
Die Spring-/MCP-Versionen entsprechen dem Referenzprojekt;
INTERLIS-Abhängigkeiten entsprechen der ilivalidator-POM.

`mcp` registriert die zwölf Werkzeuge explizit mit `SyncToolSpecification`.
`model` enthält modellgebundene Datenknoten und den gemeinsamen Feldkatalog;
`service` verwaltet Entwürfe und Änderungen; `interlis` kapselt IOX und
ilivalidator; `config` hält den MCP-Protokollmapper getrennt vom fachlichen
JSON-Mapper. Fehlende Werte sind im Datenknoten darstellbar, ohne Pflichtwerte
zu erfinden. Es gibt keine Codegenerierung oder generische Modellplattform.

Die beiden Originalmodelle liegen in `src/main/resources/models/`. Sie werden
beim Start in ein temporäres Modellverzeichnis kopiert und mit ili2c kompiliert.
Validierung benötigt keine Netzwerkverbindung. Bei einem Modellfehler schlägt
der Start fehl. Neue Modellversionen erfordern eine bewusste Anpassung des
Feldkatalogs, Mappings und der Tests.

## Werkzeuge

| Werkzeug | Argumente |
|---|---|
| `describe_schema` | optional `kind`: dataset, series, issue, attribute, contact, temporal |
| `create_datasheet` | `kind`: dataset oder series; optional `values` mit Metadaten |
| `import_xtf` | `xml`: XTF-Text, genau ein Dataset oder eine Serie; optional `import_key` |
| `read_datasheet` | `draft_id` |
| `update_metadata` | `draft_id`, `expected_revision`, `values`; optional `issue_id` |
| `upsert_attribute` | `draft_id`, `expected_revision`, `values`; optional `issue_id`, `attribute_id` |
| `remove_attribute` | `draft_id`, `expected_revision`, `attribute_id`; optional `issue_id` |
| `upsert_issue` | `draft_id`, `expected_revision`, `values`; optional `issue_id` |
| `remove_issue` | `draft_id`, `expected_revision`, `issue_id` |
| `validate_datasheet` | `draft_id`, `expected_revision` |
| `export_xtf` | `draft_id`, `expected_revision`; `include_xml` (HTTP: Standard false; stdio: true erforderlich) |
| `discard_datasheet` | `draft_id`, `expected_revision` |

Ein neu erzeugter/importierter Entwurf hat Revision 1. Erstellen, Lesen und
Ändern liefern `draft_id`, `revision`, `kind`, `basket_id`, `object_id` und
`data`. Änderungen liefern zusätzlich `changes` mit Pfad sowie Vorher-/Nachherwert.
Listenänderungen werden als Änderung der betreffenden Liste ausgegeben.

Alle fachlichen JSON-Feldnamen verwenden `snake_case`, z.B. `data_type`,
`contact_point`, `creator_ref`. Die XTF-Feldnamen bleiben modellkonform.

### Beispiel: FOO ergänzen

Nach `import_xtf` oder `create_datasheet` die zurückgegebene ID einsetzen:

```json
{
  "draft_id": "<zurückgegebene draft_id>",
  "expected_revision": 1,
  "values": {
    "name": "FOO",
    "data_type": "Text",
    "description": "Flächenmass in Quadratmeter",
    "unit": "m²",
    "mandatory": false
  }
}
```

Dieses Argumentobjekt an `upsert_attribute` übergeben. `mandatory: false` ist
hier eine explizite Beispielangabe, kein Serverdefault. Wenn die fachliche
Vorgabe dazu fehlt, den Wert offen lassen und klären. Der Entwurf bleibt
bearbeitbar, aber bis zur Ergänzung nicht exportierbar.

Ohne `attribute_id` wird der exakte, gross-/kleinschreibungssensitive Name
gesucht. Kein Treffer legt an, genau ein Treffer aktualisiert, mehrere Treffer
liefern `ambiguous_match` mit Kandidaten. Mit `attribute_id` wird genau dieser
Eintrag geändert; eine unbekannte ID erzeugt keinen neuen Eintrag.
Ausgaben funktionieren entsprechend über `issue_id` oder `identifier`.
Interne IDs werden weder ins XTF geschrieben noch beim erneuten Import erhalten.

### Änderungen und unvollständige Entwürfe

- Ausgelassene Werte bleiben erhalten; `null` innerhalb von `values` löscht
  einen Feldwert, auch einen Pflichtwert im Entwurf.
- Optionale Werkzeugargumente wie `issue_id` weglassen, nicht als `null` senden.
- `contact_point` wird feldweise geändert; `temporal_coverage` vollständig
  ersetzt. Themen und Suchbegriffe ersetzen die jeweilige Liste.
- Attribute und Ausgaben über ihre eigenen Werkzeuge bearbeiten; sie sind
  nicht Teil von `create_datasheet.values` oder `update_metadata.values`.
- Keine automatische Serienvererbung, Titelableitung, Statusänderung oder
  Anpassung von `modified`. Solche Werte müssen ausdrücklich gesetzt werden.
- Vollständigkeits- und Modellprüfungen erfolgen mit `validate_datasheet`.
  Die MCP-Eingabeschemas verhindern zusätzlich falsche Typen, unbekannte
  Felder, nicht erlaubte Codes und überschrittene Textlängen.
- `creator_ref` ist im Modell ein Textfeld. Es erfolgt keine zusätzliche
  Suche oder Existenzprüfung in einem Office-Katalog.

## XTF und Validierung

Import mit `Xtf24Reader`, Erzeugung mit `XtfWriter`, Transferereignissen und
`IomObject` aus iox-ili. Basket- und Objekt-IDs werden erhalten. Neue Entwürfe
erhalten UUIDs; eine Änderung des fachlichen Identifikators ändert die TID nicht.

Eine strikte XML-Vorprüfung verhindert stilles Weglassen unbekannter Felder,
Namespaces, zusätzlicher Objekte oder nicht unterstützter Transferattribute.
DTD/externe Entitäten werden abgelehnt. Sowohl wiederholte Struktur-Wrapper
als auch mehrere Strukturen innerhalb eines Wrappers werden akzeptiert.

Für den bestehenden Editor teilt der Export die von iox-ili gruppierten
`attributes`-/`issues`-Wrapper in je einen Wrapper pro Eintrag auf. Dabei werden
nur XML-Knoten umgeordnet, keine Fachwerte oder XML-Schablonen erzeugt.
**Genau das resultierende XML** wird anschliessend mit ilivalidator geprüft.

`validate_datasheet` liefert `valid`, Revision und Meldungen. Meldungen enthalten
Schweregrad, Text und, soweit verfügbar, `object_id` und `model_element`.
Ein ungültiger Entwurf ist ein erfolgreicher Prüfaufruf mit `valid: false`.

Im HTTP-Profil liefert `export_xtf` nur bei erfolgreicher Validierung
`download_url`, `expires_at`, `file_name`, `draft_id`, Revision und Meldungen.
Mit `include_xml=true` kommt `xml` hinzu; der Standard bleibt `false`.

Im stdio-Profil ist **`include_xml=true` erforderlich**. Die Antwort enthält
`draft_id`, `revision`, `file_name`, `messages` und das validierte `xml`, ohne
`download_url` oder `expires_at`. Der Client speichert genau dieses XML als
UTF-8-Datei lokal. Ein fehlendes oder auf `false` gesetztes `include_xml` liefert
`isError: true`, `code: invalid_arguments` und einen Hinweis auf
`include_xml=true`, ohne einen Export zu erzeugen. Der Server schreibt keine
Exportdatei in das Dateisystem des Clients.

Bei Validierungsfehlern erhält der Client `isError: true` und
`validation_failed`. Fehlerhafte Argumente, unbekannte IDs, Mehrdeutigkeiten
und Revisionskonflikte liefern ebenfalls `isError: true`. Fehler aus dem
Werkzeughandler enthalten einen strukturierten `code`; die vorgeschaltete
MCP-SDK-Schemaprüfung kann Fehler als reinen Text zurückgeben.

Formatierung, Namespace-Präfixe und Header-Metadaten sind keine
Roundtrip-Garantie; fachliche Werte und Transfer-IDs bleiben erhalten.

## Parallelität

Ein `ConcurrentHashMap` verwaltet Entwürfe; je Entwurf schützt eine Sperre
Revisionsprüfung und Änderung. Änderungen werden erst nach erfolgreicher
Anwendung auf einer Kopie übernommen. Bei Konflikt bleibt der Entwurf
unverändert; erneut lesen und die beabsichtigte Änderung prüfen.

Lesen, Validieren und Exportieren verwenden tiefe Momentaufnahmen.
Ein Export darf während einer späteren Änderung noch die angeforderte frühere
Revision abschliessen; seine ausgewiesene Revision bezeichnet exakt den
exportierten Stand. Ein bereits gestarteter Export kann auch nach dem
Verwerfen des Entwurfs fertig werden.

INTERLIS-Aufrufe sind zusätzlich gemeinsam serialisiert, da ilivalidator
Listener am globalen EhiLogger registriert. Validatoren, Reader und Writer
werden pro Aufruf erzeugt; Listener und temporäre Validierungsdateien werden
im `finally`-Block entfernt. Metadatenänderungen anderer Entwürfe benötigen
diese globale Sperre nicht.

## Tests

```sh
./gradlew check bootJar
```

Die Tests prüfen fachliche Roundtrips, Pflichtwerte und Constraints,
Änderungssemantik, Mehrdeutigkeiten, parallele Revisionen und isolierte
Validierungen sowie die MCP-Verträge über HTTP und das gebaute JAR über stdio.
`check` enthält `test` und `e2eTest`; letzteres prüft zusätzlich Nullwerte,
genaue Revisionszahlen, grosse/parallele JSON-RPC-Antworten und EOF-Shutdown.
Testmodelle werden lokal geladen. Test-XTFs stammen aus dem Snapshot des
bestehenden Editors.

Zusätzlicher Test mit dem tatsächlichen TypeScript-Parser des Editors
(nach `npm ci` im Repository-Hauptverzeichnis und dem Gradle-Testlauf):

```sh
node scripts/check-editor.mjs
```

Die Java-Tests erzeugen dafür Dateien unter `build/interop/`.

Smoke-Test eines gestarteten JARs:

```sh
python3 scripts/smoke.py
```

Optional eine andere Basisadresse als Argument übergeben.

## Docker und Veröffentlichung

Aus `mcp-java`:

```sh
docker build -t datasheet-mcp .
# HTTP ist im Image der Standard.
docker run --rm -p 127.0.0.1:8000:8000 datasheet-mcp
# STDIO: stdin offen halten, kein -t und keine Portfreigabe.
docker run --rm -i -e SPRING_PROFILES_ACTIVE=stdio datasheet-mcp
```

Das Image enthält den Java-MCP und läuft als unprivilegierter Benutzer mit
Java 25. Datenbank und persistente Entwurfs-Volumes sind nicht erforderlich.
Das bestehende Editor-Image enthält weiterhin die Weboberfläche.

Der eigene Workflow `.github/workflows/publish-mcp-container.yml` prüft bei
Push, Pull Request und manuellem Start Java, beide Transporte und den echten
Editor-Parser. Er baut `linux/amd64` und `linux/arm64` mit demselben bereits
getesteten JAR (Docker-Target `canonical`), prüft HTTP, offline stdio, grosse
parallele Antworten, EOF und die Originalmodelle auf beiden Architekturen.
Auf amd64 prüft er zusätzlich Originalanhänge mit Open WebUI 0.11.3.
Er veröffentlicht anschliessend bei Push oder manuellem Start exakt die
geprüften Images, ohne sie erneut zu bauen, auf:

- Docker Hub: `sogis/datenportal-datenblatt-mcp`
- GHCR: `ghcr.io/sogis/datenportal-datenblatt-mcp`

Tags: `0.2.<github.run_number>`, `sha-<kurzer-commit-sha>` und `latest` nur auf
dem Default-Branch. Multiarch-Manifeste werden vor dem Setzen der SHA-/latest-
Tags auf beide Plattformen geprüft. Docker Hub verwendet die bestehenden
Secrets `DOCKERHUB_USERNAME` und `DOCKERHUB_TOKEN`; GHCR nutzt `GITHUB_TOKEN`.
Der Webeditor-Workflow und seine Registries bleiben erhalten.

Lokale Prüfungen des CI-Targets (JDK 25 auch für den Modellcompiler auswählen):

```sh
./gradlew check bootJar
docker build --target canonical -t datasheet-mcp:verified .
python3 scripts/check-image.py --image datasheet-mcp:verified
python3 scripts/check-openwebui.py --image datasheet-mcp:verified
```

Die Skripte verwenden eigene wegwerfbare Container und Netzwerke und räumen
sie anschliessend auf. Es werden keine bestehenden Open-WebUI-Instanzen geändert.

### Originalmodelle ohne Editor-Checkout übernehmen

Das Image enthält beide unveränderten Originalmodelle zusätzlich unter
`/app/models`. Sie stammen aus denselben Quellen wie die JAR-Ressourcen und
enthalten auch das Office-Modell im Basismodell. Externe Office-Prüfung und
ilivalidator benötigen weiterhin lokale `.ili`-Dateien.

Serverstart und Modellübernahme müssen **denselben festgelegten Image-Digest**
verwenden. Beispiel nach Veröffentlichung, Digest durch den ausgewählten Wert
ersetzen (kein `latest` für einen reproduzierbaren Integratorlauf):

```sh
DATASHEET_IMAGE='sogis/datenportal-datenblatt-mcp@sha256:<digest>'
mkdir -p ./models/datasheet
MODEL_CONTAINER=$(docker create "$DATASHEET_IMAGE")
docker cp "$MODEL_CONTAINER:/app/models/." ./models/datasheet/
docker rm "$MODEL_CONTAINER"
docker run --rm -i -e SPRING_PROFILES_ACTIVE=stdio "$DATASHEET_IMAGE"
```

Der Container muss zum Kopieren nicht laufen. Im Themenintegrator anschliessend
beispielsweise `model_dirs = ["./models/datasheet"]` statt eines Editor-Checkout-
Pfads verwenden. Für den MCP-Start wird `docker` mit den oben gezeigten Argumenten
benötigt; die Anpassung seines Adapters erfolgt separat im Integratorprojekt.
XTF weiterhin mit `include_xml=true` exportieren und clientseitig lokal speichern.
Browser-Downloadlinks benötigen das Profil `http` und eine erreichbare öffentliche
Basisadresse.

Für die lokale Open-WebUI-Demo siehe [OPENWEBUI-DEMO.md](OPENWEBUI-DEMO.md).

## Open WebUI 0.11.3: XTF-Anhang importieren und herunterladen

Für eine vorkonfigurierte Demoinstanz (Compose, Provider, Modelle und
automatisch registrierter MCP-Toolserver) siehe
[`OPENWEBUI-DEMO.md`](OPENWEBUI-DEMO.md). Die folgenden Schritte beschreiben
die manuelle Einrichtung in einer bestehenden Open-WebUI-Installation.

Die installierbare Datei ist [openwebui/xtf_import.py](openwebui/xtf_import.py).
Sie läuft als Workspace Tool im vorhandenen Open-WebUI-Prozess. Es ist keine
Filter Function, kein zusätzlicher Container und keine Paketinstallation nötig.
Die Abhängigkeiten Pydantic und Python-MCP-SDK sind in Open WebUI 0.11.3 vorhanden.

1. In **Workspace → Tools** ein neues Tool anlegen, den vollständigen Inhalt
   von `openwebui/xtf_import.py` einfügen und speichern.
2. Unter den Tool-Einstellungen (*Valves*) setzen:
   - `MCP_URL`: aus dem Open-WebUI-Prozess erreichbare Streamable-HTTP-Adresse
     des Java-Servers, inklusive `/mcp`.
   - `INSTANCE_ID`: stabile Kennung dieser Installation, Standard `openwebui`;
     bei mehreren Open-WebUI-Installationen unterschiedlich setzen.
   - `TIMEOUT_SECONDS`: standardmässig 60 Sekunden für Dateizugriff und Import.
3. Den Java-Server zusätzlich unter **Admin → Integrations → External Tool
   Servers** als **MCP (Streamable HTTP)** registrieren, für lokalen Betrieb
   mit Authentisierung **None**. Beide Einbindungen müssen dieselbe Instanz nutzen.
4. Python-Tool und MCP-Werkzeuge im Chat aktivieren oder unter
   **Workspace → Models → Tools** zuordnen. Benutzern Leserechte auf das Tool geben.
5. Für dieses Modell **Native Function Calling** und **File Upload** aktivieren,
   **File Context** deaktivieren. Damit gelangt kein extrahierter XTF-Inhalt als
   Dokumentenkontext ins Modell. Eine eventuell gesetzte Upload-Allowlist muss
   `.xtf` und `.xml` erlauben. Nicht „Use Entire Document“ für den Anhang wählen.
   Open WebUI verarbeitet Dateien bereits beim Upload, unabhängig von File Context.
   Wenn für diese XTF-Installation kein Embedding-Modell betrieben wird, unter
   **Admin → Settings → Documents** „Bypass Embedding and Retrieval“ aktivieren
   (alternativ initial `BYPASS_EMBEDDING_AND_RETRIEVAL=true`). Diese Einstellung
   ist instanzweit; in einer bestehenden RAG-Installation stattdessen deren
   funktionierende Upload-/Embedding-Konfiguration beibehalten. File Context bleibt aus.
6. Einen gespeicherten Chat verwenden, `src/test/resources/dataset.xtf` anhängen
   und schreiben: „Importiere die angehängte XTF und ergänze FOO als Text mit
   Beschreibung Flächenmass in Quadratmeter; FOO ist kein Pflichtattribut.“
7. „Exportiere das Datenblatt“ führt über `export_xtf` zur ilivalidator-Prüfung.
   Den zurückgegebenen Link im Chat anklicken, um die geprüfte Datei herunterzuladen.

`import_xtf_attachment(file_id?)` wählt ohne ID genau einen XTF/XML-Anhang aus.
Bei mehreren Kandidaten liefert es Namen und IDs zur Auswahl, ohne zu importieren.
Eine explizite ID muss zum Chat-Anhang gehören. Das Tool prüft den angemeldeten
Benutzer und dessen Open-WebUI-Dateirechte, liest den Originalinhalt aus dem
Dateispeicher und akzeptiert UTF-8 einschliesslich BOM. Andere Kodierungen werden
abgelehnt. Extrahierter Text und RAG-Daten werden nicht verwendet.

Das Tool gibt nur Dateiname, Entwurfs-ID, aktuelle Revision, Typ, Titel und
`reused` zurück. Anschliessend kann das Modell gezielt mit den MCP-Werkzeugen
arbeiten; es muss weder XML kopieren noch die Datei erneut erzeugen.

### Interne Adresse und Browseradresse

Die beiden Adressen erfüllen unterschiedliche Aufgaben:

| Einstellung | Beispiel bei gemeinsamem Docker-Netz |
|---|---|
| Python-Valve `MCP_URL` | `http://datasheet-mcp:8000/mcp` |
| Open-WebUI-MCP-Verbindung | `http://datasheet-mcp:8000/mcp` |
| Java `DATASHEET_PUBLIC_BASE_URL` | `http://localhost:8000` (vom Browser erreichbar) |

`datasheet-mcp` ist dabei der beispielhafte Docker-Service-Name. Beim Java-Server
auf dem Mac-Host kann Open WebUI `http://host.docker.internal:8000/mcp` verwenden;
der Java-Server muss dafür mit `DATASHEET_HOST=0.0.0.0` erreichbar sein.
`localhost` innerhalb des Open-WebUI-Containers bezeichnet diesen Container selbst.

`DATASHEET_PUBLIC_BASE_URL` hat den Standard `http://127.0.0.1:8000` und kann auch
eine Reverse-Proxy-Adresse mit Pfadpräfix enthalten. Bei anderem veröffentlichtem
Port entsprechend setzen. Der Proxy muss `/api/exports/` zum Java-Server leiten.
Der Download ist ein normaler Browser-Link; es ist keine CORS-Freigabe erforderlich.

### Wiederholte Importe

Das Python-Tool erzeugt `import_key` aus Instanz, Benutzer, Chat, Datei-ID und
SHA-256 der Originalbytes. Java hält eine atomare Zuordnung zum Entwurf und prüft
zusätzlich die Inhaltsprüfsumme. Wiederholte oder parallele Aufrufe erzeugen keinen
zweiten Entwurf und überschreiben keine Bearbeitung. Die Antwort enthält `reused`
und die aktuelle Revision. Derselbe Schlüssel mit anderem Inhalt liefert
`import_conflict`. Ohne Schlüssel legt `import_xtf` weiterhin einen neuen Entwurf an.

Fehlgeschlagene Importe reservieren keinen Schlüssel. Nach Verwerfen oder
Java-Neustart ist ein erneuter Import möglich und liefert eine neue Entwurfs-ID.
Diese Zuordnung ist keine Benutzer-Zugriffskontrolle im weiterhin lokalen Java-Server.

### Download-Lebensdauer

`GET /api/exports/{token}` liefert eine unveränderliche Kopie der bereits validierten
UTF-8-Bytes mit Dateiname, `application/xml; charset=UTF-8`, `Content-Disposition:
attachment` und `Cache-Control: no-store`. Jeder Export erhält einen zufälligen Token.

Der Link gilt eine Stunde ab Export, auch nach weiteren Änderungen oder Verwerfen
des Entwurfs. Serverneustart entfernt ihn früher. Unbekannte und abgelaufene Tokens
liefern HTTP 404. Beim Abruf und zusätzlich einmal pro Minute wird der Ablauf geprüft
beziehungsweise aufgeräumt. Wer den Link kennt und den Server erreicht, kann die Datei
während dieser Zeit laden. Das Modell soll den Link unverändert als Markdown-Link
anzeigen. Es gibt keine dauerhaft gespeicherten Exportdateien.

### Tests des Open-WebUI-Tools

Die Python-Unit-Tests benötigen Pydantic; im Open-WebUI-Container ist es vorhanden:

```sh
python -m unittest discover -s openwebui/tests -p 'test_*.py' -v
```

`openwebui/tests/integration_openwebui.py` ist ein expliziter Integrationstest für
**eine frische, wegwerfbare Open-WebUI-0.11.3-Instanz**. Er legt einen Test-Admin,
ein Workspace Tool, eine hochgeladene Originaldatei und einen gespeicherten Chat an.
Er deaktiviert Embeddings in dieser Testinstanz und verwendet den normalen
Upload mit Textextraktion. Er benutzt den echten Open-WebUI-Tool-Resolver/-Executor und danach MCP zur Änderung
und zum Download. Er testet kein LLM und braucht keine Provider-Schlüssel.

Beispiel (aus `mcp-java`, Docker Desktop, freie Ports 18080 und 18081):

```sh
./gradlew check bootJar
java -jar build/libs/datasheet-mcp.jar --spring.profiles.active=http --server.address=0.0.0.0 --server.port=18080 \
  --datasheet.public-base-url=http://127.0.0.1:18080
```

In einem zweiten Terminal:

```sh
docker run -d --name datasheet-openwebui-test -p 127.0.0.1:18081:8080 \
  --tmpfs /app/backend/data -e WEBUI_SECRET_KEY=disposable-test-only \
  -e OFFLINE_MODE=true -e ENABLE_OLLAMA_API=false \
  -e RAG_EMBEDDING_MODEL_AUTO_UPDATE=false \
  ghcr.io/open-webui/open-webui:v0.11.3
# Warten, bis der Container healthy ist.
docker cp openwebui datasheet-openwebui-test:/tmp/datasheet-openwebui
docker cp src/test/resources/dataset.xtf datasheet-openwebui-test:/tmp/dataset.xtf
docker exec datasheet-openwebui-test python -m unittest discover \
  -s /tmp/datasheet-openwebui/tests -p 'test_*.py' -v
docker exec -e PYTHONPATH=/app/backend datasheet-openwebui-test python \
  /tmp/datasheet-openwebui/tests/integration_openwebui.py
docker rm -f datasheet-openwebui-test
```

Bei Bedarf sind `OPENWEBUI_URL`, `DATASHEET_TEST_MCP_URL` und `DATASHEET_TEST_XTF`
für das Testskript konfigurierbar. Für den Download-Test wird die öffentliche
Loopback-Adresse von Port 18080 innerhalb des Containers auf den Docker-Host umgesetzt.
