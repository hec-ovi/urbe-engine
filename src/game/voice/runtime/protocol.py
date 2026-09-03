from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, TextIO

from speech_models import ChatterboxNano, FasterWhisper


class SpeechProtocol:
    def __init__(self, tts: ChatterboxNano, stt: FasterWhisper, runtime_root: Path):
        self.tts = tts
        self.stt = stt
        self.runtime_digest = runtime_sha256(runtime_root)

    def handle(self, message: dict[str, Any]) -> dict[str, Any]:
        operation = message.get("operation")
        if operation == "capabilities":
            return self.capabilities()
        if operation == "health":
            self.tts.load()
            self.stt.load()
            return {"status": "ready", **self.capabilities()}
        if operation == "synthesize":
            return {"chunk": self.tts.synthesize(message["request"])}
        if operation == "transcribe":
            return self.stt.transcribe(message["request"])
        raise ValueError(f"unknown speech operation: {operation}")

    def capabilities(self) -> dict[str, Any]:
        return {
            "tts": {
                "version": "1",
                "adapterId": "chatterbox-nano-local",
                "streaming": False,
                "cancellable": True,
                "maxConcurrent": 1,
                "languages": ["en-US"],
                "engine": {
                    "backendId": "chatterbox-nano",
                    "modelRevision": "ResembleAI/chatterbox-nano@71ccd1d",
                    "modelSha256": self.tts.model_digest,
                    "runtimeId": "urbe-local-speech",
                    "runtimeRevision": "1.0.0",
                    "runtimeSha256": self.runtime_digest,
                },
                "output": {
                    "sampleRate": 24000,
                    "channels": 1,
                    "codec": "pcm_s16le",
                    "codecVersion": "pcm-s16le-v1",
                },
                "controls": {
                    "laugh": "native",
                    "chuckle": "native",
                    "cough": "native",
                    "breath": "unsupported",
                    "sigh": "unsupported",
                    "whisper": "unsupported",
                    "pause_ms": "exact-silence",
                    "emotion": "unsupported",
                },
            },
            "stt": {
                "version": "1",
                "adapterId": "faster-whisper-local",
                "modelRevision": "Systran/faster-whisper-small@536b066",
                "modelSha256": self.stt.model_digest,
                "runtimeRevision": "faster-whisper-1.2.1",
                "mediaTypes": ["audio/wav", "audio/webm", "audio/ogg", "audio/mp4"],
                "languages": ["auto", "en"],
            },
        }

    def serve(self, source: TextIO, destination: TextIO) -> None:
        for line in source:
            if not line.strip():
                continue
            identifier = None
            try:
                message = json.loads(line)
                identifier = message.get("id")
                response = {"id": identifier, "ok": True, "result": self.handle(message)}
            except Exception as error:
                response = {"id": identifier, "ok": False, "error": str(error)}
            destination.write(json.dumps(response, separators=(",", ":")) + "\n")
            destination.flush()


def runtime_sha256(root: Path) -> str:
    digest = hashlib.sha256()
    for name in (
        "artifacts.py", "Dockerfile", "http_service.py", "protocol.py", "pyproject.toml",
        "service.py", "speech_models.py", "uv.lock",
    ):
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        digest.update((root / name).read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()
