from __future__ import annotations

import io
import json
import threading
import time
import unittest

from http_service import RuntimeChild


def wait_for(predicate):
    deadline = time.monotonic() + 2
    while not predicate():
        if time.monotonic() >= deadline:
            raise AssertionError("timed out waiting for speech runtime state")
        time.sleep(0.001)


class ControlledOutput:
    def __init__(self):
        self.ready = threading.Event()
        self.response = None

    def readline(self):
        self.ready.wait(2)
        return self.response or ""


class ControlledProcess:
    def __init__(self):
        self.stdin = io.StringIO()
        self.stdout = ControlledOutput()
        self.terminated = False

    def poll(self):
        return -15 if self.terminated else None

    def terminate(self):
        self.terminated = True
        self.stdout.ready.set()


class RuntimeChildTest(unittest.TestCase):
    def test_cancel_queued_request_does_not_stop_active_inference(self):
        process = ControlledProcess()
        runtime = RuntimeChild(process_factory=lambda *args, **kwargs: process)
        active_result = []
        queued_error = []

        active = threading.Thread(target=lambda: active_result.append(
            runtime.request("synthesize", {"requestId": "active"})
        ))
        active.start()
        wait_for(lambda: '"requestId":"active"' in process.stdin.getvalue())

        def run_queued():
            try:
                runtime.request("synthesize", {"requestId": "queued"})
            except Exception as error:
                queued_error.append(str(error))

        queued = threading.Thread(target=run_queued)
        queued.start()
        wait_for(lambda: runtime.requests.get("queued") == "queued")

        self.assertEqual(runtime.cancel("queued"), {
            "requestId": "queued", "cancelled": True, "previousStatus": "queued"
        })
        self.assertFalse(process.terminated)

        first = json.loads(process.stdin.getvalue().splitlines()[0])
        process.stdout.response = json.dumps({
            "id": first["id"], "ok": True, "result": {"requestId": "active"}
        }) + "\n"
        process.stdout.ready.set()
        active.join(2)
        queued.join(2)

        self.assertEqual(active_result, [{"requestId": "active"}])
        self.assertEqual(queued_error, ["speech request cancelled"])

    def test_cancel_active_request_terminates_only_its_worker(self):
        process = ControlledProcess()
        runtime = RuntimeChild(process_factory=lambda *args, **kwargs: process)
        active_error = []

        def run_active():
            try:
                runtime.request("transcribe", {"requestId": "active-mic"})
            except Exception as error:
                active_error.append(str(error))

        active = threading.Thread(target=run_active)
        active.start()
        wait_for(lambda: runtime.requests.get("active-mic") == "active")

        self.assertEqual(runtime.cancel("unknown"), {
            "requestId": "unknown", "cancelled": False, "previousStatus": "unknown"
        })
        self.assertFalse(process.terminated)
        self.assertEqual(runtime.cancel("active-mic"), {
            "requestId": "active-mic", "cancelled": True, "previousStatus": "active"
        })
        active.join(2)

        self.assertTrue(process.terminated)
        self.assertEqual(active_error, ["speech model process exited without a response"])


if __name__ == "__main__":
    unittest.main()
