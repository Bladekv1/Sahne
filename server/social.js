import { randomBytes } from "node:crypto";
import { sql } from "./db.js";

const MEDIA_ID = /^[a-f0-9]{32}$/;
const USER_ID = /^[a-z0-9._]{1,64}$/;
const MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime"]);
const writes = new Map();
const paces = new Map();
const worldCache = new Map();
const MAX_IMAGE = 4 * 1024 * 1024;
const MAX_VIDEO = 8 * 1024 * 1024;
const ACCOUNT_QUOTA = 8 * 1024 * 1024;
const ACCOUNT_FILES = 6;
const UNREFERENCED = `not exists (select 1 from post_media pm where pm.src = '/api/media/' || m.id)
  and not exists (select 1 from posts p where p.src = '/api/media/' || m.id or p.poster = '/api/media/' || m.id)
  and not exists (select 1 from stories s where s.src = '/api/media/' || m.id)
  and not exists (select 1 from profiles pr where pr.avatar = '/api/media/' || m.id)
  and not exists (select 1 from highlights h where h.cover = '/api/media/' || m.id or h.frames like '%/api/media/' || m.id || '%')`;
const SHIELD = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  "referrer-policy": "same-origin",
};

function flag(value) {
  return value === true || value === 1 || value === "t" || value === "true";
}

function epoch(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function publicSrc(src) {
  const value = String(src || "");
  if (/^media\/(?:photos|reels|avatars|icons)\/[a-z0-9._-]+$/i.test(value)) return value;
  if (/^\/api\/media\/[a-f0-9]{32}$/.test(value)) return value;
  return "";
}

function cleanUser(value) {
  const id = String(value || "").trim().toLowerCase();
  return USER_ID.test(id) ? id : "";
}

function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}

function busy(accountId) {
  const now = Date.now();
  const slot = writes.get(accountId);
  if (!slot || slot.until < now) {
    writes.set(accountId, { count: 1, until: now + 10 * 60 * 1000 });
    return false;
  }
  slot.count += 1;
  return slot.count > 80;
}

function pace(key, limit, windowMs) {
  const now = Date.now();
  if (paces.size > 4000) {
    for (const [name, slot] of paces) {
      if (slot.until < now) paces.delete(name);
    }
  }
  const slot = paces.get(key);
  if (!slot || slot.until < now) {
    paces.set(key, { count: 1, until: now + windowMs });
    return false;
  }
  slot.count += 1;
  return slot.count > limit;
}

function forgetWorld(accountId) {
  if (accountId) worldCache.delete(accountId);
}

function rememberWorld(accountId, body) {
  worldCache.set(accountId, { at: Date.now(), body });
  if (worldCache.size > 400) {
    const now = Date.now();
    for (const [key, value] of worldCache) {
      if (now - value.at > 8000) worldCache.delete(key);
    }
  }
}

function asCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 40000) fail(413, "İstek çok büyük.");
    chunks.push(Buffer.from(chunk));
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(400, "İstek okunamadı.");
  }
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, "Dosya çok büyük.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string" && value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
  return Buffer.alloc(0);
}

export async function ensureProfile(id) {
  await sql("insert into profiles (account_id) values ($1) on conflict (account_id) do nothing", [id]);
}

async function accountExists(id) {
  const rows = await sql("select id from accounts where id = $1", [id]);
  return rows.length > 0;
}

export async function clearSamples() {
  await sql("delete from sessions where account_id in (select id from accounts where role = 'seed')");
  await sql("delete from verification_requests where account_id in (select id from accounts where role = 'seed')");
  await sql("delete from accounts where role = 'seed'");
}

async function requireUser(currentAccount, req) {
  const account = await currentAccount(req);
  if (!account) fail(401, "Önce giriş yap.");
  if (busy(account.id)) fail(429, "Çok deneme oldu. Biraz bekle.");
  forgetWorld(account.id);
  return account;
}

async function canSeeAccount(viewerId, ownerId) {
  if (viewerId === ownerId) return true;
  const rows = await sql("select closed from profiles where account_id = $1", [ownerId]);
  if (!rows.length || !flag(rows[0].closed)) return true;
  if (!viewerId) return false;
  const follow = await sql(
    "select 1 from follows where follower_id = $1 and following_id = $2 limit 1",
    [viewerId, ownerId],
  );
  return follow.length > 0;
}

function shapePost(row, images, comments, likeTotal, likers, mine) {
  const collaborators = String(row.collaborators || "").split(",").map(cleanUser).filter(Boolean);
  return {
    id: row.id,
    user: row.account_id,
    images,
    alt: row.alt || "",
    caption: row.caption || "",
    location: row.location || "",
    topic: row.topic || "",
    likes: Math.max(0, likeTotal - (mine ? 1 : 0)),
    at: epoch(row.at),
    likers,
    comments,
    ai: flag(row.ai),
    collaborators,
    commentsClosed: flag(row.comments_closed),
  };
}

