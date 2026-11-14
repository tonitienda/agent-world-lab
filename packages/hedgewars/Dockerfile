# Hedgewars engine (hwengine) from Debian, plus a virtual display so the engine
# can render without a GPU. Our TypeScript code plays the role of the Hedgewars
# "frontend": it listens on a TCP port and the engine connects back to it.
FROM debian:trixie-slim AS shim
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && rm -rf /var/lib/apt/lists/*
COPY fpmask.c /fpmask.c
RUN gcc -O2 -shared -fPIC -o /fpmask.so /fpmask.c -ldl

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      hedgewars hedgewars-data xvfb xauth ffmpeg libgl1-mesa-dri socat pulseaudio pulseaudio-utils \
 && rm -rf /var/lib/apt/lists/*
# See fpmask.c: without it Mesa's software renderers crash the engine on arm64.
COPY --from=shim /fpmask.so /usr/local/lib/fpmask.so
RUN useradd -m hog
USER hog
WORKDIR /home/hog
# Game sound goes to a PulseAudio null sink so the recorder can capture it; the
# engine and `docker exec ffmpeg` both reach the daemon through this socket.
ENV SDL_AUDIODRIVER=pulseaudio PULSE_SERVER=unix:/tmp/pulse.sock LIBGL_ALWAYS_SOFTWARE=1 LD_PRELOAD=/usr/local/lib/fpmask.so
