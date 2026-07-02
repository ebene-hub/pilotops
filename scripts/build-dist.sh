#!/usr/bin/env bash
# Build, verify, and package the Pilot Ops frontend for the web team.
#
#   ./scripts/build-dist.sh
#
# Guardrails so a bad build never ships:
#   - aborts if VITE_SUPABASE_ANON_KEY is a SECRET key (must be publishable/anon),
#   - checks the stream/Supabase URLs are set,
#   - after building, re-scans the bundle to confirm no secret leaked and the
#     right keys/URLs are baked in,
#   - zips dist/ as pilotops-dist-<date>.zip to hand off with DEPLOY-STATIC.md.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

say() { printf '%s\n' "$*"; }
die() { printf '!! %s\n' "$*" >&2; exit 1; }

say "==> Pilot Ops — build & package frontend dist"

[ -f .env ] || die "no .env in the project root (copy .env.example → .env and fill it in)"
getval() { grep -m1 "^$1=" .env 2>/dev/null | cut -d= -f2- | tr -d "\"' \r"; }
KEY=$(getval VITE_SUPABASE_ANON_KEY)
URL=$(getval VITE_SUPABASE_URL)
STREAM=$(getval VITE_STREAM_URL)

# --- the important check: never ship a secret key in the browser bundle --------
case "$KEY" in
  "")            die "VITE_SUPABASE_ANON_KEY is empty — set the PUBLISHABLE key." ;;
  sb_secret_*)   die "VITE_SUPABASE_ANON_KEY is a SECRET key (sb_secret_…). Use the PUBLISHABLE key (sb_publishable_…). Aborting before it leaks into the bundle." ;;
  sb_publishable_*|eyJ*) say "   .env key : publishable/anon ✓" ;;
  *)             say "   .env key : WARNING — unrecognized prefix (${KEY:0:12}…)" ;;
esac
[ -n "$URL" ]    || die "VITE_SUPABASE_URL is empty."
[ -n "$STREAM" ] || say "   WARNING : VITE_STREAM_URL empty → defaults to same-origin /stream (streaming breaks off-Vercel)."
say "   supabase: $URL"
say "   stream  : ${STREAM:-<default /stream>}"

# --- build --------------------------------------------------------------------
say "==> npm run build"
npm run build || die "build failed"

# --- verify the produced bundle -----------------------------------------------
say "==> verifying dist/"
if grep -rq "sb_secret_" dist/ 2>/dev/null; then
  die "a SECRET key is present in the build — DO NOT distribute. Fix .env and rerun."
fi
if grep -rq "sb_publishable_" dist/ 2>/dev/null || grep -rq "eyJhbGciOi" dist/ 2>/dev/null; then
  say "   ✓ no secret leaked; publishable/anon key baked in"
else
  say "   ! could not confirm the key in the bundle — check .env"
fi
REF=$(printf '%s' "$URL" | sed -E 's#https?://([^./]+).*#\1#')
[ -n "$REF" ] && grep -rq "$REF" dist/ 2>/dev/null && say "   ✓ supabase project ($REF) baked in"
if [ -n "$STREAM" ]; then
  SHOST=$(printf '%s' "$STREAM" | sed -E 's#https?://([^/]+).*#\1#')
  if grep -rq "$SHOST" dist/ 2>/dev/null; then say "   ✓ stream host ($SHOST) baked in"; else say "   ! stream host not found in bundle"; fi
fi
say "   ✓ pages : $(ls dist/*.html 2>/dev/null | wc -l | tr -d ' ')"

# --- package ------------------------------------------------------------------
OUT="pilotops-dist-$(date +%Y%m%d).zip"
rm -f "$OUT"
if command -v zip >/dev/null 2>&1; then
  ( cd dist && zip -qr "../$OUT" . )
elif command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe -NoProfile -Command "Compress-Archive -Path 'dist/*' -DestinationPath '$OUT' -Force" >/dev/null
else
  say "==> dist/ built OK. 'zip' not found — package dist/ manually."; exit 0
fi
[ -f "$OUT" ] && say "==> Done → $OUT   (hand this + DEPLOY-STATIC.md to the web team)" || die "zip step produced no file"
