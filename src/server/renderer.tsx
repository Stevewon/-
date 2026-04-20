// This file serves as the entry point for Cloudflare Pages _worker.js
// It handles:
// 1. API routes via Hono
// 2. Static asset serving (auto-handled by Cloudflare Pages)
// 3. SPA fallback (index.html for client-side routing)

export { default } from './index';
