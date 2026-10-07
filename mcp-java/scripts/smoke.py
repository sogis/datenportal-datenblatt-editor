#!/usr/bin/env python3
"""Health, STREAMABLE session lifecycle and exact download smoke check."""
import sys
from pathlib import Path
import json
import urllib.request
from mcp_client import HttpSession, tool


def verify_http(base):
    with urllib.request.urlopen(base + "/actuator/health", timeout=10) as response:
        assert json.load(response)["status"] == "UP"
    with HttpSession(base) as client:
        assert len(client.request("tools/list", {})["tools"]) == 12
        created = tool(client, "create_datasheet", {"kind": "dataset", "values": {"title": "Smoke"}})
        draft_id = created["draft_id"]
        cleared = tool(client, "update_metadata", {
            "draft_id": draft_id, "expected_revision": 1, "values": {"title": None},
        })
        assert "title" not in cleared["data"]
        assert tool(client, "validate_datasheet", {"draft_id": draft_id, "expected_revision": 2})["valid"] is False
        assert tool(client, "discard_datasheet", {"draft_id": draft_id, "expected_revision": 2})["discarded"]
        for kind in ("dataset", "series"):
            fixture = Path(__file__).resolve().parents[1] / f"src/test/resources/{kind}.xtf"
            imported = tool(client, "import_xtf", {"xml": fixture.read_text()})
            arguments = {"draft_id": imported["draft_id"], "expected_revision": imported["revision"]}
            exported = tool(client, "export_xtf", arguments)
            assert "xml" not in exported and "expires_at" in exported
            with urllib.request.urlopen(exported["download_url"], timeout=10) as response:
                download = response.read()
                assert "attachment" in response.headers["Content-Disposition"]
                assert response.headers["Cache-Control"] == "no-store"
            explicit = tool(client, "export_xtf", {**arguments, "include_xml": True})
            assert download == explicit["xml"].encode("utf-8")
            reimported = tool(client, "import_xtf", {"xml": download.decode("utf-8")})
            assert tool(client, "validate_datasheet", {
                "draft_id": reimported["draft_id"], "expected_revision": 1,
            })["valid"] is True
            tool(client, "discard_datasheet", arguments)
    print("HTTP smoke passed: session lifecycle, 12 tools, null patch, validation, Dataset/Series and exact downloads.")


if __name__ == "__main__":
    verify_http(sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8000")
