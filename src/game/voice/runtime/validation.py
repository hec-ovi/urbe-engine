from __future__ import annotations

import base64
import hashlib
import math
import re
from typing import Any


ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
LANGUAGE = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
OPTION = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]*$")


class SpeechEnvelopeError(ValueError):
    pass


def validate_request(operation: str, value: Any) -> dict[str, Any]:
    if operation == "synthesize":
        _adapter_request(value, "request")
    elif operation == "transcribe":
        _transcription_request(value, "request")
    elif operation == "cancel":
        _closed(value, {"requestId"}, set(), "request")
        _id(value["requestId"], "request.requestId")
    else:
        raise SpeechEnvelopeError(f"unsupported request operation: {operation}")
    return value


def _adapter_request(value: Any, path: str) -> None:
    required = {
        "version", "requestId", "cacheKey", "segmentIndex", "profileRecord",
        "delivery", "inference", "output", "spans",
    }
    _closed(value, required, set(), path)
    _const(value["version"], "1", f"{path}.version")
    _id(value["requestId"], f"{path}.requestId")
    _sha(value["cacheKey"], f"{path}.cacheKey")
    _integer(value["segmentIndex"], f"{path}.segmentIndex", minimum=0)
    _profile_record(value["profileRecord"], f"{path}.profileRecord")
    _delivery(value["delivery"], f"{path}.delivery")
    _inference(value["inference"], f"{path}.inference")
    _output(value["output"], f"{path}.output")
    spans = _array(value["spans"], f"{path}.spans", minimum=1)
    for index, entry in enumerate(spans):
        entry_path = f"{path}.spans[{index}]"
        _closed(entry, {"spanIndex", "span"}, set(), entry_path)
        _integer(entry["spanIndex"], f"{entry_path}.spanIndex", minimum=0)
        _adapter_span(entry["span"], f"{entry_path}.span")


def _transcription_request(value: Any, path: str) -> None:
    required = {"version", "requestId", "mediaType", "byteSize", "sha256", "dataBase64"}
    _closed(value, required, {"language"}, path)
    _const(value["version"], "1", f"{path}.version")
    _id(value["requestId"], f"{path}.requestId")
    _enum(value["mediaType"], {"audio/wav", "audio/webm", "audio/ogg", "audio/mp4"}, f"{path}.mediaType")
    _integer(value["byteSize"], f"{path}.byteSize", minimum=1, maximum=33_554_432)
    _sha(value["sha256"], f"{path}.sha256")
    encoded = _string(value["dataBase64"], f"{path}.dataBase64", minimum=1)
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except Exception as error:
        raise SpeechEnvelopeError(f"{path}.dataBase64 is not base64") from error
    if len(decoded) != value["byteSize"]:
        raise SpeechEnvelopeError(f"{path}.byteSize disagrees with decoded audio")
    if hashlib.sha256(decoded).hexdigest() != value["sha256"]:
        raise SpeechEnvelopeError(f"{path}.sha256 disagrees with decoded audio")
    if "language" in value:
        _string(value["language"], f"{path}.language", minimum=2)


def _profile_record(value: Any, path: str) -> None:
    _closed(value, {"version", "profileDigest", "profile"}, set(), path)
    _const(value["version"], "1", f"{path}.version")
    _sha(value["profileDigest"], f"{path}.profileDigest")
    _profile(value["profile"], f"{path}.profile")


def _profile(value: Any, path: str) -> None:
    required = {
        "version", "profileId", "npcId", "revision", "seed", "language",
        "delivery", "engine", "approvedReactions",
    }
    _closed(value, required, {"reference", "preset"}, path)
    if ("reference" in value) == ("preset" in value):
        raise SpeechEnvelopeError(f"{path} requires exactly one voice source")
    _const(value["version"], "1", f"{path}.version")
    _id(value["profileId"], f"{path}.profileId")
    _id(value["npcId"], f"{path}.npcId")
    _integer(value["revision"], f"{path}.revision", minimum=1)
    _integer(value["seed"], f"{path}.seed", minimum=0, maximum=4_294_967_295)
    language = _string(value["language"], f"{path}.language")
    if not LANGUAGE.fullmatch(language):
        raise SpeechEnvelopeError(f"{path}.language is invalid")
    _delivery(value["delivery"], f"{path}.delivery")
    _engine(value["engine"], f"{path}.engine")
    reactions = _array(value["approvedReactions"], f"{path}.approvedReactions")
    for index, reaction in enumerate(reactions):
        reaction_path = f"{path}.approvedReactions[{index}]"
        _closed(reaction, {"control", "audio"}, set(), reaction_path)
        _enum(reaction["control"], {"laugh", "chuckle", "cough", "breath", "sigh"}, f"{reaction_path}.control")
        _audio_asset(reaction["audio"], f"{reaction_path}.audio")
    if "preset" in value:
        _closed(value["preset"], {"presetId", "artifactSha256"}, set(), f"{path}.preset")
        _id(value["preset"]["presetId"], f"{path}.preset.presetId")
        _sha(value["preset"]["artifactSha256"], f"{path}.preset.artifactSha256")
    else:
        _reference(value["reference"], f"{path}.reference")


