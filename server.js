import { createHash, pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ME as ownerId } from "./js/data.js";
import { sql } from "./server/db.js";
import { clearSamples, ensureProfile, handleSocial, sweepMedia } from "./server/social.js";

const pbkdf2Async = promisify(pbkdf2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const reserved = new Set([ownerId]);
const categories = new Set(["Kişi", "Yaratıcı", "İşletme"]);
const buckets = new Map();
const NEW_ROUNDS = 150000;
const LOGIN_FAIL = "Kullanıcı adı veya şifre hatalı.";
const SHIELD = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  "referrer-policy": "same-origin",
};

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".webmanifest": "application/manifest+json",
  ".mp4": "video/mp4",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...SHIELD,
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function forwardedHost(req) {
  return String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
}

function httpsRequest(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  return proto === "https" || String(req.headers.origin || "").startsWith("https://");
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const site = String(req.headers["sec-fetch-site"] || "");
  if (site === "same-origin" || site === "none") return true;
  try {
    const originHost = new URL(origin).host;
    const hosts = [String(req.headers.host || ""), forwardedHost(req)].filter(Boolean);
    return hosts.includes(originHost);
  } catch {
    return false;
  }
}

function hitBucket(key, limit, windowMs) {
  if (typeof key !== "string" || key.length > 64) return true;
  const now = Date.now();
  if (buckets.size > 500) {
    for (const [name, slot] of buckets) {
      if (slot.until < now) buckets.delete(name);
    }
    while (buckets.size > 500) buckets.delete(buckets.keys().next().value);
  }
  const slot = buckets.get(key);
  if (!slot || slot.until < now) {
    buckets.set(key, { count: 1, until: now + windowMs });
    return false;
  }
  if (slot.count >= limit) return true;
  slot.count += 1;
  return slot.count > limit;
}

function folded(value) {
  return String(value || "").toLowerCase().replace(/[._\-\s]/g, "").replace(/[l1i!|]/g, "1").replace(/[o]/g, "0");
}

function looksLikeOwner(id) {
  const name = folded(id);
  return name === folded(ownerId) || name === "b1adekv1";
}

async function loginLocked(accountId) {
  const rows = await sql(
    "select 1 from login_attempts where account_id = $1 and locked_until > now() limit 1",
    [accountId],
  );
  return rows.length > 0;
}

async function noteLoginFailure(accountId) {
  const rows = await sql(
    "select fails, window_until, locked_until from login_attempts where account_id = $1",
    [accountId],
  );
  const row = rows[0];
  const open = row && new Date(row.window_until).getTime() > Date.now();
  if (!open) {
    await sql(
      `insert into login_attempts (account_id, fails, window_until, locked_until)
       values ($1, 1, now() + interval '30 minutes', null)
       on conflict (account_id) do update
       set fails = 1, window_until = now() + interval '30 minutes', locked_until = null`,
      [accountId],
    );
    return;
  }
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) return;
  const fails = Number(row.fails) + 1;
  if (fails >= 5) {
    await sql(
      "update login_attempts set fails = $2, locked_until = now() + interval '30 minutes' where account_id = $1 and locked_until is null",
      [accountId, fails],
    );
    return;
  }
  await sql("update login_attempts set fails = $2 where account_id = $1", [accountId, fails]);
}

async function clearLoginFailures(accountId) {
  await sql("delete from login_attempts where account_id = $1", [accountId]);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20000) {
      const error = new Error("İstek çok büyük.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("İstek okunamadı.");
    error.status = 400;
    throw error;
  }
}

function cookieToken(req) {
  const header = String(req.headers.cookie || "");
  const match = header.split(";").map((part) => part.trim()).find((part) => part.startsWith("blade_session="));
  if (!match) return "";
  try {
    return decodeURIComponent(match.slice("blade_session=".length));
  } catch {
    return "";
  }
}

