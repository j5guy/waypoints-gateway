#!/usr/bin/env bash
# Fails (non-zero) if anything in this repo's working tree OR full history must not go public.
# Same script as in the other repos (see PUBLISHING_RUNBOOK.md, Stage 3). Needs git and gitleaks, and the private
# denylist (PUBLISH_DENYLIST_FILE, or ~/.publish-denylist). It refuses to pass without the denylist.
set -u
fail=0
ALLOWED_EMAIL="dev@allthewaypoints.com"
DENY_RAW="${PUBLISH_DENYLIST_FILE:-$HOME/.publish-denylist}"
DENY="$(mktemp)"; trap 'rm -f "$DENY"' EXIT
# Drop blank lines (an empty pattern matches every line) and # comments, and any Windows line endings.
[ -f "$DENY_RAW" ] && tr -d '\r' < "$DENY_RAW" | grep -v -E '^[[:space:]]*(#.*)?$' > "$DENY"
section() { printf '\n== %s\n' "$1"; }

section "1. commit identities (author + committer, all refs)"
bad=$(git log --all --format='%h A:%ae C:%ce' | grep -v -E "A:${ALLOWED_EMAIL} C:${ALLOWED_EMAIL}$")
[ -n "$bad" ] && { echo "$bad" | head -20; fail=1; }

section "2. gitleaks: working tree + full history"
gitleaks detect --source . --log-opts="--all" --redact --no-banner -c .gitleaks.toml || fail=1

section "3. private denylist: tree, history diffs, commit messages"
if [ -s "$DENY" ]; then
  hits=$(git grep -I -n -i -E -f "$DENY" -- . ':!.gitea' ':!LICENSE' | head -20)
  [ -n "$hits" ] && { echo "$hits"; fail=1; }
  hits=$(git log --all -p --no-color --format='%H%n%an <%ae>%n%cn <%ce>%n%B' -- . ':!.gitea' ':!LICENSE' \
         | grep -a -i -E -f "$DENY" | head -20)
  [ -n "$hits" ] && { echo "$hits"; fail=1; }
  # Every commit message and name, on its own. The scan above only sees commits that change a file outside the excluded
  # paths, so an empty commit (or one that only touches .gitea or LICENSE) would otherwise slip through.
  hits=$(git log --all --no-color --format='%H%n%an <%ae>%n%cn <%ce>%n%B' | grep -a -i -E -f "$DENY" | head -20)
  [ -n "$hits" ] && { echo "$hits"; fail=1; }
else
  echo "No usable denylist at $DENY_RAW: refusing to pass without it."; fail=1
fi

section "4. blocked file types ever committed"
hits=$(git log --all --name-only --format= | sort -u | grep -E -f .githooks/blocked-paths.regex | grep -v '\.env\.example$')
[ -n "$hits" ] && { echo "$hits"; fail=1; }

section "5. refs that would leave"
refs=$(git for-each-ref --format='%(refname)' | grep -v -E '^refs/(heads/(master|test)|remotes/|tags/)')
[ -n "$refs" ] && { echo "Unexpected refs: $refs"; fail=1; }

[ "$fail" -eq 0 ] && echo "GATE PASSED" || echo "GATE FAILED"
exit "$fail"
