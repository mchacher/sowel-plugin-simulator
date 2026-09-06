#!/usr/bin/env bash
#
# Specs index gate.
#
# `docs/specs-index.md` is meant to be "every feature ever shipped in this
# repository". In the Sowel core the same table drifted 42 rows short, because
# nothing failed when a spec folder was merged without its row (core issue
# #872). One line typed at pull-request time is cheaper than reconstructing a
# year of history, so this check fails the pull request rather than the release.
#
# The counterpart to this file is the phase table in the showroom's project map
# (docs/project-map.md there): this check covers THIS repository's specs, the
# map covers the seven cross-repository phases. Both are updated by the
# feature skill, at the same moment.
#
# Runs in CI and locally: `bash scripts/check-specs-index.sh`.
# Portable to bash 3.2 (macOS) — no mapfile, no associative arrays.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

INDEX="docs/specs-index.md"
# A row is "| NNN |" at the start of a line, optionally with a letter suffix
# (the core has specs like 111b).
ROW='^\| [0-9]{3}[a-z]? \|'

if [ ! -f "${INDEX}" ]; then
  echo "❌ ${INDEX} not found — run this from the repository root."
  exit 1
fi

failed=0

# ── One row per spec folder ───────────────────────────────────────────
missing=""
for dir in specs/*/; do
  [ -d "${dir}" ] || continue
  slug="$(basename "${dir}")"
  num="${slug%%-*}"
  # Not a spec folder (no NNN- prefix): nothing to look up, and inviting
  # someone to paste `| archive | ... |` would be worse than staying quiet.
  echo "${num}" | grep -qE "^[0-9]{3}[a-z]?$" || continue
  if ! grep -qE "^\| ${num} \|" "${INDEX}"; then
    missing="${missing} ${slug}"
  fi
done

if [ -n "${missing}" ]; then
  echo "❌ ${INDEX} has no row for:"
  for slug in ${missing}; do
    num="${slug%%-*}"
    echo "   | ${num} | <title> | ✅ | Shipped. See \`specs/${slug}/\`. |"
  done
  failed=1
fi

# ── No spec listed twice ──────────────────────────────────────────────
# A row pasted twice is invisible to the grep above, and it is how the core's
# French index grew a second copy of eleven specs.
# `|| true`: grep exits 1 on an index with no rows at all, and pipefail would
# then kill the script mid-check without printing anything.
duplicated="$( { grep -oE "${ROW}" "${INDEX}" || true; } | tr -d '| ' | sort | uniq -d | tr '\n' ' ')"
if [ -n "${duplicated}" ]; then
  echo "❌ ${INDEX} lists the same spec more than once: ${duplicated}"
  failed=1
fi

if [ "${failed}" -ne 0 ]; then
  echo
  echo "Add the missing rows to ${INDEX}. The row is one line; the alternative"
  echo "is an index nobody trusts six months from now."
  exit 1
fi

echo "Every spec folder has a row in ${INDEX} ✓"
