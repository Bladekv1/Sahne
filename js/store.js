import {
  ME as seedOwner,
  activity,
  getUser,
  highlights,
  setLocalUsers,
  accountHistory as seedHistory,
  posts as seedPosts,
  reels as seedReels,
  seedLikes,
  stories as seedStories,
  storyReplies as seedStoryReplies,
  threads as seedThreads,
  users,
} from "./data.js";

const KEY = "bladekv1-v1";

function blank() {
  return {
    likes: {},
    saves: {},
    follows: {},
    comments: {},
    messages: {},
    read: {},
    seen: {},
    posts: [],
    frames: [],
    reels: [],
    hidden: {},
    history: [],
    storyReplies: [],
    profile: { name: null, bio: null, avatar: null, note: null, pronouns: null, link: null, category: null },
    privateAccount: false,
    theme: "system",
    activitySeen: false,
  };
}

function emptyRoot() {
  return { session: "", accounts: [], logins: [], buckets: {}, theme: "system" };
}

function loadRoot() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyRoot();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyRoot();
    if (parsed.buckets || parsed.accounts) {
      return {
        ...emptyRoot(),
        ...parsed,
        accounts: parsed.accounts || [],
        logins: parsed.logins || [],
        buckets: parsed.buckets || {},
      };
    }
    const legacy = { ...blank(), ...parsed, profile: { ...blank().profile, ...(parsed.profile || {}) } };
    return { ...emptyRoot(), theme: legacy.theme || "system", buckets: { [seedOwner]: legacy } };
  } catch {
    return emptyRoot();
  }
}

let root = loadRoot();
let state = blank();

export function me() {
  return root.session || "";
}

export function session() {
  return root.session || "";
}

function bind() {
  const id = root.session;
  const bucket = id && root.buckets[id] ? root.buckets[id] : null;
  state = bucket
    ? { ...blank(), ...bucket, profile: { ...blank().profile, ...(bucket.profile || {}) } }
    : blank();
  state.theme = root.theme || state.theme || "system";
  setLocalUsers(root.accounts.map((account) => ({
    id: account.id,
    name: account.name,
    bio: "",
    note: "",
    pronouns: "",
    category: "",
    link: "",
    followers: 0,
    following: 0,
    followed: false,
    followerIds: [],
    followingIds: [],
    online: account.id === id,
    local: true,
  })));
}

function save() {
  if (root.session) root.buckets[root.session] = state;
  root.theme = state.theme || root.theme || "system";
  try {
    localStorage.setItem(KEY, JSON.stringify(root));
    return true;
  } catch {
    return false;
  }
}

bind();

export function snapshot() {
  return state;
}

export function theme() {
  return root.theme || state.theme || "system";
}

export function setTheme(value) {
  state.theme = value;
  root.theme = value;
  save();
}

export function liked(id) {
  if (Object.prototype.hasOwnProperty.call(state.likes, id)) return !!state.likes[id];
  return me() === seedOwner && seedLikes.includes(id);
}

export function saved(id) {
  return !!state.saves[id];
}

export function toggleLike(id) {
  state.likes[id] = !liked(id);
  save();
}

export function toggleSave(id) {
  if (state.saves[id]) delete state.saves[id];
  else state.saves[id] = true;
  save();
}

export function likeCount(item) {
  return (item.likes || 0) + (liked(item.id) ? 1 : 0);
}

export function isFollowing(id) {
  if (!id || id === me()) return false;
  if (Object.prototype.hasOwnProperty.call(state.follows, id)) return !!state.follows[id];
  return me() === seedOwner && !!getUser(id)?.followed;
}

export function toggleFollow(id) {
  state.follows[id] = !isFollowing(id);
  save();
}

export function displayName(user) {
  if (user.id === me() && state.profile.name) return state.profile.name;
  return user.name;
}

export function bioOf(user) {
  if (user.id === me() && state.profile.bio != null) return state.profile.bio;
  return user.bio;
}

export function avatarOf(user) {
  if (user.id === me() && state.profile.avatar) return state.profile.avatar;
  if (user.local) {
    const letter = (user.name || user.id || "?").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 1).toLocaleUpperCase("tr-TR") || "?";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#262626"/><text x="40" y="52" text-anchor="middle" font-family="Georgia,serif" font-size="34" fill="#fff">${letter}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
  return `media/avatars/${user.id}.svg`;
}

