#!/usr/bin/env bash
# Waypoints Gateway: remove it.
#
#   bash uninstall.sh                 remove the Gateway and its proxy (your apps and all data stay)
#   bash uninstall.sh --apps          also remove the apps the Gateway installed (their data stays)
#   bash uninstall.sh --data          also DELETE all the data (asks you to confirm first)
#   bash uninstall.sh --dry-run       show what would happen and change nothing
#
# It always shows you what it is about to do and asks before it does anything. Options: --dir <folder> (where the
# Gateway's files are, default ~/waypoints-gateway), --yes (do not ask; for tests).
set -euo pipefail

DIR="${WAYPOINTS_GATEWAY_DIR:-$HOME/waypoints-gateway}"
APPS=0; DATA=0; YES=0; DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --apps)    APPS=1; shift ;;
    --data)    DATA=1; APPS=1; shift ;;
    --yes|-y)  YES=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --dir)     DIR="${2:?--dir needs a folder}"; shift 2 ;;
    -h|--help)
      cat <<'HELP'
Waypoints Gateway: remove it

  (no option)  Remove the Gateway and its secure proxy. Your apps keep running and all data stays,
               but the apps' secure addresses stop working because the proxy is gone.
  --apps       Also remove the apps the Gateway installed. Their data stays in Docker volumes.
  --data       Also DELETE all the data: the Gateway's settings and encryption key, the proxy's
               certificates, and every app's data. Backups held by the Gateway are copied to your
               home folder first. You must type a confirmation.
  --dry-run    Show what would happen and change nothing.
  --dir <dir>  Where the Gateway's files are (default: ~/waypoints-gateway).
  --yes        Do not ask questions (for tests).

Apps you kept from before you brought them into the Gateway (named ...-before-gateway-...) are never touched.
HELP
      exit 0 ;;
    *) echo "I do not know the option '$1'. Try --help." >&2; exit 1 ;;
  esac
done

say()  { printf '%s\n' "$*"; }
stop() { printf '\n%s\n\n' "$*" >&2; exit 1; }
# Run a command, or only say what would be run.
act()  { if [ "$DRY" = 1 ]; then say "  would run: $*"; else "$@"; fi; }

command -v docker >/dev/null 2>&1 || stop "Docker is not installed, so there is nothing to remove."
docker info >/dev/null 2>&1 || stop "Docker is not responding. Start Docker (or try 'sudo bash uninstall.sh'), then run this again."

# ---- What is there? (containers by name and by the Gateway's project names, volumes by name) ----
gateway_ids=""; caddy_ids=""; app_ids=""; app_names=""
rows="$(docker ps -a --format '{{.ID}}|{{.Names}}|{{.Label "com.docker.compose.project"}}' 2>/dev/null || true)"
while IFS='|' read -r id name project; do
  [ -n "${id:-}" ] || continue
  case "$name" in
    waypoints-gateway) gateway_ids="$gateway_ids $id" ;;
    waypoints-caddy)   caddy_ids="$caddy_ids $id" ;;
    *) case "${project:-}" in waypoints-*) app_ids="$app_ids $id"; app_names="$app_names $name" ;; esac ;;
  esac
done <<< "$rows"

vols="$(docker volume ls -q 2>/dev/null || true)"
gw_vols="$(printf '%s\n' "$vols" | grep -E '^waypoints-(gateway-data|gateway-key|caddy-data)$' || true)"
app_vols="$(printf '%s\n' "$vols" | grep -E '^waypoints-[a-z0-9]+_' || true)"
have_net=0; docker network inspect waypoints-proxy >/dev/null 2>&1 && have_net=1

if [ -z "$gateway_ids$caddy_ids$app_ids$gw_vols$app_vols" ] && [ "$have_net" = 0 ] && [ ! -f "$DIR/docker-compose.yml" ]; then
  say "Nothing from the Waypoints Gateway was found on this computer."
  exit 0
fi

# ---- The plan ----
say ""
say "This is what will happen:"
say "  - Remove the Gateway and its secure proxy."
[ -n "$app_ids" ] && { if [ "$APPS" = 1 ]; then say "  - Remove these apps (their data is kept):$app_names"; else say "  - Keep these apps running:$app_names"; fi; }
if [ "$DATA" = 1 ]; then
  say "  - DELETE all the data. This cannot be undone:"
  for v in $gw_vols $app_vols; do say "        $v"; done
  say "  - Copy any backups the Gateway holds to $HOME/waypoints-backups-<date> first."
  say "  - Delete the Gateway's folder, $DIR"
