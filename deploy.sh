#!/bin/bash
set -e

echo "=========================================="
echo " QuantaEX Deployment Script"
echo "=========================================="

# Check for CLOUDFLARE_API_TOKEN
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN is not set"
  echo "export CLOUDFLARE_API_TOKEN=your_token"
  exit 1
fi

# 1. Build React client
echo ""
echo "[1/3] Building React client..."
npx vite build --mode client

# 2. Build Hono worker
echo ""
echo "[2/3] Building Hono API worker..."
npx vite build

# 3. Deploy to Cloudflare Pages
echo ""
echo "[3/3] Deploying to Cloudflare Pages..."
npx wrangler pages deploy dist --project-name=quantaex --commit-dirty=true

echo ""
echo "=========================================="
echo " Deployment Complete!"
echo "=========================================="
echo " URL: https://www.quantaex.io"
echo "=========================================="
