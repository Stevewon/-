#!/usr/bin/env bash
#
# QuantaEX Cron Worker — One-shot deploy script
#
# Usage:
#   1. Create a Cloudflare API Token at https://dash.cloudflare.com/profile/api-tokens
#      with these permissions:
#        - Account → Workers Scripts → Edit
#        - Account → D1 → Edit
#        - Account → Account Settings → Read
#      Scope: Include → Specific account → <your account>
#
#   2. Run: CLOUDFLARE_API_TOKEN=<your_token> ./deploy.sh
#
set -euo pipefail

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "❌ CLOUDFLARE_API_TOKEN is not set."
  echo ""
  echo "   Get a token at: https://dash.cloudflare.com/profile/api-tokens"
  echo "   Required permissions:"
  echo "     - Account → Workers Scripts → Edit"
  echo "     - Account → D1 → Edit"
  echo "     - Account → Account Settings → Read"
  echo ""
  echo "   Then re-run:"
  echo "     CLOUDFLARE_API_TOKEN=<token> ./deploy.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Step 1: install deps if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install --silent
fi

# Step 2: verify token has required scopes
echo "🔐 Verifying token..."
npx wrangler whoami 2>&1 | grep -E "logged in|Account ID" || {
  echo "❌ Token verification failed"
  exit 1
}

# Step 3: deploy
echo ""
echo "🚀 Deploying quantaex-cron..."
npx wrangler deploy

# Step 4: verify deployment
echo ""
echo "✅ Deployed. Testing /run endpoint..."
sleep 3

# Extract account subdomain (something like myaccount.workers.dev)
SUBDOMAIN=$(npx wrangler whoami 2>&1 | grep -oE '[a-z0-9-]+\.workers\.dev' | head -1 || echo "")

if [ -n "$SUBDOMAIN" ]; then
  WORKER_URL="https://quantaex-cron.${SUBDOMAIN}/run"
  echo "Trying: $WORKER_URL"
  RESULT=$(curl -sf "$WORKER_URL" 2>&1 || echo "FAILED")
  if [[ "$RESULT" == *"checked"* ]]; then
    echo "✨ Worker is live: $RESULT"
  else
    echo "⚠️  Worker deployed but /run test failed (may need a minute to propagate)"
  fi
else
  echo "⚠️  Could not determine workers.dev subdomain; check Cloudflare dashboard"
fi

echo ""
echo "📅 Next cron runs: */5 * * * * (every 5 minutes)"
echo "🔧 Manage at: https://dash.cloudflare.com/?to=/:account/workers/services/view/quantaex-cron"
