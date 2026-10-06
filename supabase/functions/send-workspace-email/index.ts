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
// send_message sends plain text). `cc` (address or array) is optional: the
// serious behaviour alert goes to the designated safeguarding address with
// SMT and the SRO copied in (migration 202). `reply_to` (address or array)
// becomes the Reply-To header, so replies reach a person rather than the
// unread mis@ inbox; queue_workspace_email() always sets it (migration 225).
// It is written as a raw header because denomailer's own `replyTo` option
// takes a single address, and detention emails reply to all of SMT.
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

// denomailer writes a non-ASCII subject as one quoted-printable encoded-word
// and then wraps it every 74 characters with "=" + line break, as it would a
// body. A line break inside a header ends the header block, so any long
// subject with a dash or a name like "Adébáyọ̀" (6 Oct 2026: "Behaviour alert:
// … — Straight Stage 5 …") arrived with every header after Subject shown as
// the message text. So the subject handed to denomailer is always ASCII:
// common typographic characters become their ASCII forms, and anything else
// is sent as our own base64 encoded-words (each under 75 characters, joined
// by spaces, which readers drop between encoded-words). The leading space
// stops denomailer re-encoding a value that starts with "=?"; it is legal
// folding white space after "Subject:".
const TYPOGRAPHIC: Record<string, string> = {
  "\u2014": "-", "\u2013": "-", "\u2012": "-", "\u2010": "-", "\u2011": "-", "\u2212": "-",
  "\u2018": "'", "\u2019": "'", "\u201A": "'", "\u2032": "'",
  "\u201C": '"', "\u201D": '"', "\u201E": '"', "\u2033": '"',
  "\u2026": "...", "\u00A0": " ", "\u202F": " ", "\u2009": " ", "\u2022": "*", "\u00B7": "*",
};

function encodeSubject(subject: string): string {
  const flat = subject
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u2010-\u2014\u2212\u2018\u2019\u201A\u2032\u201C-\u201E\u2033\u2026\u00A0\u202F\u2009\u2022\u00B7]/g, (c) => TYPOGRAPHIC[c] ?? c)
    .replace(/ {2,}/g, " ")
    .trim();
  // deno-lint-ignore no-control-regex
  if (!/[^\u0000-\u007f]/.test(flat) && !flat.startsWith("=?")) return flat;

  // Up to 45 bytes per word (60 base64 characters + 12 of wrapper), never
  // splitting a character, since each word must decode on its own.
  const encoder = new TextEncoder();
  const words: string[] = [];
  let chunk = "";
  for (const ch of Array.from(flat)) {
    if (chunk && encoder.encode(chunk + ch).length > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  const b64 = (str: string) => btoa(String.fromCharCode(...encoder.encode(str)));
  return " " + words.map((w) => `=?utf-8?B?${b64(w)}?=`).join(" ");
}

// The plain-text part when only HTML is given: keep the line breaks the HTML
// makes (the 6 Oct alert read "alert.A single severe event" with tags simply
// removed) and turn the common entities back into characters.
function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|ul|ol|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

  let payload: {
    to?: string | string[];
    cc?: string | string[];
    subject?: string;
    text?: string;
    html?: string;
    reply_to?: string | string[];
  };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { to, cc, subject, text, html } = payload;
  if (!to || !subject || (!text && !html)) {
    return new Response(JSON.stringify({ error: "to, subject, and text or html are required" }), { status: 400 });
  }

  // Plain addresses only: anything else (a newline especially) would let the
  // value write extra headers. queue_workspace_email() already drops
  // addresses that fail this same pattern, so this only refuses a payload
  // that didn't come through it.
  const replyTo = (Array.isArray(payload.reply_to) ? payload.reply_to : [payload.reply_to])
    .filter((a): a is string => typeof a === "string" && a.trim() !== "")
    .map((a) => a.trim());
  const badReplyTo = replyTo.filter((a) => !/^[^\s@<>(),;:"\[\]\\]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(a));
  if (badReplyTo.length) {
    return new Response(JSON.stringify({ error: `Invalid reply_to address: ${badReplyTo.join(", ")}` }), { status: 400 });
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
      ...(cc && cc.length ? { cc } : {}),
      ...(replyTo.length ? { headers: { "Reply-To": replyTo.join(", ") } } : {}),
      subject: encodeSubject(subject),
      // denomailer requires plain-text `content` even for an HTML send —
      // fall back to a text version of the HTML when only html is given.
      content: text ?? htmlToText(html!),
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
