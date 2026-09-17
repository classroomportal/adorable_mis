import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { SMTPClient } from "https://deno.land/x/denomailer/mod.ts";

// Sends transactional email via Google Workspace SMTP (smtp.gmail.com) using
// an App Password, so mail actually originates as GMAIL_USER (e.g.
// mis@abc.sch.ng) rather than Resend's no-reply@mis.classroomportal.org.
// Called from Postgres triggers/functions via pg_net.http_post, replacing
// the direct https://api.resend.com/emails calls — this is the bridge,
// since pg_net only speaks HTTP and Workspace has no equivalent HTTP API.
//
// Required secret (Dashboard > Edge Functions > Secrets, or
// `supabase secrets set`): GMAIL_APP_PASSWORD
// Optional secret: GMAIL_SENDER (defaults to mis@abc.sch.ng if unset)

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const appPassword = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!appPassword) {
    return new Response(JSON.stringify({ error: "GMAIL_APP_PASSWORD is not configured" }), { status: 500 });
  }
  const sender = Deno.env.get("GMAIL_SENDER") || "mis@abc.sch.ng";

  let payload: { to?: string; subject?: string; text?: string };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { to, subject, text } = payload;
  if (!to || !subject || !text) {
    return new Response(JSON.stringify({ error: "to, subject, and text are required" }), { status: 400 });
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
    await client.send({ from: sender, to, subject, content: text });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 502 });
  } finally {
    await client.close().catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
