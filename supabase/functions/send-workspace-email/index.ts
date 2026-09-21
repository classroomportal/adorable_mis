import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { SMTPClient } from "https://deno.land/x/denomailer/mod.ts";

// Sends transactional email via Google Workspace SMTP (smtp.gmail.com) using
// an App Password, so mail actually originates as GMAIL_USER (e.g.
// mis@abc.sch.ng) rather than Resend's no-reply@mis.classroomportal.org.
// Called from Postgres triggers/functions via pg_net.http_post, replacing
// the direct https://api.resend.com/emails calls — this is the bridge,
// since pg_net only speaks HTTP and Workspace has no equivalent HTTP API.
//
// Accepts the union of what the four call sites need: `to` as a single
// address or an array (notify_pastoral_on_negative_behaviour emails
// multiple smt/houseparent staff at once), and either `text` or `html`
// body content (the welcome-email and behaviour-alert functions send HTML;
// send_message sends plain text).
//
// Required secret (Dashboard > Edge Functions > Secrets, or
// `supabase secrets set`): GMAIL_APP_PASSWORD
// Optional secret: GMAIL_SENDER (defaults to mis@abc.sch.ng if unset)
//
// Per the principal's policy, no system email may reach parents — only
// @abc.sch.ng addresses. Rather than trust each of the four Postgres call
// sites to only ever pass in-domain recipients, this is enforced here as
// the single choke point: any recipient outside @abc.sch.ng is silently
// dropped before sending. If that empties the recipient list, the call
// still returns ok:true (callers fire-and-forget via pg_net and don't
// depend on the email having actually gone out).
const SCHOOL_DOMAIN = "@abc.sch.ng";
function isSchoolAddress(addr: string) {
  return addr.trim().toLowerCase().endsWith(SCHOOL_DOMAIN);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const appPassword = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!appPassword) {
    return new Response(JSON.stringify({ error: "GMAIL_APP_PASSWORD is not configured" }), { status: 500 });
  }
  const sender = Deno.env.get("GMAIL_SENDER") || "mis@abc.sch.ng";

  let payload: { to?: string | string[]; subject?: string; text?: string; html?: string };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { to, subject, text, html } = payload;
  if (!to || !subject || (!text && !html)) {
    return new Response(JSON.stringify({ error: "to, subject, and text or html are required" }), { status: 400 });
  }

  const recipients = (Array.isArray(to) ? to : [to]).filter(isSchoolAddress);
  if (recipients.length === 0) {
    return new Response(JSON.stringify({ ok: true, skipped: "no @abc.sch.ng recipients" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: sender, password: appPassword },
    },
  });

  try {
    await client.send({
      from: sender,
      to: recipients,
      subject,
      // denomailer requires plain-text `content` even for an HTML send —
      // fall back to a stripped version of the HTML when only html is given.
      content: text ?? html!.replace(/<[^>]+>/g, ""),
      ...(html ? { html } : {}),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 502 });
  } finally {
    // denomailer's close() can throw synchronously (not just reject), so a
    // plain .catch() doesn't guard it — wrap in try/catch instead.
    try {
      await client.close();
    } catch {
      // best-effort cleanup; the send already succeeded or failed above
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
