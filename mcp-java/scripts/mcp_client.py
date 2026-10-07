"""Small JSON-RPC clients used by transport and container smoke checks."""
import json
import queue
import subprocess
import threading
import urllib.request

PROTOCOL = "2025-11-25"


class HttpSession:
    def __init__(self, base):
        self.base = base.rstrip("/")
        self.session_id = None
        self.protocol = PROTOCOL
        self.next_id = 1

    def __enter__(self):
        initialized = self.request("initialize", {
            "protocolVersion": PROTOCOL, "capabilities": {},
            "clientInfo": {"name": "datasheet-smoke", "version": "1.0"},
        })
        self.protocol = initialized["protocolVersion"]
        assert self.session_id, "STREAMABLE initialize must return Mcp-Session-Id"
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"}, 202)
        return self

    def _headers(self):
        headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        if self.session_id:
            headers.update({"Mcp-Session-Id": self.session_id, "MCP-Protocol-Version": self.protocol})
        return headers

    def _post(self, message, expected_status=200):
        request = urllib.request.Request(self.base + "/mcp", json.dumps(message).encode(), self._headers())
        with urllib.request.urlopen(request, timeout=60) as response:
            assert response.status == expected_status, response.status
            if response.headers.get("Mcp-Session-Id"):
                self.session_id = response.headers["Mcp-Session-Id"]
            text = response.read().decode()
        if expected_status == 202:
            return None
        if not text.lstrip().startswith("{"):
            text = next(line[5:].strip() for line in text.splitlines() if line.startswith("data:"))
        result = json.loads(text)
        assert "error" not in result, result
        return result["result"]

    def request(self, method, params):
        request_id = self.next_id
        self.next_id += 1
        return self._post({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})

    def __exit__(self, *_):
        if self.session_id:
            request = urllib.request.Request(self.base + "/mcp", headers=self._headers(), method="DELETE")
            with urllib.request.urlopen(request, timeout=30) as response:
                assert response.status == 200, response.status


class StdioSession:
    def __init__(self, command):
        self.proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
        self.output = queue.Queue()
        self.stderr = []
        self.pending = {}
        self.next_id = 1
        self.largest_line = 0
        self.failure = None
        self.pumps = [threading.Thread(target=self._stdout, daemon=True),
                      threading.Thread(target=self._stderr, daemon=True)]
        for pump in self.pumps:
            pump.start()

    def _stdout(self):
        try:
            for line in self.proc.stdout:
                self.largest_line = max(self.largest_line, len(line.encode("utf-8")))
                message = json.loads(line)
                assert message.get("jsonrpc") == "2.0", message
                self.output.put(message)
        except BaseException as error:
            self.failure = error
            self.output.put({"reader_error": str(error)})

    def _stderr(self):
        self.stderr.extend(self.proc.stderr)

    def __enter__(self):
        self.request("initialize", {"protocolVersion": PROTOCOL, "capabilities": {},
                     "clientInfo": {"name": "datasheet-stdio-smoke", "version": "1.0"}})
        self.write({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return self

    def write(self, message):
        self.proc.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()

    def send(self, method, params):
        request_id = self.next_id
        self.next_id += 1
        self.write({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        return request_id

    def reply(self, request_id):
        while request_id not in self.pending:
            try:
                message = self.output.get(timeout=60)
            except queue.Empty as error:
                raise AssertionError("STDIO response timeout; " + "".join(self.stderr[-30:])) from error
            assert "reader_error" not in message, message
            if "id" in message:
                self.pending[message["id"]] = message
        response = self.pending.pop(request_id)
        assert "error" not in response, response
        return response["result"]

    def request(self, method, params):
        return self.reply(self.send(method, params))

    def eof(self):
        self.proc.stdin.close()
        assert self.proc.wait(timeout=20) == 0, "".join(self.stderr)
        for pump in self.pumps:
            pump.join(timeout=3)
        assert self.failure is None, self.failure
        assert not any(pump.is_alive() for pump in self.pumps), "Undrained STDIO pipes"
        stderr = "".join(self.stderr)
        assert "Failed to enqueue" not in stderr and "onErrorDropped" not in stderr, stderr

    def __exit__(self, *_):
        if not self.proc.stdin.closed:
            self.proc.stdin.close()
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=5)
        self.proc.stdout.close()
        self.proc.stderr.close()


def tool(client, name, arguments, *, error=False):
    result = client.request("tools/call", {"name": name, "arguments": arguments})
    assert bool(result.get("isError")) == error, result
    return result["structuredContent"]
