#!/usr/bin/env python3
"""Verify the exact canonical JAR, external models and both Docker transports."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile
import uuid
import zipfile
from mcp_client import StdioSession, tool
from smoke import verify_http
from docker_checks import docker, wait_http

ROOT = Path(__file__).resolve().parents[1]
MODELS = ["SO_AGI_DataCatalog_Base_20260529.ili", "SO_AGI_DataCatalog_Datasheet_20260523.ili"]


def verify_image(image, jar):
    name = "datasheet-image-check-" + uuid.uuid4().hex[:12]
    try:
        docker("create", "--name", name, image)
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory)
            docker("cp", name + ":/app/models", copied / "models")
            docker("cp", name + ":/app/app.jar", copied / "app.jar")
            assert (copied / "app.jar").read_bytes() == jar.read_bytes(), "Image must use the exact tested JAR"
            with zipfile.ZipFile(jar) as archive:
                for model in MODELS:
                    external = (copied / "models" / model).read_bytes()
                    assert external == (ROOT / "src/main/resources/models" / model).read_bytes(), model
                    assert external == archive.read("BOOT-INF/classes/models/" + model), model
            java = str(Path(os.environ["JAVA_HOME"]) / "bin/java") if "JAVA_HOME" in os.environ else "java"
            subprocess.run([java, "-Dloader.main=ch.interlis.ili2c.Main", "-cp", str(jar),
                            "org.springframework.boot.loader.launch.PropertiesLauncher", "--no-auto", "--quiet",
                            *[str(copied / "models" / model) for model in MODELS]], check=True, timeout=30)
        docker("rm", name)
        # A stopped container can be copied; runtime HTTP must still be the image default.
        docker("run", "-d", "--name", name, "-p", "127.0.0.1::8000", image)
        port = docker("port", name, "8000/tcp").rsplit(":", 1)[1]
        base = "http://127.0.0.1:" + port
        wait_http(base + "/actuator/health")
        # public-base-url must use the randomly published host port.
        docker("rm", "-f", name)
        docker("run", "-d", "--name", name, "-p", f"127.0.0.1:{port}:8000", "-e",
               "DATASHEET_PUBLIC_BASE_URL=" + base, image)
        wait_http(base + "/actuator/health")
        verify_http(base)
        assert docker("exec", name, "id", "-u") != "0", "Container must run unprivileged"
        docker("rm", "-f", name)
        with StdioSession(["docker", "run", "--rm", "-i", "--name", name, "--network", "none", "-e",
                           "SPRING_PROFILES_ACTIVE=stdio", image]) as client:
            assert len(client.request("tools/list", {})["tools"]) == 12
            for kind in ("dataset", "series"):
                fixture = (ROOT / f"src/test/resources/{kind}.xtf").read_text()
                imported = tool(client, "import_xtf", {"xml": fixture})
                arguments = {"draft_id": imported["draft_id"], "expected_revision": 1}
                assert tool(client, "export_xtf", arguments, error=True)["code"] == "invalid_arguments"
                exported = tool(client, "export_xtf", {**arguments, "include_xml": True})
                assert "download_url" not in exported and "expires_at" not in exported
                reimported = tool(client, "import_xtf", {"xml": exported["xml"]})
                assert tool(client, "validate_datasheet", {"draft_id": reimported["draft_id"], "expected_revision": 1})["valid"]
            draft = tool(client, "create_datasheet", {"kind": "dataset"})
            tool(client, "upsert_attribute", {"draft_id": draft["draft_id"], "expected_revision": 1,
                 "values": {"name": "LARGE", "description": "ä" * 90_000}})
            requests = [client.send("tools/call", {"name": "read_datasheet", "arguments": {"draft_id": draft["draft_id"]}})
                        for _ in range(16)]
            for request in requests:
                assert not client.reply(request)["isError"]
            assert client.largest_line > 64 * 1024
            client.eof()
        print("Image checks passed: canonical JAR, original models, local compilation, HTTP, offline STDIO, large parallel responses and EOF.")
    except BaseException:
        subprocess.run(["docker", "logs", name], check=False)
        raise
    finally:
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--jar", type=Path, default=ROOT / "build/libs/datasheet-mcp.jar")
    args = parser.parse_args()
    verify_image(args.image, args.jar.resolve())