function ownField(user, key, seed) {
  if (user.id === me() && state.profile[key] != null) return state.profile[key];
  return seed || "";
}

export function noteOf(user) {
  return ownField(user, "note", user.note);
}

export function pronounsOf(user) {
  return ownField(user, "pronouns", user.pronouns);
}

export function linkOf(user) {
  return ownField(user, "link", user.link);
}

export function categoryOf(user) {
  return ownField(user, "category", user.category);
}

export function isPrivate() {
  return !!state.privateAccount;
}

export function setPrivate(value) {
  state.privateAccount = !!value;
  return save();
}

export function updateProfile(patch) {
  const labels = { name: "Ad", bio: "Biyografi", pronouns: "Hitaplar", note: "Not", link: "Bağlantı", category: "Kategori", avatar: "Profil fotoğrafı" };
  const events = Object.entries(patch).filter(([key, value]) => labels[key] && state.profile[key] !== value).map(([key, value]) => ({
    id: `h-${Date.now()}-${key}`,
    label: labels[key],
    detail: key === "avatar" ? "Fotoğraf güncellendi" : String(value || "Boş").slice(0, 80),
    at: Date.now(),
  }));
  if (events.length) state.history = [...events, ...(state.history || [])].slice(0, 40);
  state.profile = { ...state.profile, ...patch };
  return save();
}

export function followerCount(user) {
  if (user.id === me()) return user.followers;
  const was = user.followerIds.includes(me());
  const now = isFollowing(user.id);
  if (now && !was) return user.followers + 1;
  if (!now && was) return user.followers - 1;
  return user.followers;
}

export function followingCount(user) {
  if (user.id !== me()) return user.following;
  let delta = 0;
  for (const other of users) {
    if (other.id === me()) continue;
    const seed = !!other.followed;
    const now = isFollowing(other.id);
    if (now !== seed) delta += now ? 1 : -1;
  }
  return user.following + delta;
}

export function followerList(user) {
  const ids = new Set(user.followerIds);
  if (user.id !== me()) {
    if (isFollowing(user.id)) ids.add(me());
    else ids.delete(me());
  }
  return [...ids].map(getUser).filter(Boolean);
}

export function followingList(user) {
  if (user.id === me()) return users.filter((other) => other.id !== me() && isFollowing(other.id));
  return user.followingIds.map(getUser).filter(Boolean);
}

export function allPosts() {
  return [...state.posts, ...seedPosts]
    .filter((post) => !state.hidden[post.id])
    .sort((a, b) => b.at - a.at);
}

export function postsBy(userId) {
  return allPosts().filter((post) => post.user === userId);
}

export function tagged(userId) {
  const needle = `@${userId}`;
  return allPosts().filter((post) => post.caption.includes(needle) && post.user !== userId);
}

export function savedPosts() {
  return allPosts().filter((post) => state.saves[post.id]);
}

export function hiddenPosts() {
  return [...state.posts, ...seedPosts].filter((post) => post.user === me() && state.hidden[post.id]).sort((a, b) => b.at - a.at);
}

export function likedMedia() {
  return [...allPosts(), ...allReels()].filter((item) => liked(item.id)).sort((a, b) => b.at - a.at);
}

export function ownComments() {
  const rows = [];
  for (const item of [...allPosts(), ...allReels()]) {
    for (const comment of commentsFor(item)) {
      if (comment.user !== me()) continue;
      rows.push({ ...comment, postId: item.id, image: item.images?.[0] || item.poster || item.image || "", reel: Boolean(item.src) });
    }
  }
  return rows.sort((a, b) => b.at - a.at);
}

export function storyReplies() {
  return [...(state.storyReplies || []), ...(me() === seedOwner ? seedStoryReplies : [])].sort((a, b) => b.at - a.at);
}

export function addStoryReply(userId, text) {
  const item = { id: `sr-${Date.now()}`, user: userId, text, at: Date.now() };
  state.storyReplies = [item, ...(state.storyReplies || [])];
  return save() ? item : null;
}

export function accountHistory() {
  return [...(state.history || []), ...(me() === seedOwner ? seedHistory : [])].sort((a, b) => b.at - a.at);
}

export function postById(id) {
  return allPosts().find((post) => post.id === id) || null;
}

