from __future__ import annotations

import argparse
import json
import os
import sys
import wave
from pathlib import Path

from protocol import SpeechProtocol
from speech_models import ChatterboxNano, FasterWhisper


def default_models_root() -> Path:
    return Path.home() / "models" / "hf"


def create_protocol() -> SpeechProtocol:
    models = default_models_root()
    chatterbox_root = Path(os.environ.get("URBE_CHATTERBOX_MODEL_DIR", models / "chatterbox-nano"))
    whisper_root = Path(os.environ.get(
        "URBE_WHISPER_MODEL_DIR",
        models / "models--Systran--faster-whisper-small" / "snapshots" / "536b0662742c02347bc0e980a01041f333bce120",
    ))
    device = os.environ.get("URBE_SPEECH_DEVICE", "cpu")
    compute_type = os.environ.get("URBE_WHISPER_COMPUTE_TYPE", "int8")
    return SpeechProtocol(
        ChatterboxNano(chatterbox_root, device),
        FasterWhisper(whisper_root, device, compute_type),
        Path(__file__).resolve().parent,
    )


def smoke(protocol: SpeechProtocol) -> dict:
    capabilities = protocol.handle({"operation": "health"})
    manifest = capabilities["tts"]
    request = {
        "version": "1",
        "requestId": "speech-runtime-smoke",
        "cacheKey": "0" * 64,
        "segmentIndex": 0,
        "profileRecord": {
            "version": "1",
            "profileDigest": "0" * 64,
            "profile": {
                "preset": {
                    "presetId": "chatterbox-nano-built-in",
                    "artifactSha256": "b1852099306fd6a7814eb9d0bd10186caba7249596cc23868f78a0eefbfa5033",
                }
            },
        },
        "delivery": {"pace": 1, "pitchSemitones": 0, "energy": 1},
        "inference": {"seed": 7, "options": {}},
        "output": manifest["output"],
        "spans": [{"spanIndex": 0, "span": {"kind": "text", "text": "The tram leaves after midnight."}}],
    }
    chunk = protocol.handle({"operation": "synthesize", "request": request})["chunk"]
    import base64
    import hashlib
    import tempfile

    pcm = base64.b64decode(chunk["dataBase64"])
    with tempfile.NamedTemporaryFile(suffix=".wav") as audio:
        with wave.open(audio.name, "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(chunk["sampleRate"])
            output.writeframes(pcm)
        wav_bytes = Path(audio.name).read_bytes()
        encoded = base64.b64encode(wav_bytes).decode("ascii")
    transcript = protocol.handle({
        "operation": "transcribe",
        "request": {
            "version": "1",
            "requestId": "speech-runtime-smoke-stt",
            "mediaType": "audio/wav",
            "byteSize": len(wav_bytes),
            "sha256": hashlib.sha256(wav_bytes).hexdigest(),
            "dataBase64": encoded,
            "language": "en",
        },
    })
    if not transcript["text"]:
        raise RuntimeError("faster-whisper returned no text for Chatterbox smoke audio")
    return {
        "status": "ready",
        "ttsFrames": chunk["frameCount"],
        "transcript": transcript["text"],
        "ttsModelSha256": manifest["engine"]["modelSha256"],
        "sttModelSha256": capabilities["stt"]["modelSha256"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("serve", "health", "smoke"), nargs="?", default="serve")
    args = parser.parse_args()
    protocol = create_protocol()
    if args.mode == "serve":
        protocol.serve(sys.stdin, sys.stdout)
    elif args.mode == "health":
        print(json.dumps(protocol.handle({"operation": "health"}), separators=(",", ":")))
    else:
        print(json.dumps(smoke(protocol), separators=(",", ":")))


if __name__ == "__main__":
    main()
