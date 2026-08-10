# QuantaEX - Cryptocurrency Exchange

A professional, full-featured cryptocurrency exchange platform.  
React SPA + Hono API, deployed as a single Cloudflare Pages project.

**Production URL**: https://www.quantaex.io  
**Operator**: QuantaEX Holdings Ltd. (Seychelles IBC)  
**Governing law**: Republic of Seychelles

---

## Features

### Trading
- Real-time candlestick charts (1m, 5m, 15m, 1h, 4h, 1d)
- Live order book with depth visualization
- Spot: Limit, Market, Stop-Limit orders with real matching engine
- Time-in-force: GTC / IOC / FOK / POST_ONLY
- Self-Trade Prevention (STP) enforced at matching layer
- Futures (USDT-margined) with cross / isolated margin
- Cross-margin lending (margin trading)
- USDT & USDC quote markets

### Supported Coins
BTC, ETH, BNB, SOL, XRP, ADA, DOGE, DOT, AVAX, MATIC, QTA, QX + USDT, USDC quotes

### User Features
- Email + Google OAuth registration
- Age gate (18+) via date-of-birth verification
- KYC verification (tiered) with R2-backed document storage
- 2FA (TOTP / RFC 6238)
- Withdrawal whitelist + 24h cooldown + 2FA + daily USD limits
- Deposit / withdraw / order history
- Referral program (multi-level, QX rewards)
- Mobile-responsive dark mode UI (Binance / Upbit style, KO+EN i18n)

### Admin Dashboard
- User management & KYC approval
- Withdrawal approval / rejection
- Coin & market management, fee tiers
- Global circuit breaker (trade halt)
- IP blocklist, forced-logout (token rotation)
- Notices CRUD (DB-managed with KO+EN)
- Audit log of all admin actions

### Compliance & Security
- Geo-block: KR, US, CN, JP (regulatory) + IR, KP, CU, SY, RU, BY (OFAC/UN sanctions) → HTTP 451
- Company-issued asset lock (QX bonus cannot be externally withdrawn)
- JWT (HMAC-SHA256) with token_version-based revocation
- Per-endpoint rate limits (register 5/h, login 10/5min, withdraw 20/h, order 100/min)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS v4 |
| Backend API | Hono (Cloudflare Pages Functions) |
| Database | Cloudflare D1 (SQLite) |
| Real-time | Server-Sent Events (SSE) + Polling |
| Charts | TradingView Lightweight Charts |
| State | Zustand |
| Hosting | Cloudflare Pages (unified frontend + API) |

---

## Project Structure

```
quantaex/
├── src/
│   ├── components/           # React UI components
│   │   ├── chart/            # Candlestick chart
│   │   ├── layout/           # Header, navigation
│   │   ├── market/           # Market selector
│   │   ├── orderbook/        # Order book display
│   │   └── trade/            # Trade panel, orders
│   ├── pages/                # Route pages
│   ├── server/               # Hono API (Cloudflare Pages Functions)
│   │   ├── routes/           # API routes (auth, market, order, wallet, admin)
│   │   ├── middleware/       # JWT auth middleware
│   │   └── index.ts          # Hono app entry
│   ├── store/                # Zustand store
│   ├── types/                # TypeScript types
│   └── utils/                # API, formatting, SSE
├── server/                   # Express dev server (local only)
├── migrations/               # D1 SQL migrations
├── public/                   # Static assets
├── wrangler.jsonc            # Cloudflare Pages config
├── .github/workflows/        # CI/CD (auto deploy on push)
├── deploy.sh                 # Manual deployment script
└── DEPLOYMENT.md             # Deployment guide
```

---

## Quick Start (Local Development)

```bash
# Install dependencies
npm install

# Start dev server (Express backend + Vite frontend)
npm run dev

# Frontend: http://localhost:5173
# API: http://localhost:3001
```

### Test Accounts
- **Admin**: admin@quantaex.io / admin1234
- **New users**: Get 10,000 USDT + 10,000,000 KRW + 0.1 BTC + 2 ETH + 100,000 QTA bonus

---

## Production Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the complete guide.

### Prerequisites
1. Set GitHub Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
2. Create D1 database and update `wrangler.jsonc` with `database_id`
3. Run migrations
4. Push to `main` branch (auto-deploys via GitHub Actions)