else
  say "  - Keep all data (nothing in Docker volumes is deleted)."
fi
[ "$DRY" = 1 ] && say "" && say "(This is a dry run: nothing will be changed.)"
say ""

ask() {
  [ "$YES" = 1 ] && return 0
  [ -r /dev/tty ] || stop "I need to ask you to confirm, but there is no keyboard to ask. Run it from a terminal, or add --yes."
  local a; read -r -p "$1 [y/N] " a < /dev/tty
  case "$a" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

if [ "$DRY" = 0 ]; then
  ask "Continue?" || { say "Nothing was changed."; exit 0; }
  if [ "$DATA" = 1 ] && [ "$YES" = 0 ]; then
    read -r -p "To confirm deleting the data, type: delete my data   " phrase < /dev/tty
    [ "$phrase" = "delete my data" ] || { say "That was not it, so nothing was changed."; exit 0; }
  fi
fi

cd "$HOME"

# ---- 1. Keep the Gateway's backups before their volume is deleted ----
if [ "$DATA" = 1 ] && printf '%s\n' "$gw_vols" | grep -qx 'waypoints-gateway-data'; then
  dest="$HOME/waypoints-backups-$(date +%Y%m%d-%H%M%S)"
  say "Saving the Gateway's backups first ..."
  if [ "$DRY" = 1 ]; then
    say "  would copy any backups to $dest"
  else
    mkdir -p "$dest"
    docker run --rm -v waypoints-gateway-data:/data:ro -v "$dest":/out --entrypoint sh docker:27-cli \
      -c 'if [ -d /data/exports ] && [ -n "$(ls -A /data/exports)" ]; then cp -a /data/exports/. /out/; fi' \
      || stop "Could not save the Gateway's backups first, so nothing was deleted."
    if [ -n "$(ls -A "$dest" 2>/dev/null)" ]; then say "  Backups are in $dest"; else rmdir "$dest" 2>/dev/null || true; say "  There were no backups to save."; fi
  fi
fi

# ---- 2. The Gateway and its proxy ----
say "Removing the Gateway and its proxy ..."
if [ -f "$DIR/docker-compose.yml" ]; then
  if [ "$DRY" = 1 ]; then say "  would run: docker compose down   (in $DIR)"; else (cd "$DIR" && docker compose down) || true; fi
fi
[ -n "$gateway_ids" ] && act docker rm -f $gateway_ids
[ -n "$caddy_ids" ] && act docker rm -f $caddy_ids

# ---- 3. The apps (containers only: their data is in volumes) ----
if [ "$APPS" = 1 ] && [ -n "$app_ids" ]; then
  say "Removing the apps ..."
  act docker rm -f $app_ids
fi

# ---- 4. The shared network (only once nothing uses it) ----
if [ "$have_net" = 1 ]; then
  if [ "$DRY" = 1 ]; then say "  would remove the network waypoints-proxy if nothing still uses it"
  elif docker network rm waypoints-proxy >/dev/null 2>&1; then say "Removed the network waypoints-proxy."
  else say "Left the network waypoints-proxy because something still uses it (your apps, which are still running)."; fi
fi

# ---- 5. The data ----
if [ "$DATA" = 1 ]; then
  say "Deleting the data ..."
  for v in $gw_vols $app_vols; do act docker volume rm "$v" || say "  Could not delete $v (something still uses it)."; done
  case "$DIR" in
    ""|"/"|"$HOME") ;;
    *) if [ -f "$DIR/docker-compose.yml" ] && grep -q 'waypoints-gateway' "$DIR/docker-compose.yml"; then act rm -rf "$DIR"; fi ;;
  esac
fi

say ""
if [ "$DRY" = 1 ]; then say "That was a dry run. Nothing was changed."
else
  say "Done."
  [ "$APPS" = 0 ] && [ -n "$app_ids" ] && say "Your apps are still running, but without the proxy their secure addresses do not work. Install the Gateway again to get them back."
  [ "$DATA" = 0 ] && say "No data was deleted. Install the Gateway again at any time and install the apps from it to pick the data up again."
fi
say ""
