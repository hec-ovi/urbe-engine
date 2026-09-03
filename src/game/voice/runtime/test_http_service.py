from __future__ import annotations

import io
import http.client
import hashlib
import json
import threading
import time
import unittest

from http_service import RuntimeChild, SpeechHttpServer


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


class SpeechHttpServerTest(unittest.TestCase):
    def test_public_cancel_route_and_body_limit(self):
        server = SpeechHttpServer(("127.0.0.1", 0))
        server.runtime.close()
        server.runtime = StubRuntime()
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=2)
            connection.request(
                "POST", "/cancel", json.dumps({"requestId": "active"}),
                {"Content-Type": "application/json"},
            )
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read()), {
                "requestId": "active", "cancelled": True, "previousStatus": "active"
            })
            connection.close()

            connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=2)
            connection.putrequest("POST", "/synthesize")
            connection.putheader("Content-Type", "application/json")
            connection.putheader("Content-Length", str(48 * 1024 * 1024 + 1))
            connection.endheaders()
            response = connection.getresponse()
            self.assertEqual(response.status, 413)
            self.assertEqual(json.loads(response.read()), {
                "error": "speech request body size is invalid"
            })
            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)

    def test_public_synthesis_transcription_and_cancel_validate_exact_envelopes(self):
        server = SpeechHttpServer(("127.0.0.1", 0))
        server.runtime.close()
        server.runtime = StubRuntime()
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            accepted = [
                ("/synthesize", adapter_request()),
                ("/transcribe", transcription_request()),
                ("/cancel", {"requestId": "speech-one"}),
            ]
            for path, payload in accepted:
                status, result = post(server, path, payload)
                self.assertEqual(status, 200)
                self.assertEqual(result["requestId"], payload["requestId"])

            invalid_adapter = adapter_request()
            invalid_adapter["unexpected"] = True
            invalid_scalar = adapter_request()
            invalid_scalar["segmentIndex"] = True
            invalid_transcription = transcription_request()
            invalid_transcription["byteSize"] = "4"
            invalid = [
                ("/synthesize", invalid_adapter),
                ("/synthesize", invalid_scalar),
                ("/transcribe", invalid_transcription),
                ("/cancel", {"requestId": "speech-one", "reason": "stale"}),
            ]
            for path, payload in invalid:
                status, result = post(server, path, payload)
                self.assertEqual(status, 400)
                self.assertEqual(set(result), {"error"})

            status, result = post_raw(server, "/synthesize", b"{")
            self.assertEqual(status, 400)
            self.assertEqual(set(result), {"error"})

            self.assertEqual([call[0] for call in server.runtime.requests], ["synthesize", "transcribe"])
            self.assertEqual(server.runtime.cancellations, ["speech-one"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)

    def test_public_runtime_failures_return_service_unavailable(self):
        server = SpeechHttpServer(("127.0.0.1", 0))
        server.runtime.close()
        server.runtime = FailingRuntime()
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            status, result = post(server, "/synthesize", adapter_request())
            self.assertEqual(status, 503)
            self.assertEqual(result, {"error": "speech service unavailable"})

            status, result = post(server, "/cancel", {"requestId": "speech-one"})
            self.assertEqual(status, 503)
            self.assertEqual(result, {"error": "speech service unavailable"})
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)


class StubRuntime:
    def __init__(self):
        self.requests = []
        self.cancellations = []

    def close(self):
        pass

    def request(self, operation, request=None):
        self.requests.append((operation, request))
        return {"operation": operation, "requestId": request["requestId"]}

    def cancel(self, request_id):
        self.cancellations.append(request_id)
        return {"requestId": request_id, "cancelled": True, "previousStatus": "active"}


class FailingRuntime(StubRuntime):
    def request(self, operation, request=None):
        raise RuntimeError("speech service unavailable")

    def cancel(self, request_id):
        raise RuntimeError("speech service unavailable")


def post(server, path, payload):
    return post_raw(server, path, json.dumps(payload).encode("utf-8"))


def post_raw(server, path, payload):
    connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=2)
    connection.request("POST", path, payload, {"Content-Type": "application/json"})
    response = connection.getresponse()
    result = json.loads(response.read())
    status = response.status
    connection.close()
    return status, result


def adapter_request():
    digest = "1" * 64
    return {
        "version": "1",
        "requestId": "speech-one",
        "cacheKey": "2" * 64,
        "segmentIndex": 0,
        "profileRecord": {
            "version": "1",
            "profileDigest": "3" * 64,
            "profile": {
                "version": "1",
                "profileId": "voice-one",
                "npcId": "npc-one",
                "revision": 1,
                "seed": 7,
                "language": "en-US",
                "delivery": {"pace": 1, "pitchSemitones": 0, "energy": 1},
                "preset": {"presetId": "chatterbox-nano-built-in", "artifactSha256": "4" * 64},
                "engine": {
                    "backendId": "chatterbox-nano",
                    "modelRevision": "nano",
                    "modelSha256": digest,
                    "runtimeId": "urbe-local-speech",
                    "runtimeRevision": "1",
                    "runtimeSha256": "5" * 64,
                },
                "approvedReactions": [],
            },
        },
        "delivery": {"pace": 1, "pitchSemitones": 0, "energy": 1},
        "inference": {"seed": 7, "options": {}},
        "output": {
            "sampleRate": 24000,
            "channels": 1,
            "codec": "pcm_s16le",
            "codecVersion": "pcm-s16le-v1",
        },
        "spans": [{"spanIndex": 0, "span": {"kind": "text", "text": "Wait here."}}],
    }


def transcription_request():
    audio = b"RIFF"
    return {
        "version": "1",
        "requestId": "microphone-one",
        "mediaType": "audio/wav",
        "byteSize": len(audio),
        "sha256": hashlib.sha256(audio).hexdigest(),
        "dataBase64": "UklGRg==",
    }


if __name__ == "__main__":
    unittest.main()
