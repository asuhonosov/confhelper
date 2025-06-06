# ---------- STAGE 1: база с ffmpeg & curl ----------
FROM debian:bookworm-slim AS base
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
        ffmpeg ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# ---------- STAGE 2: скачиваем готовый бинарь прокси ----------
# берём последний релиз прямо из GitHub Releases
FROM base AS final
# URL релиза: https://github.com/vitaliy-vi/yandex-stt-ws-proxy/releases/latest
RUN curl -L \
  https://github.com/vitaliy-vi/yandex-stt-ws-proxy/releases/latest/download/yandex-stt-ws-proxy_linux_amd64 \
  -o /usr/local/bin/stt-proxy && \
  chmod +x /usr/local/bin/stt-proxy

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/stt-proxy"]
