#!/usr/bin/env bash
# Waypoints Gateway: one-step install.
#
#   curl -fsSL <address of this file> | bash
#   bash install.sh                 (if you already have the file)
#   bash install.sh --app fond      (start with Fond Waypoints already ticked)
#
# It checks that Docker is ready, saves the Gateway's compose file in a folder (default ~/waypoints-gateway),
# starts the Gateway, and tells you the address to open. Run it again at any time to update the Gateway.
set -euo pipefail

DIR="${WAYPOINTS_GATEWAY_DIR:-$HOME/waypoints-gateway}"
APP=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)  DIR="${2:?--dir needs a folder}"; shift 2 ;;
    --app)  APP="${2:?--app needs an app name, for example fond}"; shift 2 ;;
    -h|--help)
      cat <<'HELP'
Waypoints Gateway installer

  --dir <folder>   where to keep the Gateway's files (default: ~/waypoints-gateway)
  --app <name>     start with an app already ticked: fond, loadout, balanced or charging

Run it again later to update the Gateway.
HELP
      exit 0 ;;
    *) echo "I do not know the option '$1'. Try --help." >&2; exit 1 ;;
  esac
done

say()  { printf '\n%s\n' "$*"; }
stop() { printf '\n%s\n\n' "$*" >&2; exit 1; }

# ---- 1. Is Docker ready? ----
command -v docker >/dev/null 2>&1 || stop "Docker is not installed yet.
Install Docker first (https://docs.docker.com/get-docker/), then run this again."

docker compose version >/dev/null 2>&1 || stop "Docker is installed, but not 'Docker Compose' (the 'docker compose' command).
Update Docker (https://docs.docker.com/get-docker/), then run this again."

docker info >/dev/null 2>&1 || stop "Docker is installed but not responding.
Start Docker (on Windows or Mac, open Docker Desktop and wait until it says it is running).
On Linux your user may need permission: try again with 'sudo bash install.sh'."

# ---- 2. Is the port free? ----
if { command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE '[:.]8080$'; } && ! docker ps --format '{{.Names}}' | grep -qx 'waypoints-gateway'; then
  say "Note: something is already using port 8080 on this computer. The Gateway needs it.
Stop that program first, or the Gateway will not start."
fi

# ---- 3. Save the compose file ----
mkdir -p "$DIR"
cd "$DIR"
say "Putting the Gateway in $DIR ..."

cat > docker-compose.yml <<'COMPOSE'
# Waypoints Gateway: the only file you need.
#
#   docker compose up -d
#
# Then open http://<this computer's address>:8080, create a password, and follow the steps. The gateway sets up
# secure HTTPS and installs your apps for you, and stays running to show their status and keep them updated.
#
# It mounts the Docker socket, which gives it control of Docker on this computer, so keep port 8080 on your own
# network and never publish it to the internet.
services:
  gateway:
    image: ghcr.io/j5guy/waypoints-gateway:latest
    container_name: waypoints-gateway
    pull_policy: always
    restart: unless-stopped
    ports:
      - "8080:8080"
      # The same page, encrypted. The browser warns once: the certificate is the Gateway's own.
      - "8443:8443"
    environment:
      # This computer's address, so the Gateway's own certificate matches it (the installer fills this in).
      GATEWAY_IP: ${GATEWAY_IP:-}
      # Optional: an app to tick by default in the setup steps, e.g. balanced, or fond,loadout.
      PRESELECT: ${PRESELECT:-}
      # Optional: your time zone, for example America/New_York. Automatic updates run at the hour you choose in this
      # time zone (UTC when empty).
      TZ: ${TZ:-}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - gateway-data:/data
      # The key that encrypts saved passwords and secrets, kept apart from the data above on purpose. Do not
      # delete this volume: without it saved secrets cannot be read and have to be entered again.
      - gateway-key:/key
      # Read-only: lets the setup page offer the local certificate for download.
      - caddy-data:/caddy-data:ro

volumes:
  gateway-data:
    name: waypoints-gateway-data
  gateway-key:
    name: waypoints-gateway-key
  caddy-data:
    name: waypoints-caddy-data
COMPOSE

# This computer's address on the network (best effort): the Gateway's own certificate is made for it, and it is what we
# print for you to open.
ip=""
if command -v hostname >/dev/null 2>&1; then ip="$(hostname -I 2>/dev/null | awk '{print $1}')"; fi
if [ -z "$ip" ] && command -v ipconfig >/dev/null 2>&1; then ip="$(ipconfig getifaddr en0 2>/dev/null || true)"; fi

# Settings that go next to the compose file: the app to start with, this computer's address and time zone (best effort).
tz=""
if command -v timedatectl >/dev/null 2>&1; then tz="$(timedatectl show -p Timezone --value 2>/dev/null || true)"; fi
if [ -z "$tz" ] && [ -r /etc/timezone ]; then tz="$(cat /etc/timezone 2>/dev/null || true)"; fi
{
  [ -n "$APP" ] && echo "PRESELECT=$APP"
  [ -n "$ip" ] && echo "GATEWAY_IP=$ip"
  [ -n "$tz" ] && echo "TZ=$tz"
} > .env 2>/dev/null || true

# ---- 4. Start it ----
say "Downloading and starting the Gateway (the first time this can take a minute) ..."
docker compose pull
docker compose up -d

# ---- 5. Wait until it answers ----
ready=""
for _ in $(seq 1 30); do
  if command -v curl >/dev/null 2>&1; then
    curl -fsS http://localhost:8080/healthz >/dev/null 2>&1 && { ready=1; break; }
  else
    docker exec waypoints-gateway node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1 && { ready=1; break; }
  fi
  sleep 2
done
[ -n "$ready" ] || stop "The Gateway was started but is not answering yet.
Look at what it says with:   cd $DIR && docker compose logs gateway"

# ---- 6. Tell them where to go ----
[ -n "$ip" ] || ip="<this computer's address>"

cat <<DONE

The Waypoints Gateway is running.

  Open this in your browser (from any device on your home network):

      https://$ip:8443

  Your browser will warn once that the connection is not trusted. That is expected: the certificate is the
  Gateway's own, and the connection is still encrypted, so your password is not sent in plain text.
  Choose "Advanced", then "Continue" (the wording depends on your browser).

  If that address does not open, use the plain one:   http://$ip:8080

  Create a password within 15 minutes, then follow the steps on the page.
  (If you miss the 15 minutes, run:  docker restart waypoints-gateway   and open the page again.)

  Later:  stop it with  'cd $DIR && docker compose stop',
          update it by running this installer again, or from the Gateway's Updates page,
          remove it with the uninstall script (it asks before it changes anything).

DONE
