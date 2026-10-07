#!/usr/bin/env python3
"""Reject a published index missing either supported Linux architecture."""
import json
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text())
platforms = {(entry.get("platform", {}).get("os"), entry.get("platform", {}).get("architecture"))
             for entry in manifest.get("manifests", [])}
assert {( "linux", "amd64"), ("linux", "arm64")} <= platforms, platforms
print("Multiarch manifest verified: linux/amd64 and linux/arm64.")
