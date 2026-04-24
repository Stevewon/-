// ============================================================================
// Minimal transactional mailer abstraction.
// ----------------------------------------------------------------------------
// Selects provider via env:
//   - RESEND_API_KEY        → resend.com
//   - (fallback)            → no-op; logs a warning. Returns `dev` in response.
//
// Wire into wrangler.jsonc vars / secrets:
//   npx wrangler pages secret put RESEND_API_KEY --project-name=quantaex
//   npx wrangler pages secret put MAIL_FROM      --project-name=quantaex
//
// Frontend/UX never sees the provider — only {sent:true|false, dev_token?}.
// ============================================================================

export type MailEnv = {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  APP_URL?: string; // used to build verification / reset URLs
};

export interface MailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendMail(env: MailEnv, payload: MailPayload): Promise<{ sent: boolean; provider: string; error?: string }> {
  const from = env.MAIL_FROM || 'QuantaEX <no-reply@quantaex.io>';

  if (env.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.warn('[mailer] resend failed:', r.status, t);
        return { sent: false, provider: 'resend', error: `${r.status}` };
      }
      return { sent: true, provider: 'resend' };
    } catch (e: any) {
      console.warn('[mailer] resend exception:', e);
      return { sent: false, provider: 'resend', error: String(e?.message || e) };
    }
  }

  console.warn('[mailer] no provider configured — skipping send for', payload.to);
  return { sent: false, provider: 'dev' };
}

/** Very small HTML template for the transactional flows. */
export function templateBasic(title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  return `
<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0b1017;color:#eaeaea;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:#111823;border:1px solid #1f2a37;border-radius:12px;padding:28px">
    <div style="font-size:20px;font-weight:700;color:#f0b90b;margin-bottom:8px">QuantaEX</div>
    <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
    <div style="line-height:1.6;color:#c7d2e0;font-size:14px">${bodyHtml}</div>
    ${cta ? `<p style="margin-top:24px"><a href="${escapeAttr(cta.url)}" style="background:#f0b90b;color:#111;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(cta.label)}</a></p>` : ''}
    <p style="color:#6b7684;font-size:12px;margin-top:24px">If you didn't request this, you can safely ignore the email.</p>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[ch]);
}
function escapeAttr(s: string): string { return escapeHtml(s); }

// ============================================================================
// Transactional template library (Sprint 3 — S3-6)
// ----------------------------------------------------------------------------
// Each helper returns a ready-to-send {subject, html, text} object. Strings
// are plain English; i18n of transactional mails is deliberately out of scope
// for this sprint. All templates include the meta row (when/ip) for security
// traceability, use templateBasic() for the shell, and are safe against HTML
// injection (every interpolated value goes through escapeHtml).
// ============================================================================

export interface MailContent {
  subject: string;
  html: string;
  text: string;
}

export interface EventMeta {
  when?: string;        // ISO-ish datetime string to show to the user
  ip?: string;          // request IP, if known
  userAgent?: string;   // browser UA, if known
}

function metaBlock(meta?: EventMeta): string {
  if (!meta) return '';
  const parts: string[] = [];
  if (meta.when)      parts.push(`<strong>When:</strong> ${escapeHtml(meta.when)}`);
  if (meta.ip)        parts.push(`<strong>IP:</strong> ${escapeHtml(meta.ip)}`);
  if (meta.userAgent) parts.push(`<strong>Device:</strong> ${escapeHtml(meta.userAgent.slice(0, 160))}`);
  if (!parts.length) return '';
  return `<div style="margin-top:16px;padding:12px;background:#0b1017;border:1px solid #1f2a37;border-radius:8px;font-size:12px;color:#8ea0b5;line-height:1.8">
    ${parts.join('<br>')}
  </div>`;
}

function fmtAmount(amount: number | string, coin: string) {
  return `${escapeHtml(String(amount))} ${escapeHtml(coin)}`;
}

// -------- Security events ---------------------------------------------------

/** Fired on every successful login. Keep it short — users get one per login. */
export function tmplLoginAlert(appUrl: string, meta: EventMeta): MailContent {
  const subject = 'New sign-in to your QuantaEX account';
  const html = templateBasic(
    'New sign-in detected',
    `<p>Your QuantaEX account was just signed in to.</p>
     ${metaBlock(meta)}
     <p style="margin-top:16px">If this was you, no action is needed. If you don't recognize this sign-in, <strong>change your password immediately</strong> and enable 2FA.</p>`,
    { label: 'Review security settings', url: `${appUrl}/account/security` },
  );
  const text = `New sign-in to QuantaEX.\nWhen: ${meta.when || ''}\nIP: ${meta.ip || ''}\nIf this wasn't you, change your password immediately: ${appUrl}/account/security`;
  return { subject, html, text };
}

