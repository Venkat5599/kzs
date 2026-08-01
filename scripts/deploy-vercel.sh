#!/usr/bin/env bash
# Deploy the frontend to Vercel and re-point the stable alias at it.
#
# A .vercel.app alias is bound to one specific deployment, so `vercel --prod` on
# its own ships to a fresh hashed URL and silently leaves kairos-nox.vercel.app
# serving the previous build. That failure is quiet — the deploy reports success
# and the public URL simply does not change. Always deploy through this script.
set -euo pipefail

ALIAS="${VERCEL_ALIAS:-kairos-nox.vercel.app}"
cd "$(dirname "$0")/../apps/frontend"

echo "Deploying to Vercel…"
URL="$(bunx vercel --prod --yes | tail -1 | tr -d '[:space:]')"
echo "  deployment: $URL"

echo "Re-pointing $ALIAS…"
bunx vercel alias set "$URL" "$ALIAS"

echo
echo "Live: https://$ALIAS"
