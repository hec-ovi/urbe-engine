FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build

WORKDIR /service
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml uv.lock ./
ENV UV_PROJECT_ENVIRONMENT=/opt/urbe-speech
RUN uv sync --frozen --no-dev --no-editable

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /service
COPY --from=build /opt/urbe-speech /opt/urbe-speech
COPY Dockerfile pyproject.toml uv.lock artifacts.py http_service.py protocol.py service.py speech_models.py ./

ENV VIRTUAL_ENV=/opt/urbe-speech
ENV PATH="/opt/urbe-speech/bin:$PATH"
ENV URBE_CHATTERBOX_MODEL_DIR=/models/hf/chatterbox-nano
ENV URBE_WHISPER_MODEL_DIR=/models/hf/models--Systran--faster-whisper-small/snapshots/536b0662742c02347bc0e980a01041f333bce120
ENV URBE_SPEECH_DEVICE=cpu
ENV URBE_WHISPER_COMPUTE_TYPE=int8

EXPOSE 8091
CMD ["python", "http_service.py", "--host", "0.0.0.0", "--port", "8091"]