function shapeReel(row, likeTotal, mine) {
  return {
    id: row.id,
    user: row.account_id,
    src: publicSrc(row.src),
    poster: publicSrc(row.poster),
    image: publicSrc(row.poster),
    caption: row.caption || "",
    likes: Math.max(0, likeTotal - (mine ? 1 : 0)),
    at: epoch(row.at),
    topic: row.topic || "",
    comments: [],
    commentsClosed: flag(row.comments_closed),
  };
}

async function loadWorld(account) {
  const viewer = account.id;
  const profiles = await sql(
    `select a.id, a.name, a.verified, a.role,
            coalesce(p.bio, '') as bio, coalesce(p.note, '') as note, coalesce(p.pronouns, '') as pronouns,
            coalesce(p.category, '') as category, coalesce(p.link, '') as link, coalesce(p.avatar, '') as avatar,
            coalesce(p.closed, false) as closed
     from accounts a
     left join profiles p on p.account_id = a.id
     order by a.created_at asc
     limit 500`,
  );
  const followRows = await sql("select follower_id, following_id from follows limit 5000");
  const followers = new Map();
  const following = new Map();
  const myFollowing = new Set();
  for (const row of followRows) {
    if (!followers.has(row.following_id)) followers.set(row.following_id, []);
    if (followers.get(row.following_id).length < 200) followers.get(row.following_id).push(row.follower_id);
    if (!following.has(row.follower_id)) following.set(row.follower_id, []);
    if (following.get(row.follower_id).length < 200) following.get(row.follower_id).push(row.following_id);
    if (row.follower_id === viewer) myFollowing.add(row.following_id);
  }
  const counts = new Map();
  for (const row of followRows) {
    const item = counts.get(row.following_id) || { followers: 0, following: 0 };
    item.followers += 1;
    counts.set(row.following_id, item);
    const other = counts.get(row.follower_id) || { followers: 0, following: 0 };
    other.following += 1;
    counts.set(row.follower_id, other);
  }
  const people = profiles.map((row) => {
    const stat = counts.get(row.id) || { followers: 0, following: 0 };
    const open = row.id === viewer || !flag(row.closed) || myFollowing.has(row.id);
    return {
      id: row.id,
      name: row.name,
      bio: open ? row.bio || "" : "",
      note: open ? row.note || "" : "",
      pronouns: open ? row.pronouns || "" : "",
      category: open ? row.category || "" : "",
      link: open && /^https:\/\/\S+$/.test(row.link) ? row.link : "",
      avatar: open ? publicSrc(row.avatar) : "",
      closed: flag(row.closed),
      verified: flag(row.verified),
      sample: row.role === "seed",
      followers: stat.followers,
      following: stat.following,
      followerIds: open ? followers.get(row.id) || [] : [],
      followingIds: open ? following.get(row.id) || [] : [],
      followed: myFollowing.has(row.id),
    };
  });
  const visible = new Set(people.filter((person) => person.id === viewer || !person.closed || myFollowing.has(person.id)).map((person) => person.id));
  const postRows = await sql(
    `select id, account_id, kind, caption, location, topic, alt, ai, comments_closed, collaborators, src, poster,
            (extract(epoch from created_at) * 1000) as at
     from posts
     order by created_at desc
     limit 300`,
  );
  const mediaRows = await sql("select post_id, position, src from post_media order by post_id, position");
  const images = new Map();
  for (const row of mediaRows) {
    const src = publicSrc(row.src);
    if (!src) continue;
    if (!images.has(row.post_id)) images.set(row.post_id, []);
    images.get(row.post_id).push(src);
  }
  const commentRows = await sql(
    `select id, post_id, account_id, body, (extract(epoch from created_at) * 1000) as at
     from comments order by created_at asc limit 2000`,
  );
  const comments = new Map();
  for (const row of commentRows) {
    if (!comments.has(row.post_id)) comments.set(row.post_id, []);
    comments.get(row.post_id).push({
      id: row.id,
      user: row.account_id,
      text: row.body,
      at: epoch(row.at),
      own: row.account_id === viewer,
    });
  }
  const likeRows = await sql(
    "select post_id, account_id, (extract(epoch from created_at) * 1000) as at from likes order by created_at desc limit 5000",
  );
  const likeCount = new Map();
  const likers = new Map();
  const myLikes = new Set();
  for (const row of likeRows) {
    likeCount.set(row.post_id, (likeCount.get(row.post_id) || 0) + 1);
    if (!likers.has(row.post_id)) likers.set(row.post_id, []);
    if (likers.get(row.post_id).length < 24) likers.get(row.post_id).push(row.account_id);
    if (row.account_id === viewer) myLikes.add(row.post_id);
  }
  const posts = [];
  const reelsOut = [];
  for (const row of postRows) {
    if (!visible.has(row.account_id)) continue;
    const total = likeCount.get(row.id) || 0;
    const mine = myLikes.has(row.id);
    if (row.kind === "reel") {
      const reel = shapeReel(row, total, mine);
      reel.comments = comments.get(row.id) || [];
      reelsOut.push(reel);
    } else {
      posts.push(shapePost(row, images.get(row.id) || [], comments.get(row.id) || [], total, likers.get(row.id) || [], mine));
    }
  }
  const storyRows = await sql(
    `select id, account_id, src, text, (extract(epoch from created_at) * 1000) as at
     from stories
     where created_at > now() - interval '24 hours'
     order by created_at asc
     limit 300`,
  );
  const storyMap = new Map();
  for (const row of storyRows) {
    if (!visible.has(row.account_id)) continue;
    const src = publicSrc(row.src);
    if (!src) continue;
    if (!storyMap.has(row.account_id)) storyMap.set(row.account_id, []);
    storyMap.get(row.account_id).push({ id: row.id, image: src, text: row.text || "", at: epoch(row.at) });
  }
  const seenRows = await sql("select story_id from story_seen where account_id = $1", [viewer]);
  const seenByUser = {};
  const storyOwner = new Map();
  for (const [owner, frames] of storyMap) {
    for (const frame of frames) storyOwner.set(frame.id, owner);
  }
  for (const row of seenRows) {
    const owner = storyOwner.get(row.story_id);
    if (!owner) continue;
    if (!seenByUser[owner]) seenByUser[owner] = {};
    seenByUser[owner][row.story_id] = true;
  }
  const highlightRows = await sql("select id, account_id, title, cover, frames from highlights order by created_at asc limit 100");
  const highlightOut = [];
  for (const row of highlightRows) {
    if (!visible.has(row.account_id)) continue;
    let frames = [];
    try { frames = JSON.parse(row.frames || "[]"); } catch { frames = []; }
    highlightOut.push({
      id: row.id,
      owner: row.account_id,
      title: row.title,
      cover: publicSrc(row.cover),
      frames: (Array.isArray(frames) ? frames : []).map((frame) => ({
        id: String(frame.id || ""),
        image: publicSrc(frame.image),
        at: epoch(frame.at),
      })).filter((frame) => frame.image),
    });
  }
  const messageRows = await sql(
    `select id, sender_id, recipient_id, body, (extract(epoch from created_at) * 1000) as at
     from messages
     where sender_id = $1 or recipient_id = $1
     order by created_at asc
     limit 500`,
    [viewer],
  );
  const threadMap = new Map();
  for (const row of messageRows) {
    const peer = row.sender_id === viewer ? row.recipient_id : row.sender_id;
    if (!threadMap.has(peer)) threadMap.set(peer, []);
    threadMap.get(peer).push({ id: row.id, from: row.sender_id, text: row.body, at: epoch(row.at) });
  }
  const readRows = await sql(
    "select peer_id, (extract(epoch from read_at) * 1000) as at from reads where account_id = $1",
    [viewer],
  );
  const saveRows = await sql("select post_id from saves where account_id = $1", [viewer]);
  const hideRows = await sql("select post_id from hides where account_id = $1", [viewer]);
  const replyRows = await sql(
    `select r.id, r.account_id, r.body, (extract(epoch from r.created_at) * 1000) as at
     from story_replies r
     join stories s on s.id = r.story_id
     where s.account_id = $1
     order by r.created_at desc
     limit 40`,
    [viewer],
  );
  const likeActivity = await sql(
    `select l.account_id, l.post_id, (extract(epoch from l.created_at) * 1000) as at
     from likes l join posts p on p.id = l.post_id
     where p.account_id = $1 and l.account_id <> $1
     order by l.created_at desc limit 20`,
    [viewer],
  );
  const commentActivity = await sql(
    `select c.account_id, c.post_id, c.body, (extract(epoch from c.created_at) * 1000) as at
     from comments c join posts p on p.id = c.post_id
     where p.account_id = $1 and c.account_id <> $1
     order by c.created_at desc limit 20`,
    [viewer],
  );
  const followActivity = await sql(
    `select follower_id, (extract(epoch from created_at) * 1000) as at
     from follows where following_id = $1
     order by created_at desc limit 20`,
    [viewer],
  );
  const activity = [
    ...likeActivity.map((row) => ({ id: `like-${row.account_id}-${row.post_id}`, user: row.account_id, type: "like", postId: row.post_id, text: "gönderini beğendi", at: epoch(row.at) })),
    ...commentActivity.map((row) => ({ id: `comment-${row.account_id}-${row.post_id}-${epoch(row.at)}`, user: row.account_id, type: "comment", postId: row.post_id, text: `yorum yaptı: ${clip(row.body, 80)}`, at: epoch(row.at) })),
    ...followActivity.map((row) => ({ id: `follow-${row.follower_id}`, user: row.follower_id, type: "follow", postId: "", text: "seni takip etmeye başladı", at: epoch(row.at) })),
  ].sort((a, b) => b.at - a.at).slice(0, 40);
  const requestRows = await sql(
    `select requester_id, target_id, (extract(epoch from created_at) * 1000) as at
     from follow_requests
     where requester_id = $1 or target_id = $1`,
    [viewer],
  );
  const requestsOut = [];
  const requestsIn = [];
  for (const row of requestRows) {
    if (row.requester_id === viewer) requestsOut.push(row.target_id);
    else requestsIn.push({ id: row.requester_id, at: epoch(row.at) });
  }
  return {
    profiles: people,
    posts,
    reels: reelsOut,
    stories: [...storyMap.entries()].map(([user, frames]) => ({ user, frames })),
    highlights: highlightOut,
    threads: [...threadMap.entries()].map(([user, messages]) => ({ user, messages })),
    likes: [...myLikes],
    saves: saveRows.map((row) => row.post_id),
    hidden: hideRows.map((row) => row.post_id),
    following: [...myFollowing],
    seen: seenByUser,
    reads: Object.fromEntries(readRows.map((row) => [row.peer_id, epoch(row.at)])),
    storyReplies: replyRows.map((row) => ({ id: row.id, user: row.account_id, text: row.body, at: epoch(row.at) })),
    activity,
    requestsOut,
    requestsIn,
  };
}

