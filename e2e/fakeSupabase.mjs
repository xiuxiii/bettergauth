/**
 * A stand-in for Supabase, for the `accounts` e2e profile: a plain Node HTTP
 * server answering only the calls MindGap makes (auth, two tables, one
 * storage bucket), with the migration's rules (supabase/migrations/) acted out
 * in memory. Both the browser and the Next server talk to it, because the
 * app's NEXT_PUBLIC_SUPABASE_URL is baked into the accounts build pointing
 * here, so the real @supabase clients run end to end.
 *
 * Mirrored from the migration:
 * - row-level security: a token sees and writes only its own rows, and
 *   `sessions` / photos only once `profiles.age_ok_at` is set; the
 *   service-role key bypasses it;
 * - students may update only `profiles.preferences` and `updated_at`;
 * - `sessions.changed_at` is the server's clock, one value per request
 *   (Postgres' now() is per transaction);
 * - deleting a user cascades to its profile and rows, never to photos.
 *
 * Shapes follow the installed clients (node_modules/@supabase/{auth-js,
 * postgrest-js,storage-js}): sessions from /verify and /token, arrays from
 * every GET (maybeSingle is decided client-side), multipart photo uploads.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import http from "node:http";

export const FAKE_SUPABASE_PORT = 54399;
export const FAKE_SUPABASE_URL = `http://127.0.0.1:${FAKE_SUPABASE_PORT}`;
export const ANON_KEY = "e2e-anon";
export const SERVICE_KEY = "e2e-service";

const b64url = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const token = () => randomBytes(16).toString("hex");

export class FakeSupabase {
  constructor() {
    this.reset();
  }

  /** Forget everything (each test starts from an empty project). */
  reset() {
    /** @type {Map<string, {id: string, email: string, user_metadata: object, created_at: string}>} */
    this.users = new Map();
    /** profiles by id */
    this.profiles = new Map();
    /** sessions by `${user_id}/${id}` */
    this.sessions = new Map();
    /** photo objects by path inside the bucket: { type, bytes } */
    this.objects = new Map();
    /** The last emailed link per address. */
    this.links = new Map();
    this.otps = new Map(); // token_hash -> email
    this.codes = new Map(); // auth code -> { email, challenge, method, metadata }
    this.refresh = new Map(); // refresh token -> user id
    /** Every request, for asserting on traffic: "METHOD /path". */
    this.log = [];
    /** Who "Continue with Google" signs in as. */
    this.google = { email: "sam@example.com", name: "Sam Student" };
    this.lastClock = 0;
  }

  start(port = FAKE_SUPABASE_PORT) {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        console.error("[fake supabase]", err);
        send(res, 500, { message: String(err?.message ?? err) });
      });
    });
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, "127.0.0.1", () => resolve(this));
    });
  }

  stop() {
    if (!this.server) return Promise.resolve();
    return new Promise((resolve) => {
      this.server.close(() => resolve());
      this.server.closeAllConnections(); // keep-alive sockets would hold close() open
    });
  }

  // --- Test helpers -----------------------------------------------------------

  userByEmail(email) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  rowsOf(uid) {
    return [...this.sessions.values()].filter((r) => r.user_id === uid);
  }
  objectsOf(uid) {
    return [...this.objects.keys()].filter((k) => k.startsWith(`${uid}/`));
  }

  // --- Plumbing ---------------------------------------------------------------

  /** now(), strictly increasing, so ordering by it is total across requests. */
  clock() {
    this.lastClock = Math.max(Date.now(), this.lastClock + 1);
    return new Date(this.lastClock).toISOString();
  }

  /** Who is calling: "service", "anon", or a user id (from the JWT's sub). */
  caller(req) {
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (bearer === SERVICE_KEY) return "service";
    if (!bearer || bearer === ANON_KEY) return "anon";
    const sub = decodeJwt(bearer)?.sub;
    return typeof sub === "string" ? sub : "anon";
  }

  ageOk(uid) {
    return !!this.profiles.get(uid)?.age_ok_at;
  }

  async handle(req, res) {
    const url = new URL(req.url, FAKE_SUPABASE_URL);
    const raw = await readBody(req);
    this.log.push(`${req.method} ${url.pathname}`);
    // The browser calls this from the app's origin (another port).
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-expose-headers", "content-range, x-supabase-api-version");
    if (req.method === "OPTIONS") {
      res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("access-control-allow-headers", req.headers["access-control-request-headers"] ?? "*");
      res.setHeader("access-control-max-age", "600");
      return send(res, 204, null);
    }
    const p = url.pathname;
    if (p.startsWith("/auth/v1/")) return this.auth(req, res, url, raw);
    if (p.startsWith("/rest/v1/")) return this.rest(req, res, url, raw);
    if (p.startsWith("/storage/v1/")) return this.storage(req, res, url, raw);
    return send(res, 404, { message: `fake supabase: no route ${req.method} ${p}` });
  }

  // --- Auth (GoTrue) ------------------------------------------------------------

  ensureUser(email, metadata = {}) {
    let u = this.userByEmail(email);
    if (!u) {
      u = { id: randomUUID(), email, user_metadata: metadata, created_at: new Date().toISOString() };
      this.users.set(u.id, u);
    }
    return u;
  }

  userJson(u) {
    return {
      id: u.id,
      aud: "authenticated",
      role: "authenticated",
      email: u.email,
      email_confirmed_at: u.created_at,
      app_metadata: { provider: "email" },
      user_metadata: u.user_metadata,
      identities: [],
      created_at: u.created_at,
      updated_at: u.created_at,
    };
  }

  session(u) {
    const now = Math.floor(Date.now() / 1000);
    const access = [
      b64url({ alg: "HS256", typ: "JWT" }),
      b64url({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600, session_id: token() }),
      b64url("e2e-signature"),
    ].join(".");
    const refresh = token();
    this.refresh.set(refresh, u.id);
    return {
      access_token: access,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: refresh,
      user: this.userJson(u),
    };
  }

  async auth(req, res, url, raw) {
    const p = url.pathname.slice("/auth/v1".length);
    const body = parseJson(raw);

    // signInWithOtp: "email" the student a link, as the production template
    // does: {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
    if (req.method === "POST" && p === "/otp") {
      const email = String(body?.email ?? "").trim().toLowerCase();
      if (!email) return send(res, 400, { code: "validation_failed", message: "email required" });
      const site = new URL(url.searchParams.get("redirect_to") ?? "http://127.0.0.1").origin;
      const hash = token();
      this.otps.set(hash, email);
      this.links.set(email, `${site}/auth/confirm?token_hash=${hash}&type=email`);
      return send(res, 200, {});
    }

    // verifyOtp({ token_hash, type }): one use only, like the real one.
    if (req.method === "POST" && p === "/verify") {
      const email = this.otps.get(body?.token_hash);
      if (!email) return send(res, 403, { code: "otp_expired", message: "Email link is invalid or has expired" });
      this.otps.delete(body.token_hash);
      return send(res, 200, this.session(this.ensureUser(email)));
    }

    // signInWithOAuth navigates here; play Google and come straight back.
    if (req.method === "GET" && p === "/authorize") {
      const back = url.searchParams.get("redirect_to");
      if (url.searchParams.get("provider") !== "google" || !back) return send(res, 400, { message: "bad authorize" });
      const code = token();
      this.codes.set(code, {
        email: this.google.email,
        metadata: { full_name: this.google.name },
        challenge: url.searchParams.get("code_challenge"),
        method: url.searchParams.get("code_challenge_method"),
      });
      const to = new URL(back);
      to.searchParams.set("code", code);
      res.writeHead(302, { location: to.toString() });
      return res.end();
    }

    if (req.method === "POST" && p === "/token") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "pkce") {
        const c = this.codes.get(body?.auth_code);
        this.codes.delete(body?.auth_code);
        // The verifier must be the one the browser stored for this challenge:
        // proves the cookie made it from the sign-in page to /auth/callback.
        const v = String(body?.code_verifier ?? "");
        const ok =
          c &&
          v &&
          (c.method === "plain" ? v === c.challenge : createHash("sha256").update(v).digest("base64url") === c.challenge);
        if (!ok) return send(res, 400, { code: "bad_code_verifier", message: "code verifier does not match" });
        return send(res, 200, this.session(this.ensureUser(c.email, c.metadata)));
      }
      if (grant === "refresh_token") {
        const uid = this.refresh.get(body?.refresh_token);
        const u = uid && this.users.get(uid);
        if (!u) return send(res, 400, { code: "refresh_token_not_found", message: "Invalid Refresh Token" });
        return send(res, 200, this.session(u));
      }
      return send(res, 400, { message: `grant ${grant}` });
    }

    if (req.method === "GET" && p === "/user") {
      const who = this.caller(req);
      const u = this.users.get(who);
      if (!u) return send(res, 403, { code: "user_not_found", message: "User from sub claim in JWT does not exist" });
      return send(res, 200, this.userJson(u));
    }

    if (req.method === "POST" && p === "/logout") return send(res, 204, null);

    const del = p.match(/^\/admin\/users\/([^/]+)$/);
    if (req.method === "DELETE" && del) {
      if (this.caller(req) !== "service") return send(res, 403, { message: "not admin" });
      const id = del[1];
      if (!this.users.has(id)) return send(res, 404, { code: "user_not_found", message: "User not found" });
      this.users.delete(id);
      // on delete cascade: the profile and every session row. Storage has none.
      this.profiles.delete(id);
      for (const [k, r] of this.sessions) if (r.user_id === id) this.sessions.delete(k);
      return send(res, 200, {});
    }

    return send(res, 404, { message: `fake auth: no route ${req.method} ${p}` });
  }

  // --- REST (PostgREST) ---------------------------------------------------------

  async rest(req, res, url, raw) {
    const table = url.pathname.slice("/rest/v1/".length);
    if (table !== "profiles" && table !== "sessions") return send(res, 404, { message: `no table ${table}` });
    const who = this.caller(req);
    const admin = who === "service";
    const store = table === "profiles" ? this.profiles : this.sessions;
    const key = (r) => (table === "profiles" ? r.id : `${r.user_id}/${r.id}`);
    // The row-level security policies, per table.
    const visible = (r) =>
      admin || (table === "profiles" ? r.id === who : r.user_id === who && this.ageOk(who));
    const filters = parseFilters(url.searchParams);
    const matching = () => [...store.values()].filter((r) => visible(r) && filters.every((f) => f(r)));

    if (req.method === "GET") {
      let rows = matching();
      const order = url.searchParams.get("order");
      if (order) {
        const keys = order.split(",").map((o) => {
          const [col, dir] = o.split(".");
          return { col, sign: dir === "desc" ? -1 : 1 };
        });
        rows.sort((a, b) => {
          for (const { col, sign } of keys) {
            const c = compare(a[col], b[col]);
            if (c) return c * sign;
          }
          return 0;
        });
      }
      const limit = Number(url.searchParams.get("limit") ?? "") || rows.length;
      return send(res, 200, pick(rows.slice(0, limit), url));
    }

    const body = parseJson(raw);
    const now = this.clock();

    if (req.method === "POST") {
      // Only upserts are used (Prefer: resolution=merge-duplicates).
      const list = Array.isArray(body) ? body : [body];
      if (table === "profiles" && !admin) return send(res, 403, permissionDenied("profiles"));
      for (const v of list) {
        if (table === "sessions") {
          if (!admin && !(v.user_id === who && this.ageOk(who))) {
            return send(res, 403, { code: "42501", message: 'new row violates row-level security policy for table "sessions"' });
          }
          if (!this.users.has(v.user_id)) return send(res, 409, { code: "23503", message: "violates foreign key constraint" });
        }
        const existing = store.get(key(v));
        const defaults =
          table === "profiles"
            ? { age_ok_at: null, preferences: null, plan: "free", created_at: now, updated_at: now }
            : { deleted_at: null, record: null };
        const next = { ...defaults, ...existing, ...v };
        if (table === "sessions") next.changed_at = now; // the trigger
        store.set(key(next), next);
      }
      return send(res, 201, null);
    }

    if (req.method === "PATCH") {
      if (table === "profiles" && !admin) {
        const bad = Object.keys(body ?? {}).filter((c) => c !== "preferences" && c !== "updated_at");
        if (bad.length) return send(res, 403, permissionDenied("profiles"));
      }
      const changed = [];
      for (const r of matching()) {
        const next = { ...r, ...body };
        if (table === "sessions") next.changed_at = now;
        store.set(key(next), next);
        changed.push(next);
      }
      // .update(...).select(...) asks for the rows back.
      if (/return=representation/.test(req.headers.prefer ?? "")) return send(res, 200, pick(changed, url));
      return send(res, 204, null);
    }

    if (req.method === "DELETE") {
      for (const r of matching()) store.delete(key(r));
      return send(res, 204, null);
    }

    return send(res, 405, { message: req.method });
  }

  // --- Storage, bucket "photos" ---------------------------------------------------

  async storage(req, res, url, raw) {
    const p = decodeURIComponent(url.pathname.slice("/storage/v1".length));
    const who = this.caller(req);
    const admin = who === "service";
    // The storage policy: <uid>/... only, and only once 13+ is recorded.
    const allowed = (path) => admin || (path.split("/")[0] === who && this.ageOk(who));

    const list = p.match(/^\/object\/list\/photos$/);
    if (req.method === "POST" && list) {
      const body = parseJson(raw) ?? {};
      const prefix = String(body.prefix ?? "").replace(/\/+$/, "");
      if (!allowed(`${prefix}/x`)) return send(res, 200, []);
      const names = [...this.objects.keys()]
        .filter((k) => k.startsWith(`${prefix}/`) && !k.slice(prefix.length + 1).includes("/"))
        .map((k) => k.slice(prefix.length + 1))
        .slice(0, Number(body.limit) || 100);
      return send(res, 200, names.map((name) => ({ name, id: name, metadata: {} })));
    }

    if (req.method === "DELETE" && p === "/object/photos") {
      const prefixes = parseJson(raw)?.prefixes ?? [];
      const gone = [];
      for (const path of prefixes) {
        if (allowed(path) && this.objects.delete(path)) gone.push({ name: path });
      }
      return send(res, 200, gone);
    }

    const obj = p.match(/^\/object\/(?:authenticated\/)?photos\/(.+)$/);
    if (obj && req.method === "GET") {
      const path = obj[1];
      const o = this.objects.get(path);
      if (!o || !allowed(path)) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
      res.writeHead(200, { "content-type": o.type });
      return res.end(o.bytes);
    }
    if (obj && (req.method === "POST" || req.method === "PUT")) {
      const path = obj[1];
      if (!allowed(path)) {
        return send(res, 400, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
      }
      if (this.objects.has(path) && req.headers["x-upsert"] !== "true") {
        return send(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      }
      const file = await fileFromUpload(req, raw);
      this.objects.set(path, file);
      return send(res, 200, { Id: randomUUID(), Key: `photos/${path}` });
    }

    return send(res, 404, { message: `fake storage: no route ${req.method} ${p}` });
  }
}

// --- Helpers ----------------------------------------------------------------------

function send(res, status, body) {
  if (body === null) {
    res.writeHead(status);
    return res.end();
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJson(buf) {
  if (!buf?.length) return null;
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return null;
  }
}

function decodeJwt(jwt) {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Rows cut down to the request's `select` columns. */
function pick(rows, url) {
  const select = url.searchParams.get("select");
  const cols = select && select !== "*" ? select.split(",").map((c) => c.trim()) : null;
  return rows.map((r) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c] ?? null])) : r));
}

