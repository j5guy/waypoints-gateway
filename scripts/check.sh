#!/usr/bin/env bash
# Checks run by CI (test.yml and prod.yml) before an image is built. The gateway has no npm dependencies and no test
# suite yet, so this catches a typo, a half-finished catalog entry or a forgotten release note before anything is
# built or pushed. Run from the gateway/ folder:  bash scripts/check.sh
set -euo pipefail

echo "Syntax check"
for f in server.js lib/*.js public/app.js public/footer.js public/whatsnew.js public/theme.js; do
  node --check "$f"
done

echo "App catalog"
for d in catalog/*/; do
  for f in app.json compose.yml own-proxy.yml; do
    [ -f "$d$f" ] || { echo "Missing $d$f" >&2; exit 1; }
  done
  node -e "
    const a = JSON.parse(require('fs').readFileSync(process.argv[1] + 'app.json', 'utf8'));
    for (const k of ['id', 'name', 'port', 'container']) if (!a[k]) { console.error(process.argv[1] + 'app.json: missing ' + k); process.exit(1); }
  " "$d"
done

# The installer carries its own copy of docker-compose.yml, so nobody has to download two files. They must match.
echo "Installer"
bash -n install.sh
bash -n uninstall.sh
bash -n scripts/publish-gate.sh
bash -n .githooks/pre-commit
bash -n .githooks/pre-push
embedded="$(awk "/<<'COMPOSE'/{f=1;next} /^COMPOSE\$/{f=0} f" install.sh)"
if [ "$embedded" != "$(cat docker-compose.yml)" ]; then
  echo "install.sh has a different docker-compose.yml from the one in this folder. Copy the file into install.sh." >&2
  exit 1
fi

# Every change needs a version bump, a RELEASE_NOTES heading and a What's new entry, and they must agree.
echo "Version and release notes"
node -e "
  const fs = require('fs');
  const pkg = 'v' + require('./package.json').version;
  const notes = (fs.readFileSync('RELEASE_NOTES', 'utf8').match(/^v[0-9][^\s:]*/m) || [''])[0];
  const whats = require('./lib/whatsNew')[0].version;
  if (pkg !== notes || pkg !== whats) {
    console.error('Version mismatch: package.json ' + pkg + ', RELEASE_NOTES ' + notes + ', lib/whatsNew.js ' + whats);
    process.exit(1);
  }
"

echo "OK"