async function ownedMedia(accountId, mediaId) {
  if (!MEDIA_ID.test(mediaId)) return null;
  const rows = await sql("select id, mime from media where id = $1 and account_id = $2", [mediaId, accountId]);
  return rows[0] || null;
}

async function sendWorld(req, res, send, currentAccount) {
  const account = await currentAccount(req);
  if (!account) return send(res, 401, { error: "Önce giriş yap." });
  await sweepMedia();
  if (pace(`world:${account.id}`, 20, 60 * 1000)) return send(res, 429, { error: "Çok sık yenileniyor. Biraz bekle." });
  const cached = worldCache.get(account.id);
  if (cached && Date.now() - cached.at < 4000) return send(res, 200, cached.body);
  const body = await loadWorld(account);
  rememberWorld(account.id, body);
  send(res, 200, body);
}

let sweptAt = 0;

export async function sweepMedia() {
  const now = Date.now();
  if (now - sweptAt < 30 * 1000) return;
  sweptAt = now;
  await sql("delete from stories where created_at <= now() - interval '24 hours'");
  await sql(`delete from media m where m.created_at < now() - interval '15 minutes' and ${UNREFERENCED}`);
}

async function dropUnreferenced(ids) {
  for (const id of ids) {
    if (!MEDIA_ID.test(id)) continue;
    await sql(`delete from media m where m.id = $1 and ${UNREFERENCED}`, [id]);
  }
}

