# Headless Freeciv 3.1.4 server with the JSON protocol compiled in.
# The JSON protocol (used by freeciv-web) lets a TypeScript client join as a
# real player: unit orders, city production, research, diplomacy and chat.
# Binary-protocol clients still work; the server detects JSON per connection.
FROM debian:trixie-slim AS build
ARG FREECIV_VERSION=3.1.4
ARG FREECIV_SHA256=14999bb903c4507cc287d5a8dd1b89eee623bb41b4e01e0836567fb5f13296e4
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils build-essential meson ninja-build pkg-config python3 \
      libjansson-dev zlib1g-dev libbz2-dev liblzma-dev libzstd-dev \
      libcurl4-openssl-dev libsqlite3-dev libicu-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSL -o freeciv.tar.xz "https://files.freeciv.org/stable/freeciv-${FREECIV_VERSION}.tar.xz" \
 && if [ -n "$FREECIV_SHA256" ]; then echo "$FREECIV_SHA256  freeciv.tar.xz" | sha256sum -c -; fi \
 && tar xf freeciv.tar.xz && rm freeciv.tar.xz
# Disable delta compression for every packet, so each JSON packet carries all
# of its fields. Our clients then need no per-packet cache or bool folding.
# Stock binary clients are NOT compatible with this server.
RUN sed -E -i '/^PACKET_[A-Z0-9_]+ *= *[0-9]+;/{/no-delta/!s/$/, no-delta/}' \
      "freeciv-${FREECIV_VERSION}/common/networking/packets.def"
RUN meson setup /build "freeciv-${FREECIV_VERSION}" \
      --prefix=/opt/freeciv --buildtype=release \
      -Dclients=[] -Dfcmp=[] -Dnls=false -Dreadline=false -Daudio=false -Dack_experimental=true \
      -Djson-protocol=true -Dserver=enabled \
 && ninja -C /build && ninja -C /build install

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libjansson4 zlib1g libbz2-1.0 liblzma5 libzstd1 libcurl4t64 libsqlite3-0 libicu76 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /opt/freeciv /opt/freeciv
# libfreeciv.so lands in an arch-specific libdir (aarch64 or x86_64).
RUN dirname "$(find /opt/freeciv/lib -name libfreeciv.so)" > /etc/ld.so.conf.d/freeciv.conf && ldconfig
RUN useradd -m civ
USER civ
WORKDIR /home/civ
EXPOSE 5556
ENTRYPOINT ["/opt/freeciv/bin/freeciv-server"]
