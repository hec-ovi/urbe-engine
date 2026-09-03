from __future__ import annotations

import base64
import hashlib
import tempfile
from pathlib import Path
from typing import Any

import numpy as np

from artifacts import ArtifactSet, CHATTERBOX_ARTIFACTS, WHISPER_ARTIFACTS


class ChatterboxNano:
    SAMPLE_RATE = 24000

    def __init__(self, root: Path, device: str = "cpu"):
        self.root = root
        self.device = device
        self.model_digest = ArtifactSet(root, CHATTERBOX_ARTIFACTS).validate()
        self._model = None

    def load(self) -> None:
        if self._model is not None:
            return
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        self._model = ChatterboxTurboTTS.from_local(self.root, device=self.device, nano=True)

    def synthesize(self, request: dict[str, Any]) -> dict[str, Any]:
        self.load()
        self._assert_profile(request["profileRecord"])
        self._assert_delivery(request["delivery"])
        text = spans_to_text(request["spans"])
        options = request["inference"]["options"]
        allowed = {"temperature", "top_p", "top_k", "repetition_penalty"}
        unknown = set(options) - allowed
        if unknown:
            raise ValueError(f"unsupported Chatterbox inference option: {sorted(unknown)[0]}")

        import torch

        torch.manual_seed(request["inference"]["seed"])
        wave = self._model.generate(text, **options).squeeze().detach().cpu().numpy()
        pcm = float_to_pcm16(wave)
        output = request["output"]
        if output != {
            "sampleRate": self.SAMPLE_RATE,
            "channels": 1,
            "codec": "pcm_s16le",
            "codecVersion": "pcm-s16le-v1",
        }:
            raise ValueError("Chatterbox output request does not match local PCM capability")
        return {
            "version": "1",
            "requestId": request["requestId"],
            "segmentIndex": request["segmentIndex"],
            "sequence": 0,
            "sampleRate": self.SAMPLE_RATE,
            "channels": 1,
            "codec": "pcm_s16le",
            "frameCount": len(pcm) // 2,
            "byteSize": len(pcm),
            "sha256": hashlib.sha256(pcm).hexdigest(),
            "dataBase64": base64.b64encode(pcm).decode("ascii"),
            "spanIndex": request["spans"][0]["spanIndex"],
        }

    @staticmethod
    def _assert_delivery(delivery: dict[str, float]) -> None:
        if delivery != {"pace": 1, "pitchSemitones": 0, "energy": 1}:
            raise ValueError("Chatterbox Nano built-in voice accepts neutral delivery only")

    @staticmethod
    def _assert_profile(record: dict[str, Any]) -> None:
        profile = record.get("profile", {})
        expected = {
            "presetId": "chatterbox-nano-built-in",
            "artifactSha256": "b1852099306fd6a7814eb9d0bd10186caba7249596cc23868f78a0eefbfa5033",
        }
        if profile.get("preset") != expected or "reference" in profile:
            raise ValueError("Chatterbox Nano runtime accepts only its verified built-in preset")


class FasterWhisper:
    def __init__(self, root: Path, device: str = "cpu", compute_type: str = "int8"):
        self.root = root
        self.device = device
        self.compute_type = compute_type
        self.model_digest = ArtifactSet(root, WHISPER_ARTIFACTS).validate()
        self._model = None

    def load(self) -> None:
        if self._model is not None:
            return
        from faster_whisper import WhisperModel

        self._model = WhisperModel(str(self.root), device=self.device, compute_type=self.compute_type)

    def transcribe(self, request: dict[str, Any]) -> dict[str, Any]:
        self.load()
        audio = base64.b64decode(request["dataBase64"], validate=True)
        if len(audio) != request["byteSize"]:
            raise ValueError("microphone byteSize disagrees with decoded audio")
        if hashlib.sha256(audio).hexdigest() != request["sha256"]:
            raise ValueError("microphone SHA-256 disagrees with decoded audio")
        suffix = media_suffix(request["mediaType"])
        with tempfile.NamedTemporaryFile(suffix=suffix) as source:
            source.write(audio)
            source.flush()
            segments, info = self._model.transcribe(
                source.name,
                beam_size=5,
                language=request.get("language"),
                condition_on_previous_text=False,
                vad_filter=True,
            )
            realized = [
                {"startSeconds": item.start, "endSeconds": item.end, "text": item.text.strip()}
                for item in segments
                if item.text.strip()
            ]
        return {
            "version": "1",
            "requestId": request["requestId"],
            "text": " ".join(item["text"] for item in realized),
            "language": info.language,
            "languageProbability": info.language_probability,
            "segments": realized,
        }


def spans_to_text(spans: list[dict[str, Any]]) -> str:
    controls = {"laugh", "chuckle", "cough"}
    parts: list[str] = []
    for entry in spans:
        span = entry["span"]
        if span["kind"] == "text":
            parts.append(span["text"])
        elif span.get("control") in controls:
            parts.append(f"[{span['control']}]")
        else:
            raise ValueError(f"unsupported Chatterbox span: {span.get('control')}")
    return " ".join(parts)


def float_to_pcm16(wave: np.ndarray) -> bytes:
    clipped = np.clip(wave, -1.0, 1.0)
    return np.rint(clipped * 32767.0).astype("<i2").tobytes()


def media_suffix(media_type: str) -> str:
    suffixes = {
        "audio/wav": ".wav",
        "audio/webm": ".webm",
        "audio/ogg": ".ogg",
        "audio/mp4": ".m4a",
    }
    if media_type not in suffixes:
        raise ValueError(f"unsupported microphone media type: {media_type}")
    return suffixes[media_type]