function mediaIdFrom(src) {
  const match = /^\/api\/media\/([a-f0-9]{32})$/.exec(String(src || ""));
  return match ? match[1] : "";
}

async function mediaUsage(accountId) {
  const rows = await sql(
    "select count(*)::int as files, coalesce(sum(octet_length(bytes)), 0)::bigint as bytes from media where account_id = $1",
    [accountId],
  );
  return { files: asCount(rows[0]?.files), bytes: asCount(rows[0]?.bytes) };
}

async function upload(req, res, send, currentAccount) {
  const account = await requireUser(currentAccount, req);
  if (pace(`upload:${account.id}`, 4, 10 * 60 * 1000)) fail(429, "Çok fazla dosya. Biraz bekle.");
  const mime = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!MIMES.has(mime)) fail(400, "JPG, PNG, WEBP, GIF veya MP4 seç.");
  await sweepMedia();
  const usage = await mediaUsage(account.id);
  if (usage.files >= ACCOUNT_FILES || usage.bytes >= ACCOUNT_QUOTA) fail(413, "Hesabının depolama alanı doldu.");
  const limit = mime.startsWith("video/") ? MAX_VIDEO : MAX_IMAGE;
  const bytes = await readBody(req, limit);
  if (bytes.length < 32) fail(400, "Dosya boş görünüyor.");
  if (usage.bytes + bytes.length > ACCOUNT_QUOTA) fail(413, "Hesabının depolama alanı doldu.");
  const id = hex(randomBytes(16));
  await sql("insert into media (id, account_id, mime, bytes) values ($1, $2, $3, $4)", [id, account.id, mime, bytes]);
  send(res, 200, { id });
}