function permissionDenied(table) {
  return { code: "42501", message: `permission denied for table ${table}` };
}

/** The photo in a storage upload: a multipart form's file, or a raw body. */
async function fileFromUpload(req, raw) {
  const type = req.headers["content-type"] ?? "application/octet-stream";
  if (type.startsWith("multipart/form-data")) {
    const form = await new Response(raw, { headers: { "content-type": type } }).formData();
    for (const [, v] of form) {
      if (typeof v !== "string") return { type: v.type || "image/jpeg", bytes: Buffer.from(await v.arrayBuffer()) };
    }
  }
  return { type, bytes: raw };
}

function compare(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a < b ? -1 : 1;
}

const unquote = (v) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);

/** One PostgREST condition, "col.op.value", as a row predicate. */
function condition(col, expr) {
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot);
  const value = expr.slice(dot + 1);
  const cast = (rowValue, v) => (typeof rowValue === "number" ? Number(v) : v);
  switch (op) {
    case "eq":
      return (r) => r[col] === cast(r[col], unquote(value));
    case "gt":
      return (r) => r[col] !== null && r[col] > cast(r[col], unquote(value));
    case "in": {
      const set = value.replace(/^\(|\)$/g, "").split(",").map(unquote);
      return (r) => set.some((v) => r[col] === cast(r[col], v));
    }
    default:
      throw new Error(`fake supabase: filter ${op} not implemented`);
  }
}

/** Split "a,b(c,d),e" on the top-level commas. */
function splitTop(s) {
  const out = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** An or/and group's term: "and(x.eq.1,y.gt.2)" or "x.eq.1". */
function term(t) {
  const group = t.match(/^(and|or)\((.*)\)$/);
  if (group) {
    const parts = splitTop(group[2]).map(term);
    return group[1] === "and" ? (r) => parts.every((f) => f(r)) : (r) => parts.some((f) => f(r));
  }
  const dot = t.indexOf(".");
  return condition(t.slice(0, dot), t.slice(dot + 1));
}

const NOT_FILTERS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function parseFilters(params) {
  const out = [];
  for (const [k, v] of params) {
    if (NOT_FILTERS.has(k)) continue;
    if (k === "or" || k === "and") out.push(term(`${k}${v}`));
    else out.push(condition(k, v));
  }
  return out;
}
