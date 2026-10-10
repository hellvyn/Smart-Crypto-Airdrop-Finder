// Transactional email senders. A sender never throws and never returns or logs the provider's response body,
// which can echo recipient addresses (spec section 9).

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  /** True only when the provider accepted the message. */
  ok: boolean;
  /** HTTP status; 0 for a network error or timeout. */
  status: number;
}

export interface EmailSender {
  send(m: EmailMessage): Promise<SendResult>;
}

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";
const SEND_TIMEOUT_MS = 10_000;

/** Brevo transactional email API (`POST /v3/smtp/email`). Accepted = HTTP 201. */
export class BrevoSender implements EmailSender {
  constructor(
    private readonly deps: { fetch: typeof fetch; apiKey: string; from: { email: string; name: string } },
  ) {}

  async send(m: EmailMessage): Promise<SendResult> {
    let res: Response;
    try {
      res = await this.deps.fetch(BREVO_URL, {
        method: "POST",
        headers: { "api-key": this.deps.apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { email: this.deps.from.email, name: this.deps.from.name },
          to: [{ email: m.to }],
          subject: m.subject,
          htmlContent: m.html,
          textContent: m.text,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, status: 0 };
    }
    // The body is never read (it can contain the recipient's address); release the connection.
    try {
      await res.body?.cancel();
    } catch {
      // Ignore: the status is all we need.
    }
    return { ok: res.status === 201, status: res.status };
  }
}