async function sendMedia(req, res, id, currentAccount) {
  if (!MEDIA_ID.test(id)) {
    res.writeHead(404, SHIELD);
    res.end();
    return;
  }
  const rows = await sql("select account_id, mime, created_at from media where id = $1", [id]);
  const row = rows[0];
  if (!row || !MIMES.has(row.mime)) {
    res.writeHead(404, SHIELD);
    res.end();
    return;
  }
  const viewer = await currentAccount(req);
  if (!viewer) {
    res.writeHead(401, SHIELD);
    res.end();
    return;
  }
  if (pace(`media:${viewer.id}`, 90, 60 * 1000)) {
    res.writeHead(429, SHIELD);
    res.end();
    return;
  }
  const linked = await sql(`select 1 from media m where m.id = $1 and not (${UNREFERENCED}) limit 1`, [id]);
  const fresh = viewer.id === row.account_id && Date.now() - new Date(row.created_at).getTime() < 30 * 60 * 1000;
  if (!linked.length && !fresh) {
    res.writeHead(404, SHIELD);
    res.end();
    return;
  }
  const allowed = fresh || viewer.id === row.account_id || await canSeeAccount(viewer.id, row.account_id);
  if (!allowed) {
    res.writeHead(404, SHIELD);
    res.end();
    return;
  }
  const stored = await sql("select bytes from media where id = $1", [id]);
  const bytes = asBuffer(stored[0]?.bytes);
  const total = bytes.length;
  const headers = {
    "content-type": row.mime,
    ...SHIELD,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
  };
  const range = String(req.headers.range || "");
  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (match) {
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : total - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= total || end >= total) {
      res.writeHead(416, { "content-range": `bytes */${total}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...headers, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${total}` });
    res.end(bytes.subarray(start, end + 1));
    return;
  }
  res.writeHead(200, { ...headers, "content-length": total });
  if (req.method === "HEAD") res.end();
  else res.end(bytes);
}

