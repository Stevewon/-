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
