FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install --no-install-recommends --yes expect ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG PI_VERSION
RUN npm init --yes >/dev/null \
  && npm install --ignore-scripts --no-audit --no-fund @earendil-works/pi-coding-agent@${PI_VERSION}

ARG PI_UPGRADED_VERSION
ENV PI_TEST_BASE_VERSION=${PI_VERSION}
ENV PI_TEST_UPGRADED_VERSION=${PI_UPGRADED_VERSION}

COPY package.json auto-upgrade/package.json
COPY index.ts restart.ts handoff.mjs auto-upgrade/
COPY e2e/fake-pi e2e/fake-pi
COPY e2e/fake-provider.ts e2e/fake-provider.ts
COPY e2e/session-marker.ts e2e/session-marker.ts
COPY e2e/drive.expect e2e/drive.expect
COPY e2e/run-container.mjs e2e/run-container.mjs

RUN mkdir -p /app/bin /tmp/pi-agent \
  && cp /app/e2e/fake-pi /app/bin/pi \
  && chmod +x /app/bin/pi /app/e2e/drive.expect

ENTRYPOINT ["node", "/app/e2e/run-container.mjs"]