export function hidePost(id) {
  state.hidden[id] = true;
  save();
}

export function addPost(post) {
  state.posts.unshift(post);
  return save();
}

export function deleteOwnPost(id) {
  state.posts = state.posts.filter((post) => post.id !== id);
  delete state.hidden[id];
  save();
}

export function isOwnPost(id) {
  return state.posts.some((post) => post.id === id);
}

export function commentsFor(post) {
  const extra = (state.comments[post.id] || []).map((comment) => ({ ...comment, own: true }));
  return [...(post.comments || []), ...extra];
}

export function addComment(postId, text) {
  const comment = { id: `c-${Date.now()}`, user: me(), text, at: Date.now(), own: true };
  state.comments[postId] = [...(state.comments[postId] || []), comment];
  const ok = save();
  return ok ? comment : null;
}

export function deleteComment(postId, commentId) {
  state.comments[postId] = (state.comments[postId] || []).filter((comment) => comment.id !== commentId);
  save();
}

export function packFor(id) {
  const highlight = highlights.find((item) => item.id === id);
  if (highlight) {
    return { user: highlight.id, owner: highlight.owner, title: highlight.title, frames: highlight.frames };
  }
  const story = seedStories.find((item) => item.user === id);
  const extra = id === me() ? state.frames : [];
  if (!story && extra.length) return { user: me(), owner: me(), title: "", frames: extra };
  if (!story) return null;
  return { user: id, owner: id, title: "", frames: [...extra, ...story.frames] };
}

export function storySeen(pack) {
  const seen = state.seen[pack.user] || {};
  return pack.frames.length > 0 && pack.frames.every((frame) => seen[frame.id]);
}

export function firstUnseen(pack) {
  const seen = state.seen[pack.user] || {};
  const index = pack.frames.findIndex((frame) => !seen[frame.id]);
  return index < 0 ? 0 : index;
}

export function seeFrame(userId, frameId) {
  const seen = { ...(state.seen[userId] || {}) };
  if (seen[frameId]) return;
  seen[frameId] = true;
  state.seen[userId] = seen;
  save();
}

export function storyRow() {
  const mine = packFor(me());
  const rest = seedStories
    .filter((story) => story.user !== me())
    .map((story) => packFor(story.user))
    .filter(Boolean)
    .sort((a, b) => Number(storySeen(a)) - Number(storySeen(b)));
  return [mine, ...rest].filter(Boolean);
}

export function addFrame(frame) {
  state.frames.unshift(frame);
  return save();
}

export function allReels() {
  return [...state.reels, ...seedReels].sort((a, b) => b.at - a.at);
}

export function reelsBy(userId) {
  return allReels().filter((reel) => reel.user === userId);
}

export function reelById(id) {
  return allReels().find((reel) => reel.id === id) || null;
}

export function addReel(reel) {
  state.reels.unshift(reel);
  return save();
}

export function ownReelBlobs() {
  return state.reels.map((reel) => reel.blobId).filter(Boolean);
}

export function messagesFor(userId) {
  const seed = me() === seedOwner ? (seedThreads.find((thread) => thread.user === userId)?.messages || []) : [];
  const extra = state.messages[userId] || [];
  return [...seed, ...extra].sort((a, b) => a.at - b.at);
}

export function sendMessage(userId, text) {
  const message = { id: `m-${Date.now()}`, from: me(), text, at: Date.now() };
  state.messages[userId] = [...(state.messages[userId] || []), message];
  state.read[userId] = message.at;
  const ok = save();
  return ok ? message : null;
}

export function markRead(userId) {
  const messages = messagesFor(userId);
  const last = messages[messages.length - 1];
  if (!last) return;
  if ((state.read[userId] || 0) >= last.at) return;
  state.read[userId] = Date.now();
  save();
}

export function threadUnread(userId) {
  const messages = messagesFor(userId);
  const last = messages[messages.length - 1];
  if (!last || last.from === me()) return false;
  return (state.read[userId] || 0) < last.at;
}

export function inbox() {
  const ids = new Set([
    ...(me() === seedOwner ? seedThreads.map((thread) => thread.user) : []),
    ...Object.keys(state.messages),
  ]);
  return [...ids]
    .map((id) => {
      const messages = messagesFor(id);
      const last = messages[messages.length - 1];
      return { id, user: getUser(id), last, unread: threadUnread(id) };
    })
    .filter((item) => item.user && item.last)
    .sort((a, b) => b.last.at - a.last.at);
}

