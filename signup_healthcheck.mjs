// QuantaEX Signup Healthcheck Daemon
// ─────────────────────────────────────────────────────────────────────────────
// Runs every 5 minutes:
//   1. POST /api/auth/register with a fresh email
//   2. POST /api/auth/login with the same credentials
//   3. GET  /api/profile/me with the JWT
// Logs every result to signup_healthcheck.log. If any step fails for two
// consecutive cycles, writes signup_healthcheck.ALERT.log so the operator
// can grep it quickly.
//
// IP/geo notes:
//   • Sandbox runs from a US Cloudflare colo, which is in BLOCKED_COUNTRIES.
//   • To exercise the full signup pipeline from here, every request carries
//     the X-Admin-Bypass header. This bypasses geo-block ONLY; auth/2FA/
//     IP-whitelist still apply.
//   • For real Korean-user verification, the owner does the manual signup
//     from a KR IP in the browser; this daemon catches API-side regressions
//     between manual checks.

import fs from 'fs';
import { setTimeout as sleep } from 'timers/promises';

const HOST = 'https://quantaex.io';
const ADMIN_BYPASS = '8d61521db38d133ccd8bc276b1b18d59356b2a3b2852cc7ca099d1b01e782502';
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const LOG_FILE = 'signup_healthcheck.log';
const ALERT_FILE = 'signup_healthcheck.ALERT.log';

let consecutiveFailures = 0;

function ts() {
  return new Date().toISOString();
}

function log(line) {
  const stamped = `[${ts()}] ${line}`;
  console.log(stamped);
  fs.appendFileSync(LOG_FILE, stamped + '\n');
}

function alert(line) {
  const stamped = `[${ts()}] [ALERT] ${line}`;
  console.error(stamped);
  fs.appendFileSync(ALERT_FILE, stamped + '\n');
  fs.appendFileSync(LOG_FILE, stamped + '\n');
}

async function once() {
  const ms = Date.now();
  const email = `hc_${ms}@example.com`;
  const password = 'HealthCheck123';
  const nickname = `hc${ms}`;

  // Step 1: register
  let registerStatus, registerBody, jwtToken, userId;
  try {
    const r = await fetch(`${HOST}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Bypass': ADMIN_BYPASS,
      },
      body: JSON.stringify({ email, password, nickname }),
    });
    registerStatus = r.status;
    registerBody = await r.json();
    jwtToken = registerBody.token;
    userId = registerBody.user?.id;
  } catch (e) {
    alert(`register exception: ${e.message}`);
    return false;
  }

  if (registerStatus !== 200 && registerStatus !== 201) {
    alert(`register status=${registerStatus} body=${JSON.stringify(registerBody).slice(0, 200)}`);
    return false;
  }
  if (!jwtToken || !userId) {
    alert(`register missing token/userId — body=${JSON.stringify(registerBody).slice(0, 200)}`);
    return false;
  }

  // Step 2: login (verifies password hash & JWT issuance independent of register)
  let loginStatus, loginBody;
  try {
    const r = await fetch(`${HOST}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Bypass': ADMIN_BYPASS,
      },
      body: JSON.stringify({ email, password }),
    });
    loginStatus = r.status;
    loginBody = await r.json();
  } catch (e) {
    alert(`login exception (uid=${userId}): ${e.message}`);
    return false;
  }
  if (loginStatus !== 200 || !loginBody.token) {
    alert(`login status=${loginStatus} (uid=${userId}) body=${JSON.stringify(loginBody).slice(0, 200)}`);
    return false;
  }

  // Step 3: GET /api/auth/me — verifies JWT roundtrip + DB user lookup.
  // (Note: /api/profile uses PATCH for the root; the canonical "who am I"
  // endpoint is /api/auth/me, mounted at src/server/routes/auth.ts:200.)
  let meStatus, meBody;
  try {
    const r = await fetch(`${HOST}/api/auth/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${loginBody.token}`,
        'X-Admin-Bypass': ADMIN_BYPASS,
      },
    });
    meStatus = r.status;
    meBody = await r.json();
  } catch (e) {
    alert(`me exception (uid=${userId}): ${e.message}`);
    return false;
  }
  if (meStatus !== 200) {
    alert(`me status=${meStatus} (uid=${userId}) body=${JSON.stringify(meBody).slice(0, 200)}`);
    return false;
  }

  log(`OK register=${registerStatus} login=${loginStatus} me=${meStatus} uid=${userId.slice(0, 8)} email=${email}`);
  return true;
}

async function main() {
  log(`Signup healthcheck daemon started — interval=${INTERVAL_MS / 1000}s host=${HOST}`);
  // Initial cycle immediately
  while (true) {
    const ok = await once();
    if (ok) {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
      if (consecutiveFailures >= 2) {
        alert(`SIGNUP REGRESSION — ${consecutiveFailures} consecutive cycles failed. Check production immediately.`);
      }
    }
    await sleep(INTERVAL_MS);
  }
}

main().catch((e) => {
  alert(`daemon crashed: ${e.message}\n${e.stack}`);
  process.exit(1);
});
