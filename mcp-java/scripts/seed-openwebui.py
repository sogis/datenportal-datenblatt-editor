#!/usr/bin/env python3
"""Richtet die Open-WebUI-Instanz der Datenblatt-Demo ein (idempotent).

Das Script liest `mcp-java/.env`, wartet auf den Health-Endpunkt der per
`docker compose up -d` gestarteten Open-WebUI-Instanz und konfiguriert über
die Admin-API:

- OpenAI-kompatible Provider analog der Agentic-BI-Demo
  (OpenAI aus, Infomaniak an, DeepSeek an, Ollama aus),
- die MCP-Toolserver-Verbindung zum direkt per `java -jar` laufenden
  Datenblatt-MCP,
- das Workspace-Tool `xtf_import` inklusive Valves,
- das Workspace-Modell `datenblatt-editor` mit System-Prompt, XTF-Tool und
  MCP-Toolserver,
- die Sichtbarkeit der Basis-Modelle analog der Agentic-BI-Demo,
- `rag.bypass_embedding_and_retrieval` für Uploads ohne Embedding-Modell.

Voraussetzung: der Java-MCP läuft auf dem Host, Open WebUI läuft in Docker.
Das Script kann jederzeit erneut ausgeführt werden.
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
ENV_FILE = BASE_DIR / ".env"
SYSTEM_PROMPT_FILE = BASE_DIR / "openwebui" / "system-prompt.md"
DEMO_PROMPTS_FILE = BASE_DIR / "openwebui" / "demo-prompts.md"
TOOL_SOURCE_FILE = BASE_DIR / "openwebui" / "xtf_import.py"

MCP_SERVER_ID = "datasheet_mcp"
MODEL_ID = "datenblatt-editor"
MODEL_BASE_DEFAULT = "Qwen/Qwen3.5-397B-A17B-FP8"
MODEL_NAME = "Datenblatt-Editor – Kanton Solothurn"
TOOL_ID = "xtf_import"
TOOL_NAME = "XTF-Anhang importieren"

# Reihenfolge und Aktivierung wie in der Agentic-BI-Demo (openwebui-demo1).
PROVIDERS = [
    {
        "base_url": "https://api.openai.com/v1",
        "key_env": None,
        "enable": False,
    },
    {
        "base_url": "https://api.infomaniak.com/2/ai/103965/openai/v1",
        "key_env": "INFOMANIAK_API_KEY",
        "enable": True,
    },
    {
        "base_url": "https://api.deepseek.com",
        "key_env": "DEEPSEEK_API_KEY",
        "enable": True,
    },
]

# Aktive bzw. ausgeblendete Basis-Modelle wie in der Agentic-BI-Demo.
ACTIVE_BASE_MODELS = [
    "swiss-ai/Apertus-v1.5-70B",
    "Qwen/Qwen3.5-397B-A17B-FP8",
]
HIDDEN_BASE_MODELS = [
    "Qwen/Qwen3-Embedding-8B",
    "bge_multilingual_gemma2",
    "mini_lm_l12_v2",
    "mistralai/Ministral-3-14B-Instruct-2512",
    "mistralai/Mistral-Small-4-119B-2603",
    "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8",
]


class ApiError(RuntimeError):
    def __init__(self, status: int, method: str, path: str, detail: str):
        super().__init__(f"{method} {path} -> HTTP {status}: {detail[:300]}")
        self.status = status


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def api(base: str, method: str, path: str, payload: dict | None = None, token: str | None = None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(base + path, data=data, method=method)
    request.add_header("Accept", "application/json")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise ApiError(error.code, method, path, detail) from error
    except urllib.error.URLError as error:
        raise SystemExit(f"{method} {path} fehlgeschlagen: {error.reason}") from error
    if not body:
        return None
    return json.loads(body)


def wait_for_health(base: str, timeout_seconds: int = 180) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(base + "/health", timeout=5) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(3)
    raise SystemExit(
        f"Open WebUI unter {base} ist nicht erreichbar. Läuft `docker compose up -d`?"
    )


def check_mcp(port: str) -> None:
    url = f"http://127.0.0.1:{port}/actuator/health"
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            if json.load(response).get("status") != "UP":
                raise ValueError("Health-Status ist nicht UP")
    except Exception as error:
        raise SystemExit(
            f"Datenblatt-MCP auf {url} ist nicht erreichbar ({error}).\n"
            "Den Java-Server zuerst starten, zum Beispiel:\n"
            f"  DATASHEET_HOST=0.0.0.0 DATASHEET_PORT={port} "
            f"DATASHEET_PUBLIC_BASE_URL=http://127.0.0.1:{port} "
            "java -jar build/libs/datasheet-mcp.jar --spring.profiles.active=http"
        ) from error


def authenticate(base: str, env: dict[str, str]) -> str:
    email = env.get("OPENWEBUI_ADMIN_EMAIL", "admin@example.com")
    password = env.get("OPENWEBUI_ADMIN_PASSWORD", "")
    name = env.get("OPENWEBUI_ADMIN_NAME", "Admin")
    if not password:
        raise SystemExit("OPENWEBUI_ADMIN_PASSWORD fehlt in mcp-java/.env")
    try:
        session = api(base, "POST", "/api/v1/auths/signup", {
            "name": name,
            "email": email,
            "password": password,
            "profile_image_url": "/user.png",
        })
        print(f"Admin-Konto {email} angelegt.")
        return session["token"]
    except ApiError:
        pass
    try:
        session = api(base, "POST", "/api/v1/auths/signin", {
            "email": email,
            "password": password,
        })
        print(f"Als {email} angemeldet.")
        return session["token"]
    except ApiError as error:
        raise SystemExit(
            f"Anmeldung als {email} fehlgeschlagen: {error}\n"
            "OPENWEBUI_ADMIN_* in mcp-java/.env prüfen."
        ) from error


def seed_providers(base: str, token: str, env: dict[str, str]) -> None:
    base_urls = [provider["base_url"] for provider in PROVIDERS]
    keys: list[str] = []
    configs: dict[str, dict] = {}
    for index, provider in enumerate(PROVIDERS):
        key = env.get(provider["key_env"], "") if provider["key_env"] else ""
        if provider["enable"] and not key:
            raise SystemExit(f"{provider['key_env']} fehlt in mcp-java/.env")
        keys.append(key)
        if provider["enable"]:
            configs[str(index)] = {
                "enable": True,
                "tags": [],
                "prefix_id": "",
                "model_ids": [],
                "connection_type": "external",
                "auth_type": "bearer",
                "passthrough_params": [],
            }
        else:
            configs[str(index)] = {"enable": False}
    api(base, "POST", "/openai/config/update", {
        "ENABLE_OPENAI_API": True,
        "OPENAI_API_BASE_URLS": base_urls,
        "OPENAI_API_KEYS": keys,
        "OPENAI_API_CONFIGS": configs,
    }, token)
    print(f"Provider konfiguriert: {len(base_urls)} Verbindungen (Infomaniak, DeepSeek aktiv).")


def seed_ollama(base: str, token: str) -> None:
    api(base, "POST", "/ollama/config/update", {
        "ENABLE_OLLAMA_API": False,
        "OLLAMA_BASE_URLS": ["http://host.docker.internal:11434"],
        "OLLAMA_API_CONFIGS": {"0": {"enable": False}},
    }, token)
    print("Ollama deaktiviert.")


def seed_tool_server(base: str, token: str, mcp_port: str) -> None:
    connection = {
        "url": f"http://host.docker.internal:{mcp_port}/mcp",
        "path": "openapi.json",
        "type": "mcp",
        "auth_type": "none",
        "headers": None,
        "key": "",
        "config": {
            "enable": True,
            "function_name_filter_list": "",
            "access_grants": [
                {"principal_type": "user", "principal_id": "*", "permission": "read"}
            ],
        },
        "info": {
            "id": MCP_SERVER_ID,
            "name": MCP_SERVER_ID,
            "description": "Datenblatt MCP (Streamable HTTP, Java auf dem Host)",
        },
        "spec_type": "url",
        "spec": "",
    }
    api(base, "POST", "/api/v1/configs/tool_servers",
        {"TOOL_SERVER_CONNECTIONS": [connection]}, token)
    print(f"MCP-Toolserver {MCP_SERVER_ID} registriert "
          f"(http://host.docker.internal:{mcp_port}/mcp).")


def seed_config(base: str, token: str) -> None:
    api(base, "POST", "/api/v1/configs/import", {
        "config": {"rag.bypass_embedding_and_retrieval": True},
    }, token)
    print("RAG-Bypass für Uploads ohne Embedding-Modell aktiviert.")


def seed_tool(base: str, token: str, env: dict[str, str], mcp_port: str) -> None:
    source = TOOL_SOURCE_FILE.read_text(encoding="utf-8")
    form = {
        "id": TOOL_ID,
        "name": TOOL_NAME,
        "content": source,
        "meta": {
            "description": "Importiert einen XTF-/XML-Chat-Anhang als "
                           "Datenblatt-Entwurf über die Datenblatt-MCP.",
            "manifest": {},
        },
        "access_grants": [
            {"principal_type": "user", "principal_id": "*", "permission": "read"}
        ],
    }
    exists = True
    try:
        api(base, "GET", f"/api/v1/tools/id/{TOOL_ID}", token=token)
    except ApiError as error:
        if error.status == 404:
            exists = False
        else:
            raise
    if exists:
        api(base, "POST", f"/api/v1/tools/id/{TOOL_ID}/update", form, token)
        print(f"Workspace-Tool {TOOL_ID} aktualisiert.")
    else:
        api(base, "POST", "/api/v1/tools/create", form, token)
        print(f"Workspace-Tool {TOOL_ID} angelegt.")
    api(base, "POST", f"/api/v1/tools/id/{TOOL_ID}/valves/update", {
        "MCP_URL": f"http://host.docker.internal:{mcp_port}/mcp",
        "INSTANCE_ID": env.get("OPENWEBUI_INSTANCE_ID", "datenblatt-openwebui"),
        "TIMEOUT_SECONDS": 60,
    }, token)
    print(f"Valves von {TOOL_ID} gesetzt.")


def parse_demo_prompts(path: Path) -> list[dict]:
    prompts: list[dict] = []
    title: str | None = None
    lines: list[str] = []

    def flush() -> None:
        nonlocal lines
        if title and lines:
            prompts.append({"content": " ".join(lines), "title": [title, ""]})
        lines = []

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.rstrip()
        if line.startswith("## "):
            flush()
            title = re.sub(r"^\d+\.\s*", "", line[3:].strip())
        elif title and line.startswith(">"):
            lines.append(line[1:].strip())
    flush()
    return prompts


def seed_models(base: str, token: str, model_base: str) -> None:
    system_prompt = SYSTEM_PROMPT_FILE.read_text(encoding="utf-8")
    suggestions = parse_demo_prompts(DEMO_PROMPTS_FILE)
    models: list[dict] = [
        {
            "id": MODEL_ID,
            "name": MODEL_NAME,
            "base_model_id": model_base,
            "meta": {
                "profile_image_url": "/static/favicon.png",
                "description": "Datenblätter nach SO_AGI_DataCatalog erstellen und "
                               "nachführen: XTF importieren, Metadaten und Attribute "
                               "ändern, validieren und exportieren.",
                "capabilities": {
                    "file_context": False,
                    "vision": False,
                    "file_upload": True,
                    "web_search": False,
                    "image_generation": False,
                    "code_interpreter": False,
                    "citations": True,
                    "status_updates": True,
                    "memory": False,
                    "builtin_tools": False,
                },
                "suggestion_prompts": suggestions,
                "toolIds": [f"server:mcp:{MCP_SERVER_ID}", TOOL_ID],
            },
            "params": {
                "system": system_prompt,
                "temperature": 0.1,
                "function_calling": "native",
                # Infomaniak/vLLM streamt bei Thinking-Modellen die Antwort nach
                # Tool-Aufrufen sonst im Reasoning-Kanal; Open WebUI zeigt dann
                # keinen Antworttext an. Thinking deaktiviert.
                "custom_params": {
                    "chat_template_kwargs": {"enable_thinking": False}
                },
            },
            "access_grants": [
                {"principal_type": "user", "principal_id": "*", "permission": "read"}
            ],
            "is_active": True,
        }
    ]
    for model_id in ACTIVE_BASE_MODELS:
        models.append({
            "id": model_id,
            "name": model_id,
            "base_model_id": None,
            "meta": {},
            "params": {},
            "is_active": True,
        })
    for model_id in HIDDEN_BASE_MODELS:
        models.append({
            "id": model_id,
            "name": model_id,
            "base_model_id": None,
            "meta": {},
            "params": {},
            "is_active": False,
        })
    api(base, "POST", "/api/v1/models/import", {"models": models}, token)
    print(f"Modelle konfiguriert: {MODEL_ID} (Basis {model_base}) und "
          f"{len(ACTIVE_BASE_MODELS) + len(HIDDEN_BASE_MODELS)} Basis-Modelle.")


def main() -> None:
    if not ENV_FILE.exists():
        raise SystemExit("mcp-java/.env fehlt. Vorlage: cp .env.example .env")
    if not TOOL_SOURCE_FILE.exists():
        raise SystemExit(f"Tool-Quelle fehlt: {TOOL_SOURCE_FILE}")
    env = load_env()
    port = env.get("OPEN_WEBUI_HOST_PORT", "3001")
    mcp_port = env.get("DATASHEET_MCP_PORT", "8001")
    model_base = env.get("OPENWEBUI_MODEL_BASE", MODEL_BASE_DEFAULT)
    base = f"http://127.0.0.1:{port}"

    check_mcp(mcp_port)
    wait_for_health(base)
    token = authenticate(base, env)
    seed_ollama(base, token)
    seed_providers(base, token, env)
    seed_config(base, token)
    seed_tool_server(base, token, mcp_port)
    seed_tool(base, token, env, mcp_port)
    seed_models(base, token, model_base)

    print()
    print(f"Fertig. Open WebUI: {base}")
    print(f"Login: {env.get('OPENWEBUI_ADMIN_EMAIL', 'admin@example.com')} "
          f"(Passwort aus mcp-java/.env)")
    print(f"Modell: {MODEL_NAME}")
    print("Hinweis: Open WebUI beim ersten Aufruf neu laden (Browser-Cache).")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