export function tmplPasswordChanged(appUrl: string, meta: EventMeta): MailContent {
  const subject = 'Your QuantaEX password was changed';
  const html = templateBasic(
    'Password changed',
    `<p>The password on your QuantaEX account was just changed successfully. All existing sessions have been logged out.</p>
     ${metaBlock(meta)}
     <p style="margin-top:16px">If you did <strong>not</strong> make this change, contact support immediately and reset your password via the link below.</p>`,
    { label: 'I did not do this', url: `${appUrl}/forgot-password` },
  );
  const text = `Your QuantaEX password was changed.\nWhen: ${meta.when || ''}\nIP: ${meta.ip || ''}\nIf this wasn't you: ${appUrl}/forgot-password`;
  return { subject, html, text };
}

export function tmpl2faEnabled(appUrl: string, meta: EventMeta): MailContent {
  const subject = 'Two-factor authentication enabled';
  const html = templateBasic(
    '2FA enabled',
    `<p>Two-factor authentication (TOTP) is now <strong>ON</strong> for your QuantaEX account. You'll need your authenticator code on every login and withdrawal.</p>
     ${metaBlock(meta)}
     <p style="margin-top:16px">Save your backup/recovery setup QR in a safe place. If you lose access to your authenticator, reach out to support.</p>`,
    { label: 'Open security settings', url: `${appUrl}/account/security` },
  );
  const text = `2FA enabled on QuantaEX.\nWhen: ${meta.when || ''}`;
  return { subject, html, text };
}

export function tmpl2faDisabled(appUrl: string, meta: EventMeta): MailContent {
  const subject = 'Two-factor authentication disabled';
  const html = templateBasic(
    '2FA disabled',
    `<p>Two-factor authentication (TOTP) was just turned <strong>OFF</strong> for your QuantaEX account. Your account is now only protected by your password.</p>
     ${metaBlock(meta)}
     <p style="margin-top:16px">If you did <strong>not</strong> do this, your account may be compromised. Re-enable 2FA and change your password immediately.</p>`,
    { label: 'Re-enable 2FA', url: `${appUrl}/account/security` },
  );
  const text = `2FA disabled on QuantaEX.\nWhen: ${meta.when || ''}\nRe-enable: ${appUrl}/account/security`;
  return { subject, html, text };
}

// -------- Withdrawals -------------------------------------------------------

export function tmplWithdrawSubmitted(
  appUrl: string,
  p: { amount: number | string; coin: string; address: string; network?: string | null; fee?: number | string | null },
  meta: EventMeta,
): MailContent {
  const subject = `Withdrawal requested: ${p.amount} ${p.coin}`;
  const html = templateBasic(
    'Withdrawal request received',
    `<p>We received your withdrawal request and it's now pending admin review.</p>
     <ul style="line-height:1.8;color:#c7d2e0;font-size:13px;padding-left:18px;margin:12px 0">
       <li>Amount: <strong>${fmtAmount(p.amount, p.coin)}</strong></li>
       ${p.fee != null ? `<li>Fee: ${fmtAmount(p.fee, p.coin)}</li>` : ''}
       ${p.network ? `<li>Network: ${escapeHtml(p.network)}</li>` : ''}
       <li>Address: <code style="background:#0b1017;padding:2px 6px;border-radius:4px">${escapeHtml(p.address)}</code></li>
     </ul>
     ${metaBlock(meta)}
     <p style="margin-top:16px">You'll receive another email once this withdrawal is approved and broadcast on-chain. If you didn't request this, contact support right now — your funds are still locked and can be released back.</p>`,
    { label: 'View withdrawal history', url: `${appUrl}/wallet/history` },
  );
  const text = `Withdrawal requested: ${p.amount} ${p.coin} to ${p.address}\nPending admin approval.`;
  return { subject, html, text };
}

export function tmplWithdrawApproved(
  appUrl: string,
  p: { amount: number | string; coin: string; txHash?: string | null },
): MailContent {
  const subject = `Withdrawal approved: ${p.amount} ${p.coin}`;
  const html = templateBasic(
    'Withdrawal approved',
    `<p>Your withdrawal of <strong>${fmtAmount(p.amount, p.coin)}</strong> has been approved and broadcast.</p>
     ${p.txHash ? `<p>Transaction: <code style="background:#0b1017;padding:2px 6px;border-radius:4px">${escapeHtml(p.txHash)}</code></p>` : ''}
     <p>It may take a few minutes for the network to confirm the transfer.</p>`,
    { label: 'View withdrawal history', url: `${appUrl}/wallet/history` },
  );
  const text = `Withdrawal approved: ${p.amount} ${p.coin}${p.txHash ? ` (tx ${p.txHash})` : ''}`;
  return { subject, html, text };
}

