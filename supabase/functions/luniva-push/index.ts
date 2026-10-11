// =========================================================
// Luniva — luniva-push (Supabase Edge Function)
//
// Sends each device ONE daily reminder at the hour its owner chose.
// The push carries no content at all: the phone's service worker
// decides what to say from data that never leaves the phone. This
// server only knows "send a nudge to this address at 8 pm".
//
//   GET                              → the public VAPID key (for the app)
//   POST {action:"send"} + x-cron-secret → send every reminder due now
//                                         (called every 15 min by pg_cron)
//   POST {action:"test"} + user's login → send a test to that user's devices
//
// Secrets (Edge Functions → Secrets): VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, CRON_SECRET. Generate them at /push-setup.html.
// Deploy with "Verify JWT" turned OFF (the function checks access itself).
// =========================================================

import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "https://myluniva.netlify.app";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

// Only real browser push services, so nobody can make us POST elsewhere.
const PUSH_HOSTS = [".googleapis.com", ".mozilla.com", ".push.apple.com", ".notify.windows.com"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

/** The project's secret key (new "secret" keys first, legacy service_role as fallback). */
function getSecretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys && typeof keys.default === "string") return keys.default;
  } catch (_) { /* fall through */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", getSecretKey(), {
  auth: { persistSession: false, autoRefreshToken: false }
});

/* ---------- VAPID (RFC 8292): a signed token proving the push is from us ---------- */

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "===".slice((base64.length + 3) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

let signingKey: Promise<CryptoKey> | null = null;

function getSigningKey(): Promise<CryptoKey> {
  if (!signingKey) {
    const publicKey = fromBase64Url(VAPID_PUBLIC_KEY); // 0x04 ‖ x ‖ y
    signingKey = crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC", crv: "P-256", d: VAPID_PRIVATE_KEY,
        x: toBase64Url(publicKey.slice(1, 33)), y: toBase64Url(publicKey.slice(33, 65)), ext: true
      },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
  }
  return signingKey;
}

async function getVapidHeader(endpoint: string): Promise<string> {
  const header = toBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = toBase64Url(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: VAPID_SUBJECT
  })));
  const unsigned = header + "." + claims;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, await getSigningKey(), encoder.encode(unsigned));
  return "vapid t=" + unsigned + "." + toBase64Url(new Uint8Array(signature)) + ", k=" + VAPID_PUBLIC_KEY;
}

function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && PUSH_HOSTS.some((host) => url.hostname.endsWith(host));
  } catch (_) {
    return false;
  }
}

/** Send one empty push. Returns the push service's HTTP status. */
async function sendPush(endpoint: string): Promise<number> {
  if (!isPushEndpoint(endpoint)) return 410;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: await getVapidHeader(endpoint), TTL: "43200", Urgency: "normal" }
  });
  await response.body?.cancel();
  return response.status;
}

/** Send to many endpoints; delete the ones the push service says are gone. */
async function sendAll(endpoints: string[]) {
  const results = await Promise.allSettled(endpoints.map(sendPush));
  const gone: string[] = [];
  let sent = 0;
  let failed = 0;
  results.forEach((result, index) => {
    const status = result.status === "fulfilled" ? result.value : 0;
    if (status >= 200 && status < 300) sent++;
    else if (status === 404 || status === 410) gone.push(endpoints[index]);
    else {
      failed++;
      console.warn("push failed", status, result.status === "rejected" ? String(result.reason) : "");
    }
  });
  if (gone.length) await db.from("luniva_push").delete().in("endpoint", gone);
  return { sent, removed: gone.length, failed };
}

/* ---------- Which reminders are due right now ---------- */

/** Local date (YYYY-MM-DD) and hour (0–23) in a time zone. */
function localNow(timeZone: string): { date: string; hour: number } {
  let zone = timeZone;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: zone }); } catch (_) { zone = "UTC"; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return { date: parts.year + "-" + parts.month + "-" + parts.day, hour: Number(parts.hour) % 24 };
}

async function sendDueReminders() {
  const { data, error } = await db.from("luniva_push")
    .select("endpoint, remind_hour, timezone, last_sent_on").limit(10000);
  if (error) throw error;

  const due: { endpoint: string; date: string }[] = [];
  for (const row of data ?? []) {
    const now = localNow(row.timezone);
    if (now.hour === row.remind_hour && row.last_sent_on !== now.date) due.push({ endpoint: row.endpoint, date: now.date });
  }

  // Mark as sent first so an overlapping run can't send twice.
  for (const item of due) {
    await db.from("luniva_push").update({ last_sent_on: item.date }).eq("endpoint", item.endpoint);
  }
  return { due: due.length, ...(await sendAll(due.map((item) => item.endpoint))) };
}

async function sendTest(request: Request) {
  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return json({ error: "Please log in again." }, 401);

  const { data: rows, error: rowsError } = await db.from("luniva_push")
    .select("endpoint").eq("user_id", data.user.id).limit(20);
  if (rowsError) throw rowsError;
  if (!rows?.length) return json({ error: "Reminders aren't turned on for any device yet." }, 404);
  return json(await sendAll(rows.map((row) => row.endpoint)));
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return json({ error: "Push keys are not set up yet." }, 503);
  if (request.method === "GET") return json({ publicKey: VAPID_PUBLIC_KEY });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === "send") {
      if (!CRON_SECRET || request.headers.get("x-cron-secret") !== CRON_SECRET) return json({ error: "Forbidden" }, 403);
      return json(await sendDueReminders());
    }
    if (body.action === "test") return await sendTest(request);
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("luniva-push", error);
    return json({ error: "Something went wrong" }, 500);
  }
});
