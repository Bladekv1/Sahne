import {
  ME as seedOwner,
  everyone,
  getUser,
  setDirectory,
  setLocalUsers,
  accountHistory as seedHistory,
  users,
} from "./data.js";

const KEY = "bladekv1-v1";

function blank() {
  return {
    likes: {},
    saves: {},
    follows: {},
    requested: {},
    incoming: [],
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
let peopleCache = [];
let serverUser = null;
let pending = 0;
let lastWorld = "";

function emptyWorld() {
  return {
    posts: [],
    reels: [],
    stories: [],
    highlights: [],
    threads: [],
    activity: [],
    storyReplies: [],
  };
}

let world = emptyWorld();

function clearWorld() {
  world = emptyWorld();
  lastWorld = "";
  setDirectory([]);
}

function localRecord(account, online) {
  return {
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
    online,
    local: true,
  };
}

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
  publishLocals();
}

function publishLocals() {
  const seeded = new Set(users.map((user) => user.id));
  const map = new Map();
  for (const account of root.accounts) {
    if (!seeded.has(account.id)) map.set(account.id, localRecord(account, account.id === root.session));
  }
  for (const person of peopleCache) {
    if (!seeded.has(person.id)) map.set(person.id, localRecord(person, person.id === root.session));
  }
  setLocalUsers([...map.values()]);
}

function applyPeople(list) {
  peopleCache = Array.isArray(list) ? list : [];
  publishLocals();
}

function adopt(user) {
  serverUser = user;
  root.session = user.id;
  if (user.verified) {
    peopleCache = [...peopleCache.filter((person) => person.id !== user.id), { id: user.id, name: user.name, verified: true }];
  }
  if (!root.accounts.some((account) => account.id === user.id)) {
    root.accounts.push({ id: user.id, name: user.name, contact: "", born: "", salt: "", hash: "", createdAt: Date.now() });
  }
  if (!root.buckets[user.id]) {
    const fresh = blank();
    fresh.profile = { ...fresh.profile, name: user.name || null };
    root.buckets[user.id] = fresh;
  }
  bind();
  save();
}

async function postJson(path, body) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  } catch {
    return { error: "Sunucuya ulaşılamadı." };
  }
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) return { error: data.error || "Olmadı." };
  return data;
}

export async function syncAccount() {
  try {
    const response = await fetch("/api/session", { credentials: "same-origin" });
    if (!response.ok) return;
    const data = await response.json();
    applyPeople(data.people);
    if (data.user) adopt(data.user);
    else if (root.session) {
      root.session = "";
      serverUser = null;
      clearWorld();
      bind();
      save();
    }
  } catch {
    /* keep the device session when the server cannot be reached */
  }
}

export function isVerified(id) {
  if (serverUser?.id === id && serverUser.verified) return true;
  if (getUser(id)?.verified) return true;
  return peopleCache.some((person) => person.id === id && person.verified);
}

export function isAdmin() {
  return serverUser?.role === "admin";
}

export function verifyRequest() {
  return serverUser?.request || "";
}

