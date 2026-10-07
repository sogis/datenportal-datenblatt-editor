# Open WebUI Demo für den Datenblatt-MCP

Diese Anleitung richtet eine lokale Open-WebUI-Instanz für den
Datenblatt-Editor-MCP ein. Der Java-MCP wird weiterhin direkt auf dem Host
mit `java -jar` gestartet; Docker wird nur für Open WebUI verwendet. Die
Konfiguration orientiert sich an der Agentic-BI-Demo unter
`agentic-bi-lab/demo-001/mcp-java`, nutzt aber eigene Ports, ein eigenes
Compose-Projekt und ein eigenes Volume.

Alle Befehle werden im Verzeichnis `mcp-java` ausgeführt.

## Architektur

```text
Browser (Host)
   │  http://127.0.0.1:3001
   ▼
Open WebUI (Docker, Compose-Projekt datenblatt-demo)
   │  MCP Streamable HTTP
   │  http://host.docker.internal:8001/mcp
   ▼
Datenblatt-MCP (Java auf dem Host, DATASHEET_PORT=8001)
```

| Bestandteil | Adresse | Betrieb |
|---|---|---|
| Open WebUI | `http://127.0.0.1:3001` | Docker Compose |
| Datenblatt-MCP | `http://127.0.0.1:8001/mcp` | `java -jar` auf dem Host |
| Health des MCP | `http://127.0.0.1:8001/actuator/health` | `java -jar` auf dem Host |
| Export-Download | `http://127.0.0.1:8001/api/exports/...` | Browser-Link |

Der Java-Server bindet mit `DATASHEET_HOST=0.0.0.0` an alle Interfaces, damit
der Open-WebUI-Container ihn über `host.docker.internal` erreicht. Die
öffentliche Download-Basis bleibt `http://127.0.0.1:8001`, weil der Link im
Browser des Hosts geöffnet wird.

## Voraussetzungen

- JDK 25 (siehe `README.md`)
- Docker Desktop mit Compose v2
- Freie Ports 3001 (Open WebUI) und 8001 (Java-MCP)
- Die Provider-Schlüssel für Infomaniak und DeepSeek (siehe `.env`)

## Einmalige Einrichtung

### 1. `.env` anlegen

```sh
cp .env.example .env
```

Werte in `.env` prüfen und anpassen:

| Variable | Bedeutung | Standard |
|---|---|---|
| `OPEN_WEBUI_HOST_PORT` | Host-Port der Oberfläche | `3001` |
| `OPENWEBUI_ADMIN_NAME` | Anzeigename des Admin-Kontos | `Admin` |
| `OPENWEBUI_ADMIN_EMAIL` | Login-E-Mail des Admin-Kontos | `admin@example.com` |
| `OPENWEBUI_ADMIN_PASSWORD` | Login-Passwort; wird beim ersten Seed-Lauf gesetzt | – |
| `OPENWEBUI_INSTANCE_ID` | Stabile Kennung dieser Installation für den XTF-Import | `datenblatt-openwebui` |
| `DATASHEET_MCP_PORT` | Host-Port des Java-MCP | `8001` |
| `OPENWEBUI_MODEL_BASE` | Basismodell des Datenblatt-Modells | `Qwen/Qwen3.5-397B-A17B-FP8` |
| `INFOMANIAK_API_KEY` | Schlüssel für Infomaniak AI Tools | – |
| `DEEPSEEK_API_KEY` | Schlüssel für die DeepSeek-API | – |

Die Datei `.env` ist gitignoriert. Das aktuelle Passwort steht im Klartext
darin, zum Beispiel:

```sh
grep OPENWEBUI_ADMIN_PASSWORD .env
```

### 2. Java-MCP bauen und starten

```sh
./gradlew check bootJar
```

In einem eigenen Terminal läuft der Server während der ganzen Demo:

```sh
DATASHEET_HOST=0.0.0.0 \
DATASHEET_PORT=8001 \
DATASHEET_PUBLIC_BASE_URL=http://127.0.0.1:8001 \
java -jar build/libs/datasheet-mcp.jar --spring.profiles.active=http
```

Der MCP muss für das Seeding laufen: Das Script prüft seinen Health-Endpunkt,
und Open WebUI lädt die Werkzeugliste der gespeicherten Verbindung bei jeder
Chat-Anfrage.

### 3. Open WebUI starten

```sh
docker compose up -d
docker compose ps
```

Beim ersten Start dauert es einige Sekunden, bis die Oberfläche unter
`http://127.0.0.1:3001` erreichbar ist.

### 4. Open WebUI konfigurieren (Seeding)

```sh
python3 scripts/seed-openwebui.py
```

Das Script ist idempotent und kann jederzeit erneut ausgeführt werden. Es

1. prüft den Health-Endpunkt des Java-MCP,
2. wartet auf Open WebUI,
3. legt beim ersten Lauf das Admin-Konto an beziehungsweise meldet sich mit
   den Werten aus `.env` an,
4. setzt Provider, MCP-Verbindung, Workspace-Tool, Modell und Einstellungen.

Danach ist die Demo einsatzbereit: `http://127.0.0.1:3001` öffnen und mit
`OPENWEBUI_ADMIN_EMAIL` / `OPENWEBUI_ADMIN_PASSWORD` anmelden.

## Starten und Stoppen im Alltag

```sh
# Terminal 1: MCP (aus mcp-java)
DATASHEET_HOST=0.0.0.0 \
DATASHEET_PORT=8001 \
DATASHEET_PUBLIC_BASE_URL=http://127.0.0.1:8001 \
java -jar build/libs/datasheet-mcp.jar --spring.profiles.active=http

# Terminal 2: Open WebUI
docker compose up -d        # starten
docker compose logs -f open-webui   # Logs verfolgen
docker compose stop         # anhalten, Volume bleibt erhalten
docker compose down         # entfernen, Volume bleibt erhalten
docker compose down -v      # entfernen und Konfiguration/Logins verwerfen
```

Nach einem Neustart von Open WebUI ist kein erneutes Seeding nötig; die
Konfiguration liegt im Volume `datenblatt-open-webui-data`. Nur wenn der
Java-MCP auf einem anderen Port läuft oder `.env` geändert wurde, das
Seed-Script erneut ausführen.

## Was automatisch konfiguriert wird

Provider (Admin → Settings → Connections), identisch zur Agentic-BI-Demo:

| Verbindung | Base-URL | Status |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | aus |
| Infomaniak AI Tools | `https://api.infomaniak.com/2/ai/103965/openai/v1` | an |
| DeepSeek | `https://api.deepseek.com` | an |
| Ollama | `http://host.docker.internal:11434` | aus |

Modell-Sichtbarkeit wie in der Agentic-BI-Demo:

- aktiv: `swiss-ai/Apertus-v1.5-70B`, `Qwen/Qwen3.5-397B-A17B-FP8`
- ausgeblendet: `Qwen/Qwen3-Embedding-8B`, `bge_multilingual_gemma2`,
  `mini_lm_l12_v2`, `mistralai/Ministral-3-14B-Instruct-2512`,
  `mistralai/Mistral-Small-4-119B-2603`,
  `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8`
- Workspace-Modell `Datenblatt-Editor – Kanton Solothurn`
  (Basis `Qwen/Qwen3.5-397B-A17B-FP8`, Temperatur 0.1, Native Function Calling,
  Thinking deaktiviert, System-Prompt aus `openwebui/system-prompt.md`,
  Vorschlagsfragen aus `openwebui/demo-prompts.md`). Das Basismodell lässt
  sich über `OPENWEBUI_MODEL_BASE` in `.env` ändern; alternativ stehen
  `moonshotai/Kimi-K2.6` oder `swiss-ai/Apertus-v1.5-70B` bereit. Bei Kimi
  K2.6 streamt der Infomaniak-Endpunkt die Antwort nach Werkzeugaufrufen im
  Reasoning-Kanal, wodurch Open WebUI keinen Antworttext anzeigt; Qwen3.5
  liefert hier stabile Antworten.