async function createPost(req, res, send, currentAccount) {
  const account = await requireUser(currentAccount, req);
  const body = await readJson(req);
  const kind = body.kind === "reel" ? "reel" : "post";
  const mediaIds = Array.isArray(body.mediaIds) ? body.mediaIds.map((id) => String(id || "")).filter((id) => MEDIA_ID.test(id)).slice(0, 10) : [];
  if (!mediaIds.length) fail(400, "Bir fotoğraf veya video seç.");
  const owned = [];
  for (const id of mediaIds) {
    const row = await ownedMedia(account.id, id);
    if (!row) fail(400, "Dosya bulunamadı.");
    owned.push(row);
  }
  const caption = clip(body.caption, 2200);
  const collaborators = Array.isArray(body.collaborators) ? [...new Set(body.collaborators.map(cleanUser).filter((id) => id && id !== account.id))].slice(0, 5) : [];
  for (const id of collaborators) {
    if (!(await accountExists(id))) fail(400, "Etiketlenen hesap yok.");
  }
  const postId = hex(randomBytes(16));
  const video = owned.find((row) => row.mime.startsWith("video/"));
  const still = owned.find((row) => row.mime.startsWith("image/"));
  const src = kind === "reel" && video ? `/api/media/${video.id}` : "";
  const poster = kind === "reel" && still ? `/api/media/${still.id}` : "";
  await sql(
    `insert into posts (id, account_id, kind, caption, location, topic, alt, ai, comments_closed, collaborators, src, poster)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      postId,
      account.id,
      kind,
      caption,
      clip(body.location, 80),
      clip(body.topic, 40),
      clip(body.alt, 200),
      Boolean(body.ai),
      Boolean(body.commentsClosed),
      collaborators.join(","),
      src,
      poster,
    ],
  );
  const gallery = kind === "reel" ? [] : owned;
  for (const [index, row] of gallery.entries()) {
    await sql("insert into post_media (post_id, position, src) values ($1, $2, $3)", [postId, index, `/api/media/${row.id}`]);
  }
  send(res, 200, { ok: true, id: postId });
}

async function removePost(req, res, send, currentAccount) {
  const account = await requireUser(currentAccount, req);
  const body = await readJson(req);
  const id = String(body.id || "");
  const owned = await sql("select id from posts where id = $1 and account_id = $2", [id, account.id]);
  if (!owned.length) fail(404, "Gönderi bulunamadı.");
  const files = await sql(
    `select src from post_media where post_id = $1
     union select src from posts where id = $1
     union select poster from posts where id = $1`,
    [id],
  );
  await sql("delete from posts where id = $1 and account_id = $2", [id, account.id]);
  await dropUnreferenced(files.map((row) => mediaIdFrom(row.src)));
  send(res, 200, { ok: true });
}

async function hidePost(req, res, send, currentAccount) {
  const account = await requireUser(currentAccount, req);
  const body = await readJson(req);
  const id = String(body.id || "");
  const posts = await sql("select id from posts where id = $1", [id]);
  if (!posts.length) fail(404, "Gönderi bulunamadı.");
  await sql("insert into hides (account_id, post_id) values ($1, $2) on conflict do nothing", [account.id, id]);
  send(res, 200, { ok: true });
}

async function setLike(req, res, send, currentAccount) {
  const account = await requireUser(currentAccount, req);
  const body = await readJson(req);
  const id = String(body.id || "");
  const rows = await sql("select account_id from posts where id = $1", [id]);
  if (!rows.length) fail(404, "Gönderi bulunamadı.");
  if (!(await canSeeAccount(account.id, rows[0].account_id))) fail(404, "Gönderi bulunamadı.");
  if (body.on === false) await sql("delete from likes where account_id = $1 and post_id = $2", [account.id, id]);
  else await sql("insert into likes (account_id, post_id) values ($1, $2) on conflict do nothing", [account.id, id]);
  send(res, 200, { ok: true });
}

async function setSave(req, res, send, currentAccount) {
  const account = await requireUser(currentAccount, req);
  const body = await readJson(req);
  const id = String(body.id || "");
  const rows = await sql("select id from posts where id = $1", [id]);
  if (!rows.length) fail(404, "Gönderi bulunamadı.");
  if (body.on === false) await sql("delete from saves where account_id = $1 and post_id = $2", [account.id, id]);
  else await sql("insert into saves (account_id, post_id) values ($1, $2) on conflict do nothing", [account.id, id]);
  send(res, 200, { ok: true });
}

async function setFollow(req, res, send, currentAccount) {
  const account = await requireUser(currentAccount, req);
  const body = await readJson(req);
  const id = cleanUser(body.id);
  if (!id || id === account.id) fail(400, "Bu hesap takip edilemez.");
  if (!(await accountExists(id))) fail(404, "Bu hesap yok.");
  if (body.on === false) {
    await sql("delete from follows where follower_id = $1 and following_id = $2", [account.id, id]);
    await sql("delete from follow_requests where requester_id = $1 and target_id = $2", [account.id, id]);
    forgetWorld(id);
    return send(res, 200, { ok: true, following: false, pending: false });
  }
  const existing = await sql(
    "select 1 from follows where follower_id = $1 and following_id = $2 limit 1",
    [account.id, id],
  );
  if (existing.length) return send(res, 200, { ok: true, following: true, pending: false });
  const profile = await sql("select closed from profiles where account_id = $1", [id]);
  if (flag(profile[0]?.closed)) {
    await sql(
      "insert into follow_requests (requester_id, target_id) values ($1, $2) on conflict do nothing",
      [account.id, id],
    );
    forgetWorld(id);
    return send(res, 200, { ok: true, following: false, pending: true });
  }
  await sql("delete from follow_requests where requester_id = $1 and target_id = $2", [account.id, id]);
  await sql("insert into follows (follower_id, following_id) values ($1, $2) on conflict do nothing", [account.id, id]);
  forgetWorld(id);
  send(res, 200, { ok: true, following: true, pending: false });
}

async function acceptFollow(req, res, send, currentAccount) {
  const account = await requireUser(currentAccount, req);
  const body = await readJson(req);
  const id = cleanUser(body.id);
  if (!id) fail(400, "Bu hesap yok.");
  const rows = await sql(
    "delete from follow_requests where requester_id = $1 and target_id = $2 returning requester_id",
    [id, account.id],
  );
  if (!rows.length) fail(404, "İstek bulunamadı.");
  await sql("insert into follows (follower_id, following_id) values ($1, $2) on conflict do nothing", [id, account.id]);
  forgetWorld(id);
  send(res, 200, { ok: true });
}

async function rejectFollow(req, res, send, currentAccount) {
  const account = await requireUser(currentAccount, req);
  const body = await readJson(req);
  const id = cleanUser(body.id);
  if (!id) fail(400, "Bu hesap yok.");
  await sql("delete from follow_requests where requester_id = $1 and target_id = $2", [id, account.id]);
  forgetWorld(id);
  send(res, 200, { ok: true });
}

async function addComment(req, res, send, currentAccount) {
  const account = await requireUser(currentAccount, req);
  const body = await readJson(req);
  const postId = String(body.postId || "");
  const text = clip(body.text, 500);
  if (!text) fail(400, "Yorum yaz.");
  const rows = await sql("select account_id, comments_closed from posts where id = $1", [postId]);
  if (!rows.length) fail(404, "Gönderi bulunamadı.");
  if (flag(rows[0].comments_closed) && rows[0].account_id !== account.id) fail(400, "Yorumlar kapalı.");
  if (!(await canSeeAccount(account.id, rows[0].account_id))) fail(404, "Gönderi bulunamadı.");
  const id = hex(randomBytes(16));
  await sql("insert into comments (id, post_id, account_id, body) values ($1, $2, $3, $4)", [id, postId, account.id, text]);
  send(res, 200, { ok: true, comment: { id, user: account.id, text, at: Date.now() } });
}

async function removeComment(req, res, send, currentAccount) {
  const account = await requireUser(currentAccount, req);
  const body = await readJson(req);
  const id = String(body.id || "");
  const rows = await sql(
    `select c.id, c.account_id, p.account_id as owner
     from comments c join posts p on p.id = c.post_id
     where c.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) fail(404, "Yorum bulunamadı.");
  if (row.account_id !== account.id && row.owner !== account.id) fail(403, "Bu yorumu silemezsin.");
  await sql("delete from comments where id = $1", [id]);
  send(res, 200, { ok: true });
}

