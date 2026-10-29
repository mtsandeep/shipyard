# Single image shared by the api / engine / ui containers.
# Each service picks its entrypoint via `command:` in docker-compose.yml.
FROM oven/bun:1.3-debian

# git: build-time repo clones; nginx: deployment activation; node+npm + curl:
# healthchecks and build tooling for deployed apps. pm0 — the PM2-compatible
# Go supervisor this project drives — is installed from its official release
# (github.com/thakurdotdev/pm0, same author as ShipYard). systemd does not
# exist in containers, so nginx reload during activation will fail — dashboard
# and builds still work (known local limitation).
ARG PM0_VERSION=v0.1.7
RUN apt-get update \
  && apt-get install -y --no-install-recommends git nginx sudo curl ca-certificates nodejs npm \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL "https://github.com/thakurdotdev/pm0/releases/download/${PM0_VERSION}/pm0-linux-amd64" -o /usr/local/bin/pm0 \
  && chmod +x /usr/local/bin/pm0

# Docker CLI for USE_DOCKER=true app deployments; the daemon is the host's,
# reached through the mounted /var/run/docker.sock (see docker-compose.yml).
COPY --from=docker:28-cli /usr/local/bin/docker /usr/local/bin/docker

WORKDIR /app

# Copy manifests first so dependency install layers cache independently of source.
COPY package.json bun.lock ./
COPY packages/control-api/package.json packages/control-api/
COPY packages/deploy-engine/package.json packages/deploy-engine/
COPY packages/ui/package.json packages/ui/
RUN bun install --frozen-lockfile

COPY . .

# Build the API and the engine bundles (mirrors each package's build script).
RUN cd packages/control-api \
  && bun build src/index.ts --outdir dist --target=bun --packages=external
RUN cd packages/deploy-engine \
  && bun build src/index.ts src/static-server.ts --outdir dist --target=bun --packages=external

# typescript@7 (native, no lib/typescript.js) is not recognized by next build's
# TypeScript detection, which would try to auto-install TS 5 via npm (absent in
# this image). Install a ui-local TS 5 up front; type checking is disabled in
# next.config.ts anyway.
RUN cd packages/ui && bun add -d typescript@5

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time; the
# browser reaches the API on the host-published port. Override per environment
# with --build-arg. BASE_DOMAIN keeps new-project subdomains off the author's
# real domain.
ARG NEXT_PUBLIC_API_URL=http://localhost:4010
ARG NEXT_PUBLIC_BASE_DOMAIN=localhost
RUN cd packages/ui \
  && NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_PUBLIC_BASE_DOMAIN=${NEXT_PUBLIC_BASE_DOMAIN} bun run build

# Where the deploy engine clones/builds deployed apps (mounted as a volume).
RUN mkdir -p /var/lib/shipyard/apps

EXPOSE 4010 4012 4013
