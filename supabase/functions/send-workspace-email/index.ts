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
// Sends to any address, parents' included. A version deployed straight to
// Supabase (never committed) silently dropped every non-@abc.sch.ng
// recipient and still answered ok:true, so the 25 Sep 2026 parent welcome
// batch was recorded as sent while nothing reached a parent. The principal
// asked for parent email to be allowed again. If a recipient restriction is
// ever wanted, make it fail loudly (a non-2xx status) rather than
// returning ok, or callers will record a send that never happened.

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
      to,
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
