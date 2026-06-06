// Sends the magic-link email. Provider-pluggable and zero-dep: if RESEND_API_KEY
// is set we POST to Resend's REST API; otherwise we just log the link to the
// server console (the dev path). Returning false means "not actually emailed" so
// the caller can surface the link directly in development.

export async function sendMagicLink(
  email: string,
  link: string
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.WC_EMAIL_FROM ?? "Wild Card <login@wildcard.app>";

  if (!key) {
    console.log(`\n[auth] magic link for ${email}:\n  ${link}\n`);
    return false;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: "Your Wild Card sign-in link",
      text: `Tap to sign in to Wild Card:\n\n${link}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.`,
    }),
  });

  if (!res.ok) {
    console.error(`[auth] email send failed (${res.status}): ${await res.text()}`);
    console.log(`[auth] magic link for ${email}: ${link}`);
    return false;
  }
  return true;
}
