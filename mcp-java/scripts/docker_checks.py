"""Docker CLI and readiness helpers for disposable integration checks."""
import subprocess
import http.client
import time
import urllib.error
import urllib.request


def docker(*arguments):
    return subprocess.check_output(["docker", *map(str, arguments)], text=True).strip()


def wait_http(url, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException):
            time.sleep(1)
    raise AssertionError(f"HTTP readiness timeout: {url}")
