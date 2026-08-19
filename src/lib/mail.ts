/**
 * Email delivery.
 *
 * In local development there is no provider and no domain to verify: every
 * message is written to ./tmp/mail as an HTML file and its path is printed to
 * the console. You can open and read every reminder, confirmation, and invite
 * the app sends without configuring anything.
 *
 * Set RESEND_API_KEY to switch to real delivery. Nothing else changes.
 *
 * Notifications are never the source of truth — the database is (BRIEF).
 * A send failure must never roll back a league decision.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  /** Correlates with the `notifications` row, for delivery tracking. */
  type: string;
}

/**
 * Where replies go.
 *
 * The sending domain has receiving switched off, so a reply to the From address
 * would vanish silently. Players absolutely do reply to reminders -- "I cannot
 * make my pick", "did you get my $20" -- so REPLY_TO points at an inbox the
 * commissioner actually reads.
 *
 * Falls back to the From address if unset, which is the current behaviour.
 */
function replyTo(): string | undefined {
  return process.env.REPLY_TO || undefined;
}

export interface MailResult {
  delivered: boolean;
  transport: "file" | "resend";
  reference: string;
  error?: string;
}

const MAIL_DIR = join(process.cwd(), "tmp", "mail");

export async function sendEmail(message: OutboundEmail): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  return apiKey ? sendViaResend(message, apiKey) : writeToDisk(message);
}

async function writeToDisk(message: OutboundEmail): Promise<MailResult> {
  try {
    await mkdir(MAIL_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeTo = message.to.replace(/[^a-z0-9]/gi, "_");
    const filename = `${stamp}__${message.type}__${safeTo}.html`;
    const path = join(MAIL_DIR, filename);

    const document = `<!doctype html>
<meta charset="utf-8">
<title>${escapeHtml(message.subject)}</title>
<div style="font:14px/1.5 system-ui,sans-serif;max-width:640px;margin:2rem auto">
  <div style="border:1px solid #ddd;border-radius:8px;padding:1rem;margin-bottom:1rem;background:#fafafa">
    <div><strong>To:</strong> ${escapeHtml(message.to)}</div>
    <div><strong>Subject:</strong> ${escapeHtml(message.subject)}</div>
    <div><strong>Type:</strong> ${escapeHtml(message.type)}</div>
    ${replyTo() ? `<div><strong>Reply-To:</strong> ${escapeHtml(replyTo() as string)}</div>` : ""}
    <div style="color:#666;margin-top:.5rem">Local development — not actually sent.</div>
  </div>
  ${message.html}
</div>`;

    await writeFile(path, document, "utf8");
    console.log(`[mail] ${message.type} -> ${message.to}\n[mail] ${path}`);
    return { delivered: true, transport: "file", reference: path };
  } catch (error) {
    return {
      delivered: false,
      transport: "file",
      reference: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function sendViaResend(message: OutboundEmail, apiKey: string): Promise<MailResult> {
  const from = process.env.MAIL_FROM ?? "Survivor League <onboarding@resend.dev>";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        ...(replyTo() ? { reply_to: replyTo() } : {}),
      }),
    });

    if (!response.ok) {
      return {
        delivered: false,
        transport: "resend",
        reference: "",
        error: `Resend responded ${response.status}: ${await response.text()}`,
      };
    }

    const body = (await response.json()) as { id?: string };
    return { delivered: true, transport: "resend", reference: body.id ?? "" };
  } catch (error) {
    return {
      delivered: false,
      transport: "resend",
      reference: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
