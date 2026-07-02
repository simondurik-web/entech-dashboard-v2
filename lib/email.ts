// Minimal Resend transactional-email wrapper (mirrors snappad-app/src/lib/email.ts).
// Sends from automated@4molding.com (the 4molding.com domain is verified in Resend).
// If RESEND_API_KEY is absent the send is a logged no-op so non-prod environments
// never error — callers check `sent` and surface a retry to the user.

export interface SendEmailInput {
  from: string
  to: string[]
  bcc?: string[]
  subject: string
  html: string
  text?: string
}

export interface SendResult {
  sent: boolean
  skipped?: string
  id?: string
  error?: string
}

export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { sent: false, skipped: 'RESEND_API_KEY not set' }
  if (input.to.length === 0 && (!input.bcc || input.bcc.length === 0)) {
    return { sent: false, skipped: 'no recipients' }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        bcc: input.bcc && input.bcc.length ? input.bcc : undefined,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { sent: false, error: data?.message || `Resend ${res.status}` }
    return { sent: true, id: data?.id }
  } catch (e) {
    return { sent: false, error: String(e) }
  }
}