function sessionCookie(token, req) {
  const parts = [`blade_session=${encodeURIComponent(token)}`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=2592000"];
  if (httpsRequest(req)) parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(req) {
  const parts = ["blade_session=", "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (req && httpsRequest(req)) parts.push("Secure");
  return parts.join("; ");
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

async function hashPassword(password, salt, iterations = 100000) {
  const rounds = Number(iterations) || 100000;
  const bits = await pbkdf2Async(password, salt, rounds, 32, "sha256");
  return bits.toString("hex");
}

function passwordMatches(passwordHash, expected) {
  const left = Buffer.from(String(passwordHash), "hex");
  const right = Buffer.from(String(expected), "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function cleanId(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s()-]/g, "").slice(0, 80);
}

function validBorn(born) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(born || "");
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return false;
  const today = new Date();
  let age = today.getFullYear() - year;
  if (today.getMonth() < month - 1 || (today.getMonth() === month - 1 && today.getDate() < day)) age -= 1;
  return age >= 13 && age <= 120;
}

function validContact(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || /^\+?[0-9]{10,15}$/.test(value);
}

function flag(value) {
  return value === true || value === 1 || value === "t" || value === "true";
}

function publicPerson(row) {
  return { id: row.id, name: row.name, verified: flag(row.verified) };
}

async function people() {
  const rows = await sql("select id, name, verified from accounts where role <> 'seed' order by created_at desc limit 40");
  return rows.map(publicPerson);
}

async function latestRequest(accountId) {
  const rows = await sql(
    "select status from verification_requests where account_id = $1 order by created_at desc limit 1",
    [accountId],
  );
  return rows[0]?.status || "";
}

async function accountView(row) {
  if (!row) return null;
  return {
    ...publicPerson(row),
    role: row.role === "admin" ? "admin" : "user",
    request: await latestRequest(row.id),
  };
}

async function currentAccount(req) {
  const token = cookieToken(req);
  if (!token) return null;
  const rows = await sql(
    `select a.id, a.name, a.verified, a.role
     from sessions s join accounts a on a.id = s.account_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [tokenHash(token)],
  );
  return rows[0] || null;
}

async function openSession(res, req, account, created) {
  const token = hex(randomBytes(32));
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  await sql(
    "insert into sessions (token_hash, account_id, expires_at) values ($1, $2, $3)",
    [tokenHash(token), account.id, expires],
  );
  const user = await accountView(account);
  send(res, 200, { user, created: Boolean(created) }, { "set-cookie": sessionCookie(token, req) });
}

async function findAccount(ident) {
  const key = cleanId(ident);
  if (!/^[a-z0-9._]{1,80}$/.test(key)) return null;
  const rows = await sql("select * from accounts where id = $1 limit 1", [key]);
  return rows[0] || null;
}

async function createAccount({ id, name, contact, born, password, verified, role }) {
  const salt = randomBytes(16);
  const hash = await hashPassword(password, salt, NEW_ROUNDS);
  const rows = await sql(
    `insert into accounts (id, name, contact, born, salt, hash, verified, role, iterations)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (id) do nothing
     returning id, name, verified, role`,
    [id, name, contact, born, hex(salt), hash, verified, role, NEW_ROUNDS],
  );
  return rows[0] || null;
}

async function login(req, res) {
  const body = await readJson(req);
  const ident = cleanId(body.id);
  const password = String(body.password || "");
  if (password.length < 8 || password.length > 200) return send(res, 401, { error: LOGIN_FAIL });
  const account = await findAccount(ident);
  if (!account || account.role === "seed") {
    if (hitBucket("login-miss", 40, 60 * 1000)) return send(res, 429, { error: "Çok deneme oldu. Biraz bekle." });
    return send(res, 401, { error: LOGIN_FAIL });
  }
  if (await loginLocked(account.id)) return send(res, 429, { error: "Çok deneme oldu. Biraz bekle." });
  const rounds = Number(account.iterations) || 100000;
  let actual = "";
  try {
    actual = await hashPassword(password, Buffer.from(String(account.salt), "hex"), rounds);
  } catch {
    actual = "";
  }
  if (!passwordMatches(actual, account.hash)) {
    await noteLoginFailure(account.id);
    return send(res, 401, { error: LOGIN_FAIL });
  }
  await clearLoginFailures(account.id);
  return openSession(res, req, account, false);
}

async function register(req, res) {
  const body = await readJson(req);
  const id = String(body.username || "").trim().toLowerCase().slice(0, 30);
  const name = String(body.name || "").trim().slice(0, 40);
  const born = String(body.born || "");
  const password = String(body.password || "");
  if (!/^[a-z0-9._]{3,30}$/.test(id) || !/[a-z]/.test(id)) {
    if (hitBucket("register:invalid", 20, 10 * 60 * 1000)) {
      return send(res, 429, { error: "Çok deneme oldu. Biraz bekle." });
    }
    return send(res, 400, { error: "Kullanıcı adı 3–30 karakter olmalı ve en az bir harf içermeli." });
  }
  if (hitBucket(`register:${id}`, 5, 10 * 60 * 1000)) {
    return send(res, 429, { error: "Çok deneme oldu. Biraz bekle." });
  }
  if (reserved.has(id) || looksLikeOwner(id)) return send(res, 400, { error: "Bu kullanıcı adı kullanılıyor." });
  if (!name) return send(res, 400, { error: "Adını yaz." });
  if (password.length < 8 || password.length > 200) return send(res, 400, { error: "Şifre en az 8 karakter olmalı." });
  if (!validBorn(born)) return send(res, 400, { error: "Doğum yılı 13 yaşından büyük olmalı." });
  const existing = await sql("select id from accounts where id = $1 limit 1", [id]);
  if (existing.length) return send(res, 409, { error: "Bu kullanıcı adı kullanılıyor." });
  const recent = await sql(
    "select count(*)::int as n from accounts where role = 'user' and created_at > now() - interval '10 minutes'",
  );
  if (Number(recent[0]?.n || 0) >= 6) return send(res, 429, { error: "Şu an çok kayıt var. Biraz sonra yeniden dene." });
  const account = await createAccount({
    id,
    name,
    contact: "",
    born: "",
    password,
    verified: false,
    role: "user",
  });
  if (!account) return send(res, 409, { error: "Bu kullanıcı adı kullanılıyor." });
  await ensureProfile(account.id);
  return openSession(res, req, account, true);
}

async function changePassword(req, res) {
  const sessionAccount = await currentAccount(req);
  if (!sessionAccount) return send(res, 401, { error: "Önce giriş yap." });
  if (hitBucket(`password:${sessionAccount.id}`, 6, 10 * 60 * 1000)) {
    return send(res, 429, { error: "Çok deneme oldu. Biraz bekle." });
  }
  const account = await findAccount(sessionAccount.id);
  if (!account) return send(res, 401, { error: "Önce giriş yap." });
  const body = await readJson(req);
  const current = String(body.current || "");
  const next = String(body.next || "");
  if (next.length < 8 || next.length > 200) return send(res, 400, { error: "Yeni şifre en az 8 karakter olmalı." });
  const rounds = Number(account.iterations) || 100000;
  const actual = await hashPassword(current, Buffer.from(String(account.salt), "hex"), rounds);
  if (!passwordMatches(actual, account.hash)) return send(res, 401, { error: "Şimdiki şifre yanlış." });
  const salt = randomBytes(16);
  const hash = await hashPassword(next, salt, NEW_ROUNDS);
  await sql("update accounts set salt = $1, hash = $2, iterations = $3 where id = $4", [hex(salt), hash, NEW_ROUNDS, account.id]);
  const token = cookieToken(req);
  await sql("delete from sessions where account_id = $1 and token_hash <> $2", [account.id, tokenHash(token)]);
  send(res, 200, { ok: true });
}

async function ensureOwner() {
  const password = String(process.env.BLADEKV1_OWNER_PASSWORD || "").trim();
  if (password.length < 8) return;
  const existing = await findAccount(ownerId);
  if (!existing) {
    const account = await createAccount({
      id: ownerId,
      name: "Blade",
      contact: "",
      born: "",
      password,
      verified: true,
      role: "admin",
    });
    if (account) await ensureProfile(account.id);
    return;
  }
  let same = false;
  try {
    const rounds = Number(existing.iterations) || 100000;
    const actual = await hashPassword(password, Buffer.from(String(existing.salt), "hex"), rounds);
    same = passwordMatches(actual, existing.hash);
  } catch {
    same = false;
  }
  if (same && existing.role === "admin" && flag(existing.verified)) {
    await ensureProfile(ownerId);
    return;
  }
  const salt = randomBytes(16);
  const hash = await hashPassword(password, salt, NEW_ROUNDS);
  await sql(
    "update accounts set salt = $1, hash = $2, verified = true, role = 'admin', iterations = $3 where id = $4",
    [hex(salt), hash, NEW_ROUNDS, ownerId],
  );
  await sql("delete from sessions where account_id = $1", [ownerId]);
  await ensureProfile(ownerId);
}

async function applyVerify(req, res) {
  const account = await currentAccount(req);
  if (!account) return send(res, 401, { error: "Önce giriş yap." });
  if (flag(account.verified)) return send(res, 400, { error: "Bu hesapta mavi tik var." });
  const pending = await sql(
    "select id from verification_requests where account_id = $1 and status = 'pending' limit 1",
    [account.id],
  );
  if (pending.length) return send(res, 409, { error: "Başvurun zaten inceleniyor." });
  const body = await readJson(req);
  const fullName = String(body.fullName || "").trim().slice(0, 80);
  const category = String(body.category || "");
  const audience = String(body.audience || "").trim().slice(0, 200);
  const reason = String(body.reason || "").trim().slice(0, 600);
  const link = String(body.link || "").trim().slice(0, 200);
  if (!fullName) return send(res, 400, { error: "Adını yaz." });
  if (!categories.has(category)) return send(res, 400, { error: "Bir kategori seç." });
  if (reason.length < 8) return send(res, 400, { error: "Nedenini biraz daha yaz." });
  if (link && !/^https:\/\/\S+$/.test(link)) return send(res, 400, { error: "Bağlantı https ile başlamalı." });
  const id = hex(randomBytes(16));
  await sql(
    `insert into verification_requests (id, account_id, full_name, category, audience, reason, link)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, account.id, fullName, category, audience, reason, link],
  );
  send(res, 200, { ok: true, user: await accountView(account) });
}

async function review(req, res) {
  const account = await currentAccount(req);
  if (!account || account.role !== "admin") return send(res, 403, { error: "Bu işlem yönetici hesabında." });
  const body = await readJson(req);
  const id = String(body.id || "");
  const status = body.status === "approved" ? "approved" : body.status === "rejected" ? "rejected" : "";
  if (!/^[a-f0-9]{32}$/.test(id) || !status) return send(res, 400, { error: "Başvuru seçilemedi." });
  const rows = await sql("select id, account_id, status from verification_requests where id = $1", [id]);
  const request = rows[0];
  if (!request || request.status !== "pending") return send(res, 404, { error: "Başvuru bulunamadı." });
  await sql("update verification_requests set status = $1, reviewed_at = now() where id = $2", [status, id]);
  if (status === "approved") await sql("update accounts set verified = true where id = $1", [request.account_id]);
  send(res, 200, { ok: true, people: await people() });
}

async function adminRequests(req, res) {
  const account = await currentAccount(req);
  if (!account || account.role !== "admin") return send(res, 403, { error: "Bu sayfa yönetici hesabında." });
  const requests = await sql(
    `select r.id, r.full_name, r.category, r.audience, r.reason, r.link, r.status, r.created_at, a.id as account_id, a.name as account_name, a.verified
     from verification_requests r join accounts a on a.id = r.account_id
     order by r.created_at desc limit 80`,
  );
  const accounts = await sql("select id, name, verified, role, created_at from accounts order by created_at desc limit 80");
  send(res, 200, {
    requests: requests.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      category: row.category,
      audience: row.audience,
      reason: row.reason,
      link: /^https:\/\/\S+$/.test(row.link) ? row.link : "",
      status: row.status,
      accountId: row.account_id,
      accountName: row.account_name,
      verified: flag(row.verified),
    })),
    accounts: accounts.map((row) => ({
      id: row.id,
      name: row.name,
      verified: flag(row.verified),
      role: row.role === "admin" ? "admin" : "user",
    })),
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") return send(res, 200, { ok: true });
  if (req.method === "GET" && pathname === "/api/session") {
    const token = cookieToken(req);
    const key = token ? `session:${tokenHash(token).slice(0, 12)}` : "session:anon";
    if (hitBucket(key, token ? 40 : 20, 60 * 1000)) return send(res, 429, { error: "Çok sık deneme oldu. Biraz bekle." });
    const account = await currentAccount(req);
    return send(res, 200, { user: await accountView(account) });
  }
  if (req.method === "GET" && pathname === "/api/people") {
    const account = await currentAccount(req);
    if (!account) return send(res, 401, { error: "Önce giriş yap." });
    if (hitBucket(`people:${account.id}`, 12, 60 * 1000)) return send(res, 429, { error: "Çok sık deneme oldu. Biraz bekle." });
    const rows = await sql("select id, name, verified from accounts where role <> 'seed' order by created_at desc limit 20");
    return send(res, 200, { people: rows.map(publicPerson) });
  }
  if (req.method === "GET" && await handleSocial(req, res, pathname, { send, currentAccount })) return;
  if (!sameOrigin(req)) return send(res, 403, { error: "İstek kabul edilmedi." });
  if (req.method === "POST" && await handleSocial(req, res, pathname, { send, currentAccount })) return;
  if (req.method === "POST" && pathname === "/api/login") return login(req, res);
  if (req.method === "POST" && pathname === "/api/register") return register(req, res);
  if (req.method === "POST" && pathname === "/api/logout") {
    const token = cookieToken(req);
    if (token) await sql("delete from sessions where token_hash = $1", [tokenHash(token)]);
    return send(res, 200, { ok: true }, { "set-cookie": clearCookie(req) });
  }
  if (req.method === "POST" && pathname === "/api/password") return changePassword(req, res);
  if (req.method === "POST" && pathname === "/api/verify") return applyVerify(req, res);
  if (req.method === "GET" && (pathname === "/api/admin/requests" || pathname === "/api/admin-requests")) return adminRequests(req, res);
  if (req.method === "POST" && (pathname === "/api/admin/review" || pathname === "/api/admin-review")) return review(req, res);
  return send(res, 404, { error: "Bulunamadı." });
}

function blocked(pathname) {
  const name = pathname.toLowerCase();
  return name.startsWith("/server") || name.startsWith("/scripts") || name.startsWith("/migrations")
    || name.startsWith("/node_modules") || name.startsWith("/.git") || name.includes("..")
    || name.endsWith(".env") || name.endsWith(".sql") || name.endsWith(".mjs")
    || name.endsWith("package.json") || name.endsWith("package-lock.json");
}

function serveStatic(req, res, pathname) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) {
    res.writeHead(400);
    res.end();
    return;
  }
  const requested = decoded === "/" ? "/index.html" : decoded;
  if (blocked(requested)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const file = path.resolve(root, requested.replace(/^\/+/, ""));
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  const type = types[path.extname(file).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "content-type": type, ...SHIELD });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

let booted;
function boot() {
  booted ??= (async () => {
    await sql("select 1 as ok");
    await sql(
      `create table if not exists login_attempts (
         account_id text primary key references accounts (id) on delete cascade,
         fails integer not null default 0,
         window_until timestamptz not null,
         locked_until timestamptz
       )`,
    );
    await clearSamples();
    await ensureOwner();
    await sweepMedia();
  })();
  return booted;
}

export function handleRequest(req, res) {
  const run = (async () => {
    await boot();
    let pathname = "/";
    try {
      const url = new URL(req.url || "/", "http://localhost");
      pathname = url.pathname;
      if (!pathname.startsWith("/api/") && Array.isArray(req.query?.path)) {
        pathname = `/api/${req.query.path.map((part) => encodeURIComponent(part)).join("/")}`;
      }
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (pathname.startsWith("/api/")) return handleApi(req, res, pathname);
    return serveStatic(req, res, pathname);
  })();
  run.catch((error) => {
    const status = error.status || 500;
    if (status === 500) console.error("request failed");
    if (!res.headersSent) send(res, status, { error: status === 500 ? "Sunucu hatası." : error.message });
  });
}

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT) || 8765;
  const server = createServer(handleRequest);
  await boot();
  server.listen(port, "0.0.0.0", () => {
    console.log(`bladekv1 listening on ${port}`);
  });
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