Werkzeuge:

| Einbindung | Wert |
|---|---|
| MCP-Toolserver (`server:mcp:datasheet_mcp`) | `http://host.docker.internal:8001/mcp`, Authentisierung None, Leserecht für alle |
| Workspace-Tool `xtf_import` | Quelle `openwebui/xtf_import.py`, Valve `MCP_URL=http://host.docker.internal:8001/mcp`, `INSTANCE_ID=datenblatt-openwebui`, Timeout 60 s |

Einstellungen:

- `ENABLE_FOLLOW_UP_GENERATION=False` (Compose),
- File Upload und Native Function Calling für das Modell aktiv, File Context
  aus,
- `rag.bypass_embedding_and_retrieval=true`, damit XTF-Anhänge ohne
  Embedding-Modell hochgeladen werden können,
- `custom.css` wie in der Agentic-BI-Demo eingebunden.

Die Einbindung kann jederzeit manuell geprüft werden unter
**Admin → Integrations → External Tool Servers** (`datasheet_mcp`) und
**Workspace → Tools** (`xtf_import`).

## Demo-Ablauf

1. `http://127.0.0.1:3001` öffnen und anmelden.
2. Im Chat oben das Modell **Datenblatt-Editor – Kanton Solothurn** wählen.
3. Einen gespeicherten Chat anlegen, `src/test/resources/dataset.xtf`
   anhängen und schreiben:
   *«Importiere die angehängte XTF-Datei und fasse den Entwurf zusammen.»*
4. Danach die Fragen aus `openwebui/demo-prompts.md` verwenden, zum Beispiel:
   *«Ergänze im aktuellen Entwurf das Attribut FOO als Text mit der
   Beschreibung ‹Flächenmass in Quadratmeter›. FOO ist kein
   Pflichtattribut.»*
5. *«Exportiere das Datenblatt»* führt über `export_xtf` und ilivalidator
   zum Download-Link. Der Link ist eine Stunde gültig und wird unverändert
   als Markdown-Link angezeigt.

Wichtig: Der XTF-Anhang wird über das Workspace-Tool gelesen, nicht als
Dokumentenkontext. Deshalb File Context nicht einschalten und nicht
«Use Entire Document» wählen. Die ausführlichen manuellen Hinweise stehen
weiterhin im Abschnitt «Open WebUI 0.11.3» der `README.md`.

## Koexistenz mit der Agentic-BI-Demo

Beide Demos können parallel laufen. Sie teilen sich keine Container, Volumes
oder Ports:

| Ressource | Agentic-BI-Demo | Datenblatt-Demo |
|---|---|---|
| Compose-Projekt | `openwebui-demo1` | `datenblatt-demo` (in `docker-compose.yml`) |
| Open-WebUI-Port | 3000 | 3001 |
| MCP-Port auf dem Host | 8000 (Compose-Container) | 8001 (Java auf dem Host) |
| Volume | `openwebui-demo1_open-webui-data` | `datenblatt-open-webui-data` |
| Container-Name | `openwebui-demo1-open-webui-1` | `datenblatt-demo-open-webui-1` |
| `INSTANCE_ID` des XTF-Tools | `openwebui` (Standard) | `datenblatt-openwebui` |

Beide Instanzen verwenden dieselben Infomaniak-/DeepSeek-Schlüssel und
teilen damit Kontingent und Kosten. Die MCP-Verbindungen sind getrennt:
Die Agentic-BI-Demo nutzt ihren Compose-Container `agentic-bi-mcp`, die
Datenblatt-Demo den Java-Server auf dem Host.

## Änderungen und Zurücksetzen

- **Provider-Schlüssel ändern:** `.env` anpassen und
  `python3 scripts/seed-openwebui.py` erneut ausführen.