def _reference(value: Any, path: str) -> None:
    _closed(value, {"media", "transcript", "provenance", "license", "consent"}, set(), path)
    media = value["media"]
    _closed(media, {"uri", "mediaType", "byteSize", "sha256"}, set(), f"{path}.media")
    _string(media["uri"], f"{path}.media.uri", minimum=1)
    media_type = _string(media["mediaType"], f"{path}.media.mediaType")
    if not media_type.startswith("audio/"):
        raise SpeechEnvelopeError(f"{path}.media.mediaType is invalid")
    _integer(media["byteSize"], f"{path}.media.byteSize", minimum=1)
    _sha(media["sha256"], f"{path}.media.sha256")
    _string(value["transcript"], f"{path}.transcript", minimum=1)
    provenance = value["provenance"]
    _closed(provenance, {"source", "creator"}, set(), f"{path}.provenance")
    _string(provenance["source"], f"{path}.provenance.source", minimum=1)
    _string(provenance["creator"], f"{path}.provenance.creator", minimum=1)
    license_value = value["license"]
    _closed(license_value, {"name", "uri", "allowsVoiceCloning"}, set(), f"{path}.license")
    _string(license_value["name"], f"{path}.license.name", minimum=1)
    _string(license_value["uri"], f"{path}.license.uri", minimum=1)
    _const(license_value["allowsVoiceCloning"], True, f"{path}.license.allowsVoiceCloning")
    consent = value["consent"]
    _closed(consent, {"granted", "scope", "grantedBy", "recordedAt"}, set(), f"{path}.consent")
    _const(consent["granted"], True, f"{path}.consent.granted")
    _const(consent["scope"], "voice-cloning", f"{path}.consent.scope")
    _string(consent["grantedBy"], f"{path}.consent.grantedBy", minimum=1)
    _string(consent["recordedAt"], f"{path}.consent.recordedAt", minimum=1)


def _engine(value: Any, path: str) -> None:
    fields = {"backendId", "modelRevision", "modelSha256", "runtimeId", "runtimeRevision", "runtimeSha256"}
    _closed(value, fields, set(), path)
    _id(value["backendId"], f"{path}.backendId")
    _string(value["modelRevision"], f"{path}.modelRevision", minimum=1)
    _sha(value["modelSha256"], f"{path}.modelSha256")
    _id(value["runtimeId"], f"{path}.runtimeId")
    _string(value["runtimeRevision"], f"{path}.runtimeRevision", minimum=1)
    _sha(value["runtimeSha256"], f"{path}.runtimeSha256")


def _audio_asset(value: Any, path: str) -> None:
    required = {"sampleRate", "channels", "codec", "frameCount", "byteSize", "sha256"}
    _closed(value, required, {"dataBase64", "uri"}, path)
    if ("dataBase64" in value) == ("uri" in value):
        raise SpeechEnvelopeError(f"{path} requires exactly one audio source")
    _integer(value["sampleRate"], f"{path}.sampleRate", minimum=8000)
    _integer(value["channels"], f"{path}.channels", minimum=1, maximum=2)
    _enum(value["codec"], {"pcm_s16le", "wav", "opus"}, f"{path}.codec")
    _integer(value["frameCount"], f"{path}.frameCount", minimum=0)
    _integer(value["byteSize"], f"{path}.byteSize", minimum=0)
    _sha(value["sha256"], f"{path}.sha256")
    if "dataBase64" in value:
        _string(value["dataBase64"], f"{path}.dataBase64")
    else:
        _string(value["uri"], f"{path}.uri", minimum=1)


def _delivery(value: Any, path: str) -> None:
    _closed(value, {"pace", "pitchSemitones", "energy"}, set(), path)
    _number(value["pace"], f"{path}.pace", exclusive_minimum=0)
    _number(value["pitchSemitones"], f"{path}.pitchSemitones")
    _number(value["energy"], f"{path}.energy", minimum=0)


def _inference(value: Any, path: str) -> None:
    _closed(value, {"seed", "options"}, set(), path)
    _integer(value["seed"], f"{path}.seed", minimum=0, maximum=4_294_967_295)
    options = _object(value["options"], f"{path}.options")
    for name, option in options.items():
        if not OPTION.fullmatch(name):
            raise SpeechEnvelopeError(f"{path}.options has invalid name {name}")
        if isinstance(option, bool) or isinstance(option, str):
            continue
        _number(option, f"{path}.options.{name}")