async function sendMessage(req, res, send, currentAccount) {
  const account = await requireUser(currentAccount, req);
  const body = await readJson(req);
  const to = cleanUser(body.to);
  const text = clip(body.text, 1000);
  if (!to || to === account.id) fail(400, "Bu kişiye mesaj gönderilemez.");
  if (!text) fail(400, "Mesaj yaz.");
  if (!(await accountExists(to))) fail(404, "Bu hesap yok.");
  const id = hex(randomBytes(16));
  await sql("insert into messages (id, sender_id, recipient_id, body) values ($1, $2, $3, $4)", [id, account.id, to, text]);
  await sql(
    `insert into reads (account_id, peer_id, read_at) values ($1, $2, now())
     on conflict (account_id, peer_id) do update set read_at = now()`,
    [account.id, to],
  );
  send(res, 200, { ok: true, message: { id, from: account.id, text, at: Date.now() } });
}

async function markRead(req, res, send, currentAccount) {
  const account = await requireUser(currentAccount, req);
  const body = await readJson(req);
  const peer = cleanUser(body.user);
  if (!peer) fail(400, "Sohbet seçilemedi.");
  await sql(
    `insert into reads (account_id, peer_id, read_at) values ($1, $2, now())
     on conflict (account_id, peer_id) do update set read_at = now()`,
    [account.id, peer],
  );
  send(res, 200, { ok: true });
}

async function addStory(req, res, send, currentAccount) {
  const account = await requireUser(currentAccount, req);
  const body = await readJson(req);
  const mediaId = String(body.mediaId || "");
  const row = await ownedMedia(account.id, mediaId);
  if (!row || !row.mime.startsWith("image/")) fail(400, "Hikaye için bir fotoğraf seç.");
  const id = hex(randomBytes(16));
  await sql("insert into stories (id, account_id, src, text) values ($1, $2, $3, $4)", [id, account.id, `/api/media/${mediaId}`, clip(body.text, 140)]);
  send(res, 200, { ok: true, id });
}

async function seeStory(req, res, send, currentAccount) {
  const account = await requireUser(currentAccount, req);
  const body = await readJson(req);
  const id = String(body.id || "");
  const rows = await sql("select id, account_id from stories where id = $1", [id]);
  if (!rows.length) return send(res, 200, { ok: true });
  if (!(await canSeeAccount(account.id, rows[0].account_id))) fail(404, "Hikaye bulunamadı.");
  await sql("insert into story_seen (account_id, story_id) values ($1, $2) on conflict do nothing", [account.id, id]);
  send(res, 200, { ok: true });
}

async function replyStory(req, res, send, currentAccount) {
  const account = await requireUser(currentAccount, req);
  const body = await readJson(req);
  const storyId = String(body.storyId || "");
  const text = clip(body.text, 500);
  if (!text) fail(400, "Yanıt yaz.");
  const rows = await sql("select id, account_id from stories where id = $1", [storyId]);
  if (!rows.length) fail(404, "Hikaye bulunamadı.");
  if (!(await canSeeAccount(account.id, rows[0].account_id))) fail(404, "Hikaye bulunamadı.");
  if (rows[0].account_id === account.id) fail(400, "Kendi hikayene yanıt gönderilmez.");
  const id = hex(randomBytes(16));
  await sql("insert into story_replies (id, story_id, account_id, body) values ($1, $2, $3, $4)", [id, storyId, account.id, text]);
  send(res, 200, { ok: true });
}

