from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


class RuntimeChild:
    def __init__(self, process_factory=subprocess.Popen):
        self.model_lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.child = None
        self.next_id = 1
        self.requests: dict[str, str] = {}
        self.active_request_id: str | None = None
        self.process_factory = process_factory

    def request(self, operation: str, request: dict[str, Any] | None = None):
        request_id = request.get("requestId") if request else None
        if not request_id:
            with self.state_lock:
                request_id = f"internal:{operation}:{self.next_id}"
                self.next_id += 1
        with self.state_lock:
            if request_id in self.requests:
                raise RuntimeError(f"speech request is already pending: {request_id}")
            self.requests[request_id] = "queued"

        try:
            with self.model_lock:
                child = self._open()
                with self.state_lock:
                    if self.requests.get(request_id) == "cancelled":
                        raise RuntimeError("speech request cancelled")
                    self.requests[request_id] = "active"
                    self.active_request_id = request_id
                identifier = self.next_id
                self.next_id += 1
                message = {"id": identifier, "operation": operation}
                if request is not None:
                    message["request"] = request
                child.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
                child.stdin.flush()
                line = child.stdout.readline()
                if not line:
                    raise RuntimeError("speech model process exited without a response")
                response = json.loads(line)
                if response.get("id") != identifier:
                    raise RuntimeError("speech model response is out of order")
                if not response.get("ok"):
                    raise RuntimeError(response.get("error") or "speech model process failed")
                return response["result"]
        finally:
            with self.state_lock:
                self.requests.pop(request_id, None)
                if self.active_request_id == request_id:
                    self.active_request_id = None

    def cancel(self, request_id: str):
        with self.state_lock:
            previous = self.requests.get(request_id, "unknown")
            if previous not in {"queued", "active"}:
                return {"requestId": request_id, "cancelled": False, "previousStatus": previous}
            self.requests[request_id] = "cancelled"
            child = self.child if previous == "active" and self.active_request_id == request_id else None
            if child:
                self.child = None
        if child and child.poll() is None:
            child.terminate()
        return {"requestId": request_id, "cancelled": True, "previousStatus": previous}

    def close(self):
        with self.state_lock:
            child = self.child
            self.child = None
        if child and child.poll() is None:
            child.terminate()

    def _open(self):
        if self.child and self.child.poll() is None:
            return self.child
        service = Path(__file__).resolve().with_name("service.py")
        self.child = self.process_factory(
            [sys.executable, str(service), "serve"],
            cwd=service.parent,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        return self.child


class SpeechHttpServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address):
        super().__init__(address, SpeechHandler)
        self.runtime = RuntimeChild()

    def server_close(self):
        self.runtime.close()
        super().server_close()


class SpeechHandler(BaseHTTPRequestHandler):
    routes = {
        ("GET", "/capabilities"): "capabilities",
        ("GET", "/health"): "health",
        ("POST", "/synthesize"): "synthesize",
        ("POST", "/transcribe"): "transcribe",
    }

    def do_GET(self):
        self._handle()

    def do_POST(self):
        if self.path == "/cancel":
            try:
                request = self._read_request()
                request_id = request.get("requestId")
                if not isinstance(request_id, str) or not request_id:
                    raise ValueError("cancel requestId is required")
                self._send(200, self.server.runtime.cancel(request_id))
            except Exception as error:
                self._send(400, {"error": str(error)})
            return
        self._handle()

    def log_message(self, message, *args):
        print(f"speech http: {message % args}")

    def _handle(self):
        operation = self.routes.get((self.command, self.path))
        if operation is None:
            self._send(404, {"error": "unknown speech route"})
            return
        try:
            request = None
            if self.command == "POST":
                request = self._read_request()
            self._send(200, self.server.runtime.request(operation, request))
        except Exception as error:
            self._send(503, {"error": str(error)})

    def _read_request(self):
        size = int(self.headers.get("Content-Length", "0"))
        if size <= 0 or size > 48 * 1024 * 1024:
            raise ValueError("speech request body size is invalid")
        return json.loads(self.rfile.read(size))

    def _send(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8091)
    args = parser.parse_args()
    SpeechHttpServer((args.host, args.port)).serve_forever()


if __name__ == "__main__":
    main()