export function noteServerUser(user) {
  if (!user) return;
  serverUser = user;
  if (Array.isArray(user.people)) applyPeople(user.people);
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

function notify(message) {
  window.dispatchEvent(new CustomEvent("blade-notice", { detail: message || "Olmadı" }));
}

function findItem(id) {
  return world.posts.find((post) => post.id === id) || world.reels.find((reel) => reel.id === id) || null;
}

async function getJson(path) {
  try {
    const response = await fetch(path, { credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { error: data.error || "Olmadı." };
    return data;
  } catch {
    return { error: "Sunucuya ulaşılamadı." };
  }
}

function applyWorld(data) {
  world = {
    posts: data.posts || [],
    reels: data.reels || [],
    stories: data.stories || [],
    highlights: data.highlights || [],
    threads: data.threads || [],
    activity: data.activity || [],
    storyReplies: data.storyReplies || [],
  };
  state.likes = {};
  for (const id of data.likes || []) state.likes[id] = true;
  state.saves = {};
  for (const id of data.saves || []) state.saves[id] = true;
  state.hidden = {};
  for (const id of data.hidden || []) state.hidden[id] = true;
  state.follows = {};
  for (const id of data.following || []) state.follows[id] = true;
  state.requested = {};
  for (const id of data.requestsOut || []) state.requested[id] = true;
  state.incoming = data.requestsIn || [];
  state.seen = data.seen || {};
  state.read = data.reads || {};
  const mine = (data.profiles || []).find((person) => person.id === me());
  if (mine) {
    state.profile = {
      name: mine.name || null,
      bio: mine.bio ?? "",
      avatar: mine.avatar || null,
      note: mine.note ?? "",
      pronouns: mine.pronouns ?? "",
      link: mine.link ?? "",
      category: mine.category ?? "",
    };
    state.privateAccount = !!mine.closed;
  }
  const profiles = (data.profiles || []).map((person) => {
    const seed = users.find((user) => user.id === person.id);
    return { ...(seed || {}), ...person, online: person.id === me() || !!seed?.online, local: !seed };
  });
  setDirectory(profiles);
}

export async function syncWorld() {
  if (!me() || pending > 0) return false;
  const data = await getJson("/api/world");
  if (!data || data.error || pending > 0) return false;
  const next = JSON.stringify(data);
  if (next === lastWorld) return false;
  lastWorld = next;
  applyWorld(data);
  return true;
}

async function uploadBlob(blob) {
  if (!blob) return { error: "Bir fotoğraf veya video seç." };
  const video = String(blob.type || "").startsWith("video/");
  const max = video ? 8 * 1024 * 1024 : 4 * 1024 * 1024;
  if (blob.size > max) return { error: video ? "Video en fazla 8 MB olabilir." : "Fotoğraf en fazla 4 MB olabilir." };
  let response;
  try {
    response = await fetch("/api/media", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": blob.type || "application/octet-stream" },
      body: blob,
    });
  } catch {
    return { error: "Sunucuya ulaşılamadı." };
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { error: data.error || "Dosya yüklenmedi." };
  return { id: data.id };
}

export async function publishEntry({ kind, caption, location, alt, topic, ai, collaborators, commentsClosed, image, video, text }) {
  pending += 1;
  try {
    const mediaIds = [];
    if (video) {
      const uploaded = await uploadBlob(video);
      if (!uploaded.id) return uploaded;
      mediaIds.push(uploaded.id);
    }
    if (image) {
      const uploaded = await uploadBlob(image);
      if (!uploaded.id) return uploaded;
      if (kind === "hikaye") {
        const story = await postJson("/api/stories", { mediaId: uploaded.id, text: text || "" });
        return story.error ? story : { ok: true, id: story.id };
      }
      mediaIds.push(uploaded.id);
    }
    if (kind === "hikaye") return { error: "Hikaye için bir fotoğraf seç." };
    const data = await postJson("/api/posts", {
      kind: kind === "reel" ? "reel" : "post",
      caption,
      location,
      alt,
      topic,
      ai,
      collaborators,
      commentsClosed,
      mediaIds,
    });
    return data.error ? data : { ok: true, id: data.id };
  } finally {
    pending -= 1;
  }
}

export function liked(id) {
  return !!state.likes[id];
}

export function saved(id) {
  return !!state.saves[id];
}

function track(run) {
  pending += 1;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      pending -= 1;
    });
}

export function toggleLike(id) {
  const on = !liked(id);
  state.likes[id] = on;
  track(() => postJson("/api/like", { id, on })).then((data) => {
    if (data?.error) {
      state.likes[id] = !on;
      notify(data.error);
    }
  });
  return true;
}

export function toggleSave(id) {
  const on = !saved(id);
  if (on) state.saves[id] = true;
  else delete state.saves[id];
  track(() => postJson("/api/save", { id, on })).then((data) => {
    if (data?.error) notify(data.error);
  });
  return true;
}

export function likeCount(item) {
  return (item.likes || 0) + (liked(item.id) ? 1 : 0);
}

export function isFollowing(id) {
  if (!id || id === me()) return false;
  return !!state.follows[id];
}

export function followStatus(id) {
  if (!id || id === me()) return "self";
  if (state.follows[id]) return "following";
  if (state.requested?.[id]) return "requested";
  return "none";
}

export function followLabel(id) {
  const status = followStatus(id);
  if (status === "following") return "Takiptesin";
  if (status === "requested") return "İstek gönderildi";
  return "Takip et";
}

export function incomingRequests() {
  return state.incoming || [];
}

function shiftFollowCounts(id, on) {
  const user = getUser(id);
  const self = getUser(me());
  if (user) {
    user.followers = Math.max(0, (user.followers || 0) + (on ? 1 : -1));
    user.followerIds = on ? [...new Set([...(user.followerIds || []), me()])] : (user.followerIds || []).filter((item) => item !== me());
  }
  if (self) {
    self.following = Math.max(0, (self.following || 0) + (on ? 1 : -1));
    self.followingIds = on ? [...new Set([...(self.followingIds || []), id])] : (self.followingIds || []).filter((item) => item !== id);
  }
}

export function toggleFollow(id) {
  if (!id || id === me()) return false;
  const status = followStatus(id);
  if (status === "following") {
    state.follows[id] = false;
    shiftFollowCounts(id, false);
    track(() => postJson("/api/follow", { id, on: false })).then((data) => {
      if (data?.error) notify(data.error);
    });
    return true;
  }
  if (status === "requested") {
    delete state.requested[id];
    track(() => postJson("/api/follow", { id, on: false })).then((data) => {
      if (data?.error) notify(data.error);
    });
    return true;
  }
  const user = getUser(id);
  if (user?.closed) {
    state.requested[id] = true;
  } else {
    state.follows[id] = true;
    shiftFollowCounts(id, true);
  }
  track(() => postJson("/api/follow", { id, on: true })).then((data) => {
    if (data?.error) {
      delete state.follows[id];
      delete state.requested[id];
      notify(data.error);
      return;
    }
    if (data?.pending) {
      if (state.follows[id]) shiftFollowCounts(id, false);
      delete state.follows[id];
      state.requested[id] = true;
    }
    if (data?.following) {
      const was = !!state.follows[id];
      delete state.requested[id];
      state.follows[id] = true;
      if (!was) shiftFollowCounts(id, true);
    }
  });
  return true;
}

export function answerFollow(id, accept) {
  if (!id) return;
  state.incoming = (state.incoming || []).filter((item) => item.id !== id);
  const self = getUser(me());
  if (accept && self) {
    self.followers = (self.followers || 0) + 1;
    self.followerIds = [...new Set([...(self.followerIds || []), id])];
  }
  track(() => postJson(accept ? "/api/follow-accept" : "/api/follow-reject", { id })).then((data) => {
    if (data?.error) notify(data.error);
    lastWorld = "";
  });
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
  const picture = (user.id === me() && state.profile.avatar) || user.avatar || "";
  if (picture.startsWith("/api/media/") || picture.startsWith("/api/media?") || picture.startsWith("media/") || picture.startsWith("data:image/")) return picture;
  if (user.local || user.sample === false) {
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
  const next = !!value;
  state.privateAccount = next;
  const self = getUser(me());
  if (self) self.closed = next;
  track(() => postJson("/api/profile", { closed: next })).then((data) => {
    if (data?.error) notify(data.error);
  });
  return true;
}

export async function updateProfile(patch) {
  const next = { ...patch };
  if (typeof next.avatar === "string" && next.avatar.startsWith("data:")) {
    const blob = await (await fetch(next.avatar)).blob();
    const uploaded = await uploadBlob(blob);
    if (!uploaded.id) return false;
    next.avatar = `/api/media/${uploaded.id}`;
  }
  const labels = { name: "Ad", bio: "Biyografi", pronouns: "Hitaplar", note: "Not", link: "Bağlantı", category: "Kategori", avatar: "Profil fotoğrafı" };
  const events = Object.entries(next).filter(([key, value]) => labels[key] && state.profile[key] !== value).map(([key, value]) => ({
    id: `h-${Date.now()}-${key}`,
    label: labels[key],
    detail: key === "avatar" ? "Fotoğraf güncellendi" : String(value || "Boş").slice(0, 80),
    at: Date.now(),
  }));
  pending += 1;
  const data = await postJson("/api/profile", next).finally(() => {
    pending -= 1;
  });
  if (data.error) return false;
  if (events.length) state.history = [...events, ...(state.history || [])].slice(0, 40);
  state.profile = { ...state.profile, ...next };
  const self = getUser(me());
  if (self) Object.assign(self, next);
  lastWorld = "";
  return true;
}

export function followerCount(user) {
  return user?.followers || 0;
}

export function followingCount(user) {
  return user?.following || 0;
}

export function followerList(user) {
  return (user.followerIds || []).map(getUser).filter(Boolean);
}

export function followingList(user) {
  return (user.followingIds || []).map(getUser).filter(Boolean);
}

export function suggestPeople() {
  return everyone()
    .filter((user) => user.id !== me() && !isFollowing(user.id))
    .sort((a, b) => Number(Boolean(a.sample)) - Number(Boolean(b.sample)) || (b.followers || 0) - (a.followers || 0))
    .slice(0, 8);
}

export function homePosts() {
  return allPosts();
}

export function allPosts() {
  return world.posts.filter((post) => !state.hidden[post.id]).sort((a, b) => b.at - a.at);
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
  return world.posts.filter((post) => post.user === me() && state.hidden[post.id]).sort((a, b) => b.at - a.at);
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
  return [...(world.storyReplies || [])].sort((a, b) => b.at - a.at);
}

export function addStoryReply(userId, text, storyId) {
  const story = world.stories.find((item) => item.user === userId);
  const frameId = storyId || story?.frames?.[0]?.id || "";
  if (frameId) track(() => postJson("/api/story-reply", { storyId: frameId, text }));
  return { id: frameId, user: userId, text, at: Date.now() };
}

export function accountHistory() {
  return [...(state.history || []), ...(me() === seedOwner ? seedHistory : [])].sort((a, b) => b.at - a.at);
}

export function postById(id) {
  return allPosts().find((post) => post.id === id) || null;
}

export function hidePost(id) {
  state.hidden[id] = true;
  track(() => postJson("/api/post-hide", { id })).then((data) => {
    if (data?.error) notify(data.error);
  });
}

export function deleteOwnPost(id) {
  const item = findItem(id);
  if (!item || item.user !== me()) return;
  world.posts = world.posts.filter((post) => post.id !== id);
  world.reels = world.reels.filter((reel) => reel.id !== id);
  track(() => postJson("/api/post-delete", { id })).then((data) => {
    if (data?.error) notify(data.error);
  });
}

export function isOwnPost(id) {
  const item = findItem(id);
  return !!item && item.user === me();
}

export function commentsFor(post) {
  return (post?.comments || []).map((comment) => ({ ...comment, own: comment.user === me() }));
}

export function addComment(postId, text) {
  const item = findItem(postId);
  const comment = { id: `c-${Date.now()}`, user: me(), text, at: Date.now(), own: true };
  if (item) item.comments = [...(item.comments || []), comment];
  track(() => postJson("/api/comments", { postId, text })).then((data) => {
    if (data?.error) {
      if (item) item.comments = (item.comments || []).filter((row) => row.id !== comment.id);
      notify(data.error);
      return;
    }
    if (data.comment) comment.id = data.comment.id;
  });
  return comment;
}

export function deleteComment(postId, commentId) {
  const item = findItem(postId);
  if (item) item.comments = (item.comments || []).filter((comment) => comment.id !== commentId);
  track(() => postJson("/api/comment-delete", { id: commentId })).then((data) => {
    if (data?.error) notify(data.error);
  });
}

export function packFor(id) {
  const highlight = world.highlights.find((item) => item.id === id);
  if (highlight) return { user: highlight.id, owner: highlight.owner, title: highlight.title, frames: highlight.frames };
  const story = world.stories.find((item) => item.user === id);
  if (!story) return null;
  return { user: id, owner: id, title: "", frames: story.frames };
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
  track(() => postJson("/api/story-seen", { id: frameId }));
}

export function storyRow() {
  const packs = world.stories.map((story) => packFor(story.user)).filter((pack) => pack && pack.frames.length);
  const mine = packs.find((pack) => pack.owner === me());
  const rest = packs.filter((pack) => pack.owner !== me()).sort((a, b) => {
    const follow = Number(isFollowing(b.owner)) - Number(isFollowing(a.owner));
    if (follow) return follow;
    return Number(storySeen(a)) - Number(storySeen(b));
  });
  const slot = mine || (me() ? { user: me(), owner: me(), title: "", frames: [] } : null);
  return [slot, ...rest].filter(Boolean);
}

export function allReels() {
  return [...world.reels].sort((a, b) => b.at - a.at);
}

export function reelsBy(userId) {
  return allReels().filter((reel) => reel.user === userId);
}

export function reelById(id) {
  return allReels().find((reel) => reel.id === id) || null;
}

export function ownReelBlobs() {
  return [];
}

export function messagesFor(userId) {
  const thread = world.threads.find((item) => item.user === userId);
  return thread ? [...thread.messages].sort((a, b) => a.at - b.at) : [];
}

export function sendMessage(userId, text) {
  const message = { id: `m-${Date.now()}`, from: me(), text, at: Date.now() };
  let thread = world.threads.find((item) => item.user === userId);
  if (!thread) {
    thread = { user: userId, messages: [] };
    world.threads.push(thread);
  }
  thread.messages.push(message);
  state.read[userId] = message.at;
  track(() => postJson("/api/messages", { to: userId, text })).then((data) => {
    if (data?.error) {
      thread.messages = thread.messages.filter((item) => item.id !== message.id);
      notify(data.error);
      return;
    }
    if (data.message) message.id = data.message.id;
  });
  return message;
}

export function markRead(userId) {
  const messages = messagesFor(userId);
  const last = messages[messages.length - 1];
  if (!last) return;
  if ((state.read[userId] || 0) >= last.at) return;
  state.read[userId] = Date.now();
  track(() => postJson("/api/read", { user: userId }));
}

export function threadUnread(userId) {
  const messages = messagesFor(userId);
  const last = messages[messages.length - 1];
  if (!last || last.from === me()) return false;
  return (state.read[userId] || 0) < last.at;
}

export function inbox() {
  const ids = new Set(world.threads.map((thread) => thread.user));
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
  return world.activity || [];
}

export function activityPending() {
  if ((state.incoming || []).length) return true;
  const newest = world.activity[0]?.at || 0;
  return newest > (state.activitySeenAt || 0);
}

export function seeActivity() {
  const newest = world.activity[0]?.at || 0;
  if (!newest || (state.activitySeenAt || 0) >= newest) return;
  state.activitySeenAt = newest;
  save();
}

export function highlightsFor(userId) {
  return world.highlights.filter((item) => item.owner === userId);
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
  const data = await postJson("/api/register", { name, username, contact, password, born });
  if (data.error || !data.user) return { error: data.error || "Hesap açılamadı." };
  applyPeople(data.people);
  adopt(data.user);
  rememberLogin(data.user.id, "kayıt");
  save();
  await syncWorld();
  return { ok: true, created: true };
}

export async function loginAccount(ident, password) {
  const data = await postJson("/api/login", { id: ident, password });
  if (data.error || !data.user) return { error: data.error || "Giriş tamamlanamadı." };
  applyPeople(data.people);
  adopt(data.user);
  rememberLogin(data.user.id, data.created ? "kayıt" : "giriş");
  save();
  await syncWorld();
  return { ok: true, created: Boolean(data.created) };
}

export async function changePassword({ current, next }) {
  const data = await postJson("/api/password", { current, next });
  if (data.error) return data;
  return { ok: true };
}

export async function logout() {
  try {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  } catch { /* the device session still closes */ }
  if (root.session) rememberLogin(root.session, "çıkış");
  root.session = "";
  serverUser = null;
  clearWorld();
  bind();
  save();
}

export async function reset() {
  try {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  } catch { /* local data still clears */ }
  root = emptyRoot();
  state = blank();
  serverUser = null;
  peopleCache = [];
  clearWorld();
  bind();
  localStorage.removeItem(KEY);
}