- **Basismodell wechseln:** `OPENWEBUI_MODEL_BASE` in `.env` auf ein Modell
  des aktivierten Providers setzen (z. B. `moonshotai/Kimi-K2.6`) und das
  Seed-Script erneut ausführen.
- **Admin-Passwort ändern:** Wert in `.env` anpassen. Das Seed-Script legt
  kein neues Konto an, sondern meldet sich mit den neuen Werten an; für ein
  neues Passwort das Passwort zuerst in der Oberfläche unter
  **Settings → Account** ändern und danach `.env` nachziehen.
- **Kompletter Neustart der Instanz:** `docker compose down -v` löscht
  Volume, Login und Konfiguration. Danach `docker compose up -d` und
  `python3 scripts/seed-openwebui.py`; das Admin-Konto wird neu angelegt.
- **Ports ändern:** `OPEN_WEBUI_HOST_PORT` beziehungsweise
  `DATASHEET_MCP_PORT` in `.env` anpassen, Compose beziehungsweise den
  Java-Server neu starten und das Seed-Script erneut ausführen.

## Troubleshooting

| Symptom | Ursache und Lösung |
|---|---|
| Seed bricht mit «Datenblatt-MCP ... ist nicht erreichbar» ab | Java-Server läuft nicht. Zuerst starten, dann Seed erneut. |
| MCP-Toolserver ist registriert, aber ohne Werkzeuge | Der MCP war beim Seeding nicht erreichbar. Java-Server starten und Seed erneut ausführen oder die Verbindung unter **Admin → Integrations → External Tool Servers** speichern. |
| Container erreicht den Host nicht (`Connection refused`) | `DATASHEET_HOST=0.0.0.0` gesetzt? Docker Desktop gestartet? Unter macOS ggf. die Firewall-Freigabe für Java bestätigen. |
| Anmeldung schlägt fehl oder Signup liefert 403 | Nach dem ersten Login ist die Registrierung deaktiviert. Zugangsdaten aus `.env` verwenden. Passwort vergessen: `docker compose down -v` und neu seeden. |
| Port 3001 oder 8001 belegt | Ports in `.env` ändern, `docker compose up -d` beziehungsweise Java-Server neu starten, Seed erneut ausführen. |
| Download-Link im Chat führt ins Leere | `DATASHEET_PUBLIC_BASE_URL` muss den Host-Port nennen (`http://127.0.0.1:8001`), nicht `host.docker.internal`. Links sind nur eine Stunde gültig. |
| `custom.css` wirkt nicht | Container neu starten (`docker compose restart open-webui`) und die Seite hart neu laden. |
| Modell oder Vorschläge fehlen nach einem Update | Seed-Script erneut ausführen; es aktualisiert Modell und Werkzeuge. |
| Antwort bleibt leer, nur «Thought for …» sichtbar | Thinking-Modelle können nach Werkzeugaufrufen die Antwort im Reasoning-Kanal streamen. `OPENWEBUI_MODEL_BASE=Qwen/Qwen3.5-397B-A17B-FP8` setzen und Seed erneut ausführen. |

## Dateien

| Datei | Zweck |
|---|---|
| `docker-compose.yml` | Open WebUI v0.11.3, eigenes Projekt/Volume, Port 3001 |
| `.env.example` / `.env` | Ports, Admin-Konto, Provider-Schlüssel (`.env` ist gitignoriert) |
| `scripts/seed-openwebui.py` | Idempotentes Seeding über die Admin-API |
| `openwebui/system-prompt.md` | System-Prompt des Datenblatt-Modells |
| `openwebui/demo-prompts.md` | Demo-Fragen und erwartetes Verhalten |
| `openwebui/xtf_import.py` | Workspace-Tool für XTF-Anhänge (wird vom Seed installiert) |
| `custom.css` | Open-WebUI-Styling, übernommen aus der Agentic-BI-Demo |
