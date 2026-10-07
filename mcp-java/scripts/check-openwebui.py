#!/usr/bin/env python3
"""Run attachment integration in a fresh disposable Open WebUI instance."""
import argparse
from pathlib import Path
import subprocess
import uuid
from docker_checks import docker, wait_http
ROOT = Path(__file__).resolve().parents[1]


def verify_openwebui(image, webui_image):
    suffix = uuid.uuid4().hex[:12]
    network = "datasheet-webui-check-" + suffix
    mcp_name = "datasheet-mcp-" + suffix
    webui_name = "datasheet-webui-" + suffix
    try:
        docker("network", "create", network)
        docker("run", "-d", "--name", mcp_name, "--network", network,
               "--network-alias", "datasheet-mcp", "-e",
               "DATASHEET_PUBLIC_BASE_URL=http://datasheet-mcp:8000", image)
        docker("run", "-d", "--name", webui_name, "--network", network,
               "-p", "127.0.0.1::8080", "-e", "WEBUI_SECRET_KEY=disposable-datasheet-integration",
               "-e", "ENABLE_VERSION_UPDATE_CHECK=false", "-e", "ENABLE_FOLLOW_UP_GENERATION=false",
               "-e", "OFFLINE_MODE=true", "-e", "ENABLE_OLLAMA_API=false",
               "-e", "RAG_EMBEDDING_MODEL_AUTO_UPDATE=false",
               webui_image)
        port = docker("port", webui_name, "8080/tcp").rsplit(":", 1)[1]
        wait_http("http://127.0.0.1:" + port + "/health", timeout=180)
        docker("cp", ROOT / "openwebui", webui_name + ":/tmp/datasheet-openwebui")
        docker("cp", ROOT / "src/test/resources/dataset.xtf", webui_name + ":/tmp/dataset.xtf")
        subprocess.run(["docker", "exec", "-e", "PYTHONPATH=/app/backend", webui_name, "python", "-m", "unittest", "discover", "-s",
                        "/tmp/datasheet-openwebui/tests", "-p", "test_*.py", "-v"], check=True, timeout=90)
        subprocess.run(["docker", "exec", "-e", "PYTHONPATH=/app/backend", "-e", "DATASHEET_TEST_MCP_URL=http://datasheet-mcp:8000/mcp",
                        webui_name, "python", "/tmp/datasheet-openwebui/tests/integration_openwebui.py"],
                       check=True, timeout=180)
    except BaseException:
        for name in (mcp_name, webui_name):
            subprocess.run(["docker", "logs", "--tail", "60", name], check=False)
        raise
    finally:
        for name in (mcp_name, webui_name):
            subprocess.run(["docker", "rm", "-fv", name], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, check=False)
        subprocess.run(["docker", "network", "rm", network], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, check=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--webui-image", default="ghcr.io/open-webui/open-webui:v0.11.3")
    args = parser.parse_args()
    verify_openwebui(args.image, args.webui_image)
