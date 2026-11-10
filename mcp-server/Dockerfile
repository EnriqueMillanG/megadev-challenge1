# --- build whisper.cpp (speech to text, runs on CPU) ---
FROM debian:bookworm-slim AS whisper
ARG WHISPER_CPP_VERSION=v1.7.6
ARG WHISPER_MODEL=base.en
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${WHISPER_CPP_VERSION} https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
# Portable build (the build machine is not the run machine), with AVX2 which Cloud Run CPUs have.
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF \
      -DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON \
 && cmake --build build -j"$(nproc)" --target whisper-cli \
 && cp build/bin/whisper-cli /usr/local/bin/whisper-cli
RUN mkdir -p /models && curl -fsSL -o /models/ggml-${WHISPER_MODEL}.bin \
      https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL}.bin

# --- app ---
FROM node:22-bookworm-slim
ARG WHISPER_MODEL=base.en
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgomp1 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=whisper /usr/local/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper /models /models
ENV WHISPER_MODEL=/models/ggml-${WHISPER_MODEL}.bin NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
