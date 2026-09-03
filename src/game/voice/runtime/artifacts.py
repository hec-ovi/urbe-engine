from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path


class ArtifactError(RuntimeError):
    pass


@dataclass(frozen=True)
class Artifact:
    name: str
    sha256: str


CHATTERBOX_ARTIFACTS = (
    Artifact("added_tokens.json", "72e4ab6acb0d9309ac3df4b526ae5fd80a2da5bc5ab7bb02d85096a374f69193"),
    Artifact("conds.pt", "b1852099306fd6a7814eb9d0bd10186caba7249596cc23868f78a0eefbfa5033"),
    Artifact("merges.txt", "1ce1664773c50f3e0cc8842619a93edc4624525b728b188a9e0be33b7726adc5"),
    Artifact("s3gen_meanflow.safetensors", "d65cb687a2ed581ee6cc297e919ffefa63386944f42364ae13b78a594945514f"),
    Artifact("special_tokens_map.json", "92ba8063bf40aa163eadebbfe0de07c2aebe44cf0d4a9e8726580b0781fd2640"),
    Artifact("t3_nano_v1.safetensors", "72b110185087d945dbdf54dee4e333848e1811bdd5fd6cb16ceb8da50006f0c9"),
    Artifact("tokenizer_config.json", "bca16a2ac1ddbd78b8d6228f0031884cc74b6ea54b967d6f6d2ebae9ccde23e6"),
    Artifact("ve.safetensors", "f0921cab452fa278bc25cd23ffd59d36f816d7dc5181dd1bef9751a7fb61f63c"),
    Artifact("vocab.json", "f6bd25a65e4e63ca31360e9fb11c7e4f9a391a78385d640acd814092dd6eee4f"),
)
WHISPER_ARTIFACTS = (
    Artifact("config.json", "b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828"),
    Artifact("model.bin", "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671"),
    Artifact("tokenizer.json", "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab"),
    Artifact("vocabulary.txt", "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913"),
)


class ArtifactSet:
    def __init__(self, root: Path, expected: tuple[Artifact, ...]):
        self.root = root.expanduser().resolve()
        self.expected = expected

    def validate(self) -> str:
        rows: list[str] = []
        for artifact in self.expected:
            path = self.root / artifact.name
            if not path.is_file():
                raise ArtifactError(f"required model artifact is absent: {path}")
            digest = file_sha256(path)
            if digest != artifact.sha256:
                raise ArtifactError(f"model artifact digest disagrees: {path}")
            rows.append(f"{artifact.name}:{digest}")
        return sha256(("\n".join(rows) + "\n").encode("utf-8")).hexdigest()


def file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()
