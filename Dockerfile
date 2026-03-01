FROM n8nio/n8n:latest

USER root

# 1. Restore the 'apk' package manager (which n8n v2 removes for security)
RUN ARCH=$(uname -m) && \
    wget -qO- "http://dl-cdn.alpinelinux.org/alpine/latest-stable/main/${ARCH}/" | \
    grep -o 'href="apk-tools-static-[^"]*\.apk"' | head -1 | cut -d'"' -f2 | \
    xargs -I {} wget -q "http://dl-cdn.alpinelinux.org/alpine/latest-stable/main/${ARCH}/{}" && \
    tar -xzf apk-tools-static-*.apk && \
    ./sbin/apk.static -X http://dl-cdn.alpinelinux.org/alpine/latest-stable/main -U --allow-untrusted --initdb add apk-tools && \
    rm apk-tools-static-*.apk

# 2. Now we can use apk to install poppler-utils and xz (for ffmpeg)
RUN apk add --no-cache poppler-utils xz mupdf-tools ghostscript


# 3. Install FFmpeg (Static build)
ADD https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz /tmp/ffmpeg.tar.xz
RUN mkdir -p /tmp/ffmpeg-unpack && \
    tar -xJf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg-unpack --strip-components=1 && \
    mv /tmp/ffmpeg-unpack/ffmpeg /usr/local/bin/ffmpeg && \
    chmod +x /usr/local/bin/ffmpeg && \
    rm -rf /tmp/ffmpeg*

USER node