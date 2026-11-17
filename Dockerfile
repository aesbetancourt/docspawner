# docspawner worker: a stateless HTTP service that renders Typst templates to PDF.
# Build: docker build -t docspawner .
# Run:   docker run --init --read-only --tmpfs /tmp -p 3000:3000 docspawner

ARG NODE_IMAGE=node:24-slim

# --- Typst: download the pinned release and check its SHA-256 ----------------
FROM ${NODE_IMAGE} AS typst
ARG TYPST_VERSION=0.15.1
ARG TYPST_SHA256_AMD64=a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c
ARG TYPST_SHA256_ARM64=5aa8d74a3d906e60ea12a66ac2f37f8eef1b14cbad7182a745e393a10c23dcee
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && case "$TARGETARCH" in \
      amd64) arch=x86_64;  sha="$TYPST_SHA256_AMD64" ;; \
      arm64) arch=aarch64; sha="$TYPST_SHA256_ARM64" ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/typst.tar.xz \
      "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${arch}-unknown-linux-musl.tar.xz" \
 && echo "${sha}  /tmp/typst.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/typst.tar.xz -C /tmp \
 && install -m 0755 "/tmp/typst-${arch}-unknown-linux-musl/typst" /usr/local/bin/typst \
 && typst --version

# --- Build: compile TypeScript ----------------------------------------------
FROM ${NODE_IMAGE} AS build
RUN npm install -g pnpm@12.4.2
WORKDIR /src
COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json ./
RUN pnpm install --frozen-lockfile
COPY src ./src
RUN pnpm build

# --- Production dependencies only ----------------------------------------------
FROM ${NODE_IMAGE} AS deps
RUN npm install -g pnpm@12.4.2
WORKDIR /src
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# --- Runtime: Node, the Typst binary, and the built worker. No build tools. ---
FROM ${NODE_IMAGE} AS runtime
COPY --from=typst /usr/local/bin/typst /usr/local/bin/typst
WORKDIR /app
COPY --from=deps --chown=node:node /src/node_modules ./node_modules
COPY --from=build --chown=node:node /src/dist ./dist
COPY --chown=node:node package.json ./
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