export function tmplWithdrawRejected(
  appUrl: string,
  p: { amount: number | string; coin: string; reason?: string | null },
): MailContent {
  const subject = `Withdrawal rejected: ${p.amount} ${p.coin}`;
  const html = templateBasic(
    'Withdrawal rejected',
    `<p>Your withdrawal request for <strong>${fmtAmount(p.amount, p.coin)}</strong> was rejected and the funds have been returned to your available balance.</p>
     ${p.reason ? `<p><strong>Reason:</strong> ${escapeHtml(p.reason)}</p>` : ''}
     <p>You can try again after reviewing the reason, or reach out to support if you think this was a mistake.</p>`,
    { label: 'Open wallet', url: `${appUrl}/wallet` },
  );
  const text = `Withdrawal rejected: ${p.amount} ${p.coin}${p.reason ? ` - ${p.reason}` : ''}. Funds returned.`;
  return { subject, html, text };
}

// -------- Deposits ----------------------------------------------------------

export function tmplDepositCredited(
  appUrl: string,
  p: { amount: number | string; coin: string; txHash?: string | null; note?: string | null },
): MailContent {
  const subject = `Deposit credited: ${p.amount} ${p.coin}`;
  const html = templateBasic(
    'Deposit credited',
    `<p><strong>${fmtAmount(p.amount, p.coin)}</strong> has been credited to your QuantaEX wallet.</p>
     ${p.txHash ? `<p>Transaction: <code style="background:#0b1017;padding:2px 6px;border-radius:4px">${escapeHtml(p.txHash)}</code></p>` : ''}
     ${p.note ? `<p><strong>Note:</strong> ${escapeHtml(p.note)}</p>` : ''}`,
    { label: 'Open wallet', url: `${appUrl}/wallet` },
  );
  const text = `Deposit credited: ${p.amount} ${p.coin}${p.txHash ? ` (tx ${p.txHash})` : ''}`;
  return { subject, html, text };
}

// -------- KYC ---------------------------------------------------------------

export function tmplKycApproved(appUrl: string): MailContent {
  const subject = 'KYC approved — full trading unlocked';
  const html = templateBasic(
    'KYC approved',
    `<p>Your identity verification was approved. You now have full access to deposits, withdrawals, and higher trading limits.</p>`,
    { label: 'Start trading', url: `${appUrl}/markets` },
  );
  return { subject, html, text: 'KYC approved. Full trading unlocked.' };
}

export function tmplKycRejected(appUrl: string, reason?: string | null): MailContent {
  const subject = 'KYC verification rejected';
  const html = templateBasic(
    'KYC rejected',
    `<p>Unfortunately your KYC submission was rejected.</p>
     ${reason ? `<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>` : ''}
     <p>Please resubmit with the corrected information — support can help if you're unsure which field failed review.</p>`,
    { label: 'Resubmit KYC', url: `${appUrl}/kyc` },
  );
  return { subject, html, text: `KYC rejected${reason ? `: ${reason}` : ''}. Please resubmit.` };
}

// -------- Convenience wrapper ----------------------------------------------

/**
 * Fire-and-forget mail: extracts appUrl from env, sends, and never throws.
 * Prefer this in hot endpoints so a mailer outage can't block trading / withdrawals.
 * If `ctx.waitUntil` is available the send is deferred off the response path.
 */
export function fireAndForgetMail(
  env: MailEnv,
  to: string,
  content: MailContent,
  ctx?: { waitUntil?: (p: Promise<unknown>) => void } | null,
): void {
  const p = sendMail(env, { to, subject: content.subject, html: content.html, text: content.text })
    .catch((e) => {
      console.warn('[mailer] fire-and-forget failed:', e);
      return { sent: false, provider: 'error' };
    });
  if (ctx?.waitUntil) {
    try { ctx.waitUntil(p); } catch { /* ignore */ }
  }
  // Otherwise we simply don't await — caller does not care about the result.
}

/** Helper to build an EventMeta from a Hono Context. */
export function metaFromReq(req: { header: (k: string) => string | undefined }): EventMeta {
  const ip =
    req.header('CF-Connecting-IP') ||
    req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    '';
  const userAgent = req.header('User-Agent') || '';
  return {
    when: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
    ip,
    userAgent,
  };
}