export function unreadTotal() {
  return inbox().filter((item) => item.unread).length;
}

export function activityItems() {
  return me() === seedOwner ? activity : [];
}

export function activityPending() {
  return me() === seedOwner && !state.activitySeen;
}

export function seeActivity() {
  if (state.activitySeen) return;
  state.activitySeen = true;
  save();
}

export function highlightsFor(userId) {
  return highlights.filter((item) => item.owner === userId);
}

function hex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function bytesFromHex(value) {
  const pairs = String(value || "").match(/../g) || [];
  return new Uint8Array(pairs.map((pair) => Number.parseInt(pair, 16)));
}

async function digestPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return hex(new Uint8Array(bits));
}

function rememberLogin(id, kind) {
  root.logins = [...(root.logins || []), { id, at: Date.now(), kind }].slice(-40);
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

export function accounts() {
  return root.accounts.map((account) => ({ id: account.id, name: account.name }));
}

export function loginEvents() {
  return [...(root.logins || [])].reverse();
}

export async function registerAccount({ name, username, contact, password, born }) {
  const id = String(username || "").trim().toLowerCase();
  const cleanName = String(name || "").trim().slice(0, 40);
  const cleanContact = String(contact || "").trim().toLowerCase().replace(/[\s()-]/g, "").slice(0, 80);
  const secret = String(password || "");
  if (!/^[a-z0-9._]{3,30}$/.test(id)) return { error: "Kullanıcı adı 3–30 karakter olmalı. Harf, rakam, nokta veya alt çizgi." };
  if (users.some((user) => user.id === id && user.id !== seedOwner)) return { error: "Bu kullanıcı adı kullanılıyor." };
  if (!cleanName) return { error: "Adını yaz." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanContact) && !/^\+?[0-9]{10,15}$/.test(cleanContact)) return { error: "E-posta ya da telefon yaz." };
  if (secret.length < 8) return { error: "Şifre en az 8 karakter olmalı." };
  if (!validBorn(born)) return { error: "Doğum günü 13 yaşından büyük olmalı." };
  if (root.accounts.some((account) => account.id === id || account.contact === cleanContact)) return { error: "Bu hesap zaten kayıtlı. Giriş yap." };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await digestPassword(secret, salt);
  root.accounts.push({ id, name: cleanName, contact: cleanContact, born, salt: hex(salt), hash, createdAt: Date.now() });
  if (!root.buckets[id]) {
    const fresh = blank();
    fresh.profile = { ...fresh.profile, name: cleanName };
    root.buckets[id] = fresh;
  }
  root.session = id;
  rememberLogin(id, "kayıt");
  bind();
  return save() ? { ok: true } : { error: "Hesap bu telefona sığmadı." };
}

export async function loginAccount(ident, password) {
  const key = String(ident || "").trim().toLowerCase().replace(/[\s()-]/g, "");
  const secret = String(password || "");
  const account = root.accounts.find((item) => item.id === key || item.contact === key);
  if (!account || secret.length < 8) return { error: "Kullanıcı adı veya şifre yanlış." };
  const hash = await digestPassword(secret, bytesFromHex(account.salt));
  if (hash !== account.hash) return { error: "Kullanıcı adı veya şifre yanlış." };
  root.session = account.id;
  rememberLogin(account.id, "giriş");
  bind();
  return save() ? { ok: true } : { error: "Giriş bu telefona sığmadı." };
}

export async function resetPassword({ username, born, password }) {
  const id = String(username || "").trim().toLowerCase();
  const secret = String(password || "");
  const account = root.accounts.find((item) => item.id === id);
  if (!account || account.born !== born) return { error: "Bilgiler eşleşmedi." };
  if (secret.length < 8) return { error: "Yeni şifre en az 8 karakter olmalı." };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  account.salt = hex(salt);
  account.hash = await digestPassword(secret, salt);
  rememberLogin(id, "şifre");
  return save() ? { ok: true } : { error: "Şifre sığmadı." };
}

export function logout() {
  if (root.session) rememberLogin(root.session, "çıkış");
  root.session = "";
  bind();
  save();
}

export function reset() {
  root = emptyRoot();
  state = blank();
  bind();
  localStorage.removeItem(KEY);
}
