// Sends the magic-link email. Provider-pluggable and zero-dep: if RESEND_API_KEY
// is set we POST to Resend's REST API; otherwise we just log the link to the
// server console (the dev path) and return false so the caller can surface the
// link inline during development.
//
// Important: once email IS configured, a send failure THROWS rather than falling
// back to the dev path — returning false would leak the magic link into the
// /v1/auth/request response to the client, which must never happen in production.

const RESEND_ENDPOINT =
  process.env.RESEND_API_BASE?.replace(/\/$/, "") ?? "https://api.resend.com";

/** True when real email delivery is configured (a Resend key is present). */
export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

function htmlBody(link: string): string {
  // Self-contained, table-free, inline-styled — renders cleanly in most clients.
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0b0b10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:480px;margin:0 auto;padding:40px 24px;color:#ecedf5;">
      <div style="font-size:20px;font-weight:700;margin-bottom:24px;">🃏 Wild Card</div>
      <p style="font-size:15px;line-height:1.5;color:#c9cbe0;margin:0 0 24px;">
        Tap the button below to sign in. This link expires in 15 minutes and can
        only be used once.
      </p>
      <a href="${link}"
         style="display:inline-block;background:#7c5cff;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:999px;">
        Sign in to Wild Card
      </a>
      <p style="font-size:13px;line-height:1.5;color:#9a9ab0;margin:24px 0 0;">
        Or paste this URL into your browser:<br />
        <span style="color:#a98bff;word-break:break-all;">${link}</span>
      </p>
      <p style="font-size:12px;line-height:1.5;color:#6b6b80;margin:24px 0 0;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  </body>
</html>`;
}

export async function sendMagicLink(email: string, link: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.WC_EMAIL_FROM ?? "Wild Card <login@wildcard.app>";

  if (!key) {
    console.log(`\n[auth] magic link for ${email}:\n  ${link}\n`);
    return false;
  }

  const res = await fetch(`${RESEND_ENDPOINT}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: "Your Wild Card sign-in link",
      text: `Sign in to Wild Card:\n\n${link}\n\nThis link expires in 15 minutes and can only be used once. If you didn't request it, ignore this email.`,
      html: htmlBody(link),
    }),
  });

  if (!res.ok) {
    // Configured but failed: surface the error. Do NOT return false here — that
    // would make the caller leak the link to the client. Fail loud instead.
    const detail = await res.text().catch(() => "");
    throw new Error(`email send failed (${res.status}): ${detail}`);
  }
  return true;
}