def _output(value: Any, path: str) -> None:
    _closed(value, {"sampleRate", "channels", "codec", "codecVersion"}, set(), path)
    _integer(value["sampleRate"], f"{path}.sampleRate", minimum=8000)
    _integer(value["channels"], f"{path}.channels", minimum=1, maximum=2)
    _enum(value["codec"], {"pcm_s16le", "wav", "opus"}, f"{path}.codec")
    _string(value["codecVersion"], f"{path}.codecVersion", minimum=1)


def _adapter_span(value: Any, path: str) -> None:
    data = _object(value, path)
    if data.get("kind") == "text":
        _closed(data, {"kind", "text"}, set(), path)
        _string(data["text"], f"{path}.text", minimum=1)
        return
    control = data.get("control")
    if data.get("kind") != "control":
        raise SpeechEnvelopeError(f"{path}.kind is invalid")
    if isinstance(control, str) and control in {"laugh", "chuckle", "cough", "breath", "sigh"}:
        _closed(data, {"kind", "control"}, set(), path)
    elif control == "whisper":
        _closed(data, {"kind", "control", "enabled"}, set(), path)
        if not isinstance(data["enabled"], bool):
            raise SpeechEnvelopeError(f"{path}.enabled must be a boolean")
    elif control == "emotion":
        _closed(data, {"kind", "control", "emotion", "intensity"}, set(), path)
        _enum(data["emotion"], {"neutral", "joy", "sadness", "anger", "fear", "surprise", "disgust", "tenderness"}, f"{path}.emotion")
        _number(data["intensity"], f"{path}.intensity", minimum=0, maximum=1)
    else:
        raise SpeechEnvelopeError(f"{path}.control is invalid")


def _closed(value: Any, required: set[str], optional: set[str], path: str) -> dict[str, Any]:
    data = _object(value, path)
    missing = required - set(data)
    if missing:
        raise SpeechEnvelopeError(f"{path} is missing {sorted(missing)[0]}")
    unknown = set(data) - required - optional
    if unknown:
        raise SpeechEnvelopeError(f"{path} has unknown field {sorted(unknown)[0]}")
    return data


def _object(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SpeechEnvelopeError(f"{path} must be an object")
    return value


def _array(value: Any, path: str, minimum: int = 0) -> list[Any]:
    if not isinstance(value, list) or len(value) < minimum:
        raise SpeechEnvelopeError(f"{path} must be an array with at least {minimum} entries")
    return value


def _string(value: Any, path: str, minimum: int = 0) -> str:
    if not isinstance(value, str) or len(value) < minimum:
        raise SpeechEnvelopeError(f"{path} must be a string")
    return value


def _id(value: Any, path: str) -> None:
    text = _string(value, path, minimum=1)
    if len(text) > 160 or not ID.fullmatch(text):
        raise SpeechEnvelopeError(f"{path} is invalid")


def _sha(value: Any, path: str) -> None:
    text = _string(value, path)
    if not SHA256.fullmatch(text):
        raise SpeechEnvelopeError(f"{path} must be a SHA-256 digest")


def _integer(value: Any, path: str, minimum: int | None = None, maximum: int | None = None) -> None:
    if isinstance(value, bool) or not isinstance(value, int):
        raise SpeechEnvelopeError(f"{path} must be an integer")
    if minimum is not None and value < minimum:
        raise SpeechEnvelopeError(f"{path} is below its minimum")
    if maximum is not None and value > maximum:
        raise SpeechEnvelopeError(f"{path} exceeds its maximum")


def _number(
    value: Any,
    path: str,
    minimum: float | None = None,
    maximum: float | None = None,
    exclusive_minimum: float | None = None,
) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise SpeechEnvelopeError(f"{path} must be a finite number")
    if minimum is not None and value < minimum:
        raise SpeechEnvelopeError(f"{path} is below its minimum")
    if maximum is not None and value > maximum:
        raise SpeechEnvelopeError(f"{path} exceeds its maximum")
    if exclusive_minimum is not None and value <= exclusive_minimum:
        raise SpeechEnvelopeError(f"{path} must be greater than {exclusive_minimum}")


def _enum(value: Any, allowed: set[Any], path: str) -> None:
    try:
        accepted = value in allowed
    except TypeError:
        accepted = False
    if not accepted:
        raise SpeechEnvelopeError(f"{path} is invalid")


def _const(value: Any, expected: Any, path: str) -> None:
    if type(value) is not type(expected) or value != expected:
        raise SpeechEnvelopeError(f"{path} must equal {expected!r}")
