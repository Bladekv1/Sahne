import { createHash, pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ME as ownerId, users as seedUsers } from "./js/data.js";
import { sql } from "./server/db.js";

const pbkdf2Async = promisify(pbkdf2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const reserved = new Set(seedUsers.map((user) => user.id));
const categories = new Set(["Kişi", "Yaratıcı", "İşletme"]);
const attempts = new Map();
let globalWindow = { count: 0, until: 0 };

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
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function clientKey(req) {
  return req.socket.remoteAddress || "local";
}

function limited(req) {
  const now = Date.now();
  if (globalWindow.until < now) globalWindow = { count: 0, until: now + 10 * 60 * 1000 };
  globalWindow.count += 1;
  if (globalWindow.count > 80) return true;
  const key = clientKey(req);
  const slot = attempts.get(key);
  if (!slot || slot.until < now) {
    attempts.set(key, { count: 1, until: now + 10 * 60 * 1000 });
    return false;
  }
  slot.count += 1;
  return slot.count > 8;
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
  const secure = req.headers["x-forwarded-proto"] === "https";
  const parts = [`blade_session=${encodeURIComponent(token)}`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=2592000"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function clearCookie() {
  return "blade_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

async function hashPassword(password, salt) {
  const bits = await pbkdf2Async(password, salt, 100000, 32, "sha256");
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
  const rows = await sql("select id, name, verified from accounts order by created_at asc");
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
  send(res, 200, { user, created: Boolean(created), people: await people() }, { "set-cookie": sessionCookie(token, req) });
}

async function findAccount(ident) {
  const key = cleanId(ident);
  const rows = await sql("select * from accounts where id = $1 or (contact <> '' and contact = $1) limit 1", [key]);
  return rows[0] || null;
}

async function createAccount({ id, name, contact, born, password, verified, role }) {
  const salt = randomBytes(16);
  const hash = await hashPassword(password, salt);
  const rows = await sql(
    `insert into accounts (id, name, contact, born, salt, hash, verified, role)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (id) do nothing
     returning id, name, verified, role`,
    [id, name, contact, born, hex(salt), hash, verified, role],
  );
  return rows[0] || null;
}

async function login(req, res) {
  if (limited(req)) return send(res, 429, { error: "Çok deneme oldu. Biraz bekle." });
  const body = await readJson(req);
  const ident = cleanId(body.id);
  const password = String(body.password || "");
  const account = await findAccount(ident);
  if (!account && ident === ownerId) return send(res, 401, { error: "Yönetici hesabı henüz hazır değil." });
  if (!account) return send(res, 401, { error: "Bu hesap yok. Kaydol." });
  if (password.length < 8) return send(res, 401, { error: "Şifre yanlış." });
  const actual = await hashPassword(password, Buffer.from(String(account.salt), "hex"));
  if (!passwordMatches(actual, account.hash)) return send(res, 401, { error: "Şifre yanlış." });
  return openSession(res, req, account, false);
}

async function register(req, res) {
  if (limited(req)) return send(res, 429, { error: "Çok deneme oldu. Biraz bekle." });
  const body = await readJson(req);
  const id = String(body.username || "").trim().toLowerCase();
  const name = String(body.name || "").trim().slice(0, 40);
  const contact = cleanId(body.contact);
  const born = String(body.born || "");
  const password = String(body.password || "");
  if (!/^[a-z0-9._]{3,30}$/.test(id)) return send(res, 400, { error: "Kullanıcı adı 3–30 karakter olmalı. Harf, rakam, nokta veya alt çizgi." });
  if (reserved.has(id)) return send(res, 400, { error: "Bu kullanıcı adı kullanılıyor." });
  if (!name) return send(res, 400, { error: "Adını yaz." });
  if (!validContact(contact)) return send(res, 400, { error: "E-posta ya da telefon yaz." });
  if (password.length < 8) return send(res, 400, { error: "Şifre en az 8 karakter olmalı." });
  if (!validBorn(born)) return send(res, 400, { error: "Doğum günü 13 yaşından büyük olmalı." });
  const existing = await sql("select id from accounts where id = $1 or (contact <> '' and contact = $2) limit 1", [id, contact]);
  if (existing.length) return send(res, 409, { error: "Bu hesap zaten kayıtlı. Giriş yap." });
  const account = await createAccount({
    id,
    name,
    contact,
    born,
    password,
    verified: false,
    role: "user",
  });
  if (!account) return send(res, 409, { error: "Bu hesap zaten kayıtlı. Giriş yap." });
  return openSession(res, req, account, true);
}

async function changePassword(req, res) {
  if (limited(req)) return send(res, 429, { error: "Çok deneme oldu. Biraz bekle." });
  const sessionAccount = await currentAccount(req);
  if (!sessionAccount) return send(res, 401, { error: "Önce giriş yap." });
  const account = await findAccount(sessionAccount.id);
  if (!account) return send(res, 401, { error: "Önce giriş yap." });
  const body = await readJson(req);
  const current = String(body.current || "");
  const next = String(body.next || "");
  if (next.length < 8) return send(res, 400, { error: "Yeni şifre en az 8 karakter olmalı." });
  const actual = await hashPassword(current, Buffer.from(String(account.salt), "hex"));
  if (!passwordMatches(actual, account.hash)) return send(res, 401, { error: "Şimdiki şifre yanlış." });
  const salt = randomBytes(16);
  const hash = await hashPassword(next, salt);
  await sql("update accounts set salt = $1, hash = $2 where id = $3", [hex(salt), hash, account.id]);
  send(res, 200, { ok: true });
}

async function ensureOwner() {
  const password = String(process.env.BLADEKV1_OWNER_PASSWORD || "").trim();
  if (password.length < 12) return;
  const existing = await findAccount(ownerId);
  if (!existing) {
    await createAccount({
      id: ownerId,
      name: "Blade",
      contact: "",
      born: "",
      password,
      verified: true,
      role: "admin",
    });
    return;
  }
  let same = false;
  try {
    const actual = await hashPassword(password, Buffer.from(String(existing.salt), "hex"));
    same = passwordMatches(actual, existing.hash);
  } catch {
    same = false;
  }
  if (same && existing.role === "admin" && flag(existing.verified)) return;
  const salt = randomBytes(16);
  const hash = await hashPassword(password, salt);
  await sql(
    "update accounts set salt = $1, hash = $2, verified = true, role = 'admin' where id = $3",
    [hex(salt), hash, ownerId],
  );
  await sql("delete from sessions where account_id = $1", [ownerId]);
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
    const account = await currentAccount(req);
    return send(res, 200, { user: await accountView(account), people: await people() });
  }
  if (req.method === "GET" && pathname === "/api/people") return send(res, 200, { people: await people() });
  if (!sameOrigin(req)) return send(res, 403, { error: "İstek kabul edilmedi." });
  if (req.method === "POST" && pathname === "/api/login") return login(req, res);
  if (req.method === "POST" && pathname === "/api/register") return register(req, res);
  if (req.method === "POST" && pathname === "/api/logout") {
    const token = cookieToken(req);
    if (token) await sql("delete from sessions where token_hash = $1", [tokenHash(token)]);
    return send(res, 200, { ok: true }, { "set-cookie": clearCookie() });
  }
  if (req.method === "POST" && pathname === "/api/password") return changePassword(req, res);
  if (req.method === "POST" && pathname === "/api/verify") return applyVerify(req, res);
  if (req.method === "GET" && pathname === "/api/admin/requests") return adminRequests(req, res);
  if (req.method === "POST" && pathname === "/api/admin/review") return review(req, res);
  return send(res, 404, { error: "Bulunamadı." });
}

function blocked(pathname) {
  const name = pathname.toLowerCase();
  return name.startsWith("/server") || name.startsWith("/scripts") || name.startsWith("/migrations")
    || name.startsWith("/node_modules") || name.startsWith("/.git") || name.includes("..")
    || name.endsWith(".env") || name.endsWith("package.json") || name.endsWith("package-lock.json");
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
  res.writeHead(200, { "content-type": type, "x-content-type-options": "nosniff" });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

const port = Number(process.env.PORT) || 8765;
const server = createServer((req, res) => {
  let pathname = "/";
  try {
    pathname = new URL(req.url || "/", "http://localhost").pathname;
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  const run = pathname.startsWith("/api/") ? handleApi(req, res, pathname) : Promise.resolve(serveStatic(req, res, pathname));
  run.catch((error) => {
    const status = error.status || 500;
    if (status === 500) console.error("request failed");
    if (!res.headersSent) send(res, status, { error: status === 500 ? "Sunucu hatası." : error.message });
  });
});

await sql("select 1 as ok");
await ensureOwner();
server.listen(port, "0.0.0.0", () => {
  console.log(`bladekv1 listening on ${port}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