async function updateProfile(req, res, send, currentAccount) {
  const account = await requireUser(currentAccount, req);
  await ensureProfile(account.id);
  const body = await readJson(req);
  const current = await sql("select bio, note, pronouns, category, link, avatar, closed from profiles where account_id = $1", [account.id]);
  const row = current[0] || {};
  const name = body.name == null ? "" : clip(body.name, 40);
  if (body.name != null && !name) fail(400, "Adını yaz.");
  const link = body.link == null ? row.link || "" : clip(body.link, 120);
  if (link && !/^https:\/\/\S+$/.test(link)) fail(400, "Bağlantı https ile başlamalı.");
  let avatar = body.avatar == null ? row.avatar || "" : String(body.avatar || "");
  if (avatar && !publicSrc(avatar)) fail(400, "Fotoğraf yüklenemedi.");
  if (avatar.startsWith("/api/media/")) {
    const owned = await ownedMedia(account.id, avatar.slice("/api/media/".length));
    if (!owned || !owned.mime.startsWith("image/")) fail(400, "Fotoğraf yüklenemedi.");
  }
  if (body.name != null) await sql("update accounts set name = $1 where id = $2", [name, account.id]);
  await sql(
    `update profiles set bio = $1, note = $2, pronouns = $3, category = $4, link = $5, avatar = $6, closed = $7 where account_id = $8`,
    [
      body.bio == null ? row.bio || "" : clip(body.bio, 150),
      body.note == null ? row.note || "" : clip(body.note, 60),
      body.pronouns == null ? row.pronouns || "" : clip(body.pronouns, 20),
      body.category == null ? row.category || "" : clip(body.category, 40),
      link,
      avatar,
      body.closed == null ? flag(row.closed) : Boolean(body.closed),
      account.id,
    ],
  );
  send(res, 200, { ok: true });
}

export async function handleSocial(req, res, pathname, ctx) {
  const { send, currentAccount } = ctx;
  const mediaId = req.method === "GET" && pathname.startsWith("/api/media/") ? pathname.slice("/api/media/".length) : "";
  const route = req.method === "GET" && pathname === "/api/world" ? () => sendWorld(req, res, send, currentAccount)
    : mediaId ? () => sendMedia(req, res, mediaId, currentAccount)
      : req.method === "POST" && pathname === "/api/media" ? () => upload(req, res, send, currentAccount)
        : req.method === "POST" && pathname === "/api/posts" ? () => createPost(req, res, send, currentAccount)
          : req.method === "POST" && pathname === "/api/posts/delete" ? () => removePost(req, res, send, currentAccount)
            : req.method === "POST" && pathname === "/api/posts/hide" ? () => hidePost(req, res, send, currentAccount)
              : req.method === "POST" && pathname === "/api/like" ? () => setLike(req, res, send, currentAccount)
                : req.method === "POST" && pathname === "/api/save" ? () => setSave(req, res, send, currentAccount)
                  : req.method === "POST" && pathname === "/api/follow" ? () => setFollow(req, res, send, currentAccount)
                    : req.method === "POST" && pathname === "/api/follow/accept" ? () => acceptFollow(req, res, send, currentAccount)
                      : req.method === "POST" && pathname === "/api/follow/reject" ? () => rejectFollow(req, res, send, currentAccount)
                    : req.method === "POST" && pathname === "/api/comments" ? () => addComment(req, res, send, currentAccount)
                      : req.method === "POST" && pathname === "/api/comments/delete" ? () => removeComment(req, res, send, currentAccount)
                        : req.method === "POST" && pathname === "/api/messages" ? () => sendMessage(req, res, send, currentAccount)
                          : req.method === "POST" && pathname === "/api/read" ? () => markRead(req, res, send, currentAccount)
                            : req.method === "POST" && pathname === "/api/stories" ? () => addStory(req, res, send, currentAccount)
                              : req.method === "POST" && pathname === "/api/stories/seen" ? () => seeStory(req, res, send, currentAccount)
                                : req.method === "POST" && pathname === "/api/stories/reply" ? () => replyStory(req, res, send, currentAccount)
                                  : req.method === "POST" && pathname === "/api/profile" ? () => updateProfile(req, res, send, currentAccount)
                                    : null;
  if (!route) return false;
  try {
    await route();
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("social request failed");
    if (!res.headersSent) send(res, status, { error: status === 500 ? "Sunucu hatası." : error.message });
  }
  return true;
}
