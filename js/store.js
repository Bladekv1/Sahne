import {
  ME,
  activity,
  getUser,
  highlights,
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

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const parsed = JSON.parse(raw);
    return {
      ...blank(),
      ...parsed,
      profile: { ...blank().profile, ...(parsed.profile || {}) },
    };
  } catch {
    return blank();
  }
}

let state = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function snapshot() {
  return state;
}

export function theme() {
  return state.theme || "system";
}

export function setTheme(value) {
  state.theme = value;
  save();
}

export function liked(id) {
  if (Object.prototype.hasOwnProperty.call(state.likes, id)) return !!state.likes[id];
  return seedLikes.includes(id);
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
  if (!id || id === ME) return false;
  if (Object.prototype.hasOwnProperty.call(state.follows, id)) return !!state.follows[id];
  return !!getUser(id)?.followed;
}

export function toggleFollow(id) {
  state.follows[id] = !isFollowing(id);
  save();
}

export function displayName(user) {
  if (user.id === ME && state.profile.name) return state.profile.name;
  return user.name;
}

export function bioOf(user) {
  if (user.id === ME && state.profile.bio != null) return state.profile.bio;
  return user.bio;
}

export function avatarOf(user) {
  if (user.id === ME && state.profile.avatar) return state.profile.avatar;
  return `media/avatars/${user.id}.svg`;
}

function ownField(user, key, seed) {
  if (user.id === ME && state.profile[key] != null) return state.profile[key];
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
  if (user.id === ME) return user.followers;
  const was = user.followerIds.includes(ME);
  const now = isFollowing(user.id);
  if (now && !was) return user.followers + 1;
  if (!now && was) return user.followers - 1;
  return user.followers;
}

export function followingCount(user) {
  if (user.id !== ME) return user.following;
  let delta = 0;
  for (const other of users) {
    if (other.id === ME) continue;
    const seed = !!other.followed;
    const now = isFollowing(other.id);
    if (now !== seed) delta += now ? 1 : -1;
  }
  return user.following + delta;
}

export function followerList(user) {
  const ids = new Set(user.followerIds);
  if (user.id !== ME) {
    if (isFollowing(user.id)) ids.add(ME);
    else ids.delete(ME);
  }
  return [...ids].map(getUser).filter(Boolean);
}

export function followingList(user) {
  if (user.id === ME) return users.filter((other) => other.id !== ME && isFollowing(other.id));
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
  return [...state.posts, ...seedPosts].filter((post) => post.user === ME && state.hidden[post.id]).sort((a, b) => b.at - a.at);
}

export function likedMedia() {
  return [...allPosts(), ...allReels()].filter((item) => liked(item.id)).sort((a, b) => b.at - a.at);
}

export function ownComments() {
  const rows = [];
  for (const item of [...allPosts(), ...allReels()]) {
    for (const comment of commentsFor(item)) {
      if (comment.user !== ME) continue;
      rows.push({ ...comment, postId: item.id, image: item.images?.[0] || item.poster || item.image || "", reel: Boolean(item.src) });
    }
  }
  return rows.sort((a, b) => b.at - a.at);
}

export function storyReplies() {
  return [...(state.storyReplies || []), ...seedStoryReplies].sort((a, b) => b.at - a.at);
}

export function addStoryReply(userId, text) {
  const item = { id: `sr-${Date.now()}`, user: userId, text, at: Date.now() };
  state.storyReplies = [item, ...(state.storyReplies || [])];
  return save() ? item : null;
}

export function accountHistory() {
  return [...(state.history || []), ...seedHistory].sort((a, b) => b.at - a.at);
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
  const comment = { id: `c-${Date.now()}`, user: ME, text, at: Date.now(), own: true };
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
  const extra = id === ME ? state.frames : [];
  if (!story && extra.length) return { user: ME, owner: ME, title: "", frames: extra };
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
  const mine = packFor(ME);
  const rest = seedStories
    .filter((story) => story.user !== ME)
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
  const seed = seedThreads.find((thread) => thread.user === userId)?.messages || [];
  const extra = state.messages[userId] || [];
  return [...seed, ...extra].sort((a, b) => a.at - b.at);
}

export function sendMessage(userId, text) {
  const message = { id: `m-${Date.now()}`, from: ME, text, at: Date.now() };
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
  if (!last || last.from === ME) return false;
  return (state.read[userId] || 0) < last.at;
}

export function inbox() {
  const ids = new Set([
    ...seedThreads.map((thread) => thread.user),
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
  return activity;
}

export function activityPending() {
  return !state.activitySeen;
}

export function seeActivity() {
  if (state.activitySeen) return;
  state.activitySeen = true;
  save();
}

export function highlightsFor(userId) {
  return highlights.filter((item) => item.owner === userId);
}

export function reset() {
  state = blank();
  localStorage.removeItem(KEY);
}
