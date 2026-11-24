FROM node:24-bookworm-slim

# The gateway starts and stops containers by running the Docker CLI against the host's Docker socket.
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:27-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose

# openssl makes the Gateway's own certificate for its encrypted setup address (lib/tls.js).
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server.js reset-password.js ./
COPY lib ./lib
COPY public ./public
COPY catalog ./catalog
COPY caddy ./caddy

ENV NODE_ENV=production
EXPOSE 8080 8443
# Runs as root: reaching /var/run/docker.sock needs it. See docs-admin/site/security.md.
CMD ["node", "server.js"]
