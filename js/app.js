import { ME, getUser, suggestions, topics, users } from "./data.js";
import { esc, formatCount, rich, safeSrc, safeVideo, timeAgo } from "./format.js";
import { icon } from "./icons.js";
import { getBlob, putBlob } from "./media.js";
import * as store from "./store.js";

const CARDS = ["#1a1a1a", "#ff4d2e", "#1d3557", "#6b2d5b", "#0b3d2e", "#143d59"];
const STORY_MS = 5200;
const expanded = new Set();
const carousel = {};
const blobUrls = new Map();
const scrollMem = new Map();
let cleanupFns = [];
let currentHash = "";
let exploreQuery = "";
let inboxQuery = "";
let storyGen = 0;
let toastTimer = 0;
let draft = { bg: CARDS[0], text: "", image: "", blobId: "", videoUrl: "" };
let pinBottom = false;

const app = document.getElementById("app");
const stage = document.getElementById("stage");
const topbar = document.getElementById("topbar");
const tabbar = document.getElementById("tabbar");
const composer = document.getElementById("composer");

function route() {
  const hash = location.hash || "#/";
  let path = hash.slice(1);
  if (!path.startsWith("/")) path = `/${path}`;
  const parts = path.split("/").filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  return { hash, head: parts[0] || "akis", parts };
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

function cleanup() {
  storyGen += 1;
  cleanupFns.splice(0).forEach((fn) => fn());
  document.querySelectorAll("video").forEach((video) => video.pause());
}

function applyTheme() {
  const choice = store.theme();
  const dark = choice === "dark" || (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#000000" : "#ffffff";
}

function avatar(user, size, dot = false) {
  const cls = size >= 80 ? "lg" : size >= 50 ? "md" : "sm";
  const mark = dot && user.online ? `<i class="online"></i>` : "";
  return `<span class="presence">${mark}<img class="ava ${cls}" src="${safeSrc(store.avatarOf(user))}" alt=""></span>`;
}

function profileHref(id) {
  return id === ME ? "#/profil" : `#/u/${id}`;
}

function tabBar(r) {
  const mail = store.unreadTotal();
  const items = [
    ["#/", "akis", "Akış", r.head === "akis" ? "homeFill" : "home"],
    ["#/kesfet", "kesfet", "Keşfet", "search"],
    ["#/reels", "reels", "Reels", r.head === "reels" ? "reelsFill" : "reels"],
    ["#/mesaj", "mesaj", "Mesajlar", "send"],
    ["#/profil", "profil", "Profil", ""],
  ];
  return items.map(([href, id, label, glyph]) => {
    const on = (id === "mesaj" && r.head === "mesaj" && !r.parts[1]) || (id !== "mesaj" && r.head === id) || (id === "akis" && r.head === "akis");
    const current = on ? ' aria-current="page"' : "";
    const badge = id === "mesaj" && mail ? `<i class="count">${mail}</i>` : "";
    const graphic = id === "profil"
      ? avatar(getUser(ME), 24).replace("ava sm", "ava sm")
      : icon(glyph);
    return `<a href="${href}" aria-label="${label}"${current}>${graphic}${badge}<span class="sr">${label}</span></a>`;
  }).join("");
}

function subBar(title, href) {
  return `<a class="icon-btn" href="${href}" aria-label="Geri">${icon("back")}</a><h1>${esc(title)}</h1><span></span>`;
}

function paintTop(r) {
  const hide = r.head === "reels" || r.head === "h";
  topbar.hidden = hide;
  topbar.className = "topbar";
  if (hide) {
    topbar.innerHTML = "";
    return;
  }
  if (r.head === "akis") {
    const dot = store.activityPending() ? `<i class="dot"></i>` : "";
    const mail = store.unreadTotal();
    topbar.innerHTML = `<a class="logo" href="#/">Bladekv1</a><div class="top-actions"><a class="icon-btn" href="#/yeni" aria-label="Oluştur">${icon("plus")}</a><a class="icon-btn" href="#/bildirim" aria-label="Bildirimler">${icon("heart")}${dot}</a><a class="icon-btn" href="#/mesaj" aria-label="Mesajlar">${icon("send")}${mail ? `<i class="count">${mail}</i>` : ""}</a></div>`;
    return;
  }
  if (r.head === "kesfet") {
    topbar.classList.add("searchbar");
    topbar.innerHTML = `<input id="q" class="search" type="search" enterkeyhint="search" placeholder="Ara" value="${esc(exploreQuery)}" aria-label="Ara" autocomplete="off">`;
    return;
  }
  if (r.head === "mesaj" && !r.parts[1]) {
    topbar.classList.add("sub");
    topbar.innerHTML = `<span></span><h1>Mesajlar</h1><button type="button" class="icon-btn" data-act="new-message" aria-label="Yeni mesaj">${icon("send")}</button>`;
    return;
  }
  if (r.head === "mesaj" && r.parts[1]) {
    const user = getUser(r.parts[1]);
    topbar.classList.add("sub");
    topbar.innerHTML = user
      ? `<a class="icon-btn" href="#/mesaj" aria-label="Geri">${icon("back")}</a><a class="who" href="${profileHref(user.id)}">${avatar(user, 32, true)}<strong>${esc(user.id)}</strong></a><span></span>`
      : subBar("Mesaj", "#/mesaj");
    return;
  }
  if (r.head === "profil" || r.head === "u") {
    const id = r.head === "profil" ? ME : r.parts[1];
    const user = getUser(id);
    topbar.classList.add("sub");
    if (!user) {
      topbar.innerHTML = subBar("Profil", "#/");
      return;
    }
    const back = r.head === "u" ? `<a class="icon-btn" href="#/" aria-label="Geri">${icon("back")}</a>` : "<span></span>";
    const menu = user.id === ME
      ? `<button type="button" class="icon-btn" data-act="profile-menu" aria-label="Menü">${icon("menu")}</button>`
      : `<button type="button" class="icon-btn" data-act="more" data-user="${esc(user.id)}" aria-label="Diğer">${icon("more")}</button>`;
    topbar.innerHTML = `${back}<strong class="handle">${esc(user.id)}</strong>${menu}`;
    return;
  }
  const titles = {
    g: ["Gönderi", "#/"],
    bildirim: ["Bildirimler", "#/"],
    duzenle: ["Profili düzenle", "#/profil"],
    ayarlar: ["Ayarlar", "#/profil"],
    kaydedilenler: ["Kaydedilenler", "#/profil"],
    b: ["Beğenenler", `#/g/${r.parts[1] || ""}`],
    takipci: ["Takipçi", profileHref(r.parts[1] || ME)],
    takip: ["Takip", profileHref(r.parts[1] || ME)],
  };
  if (r.head === "yeni") {
    const names = { gonderi: "Yeni gönderi", hikaye: "Yeni hikaye", reel: "Yeni reel" };
    topbar.classList.add("sub");
    topbar.innerHTML = subBar(names[r.parts[1]] || "Oluştur", r.parts[1] ? "#/yeni" : "#/");
    return;
  }
  const pair = titles[r.head] || ["Bladekv1", "#/"];
  topbar.classList.add("sub");
  topbar.innerHTML = subBar(pair[0], pair[1]);
}

function postCard(post, linkComments) {
  const user = getUser(post.user);
  if (!user) return "";
  const index = carousel[post.id] || 0;
  const images = post.images || [];
  const src = safeSrc(images[index] || "");
  const liked = store.liked(post.id);
  const saved = store.saved(post.id);
  const comments = store.commentsFor(post);
  let caption = post.caption || "";
  let more = "";
  if (!expanded.has(post.id) && caption.length > 150) {
    caption = `${caption.slice(0, 150).trim()}…`;
    more = ` <button type="button" class="more-inline" data-act="expand" data-id="${post.id}">daha fazla</button>`;
  }
  const dots = images.length > 1
    ? `<div class="dots" data-id="${post.id}" hidden></div><span class="pager">${index + 1}/${images.length}</span>`
    : "";
  const nav = images.length > 1
    ? `<button type="button" class="nav prev" data-act="car" data-id="${post.id}" data-dir="-1" aria-label="Önceki">‹</button><button type="button" class="nav next" data-act="car" data-id="${post.id}" data-dir="1" aria-label="Sonraki">›</button>`
    : "";
  const commentControl = linkComments
    ? `<a href="#/g/${post.id}" aria-label="Yorumlar">${icon("comment")}</a>`
    : `<button type="button" data-act="focus-comment" aria-label="Yorum yaz">${icon("comment")}</button>`;
  const commentLink = comments.length
    ? `<a class="more-comments" href="#/g/${post.id}">${comments.length === 1 ? "1 yorumu gör" : `${comments.length} yorumun tümünü gör`}</a>`
    : "";
  return `<article class="post">
    <header class="post-h">
      <a class="who" href="${profileHref(user.id)}">${avatar(user, 32, true)}<span><strong>${esc(user.id)}</strong>${post.location ? `<small>${esc(post.location)}</small>` : ""}</span></a>
      <button type="button" class="icon-btn" data-act="more" data-id="${post.id}" aria-label="Diğer">${icon("more")}</button>
    </header>
    <div class="frame" data-id="${post.id}">
      ${src ? `<img src="${src}" alt="${esc(post.alt || "")}" draggable="false">` : ""}
      ${nav}${dots}
      <div class="burst">${icon("heartFill")}</div>
    </div>
    <div class="actions">
      <div class="left">
        <button type="button" data-act="like" data-like="${post.id}" aria-pressed="${liked}" aria-label="Beğen" class="${liked ? "on" : ""}">${icon(liked ? "heartFill" : "heart")}</button>
        ${commentControl}
        <button type="button" data-act="share" data-id="${post.id}" aria-label="Paylaş">${icon("send")}</button>
      </div>
      <button type="button" data-act="save" data-save="${post.id}" aria-pressed="${saved}" aria-label="Kaydet" class="${saved ? "on" : ""}">${icon(saved ? "bookmarkFill" : "bookmark")}</button>
    </div>
    <button type="button" class="like-count" data-act="likes" data-id="${post.id}" data-likecount="${post.id}">${formatCount(store.likeCount(post))} beğenme</button>
    <p class="caption"><a class="author" href="${profileHref(user.id)}">${esc(user.id)}</a> ${rich(caption)}${more}</p>
    ${linkComments ? commentLink : ""}
    <time datetime="${new Date(post.at).toISOString()}">${timeAgo(post.at)}</time>
  </article>`;
}

function storyStrip() {
  return `<div class="stories">${store.storyRow().map((pack) => {
    const user = getUser(pack.owner);
    if (!user) return "";
    const seen = store.storySeen(pack) ? "seen" : "";
    const mine = pack.user === ME;
    return `<div class="story-slot"><a href="#/h/${pack.user}/${store.firstUnseen(pack)}" aria-label="${esc(mine ? "Hikayen" : user.name)}"><span class="ring ${seen}">${avatar(user, 56)}</span><b>${mine ? "Hikayen" : esc(user.id)}</b></a>${mine ? `<a class="add-badge" href="#/yeni/hikaye" aria-label="Hikaye ekle">${icon("plus")}</a>` : ""}</div>`;
  }).join("")}</div>`;
}

function feedScreen() {
  const cards = store.allPosts().map((post, index) => postCard(post, true).replace(
    index > 1 ? 'loading="eager"' : 'loading="eager"',
    index > 1 ? 'loading="lazy"' : 'loading="eager"',
  ));
  const people = suggestions.map((id) => getUser(id)).filter(Boolean);
  return `${storyStrip()}${cards.join("")}<section class="suggest"><h2>Senin için</h2><div class="scards">${people.map((user) => {
    const on = store.isFollowing(user.id);
    return `<article class="scard">${avatar(user, 56)}<b>${esc(user.id)}</b><span>${esc(user.name)}</span><button type="button" class="follow-btn${on ? " following" : ""}" data-act="follow" data-follow="${user.id}" data-user="${user.id}" aria-pressed="${on}">${on ? "Takiptesin" : "Takip et"}</button></article>`;
  }).join("")}</div></section>`;
}

function matches(post, query) {
  if (!query) return true;
  const user = getUser(post.user);
  const blob = `${user?.id || ""} ${user?.name || ""} ${post.caption || ""} ${post.location || ""} ${post.topic || ""}`.toLocaleLowerCase("tr-TR");
  return blob.includes(query.toLocaleLowerCase("tr-TR"));
}

function exploreGrid() {
  const list = store.allPosts().filter((post) => matches(post, exploreQuery));
  if (!list.length) return `<p class="empty">Bu aramada bir şey yok.</p>`;
  return list.map((post, index) => {
    const src = safeSrc(post.images?.[0] || "");
    const feat = list.length > 8 && index % 9 === 0 ? " feat" : "";
    return `<a class="tile${feat}" href="#/g/${post.id}">${src ? `<img src="${src}" alt="${esc(post.alt || "")}" loading="lazy">` : ""}</a>`;
  }).join("");
}

function exploreScreen() {
  const chips = topics.map((topic) => {
    const tag = topic === "Tümü" ? "" : topic;
    const on = (exploreQuery || "") === tag || (topic !== "Tümü" && exploreQuery.toLocaleLowerCase("tr-TR") === topic.toLocaleLowerCase("tr-TR"));
    return `<button type="button" data-act="chip" data-tag="${esc(tag)}" class="${on ? "on" : ""}">${esc(topic)}</button>`;
  }).join("");
  return `<div class="chips">${chips}</div><div id="explore-grid" class="explore-grid">${exploreGrid()}</div>`;
}

function reelMedia(reel) {
  const video = safeVideo(reel.src || "") || (reel.blobId ? blobUrls.get(reel.blobId) || "" : "");
  const poster = safeSrc(reel.poster || reel.image || "");
  if (video) {
    return `<video src="${video}" ${poster ? `poster="${poster}"` : ""} playsinline webkit-playsinline muted loop preload="metadata"></video>`;
  }
  if (poster) return `<img class="pan" src="${poster}" alt="">`;
  return "";
}

function reelsScreen(selected) {
  const list = store.allReels();
  if (selected) {
    const index = list.findIndex((reel) => reel.id === selected);
    if (index > 0) {
      const [item] = list.splice(index, 1);
      list.unshift(item);
    }
  }
  return `<div class="reels" id="reels">${list.map((reel) => {
    const user = getUser(reel.user);
    if (!user) return "";
    const liked = store.liked(reel.id);
    const saved = store.saved(reel.id);
    const follow = user.id === ME ? "" : `<button type="button" class="follow-btn${store.isFollowing(user.id) ? " following" : ""}" data-act="follow" data-follow="${user.id}" data-user="${user.id}">${store.isFollowing(user.id) ? "Takiptesin" : "Takip et"}</button>`;
    return `<article class="reel" id="reel-${reel.id}" data-id="${reel.id}">
      ${reelMedia(reel)}
      <div class="reel-shade"></div>
      <div class="burst">${icon("heartFill")}</div>
      <div class="reel-side">
        <a href="${profileHref(user.id)}" aria-label="${esc(user.id)}">${avatar(user, 32)}</a>
        <button type="button" data-act="like" data-like="${reel.id}" aria-label="Beğen" class="${liked ? "on" : ""}">${icon(liked ? "heartFill" : "heart")}<small data-likecount="${reel.id}">${formatCount(store.likeCount(reel))}</small></button>
        <a href="#/g/${reel.id}" aria-label="Yorum">${icon("comment")}</a>
        <button type="button" data-act="share" data-id="${reel.id}" data-kind="reel" aria-label="Paylaş">${icon("send")}</button>
        <button type="button" data-act="save" data-save="${reel.id}" aria-label="Kaydet" class="${saved ? "on" : ""}">${icon(saved ? "bookmarkFill" : "bookmark")}</button>
      </div>
      <div class="reel-copy">
        <div class="who"><a href="${profileHref(user.id)}"><strong>${esc(user.id)}</strong></a>${follow}</div>
        <p>${rich(reel.caption || "")}</p>
      </div>
    </article>`;
  }).join("")}</div>`;
}

function inboxScreen() {
  const q = inboxQuery.toLocaleLowerCase("tr-TR");
  const rows = store.inbox().filter((item) => !q || `${item.user.id} ${item.user.name} ${item.last.text}`.toLocaleLowerCase("tr-TR").includes(q));
  const list = rows.length ? rows.map((item) => `<a class="thread${item.unread ? " unread" : ""}" href="#/mesaj/${item.user.id}">${avatar(item.user, 56, true)}<span class="copy"><strong>${esc(item.user.name)}</strong><em>${esc(item.last.text)}</em></span>${item.unread ? `<i class="unread-pip"></i>` : ""}</a>`).join("") : `<p class="empty">Bu aramada mesaj yok.</p>`;
  return `<input id="inbox-q" class="inbox-search" type="search" placeholder="Ara" value="${esc(inboxQuery)}" aria-label="Mesajlarda ara" autocomplete="off"><div id="inbox-list">${list}</div>`;
}

function chatScreen(id) {
  const user = getUser(id);
  if (!user) return missing("Bu sohbet yok.");
  store.markRead(id);
  const bubbles = store.messagesFor(id).map((message) => `<div class="bubble ${message.from === ME ? "me" : "them"}">${esc(message.text)}<time>${timeAgo(message.at)}</time></div>`).join("");
  return `<div class="chat">${bubbles}</div>`;
}

function personRow(user, mode) {
  const follow = user.id === ME ? "" : `<button type="button" class="follow-btn${store.isFollowing(user.id) ? " following" : ""}" data-act="follow" data-follow="${user.id}" data-user="${user.id}" aria-pressed="${store.isFollowing(user.id)}">${store.isFollowing(user.id) ? "Takiptesin" : "Takip et"}</button>`;
  const href = mode === "message" ? `#/mesaj/${user.id}` : profileHref(user.id);
  return `<div class="person">${avatar(user, 48, true)}<a class="copy" href="${href}"><strong>${esc(user.id)}</strong><small>${esc(user.name)}</small></a>${mode === "message" ? "" : follow}</div>`;
}

function profileScreen(id, tab) {
  const user = getUser(id);
  if (!user) return missing("Bu hesap yok.");
  const base = user.id === ME ? "#/profil" : `#/u/${user.id}`;
  const posts = store.postsBy(user.id);
  const reels = store.reelsBy(user.id);
  const tagged = store.tagged(user.id);
  const pack = store.packFor(user.id);
  const photo = pack
    ? `<a href="#/h/${pack.user}/${store.firstUnseen(pack)}" aria-label="Hikaye"><span class="ring ${store.storySeen(pack) ? "seen" : ""}">${avatar(user, 86)}</span></a>`
    : avatar(user, 86);
  const actions = user.id === ME
    ? `<a class="btn" href="#/duzenle">Profili düzenle</a><a class="btn" href="#/yeni">Paylaş</a>`
    : `<button type="button" class="btn primary follow-btn${store.isFollowing(user.id) ? " following" : ""}" data-act="follow" data-follow="${user.id}" data-user="${user.id}">${store.isFollowing(user.id) ? "Takiptesin" : "Takip et"}</button><a class="btn" href="#/mesaj/${user.id}">Mesaj</a>`;
  const lights = store.highlightsFor(user.id).map((item) => `<a href="#/h/${item.id}/0"><span class="hl"><img src="${safeSrc(item.cover)}" alt=""></span>${esc(item.title)}</a>`).join("");
  const body = tab === "reels"
    ? reelGrid(reels)
    : tab === "etiket"
      ? photoGrid(tagged)
      : photoGrid(posts);
  return `<section class="profile-head">${photo}<ul class="stats"><li><strong>${formatCount(posts.length)}</strong><span>gönderi</span></li><li><a href="#/takipci/${user.id}"><strong>${formatCount(store.followerCount(user))}</strong><span>takipçi</span></a></li><li><a href="#/takip/${user.id}"><strong>${formatCount(store.followingCount(user))}</strong><span>takip</span></a></li></ul></section>
    <div class="bio"><strong>${esc(store.displayName(user))}</strong><p>${esc(store.bioOf(user))}</p></div>
    <div class="row-btns">${actions}</div>
    ${lights ? `<div class="highlights">${lights}</div>` : ""}
    <nav class="ptabs">
      <a href="${base}" class="${tab === "grid" ? "on" : ""}" aria-label="Gönderiler">${icon("grid")}</a>
      <a href="${base}/reels" class="${tab === "reels" ? "on" : ""}" aria-label="Reels">${icon("reels")}</a>
      <a href="${base}/etiket" class="${tab === "etiket" ? "on" : ""}" aria-label="Etiketlenenler">${icon("tag")}</a>
    </nav>
    ${body}`;
}

function photoGrid(items) {
  if (!items.length) return `<p class="empty">Burada henüz bir şey yok.</p>`;
  return `<div class="grid">${items.map((post) => {
    const src = safeSrc(post.images?.[0] || "");
    return `<a href="#/g/${post.id}">${src ? `<img src="${src}" alt="${esc(post.alt || "")}" loading="lazy">` : ""}</a>`;
  }).join("")}</div>`;
}

function reelGrid(items) {
  if (!items.length) return `<p class="empty">Henüz reel yok.</p>`;
  return `<div class="grid">${items.map((reel) => {
    const src = safeSrc(reel.poster || reel.image || "");
    return `<a class="reel-tile" href="#/reels/${reel.id}">${src ? `<img src="${src}" alt="">` : ""}<span>${icon("play")}</span></a>`;
  }).join("")}</div>`;
}

function commentBlock(id, seed) {
  const comments = store.commentsFor({ id, comments: seed });
  if (!comments.length) return `<p class="empty">İlk yorumu sen yap.</p>`;
  return `<ul class="comments">${comments.map((comment) => `<li class="comment-line"><a class="author" href="${profileHref(comment.user)}">${esc(comment.user)}</a> ${rich(comment.text)} <time>${timeAgo(comment.at)}</time>${comment.own ? `<button type="button" data-act="del-comment" data-post="${esc(id)}" data-id="${esc(comment.id)}">Sil</button>` : ""}</li>`).join("")}</ul>`;
}

function postScreen(id) {
  const post = store.postById(id);
  const reel = store.reelById(id);
  if (reel && !post) {
    const liked = store.liked(reel.id);
    return `<article class="post"><div class="frame" data-id="${reel.id}">${reelMedia(reel)}<div class="burst">${icon("heartFill")}</div></div>
      <div class="actions"><div class="left"><button type="button" data-act="like" data-like="${reel.id}" class="${liked ? "on" : ""}" aria-label="Beğen">${icon(liked ? "heartFill" : "heart")}</button><button type="button" data-act="focus-comment" aria-label="Yorum">${icon("comment")}</button><button type="button" data-act="share" data-id="${reel.id}" data-kind="reel" aria-label="Paylaş">${icon("send")}</button></div>
      <button type="button" data-act="save" data-save="${reel.id}" class="${store.saved(reel.id) ? "on" : ""}" aria-label="Kaydet">${icon(store.saved(reel.id) ? "bookmarkFill" : "bookmark")}</button></div>
      <button type="button" class="like-count" data-likecount="${reel.id}">${formatCount(store.likeCount(reel))} beğenme</button>
      <p class="caption"><a class="author" href="${profileHref(reel.user)}">${esc(reel.user)}</a> ${rich(reel.caption || "")}</p></article>${commentBlock(reel.id, [])}`;
  }
  if (!post) return missing("Bu gönderi yok.");
  const comments = store.commentsFor(post);
  const list = comments.length
    ? `<ul class="comments">${comments.map((comment) => `<li class="comment-line"><a class="author" href="${profileHref(comment.user)}">${esc(comment.user)}</a> ${rich(comment.text)} <time>${timeAgo(comment.at)}</time>${comment.own ? `<button type="button" data-act="del-comment" data-post="${post.id}" data-id="${comment.id}">Sil</button>` : ""}</li>`).join("")}</ul>`
    : `<p class="empty">İlk yorumu sen yap.</p>`;
  return `${postCard(post, false)}${list}`;
}

function storyScreen(id, index) {
  const pack = store.packFor(id);
  if (!pack || !pack.frames.length) return missing("Bu hikaye yok.");
  const safeIndex = Math.max(0, Math.min(pack.frames.length - 1, index));
  const frame = pack.frames[safeIndex];
  const owner = getUser(pack.owner);
  const bars = pack.frames.map((item, itemIndex) => `<span class="${itemIndex < safeIndex ? "done" : itemIndex === safeIndex ? "active" : ""}"><i style="width:${itemIndex < safeIndex ? "100%" : "0"}"></i></span>`).join("");
  const media = safeSrc(frame.image || "");
  return `<section class="story" data-user="${esc(pack.user)}" data-index="${safeIndex}">
    <div class="story-media">${media ? `<img src="${media}" alt="">` : ""}</div>
    <div class="story-top">
      <div class="bars">${bars}</div>
      <div class="story-user">${owner ? avatar(owner, 32) : ""}<div><strong>${esc(owner ? owner.id : "")}</strong>${pack.title ? `<span> · ${esc(pack.title)}</span>` : ""}<time>${timeAgo(frame.at || Date.now())}</time></div><button type="button" class="icon-btn spacer" data-act="story-close" aria-label="Kapat">${icon("close")}</button></div>
    </div>
    ${frame.text ? `<p class="story-caption">${esc(frame.text)}</p>` : ""}
    <div class="zones"><button type="button" data-act="story-go" data-dir="-1" aria-label="Önceki">.</button><button type="button" data-act="story-go" data-dir="1" aria-label="Sonraki">.</button></div>
    <form class="story-reply" data-kind="story" data-user="${esc(pack.owner)}"><input name="text" maxlength="500" placeholder="${esc(owner ? `${owner.id} kişisine yanıt gönder` : "Yanıt gönder")}" aria-label="Hikaye yanıtı" autocomplete="off"><button type="submit" aria-label="Gönder">${icon("send")}</button></form>
  </section>`;
}

function choiceScreen() {
  return `<div class="choices">
    <a class="choice" href="#/yeni/gonderi">Gönderi<small>Fotoğraf ya da renkli kart</small></a>
    <a class="choice" href="#/yeni/hikaye">Hikaye<small>Bir kare, birkaç saniye</small></a>
    <a class="choice" href="#/yeni/reel">Reel<small>Fotoğrafı kaydır ya da video seç</small></a>
  </div>`;
}

function createScreen(kind) {
  const preview = draft.videoUrl
    ? `<video src="${draft.videoUrl}" muted playsinline autoplay loop></video>`
    : draft.image
      ? `<img src="${safeSrc(draft.image)}" alt="">`
      : `<img src="${cardUri(draft.bg, draft.text || kindLabel(kind))}" alt="">`;
  const swatches = CARDS.map((color) => `<button type="button" data-act="swatch" data-bg="${color}" class="${draft.bg === color && !draft.image ? "on" : ""}" style="background:${color}" aria-label="Renk"></button>`).join("");
  const capture = kind === "reel" ? "" : `<label class="btn">Kamera<input class="js-draft-file sr" type="file" accept="image/*" capture="environment"></label>`;
  const accept = kind === "reel" ? "image/*,video/mp4,video/quicktime" : "image/*";
  return `<form class="composer-page" data-kind="create" data-create="${esc(kind)}">
    <div class="preview">${preview}</div>
    <div class="swatches">${swatches}</div>
    <div class="file-row"><label class="btn">Fotoğraf seç<input class="js-draft-file sr" type="file" accept="${accept}"></label>${capture}</div>
    <textarea id="draft-text" class="caption-box" name="text" maxlength="${kind === "hikaye" ? 140 : 2200}" placeholder="${kind === "hikaye" ? "Hikayeye bir cümle" : "Açıklama yaz"}">${esc(draft.text)}</textarea>
    <button class="btn primary" type="submit" style="width:100%;margin-top:12px">Paylaş</button>
  </form>`;
}

function kindLabel(kind) {
  if (kind === "hikaye") return "yeni hikaye";
  if (kind === "reel") return "yeni reel";
  return "yeni gönderi";
}

function editScreen() {
  const user = getUser(ME);
  return `<form id="edit-form" class="form-page">
    <div class="profile-head">${avatar(user, 86)}<div><strong>${esc(user.id)}</strong><p class="hint" style="text-align:left;padding:4px 0 0">Kullanıcı adı sabit.</p></div></div>
    <label>Ad<input name="name" type="text" maxlength="40" value="${esc(store.displayName(user))}"></label>
    <label>Biyografi<textarea name="bio" maxlength="150">${esc(store.bioOf(user))}</textarea></label>
    <div class="file-row"><label class="btn">Profil fotoğrafı<input id="avatar-file" class="sr" type="file" accept="image/*"></label></div>
    <button class="btn primary" type="submit" style="width:100%">Bitti</button>
  </form>`;
}

function settingsScreen() {
  const current = store.theme();
  const seg = ["system", "light", "dark"].map((value) => {
    const label = value === "system" ? "Sistem" : value === "light" ? "Aydınlık" : "Karanlık";
    return `<button type="button" data-act="theme" data-theme="${value}" class="${current === value ? "on" : ""}">${label}</button>`;
  }).join("");
  return `<div class="setting"><span>Görünüm</span><div class="seg">${seg}</div></div>
    <div class="setting"><span>Bu cihaz</span><button type="button" class="btn" data-act="reset-ask">Verileri sil</button></div>
    <div class="about"><p>Beğeniler, mesajlar, hikayeler ve yeni gönderiler bu telefonda kalır.</p><p>Fotoğraflar <a href="https://unsplash.com/license" target="_blank" rel="noopener noreferrer">Unsplash lisansı</a> ile eklendi.</p></div>`;
}

function missing(text) {
  return `<p class="empty">${esc(text)}</p>`;
}

function screen(r) {
  if (r.head === "h") return storyScreen(r.parts[1], Number(r.parts[2] || 0));
  if (r.head === "kesfet") return exploreScreen();
  if (r.head === "reels") return reelsScreen(r.parts[1] || "");
  if (r.head === "mesaj") return r.parts[1] ? chatScreen(r.parts[1]) : inboxScreen();
  if (r.head === "profil") return profileScreen(ME, r.parts[1] === "reels" || r.parts[1] === "etiket" ? r.parts[1] : "grid");
  if (r.head === "u") return profileScreen(r.parts[1], r.parts[2] === "reels" || r.parts[2] === "etiket" ? r.parts[2] : "grid");
  if (r.head === "g") return postScreen(r.parts[1]);
  if (r.head === "bildirim") {
    store.seeActivity();
    return store.activityItems().map((item) => {
      const user = getUser(item.user);
      if (!user) return "";
      const href = item.postId ? `#/g/${item.postId}` : profileHref(user.id);
      return `<a class="note" href="${href}">${avatar(user, 44, true)}<span class="copy"><p><strong>${esc(user.id)}</strong> ${esc(item.text)}</p><time>${timeAgo(item.at)}</time></span></a>`;
    }).join("");
  }
  if (r.head === "yeni") return r.parts[1] ? createScreen(r.parts[1]) : choiceScreen();
  if (r.head === "duzenle") return editScreen();
  if (r.head === "ayarlar") return settingsScreen();
  if (r.head === "kaydedilenler") return photoGrid(store.savedPosts());
  if (r.head === "b") {
    const post = store.postById(r.parts[1]);
    if (!post) return missing("Bu gönderi yok.");
    const ids = new Set(post.likers || []);
    if (store.liked(post.id)) ids.add(ME);
    const people = [...ids].map(getUser).filter(Boolean);
    return `<p class="hint">${formatCount(store.likeCount(post))} beğenme</p>${people.map((user) => personRow(user)).join("")}`;
  }
  if (r.head === "takipci" || r.head === "takip") {
    const user = getUser(r.parts[1]);
    if (!user) return missing("Bu hesap yok.");
    const list = r.head === "takipci" ? store.followerList(user) : store.followingList(user);
    return list.length ? list.map((person) => personRow(person)).join("") : `<p class="empty">Liste boş.</p>`;
  }
  return feedScreen();
}

function composerFor(r) {
  if (r.head === "mesaj" && r.parts[1] && getUser(r.parts[1])) {
    return `<form id="composer-form" data-kind="chat" data-user="${esc(r.parts[1])}"><input name="text" maxlength="1000" placeholder="Mesaj yaz..." enterkeyhint="send" autocomplete="off" aria-label="Mesaj"><button type="submit" aria-label="Gönder">${icon("send")}</button></form>`;
  }
  if (r.head === "g" && (store.postById(r.parts[1]) || store.reelById(r.parts[1]))) {
    return `<form id="composer-form" data-kind="comment" data-id="${esc(r.parts[1])}"><input name="text" maxlength="500" placeholder="Yorum ekle..." enterkeyhint="send" autocomplete="off" aria-label="Yorum"><button type="submit" aria-label="Gönder">${icon("send")}</button></form>`;
  }
  return "";
}

function rootTab(r) {
  return r.head === "akis" || r.head === "kesfet" || r.head === "reels" || r.head === "profil" || (r.head === "mesaj" && !r.parts[1]);
}

function render() {
  const next = location.hash || "#/";
  if (currentHash) scrollMem.set(currentHash, stage.scrollTop);
  cleanup();
  closeSheet();
  applyTheme();
  const r = route();
  if (r.head === "bildirim") store.seeActivity();
  app.classList.toggle("reels-mode", r.head === "reels");
  app.classList.toggle("immersive", r.head === "h");
  paintTop(r);
  const showTabs = rootTab(r);
  tabbar.hidden = !showTabs;
  tabbar.innerHTML = showTabs ? tabBar(r) : "";
  const bar = composerFor(r);
  composer.hidden = !bar;
  composer.innerHTML = bar;
  stage.innerHTML = screen(r);
  const stick = pinBottom || (r.head === "mesaj" && r.parts[1]);
  pinBottom = false;
  stage.scrollTop = stick ? stage.scrollHeight : (scrollMem.get(next) || 0);
  currentHash = next;
  document.title = ({
    akis: "Bladekv1",
    kesfet: "Keşfet · Bladekv1",
    reels: "Reels · Bladekv1",
    mesaj: "Mesajlar · Bladekv1",
    profil: "Profil · Bladekv1",
  })[r.head] || "Bladekv1";
  after(r);
}

function after(r) {
  const search = document.getElementById("q");
  if (search) {
    const onInput = () => {
      exploreQuery = search.value.trim();
      const grid = document.getElementById("explore-grid");
      if (grid) grid.innerHTML = exploreGrid();
      const query = exploreQuery.toLocaleLowerCase("tr-TR");
      document.querySelectorAll(".chips button").forEach((button) => {
        const tag = (button.dataset.tag || "").toLocaleLowerCase("tr-TR");
        button.classList.toggle("on", tag === "" ? query === "" : query === tag);
      });
    };
    search.addEventListener("input", onInput);
    cleanupFns.push(() => search.removeEventListener("input", onInput));
  }
  const inbox = document.getElementById("inbox-q");
  if (inbox) {
    const onInput = () => {
      inboxQuery = inbox.value.trim();
      const list = document.getElementById("inbox-list");
      if (!list) return;
      const previous = stage.scrollTop;
      const chunk = inboxScreen();
      const holder = document.createElement("div");
      holder.innerHTML = chunk;
      list.innerHTML = holder.querySelector("#inbox-list").innerHTML;
      stage.scrollTop = previous;
    };
    inbox.addEventListener("input", onInput);
    cleanupFns.push(() => inbox.removeEventListener("input", onInput));
  }
  if (r.head === "h") mountStory();
  if (r.head === "reels") mountReels();
}

function mountStory() {
  const gen = ++storyGen;
  const story = document.querySelector(".story");
  if (!story) return;
  const pack = store.packFor(story.dataset.user);
  const index = Number(story.dataset.index || 0);
  const frame = pack?.frames[index];
  if (frame) store.seeFrame(pack.user, frame.id);
  const bar = story.querySelector(".bars .active i");
  let elapsed = 0;
  let start = performance.now();
  let paused = false;
  let raf = 0;
  const tick = (now) => {
    if (gen !== storyGen) return;
    if (paused) return;
    const progress = Math.min(1, (elapsed + (now - start)) / STORY_MS);
    if (bar) bar.style.width = `${progress * 100}%`;
    if (progress >= 1) {
      goFrame(1);
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  const pause = () => {
    if (paused) return;
    paused = true;
    elapsed += performance.now() - start;
    cancelAnimationFrame(raf);
  };
  const resume = () => {
    if (!paused || gen !== storyGen) return;
    paused = false;
    start = performance.now();
    raf = requestAnimationFrame(tick);
  };
  const down = (event) => {
    if (event.target.closest("input, a, form button")) return;
    pause();
    story.dataset.hold = String(performance.now());
  };
  const up = () => resume();
  story.addEventListener("pointerdown", down);
  story.addEventListener("pointerup", up);
  story.addEventListener("pointercancel", up);
  window.addEventListener("pointerup", up);
  const input = story.querySelector("input");
  const focus = () => pause();
  const blur = () => resume();
  input?.addEventListener("focus", focus);
  input?.addEventListener("blur", blur);
  raf = requestAnimationFrame(tick);
  cleanupFns.push(() => {
    cancelAnimationFrame(raf);
    story.removeEventListener("pointerdown", down);
    story.removeEventListener("pointerup", up);
    story.removeEventListener("pointercancel", up);
    window.removeEventListener("pointerup", up);
    input?.removeEventListener("focus", focus);
    input?.removeEventListener("blur", blur);
  });
}

function showHash(hash, replace) {
  const current = location.hash || "#/";
  if (current === hash) return;
  if (replace) {
    history.replaceState(null, "", hash);
    render();
    return;
  }
  location.hash = hash;
}

function leaveStory() {
  const before = location.hash;
  history.back();
  setTimeout(() => {
    if ((location.hash || "#/") === before) showHash("#/", false);
  }, 60);
}

function goFrame(direction) {
  const r = route();
  const order = r.parts[1]?.startsWith("hl-")
    ? [store.packFor(r.parts[1])].filter(Boolean)
    : store.storyRow();
  const place = order.findIndex((pack) => pack.user === r.parts[1]);
  if (place < 0) {
    leaveStory();
    return;
  }
  const index = Number(r.parts[2] || 0) + direction;
  if (index >= order[place].frames.length) {
    const next = order[place + 1];
    if (!next) leaveStory();
    else showHash(`#/h/${next.user}/0`, true);
    return;
  }
  if (index < 0) {
    const prev = order[place - 1];
    if (!prev) leaveStory();
    else showHash(`#/h/${prev.user}/${prev.frames.length - 1}`, true);
    return;
  }
  showHash(`#/h/${order[place].user}/${index}`, true);
}

function mountReels() {
  const root = document.getElementById("reels");
  if (!root) return;
  const videos = [...root.querySelectorAll("video")];
  videos.forEach((video) => { video.muted = true; video.playsInline = true; });
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const video = entry.target.querySelector("video");
      if (!video) continue;
      if (entry.isIntersecting && entry.intersectionRatio >= 0.65) video.play().catch(() => {});
      else video.pause();
    }
  }, { root, threshold: [0.65] });
  root.querySelectorAll(".reel").forEach((reel) => observer.observe(reel));
  cleanupFns.push(() => observer.disconnect());
}

function paintLike(id) {
  const on = store.liked(id);
  document.querySelectorAll(`[data-like="${CSS.escape(id)}"]`).forEach((button) => {
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
    const small = button.querySelector("small");
    button.innerHTML = icon(on ? "heartFill" : "heart");
    if (small) button.append(small);
  });
  const post = store.postById(id) || store.reelById(id);
  if (!post) return;
  const label = formatCount(store.likeCount(post));
  document.querySelectorAll(`[data-likecount="${CSS.escape(id)}"]`).forEach((el) => {
    el.textContent = el.tagName === "SMALL" ? label : `${label} beğenme`;
  });
}

function paintSave(id) {
  const on = store.saved(id);
  document.querySelectorAll(`[data-save="${CSS.escape(id)}"]`).forEach((button) => {
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
    button.innerHTML = icon(on ? "bookmarkFill" : "bookmark");
  });
}

function burst(id) {
  const frame = document.querySelector(`.frame[data-id="${CSS.escape(id)}"], .reel[data-id="${CSS.escape(id)}"]`);
  if (!frame) return;
  frame.classList.remove("pop");
  void frame.offsetWidth;
  frame.classList.add("pop");
}

function paintFollow(id) {
  const on = store.isFollowing(id);
  document.querySelectorAll(`[data-follow="${CSS.escape(id)}"]`).forEach((button) => {
    button.classList.toggle("following", on);
    button.textContent = on ? "Takiptesin" : "Takip et";
    button.setAttribute("aria-pressed", String(on));
  });
}

function openSheet(html) {
  document.getElementById("sheet").innerHTML = `<div class="backdrop" data-act="close-sheet"></div><div class="sheet" role="dialog">${html}</div>`;
}

function closeSheet() {
  const sheet = document.getElementById("sheet");
  if (sheet) sheet.innerHTML = "";
}

function shareItem(id, kind) {
  const post = kind === "reel" ? store.reelById(id) : (store.postById(id) || store.reelById(id));
  if (!post) return;
  const url = `${location.origin}${location.pathname}#/${kind === "reel" || store.reelById(id) && !store.postById(id) ? "reels" : "g"}/${id}`;
  const text = post.caption || "Bladekv1";
  if (navigator.share) {
    navigator.share({ title: "Bladekv1", text, url }).catch((error) => {
      if (error?.name !== "AbortError") copyText(url);
    });
    return;
  }
  copyText(url);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Bağlantı kopyalandı");
    return;
  } catch { /* fallback below */ }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
  toast("Bağlantı kopyalandı");
}

function cardUri(bg, text) {
  if (!/^#[0-9a-f]{6}$/i.test(bg)) bg = "#1a1a1a";
  const words = String(text || "Bladekv1").trim().slice(0, 140).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > 16 && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 6);
  const start = 640 - ((shown.length - 1) * 42);
  const tspans = shown.map((item, index) => `<tspan x="540" y="${start + index * 84}">${esc(item).replace(/&#39;/g, "&#39;")}</tspan>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="${bg}"/><text text-anchor="middle" fill="#ffffff" font-family="Georgia, serif" font-size="64">${tspans}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function compressImage(file, max) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    image.src = url;
  });
}

function rememberDraft() {
  const field = document.getElementById("draft-text");
  if (field) draft.text = field.value;
}

function shiftCarousel(id, direction) {
  const post = store.postById(id);
  if (!post || post.images.length < 2) return;
  const count = post.images.length;
  carousel[id] = ((carousel[id] || 0) + direction + count) % count;
  const frame = document.querySelector(`.frame[data-id="${CSS.escape(id)}"]`);
  if (!frame) return;
  const image = frame.querySelector("img");
  if (image) image.src = safeSrc(post.images[carousel[id]]);
  const pager = frame.querySelector(".pager");
  if (pager) pager.textContent = `${carousel[id] + 1}/${count}`;
}

let lastTap = { id: "", at: 0 };
let swipe = null;

document.body.addEventListener("click", (event) => {
  const zone = event.target.closest("[data-act]");
  const hit = event.target.closest(".frame, .reel");
  if (hit && !event.target.closest("button, a, input, textarea, form")) {
    const now = Date.now();
    if (lastTap.id === hit.dataset.id && now - lastTap.at < 280) {
      if (!store.liked(hit.dataset.id)) store.toggleLike(hit.dataset.id);
      paintLike(hit.dataset.id);
      burst(hit.dataset.id);
      lastTap.id = "";
      return;
    }
    lastTap = { id: hit.dataset.id, at: now };
  }
  if (!zone) return;
  const act = zone.dataset.act;
  if (act === "like") {
    store.toggleLike(zone.dataset.like);
    paintLike(zone.dataset.like);
    if (store.liked(zone.dataset.like)) burst(zone.dataset.like);
  } else if (act === "save") {
    store.toggleSave(zone.dataset.save);
    paintSave(zone.dataset.save);
    toast(store.saved(zone.dataset.save) ? "Kaydedildi" : "Kayıtlardan çıkarıldı");
  } else if (act === "follow") {
    store.toggleFollow(zone.dataset.user);
    const head = route().head;
    closeSheet();
    if (["profil", "u", "takip", "takipci", "b"].includes(head)) render();
    else paintFollow(zone.dataset.user);
  } else if (act === "share") {
    closeSheet();
    shareItem(zone.dataset.id, zone.dataset.kind || "");
  } else if (act === "copy") {
    const id = zone.dataset.id;
    closeSheet();
    copyText(`${location.origin}${location.pathname}#/g/${id}`);
  } else if (act === "more") {
    const post = store.postById(zone.dataset.id);
    if (!post) return;
    const own = post.user === ME;
    const created = store.isOwnPost(post.id);
    openSheet(`<div class="grab"></div>
      <button type="button" data-act="share" data-id="${post.id}">Paylaş</button>
      <button type="button" data-act="copy" data-id="${post.id}">Bağlantıyı kopyala</button>
      ${own ? "" : `<button type="button" data-act="follow" data-user="${post.user}" data-follow="${post.user}">${store.isFollowing(post.user) ? "Takibi bırak" : "Takip et"}</button>`}
      ${created ? `<button type="button" class="danger" data-act="delete-post" data-id="${post.id}">Sil</button>` : `<button type="button" class="danger" data-act="hide" data-id="${post.id}">Gizle</button>`}
      <button type="button" data-act="close-sheet">Vazgeç</button>`);
  } else if (act === "hide") {
    store.hidePost(zone.dataset.id);
    closeSheet();
    render();
    toast("Gönderi gizlendi");
  } else if (act === "delete-post") {
    store.deleteOwnPost(zone.dataset.id);
    closeSheet();
    if (route().head === "g") location.hash = "#/";
    else render();
    toast("Gönderi silindi");
  } else if (act === "car") {
    shiftCarousel(zone.dataset.id, Number(zone.dataset.dir) || 1);
  } else if (act === "expand") {
    expanded.add(zone.dataset.id);
    render();
  } else if (act === "likes") {
    location.hash = `#/b/${zone.dataset.id}`;
  } else if (act === "chip") {
    exploreQuery = zone.dataset.tag || "";
    if (route().head !== "kesfet") location.hash = "#/kesfet";
    else {
      const field = document.getElementById("q");
      if (field) field.value = exploreQuery;
      const grid = document.getElementById("explore-grid");
      if (grid) grid.innerHTML = exploreGrid();
      document.querySelectorAll(".chips button").forEach((button) => {
        button.classList.toggle("on", (button.dataset.tag || "") === exploreQuery);
      });
    }
  } else if (act === "story-close") {
    leaveStory();
  } else if (act === "story-go") {
    const story = document.querySelector(".story");
    const hold = Number(story?.dataset.hold || 0);
    if (hold && performance.now() - hold > 280) return;
    goFrame(Number(zone.dataset.dir) || 1);
  } else if (act === "focus-comment") {
    composer.querySelector("input")?.focus();
  } else if (act === "del-comment") {
    store.deleteComment(zone.dataset.post, zone.dataset.id);
    render();
  } else if (act === "close-sheet") {
    closeSheet();
  } else if (act === "new-message") {
    const rows = users.filter((user) => user.id !== ME).map((user) => `<a href="#/mesaj/${user.id}">${esc(user.name)}</a>`).join("");
    openSheet(`<div class="grab"></div>${rows}<button type="button" data-act="close-sheet">Vazgeç</button>`);
  } else if (act === "profile-menu") {
    openSheet(`<div class="grab"></div><a href="#/kaydedilenler">Kaydedilenler</a><a href="#/ayarlar">Ayarlar</a><button type="button" data-act="close-sheet">Vazgeç</button>`);
  } else if (act === "theme") {
    store.setTheme(zone.dataset.theme);
    render();
  } else if (act === "reset-ask") {
    openSheet(`<div class="grab"></div><p class="hint">Beğeniler, mesajlar ve eklediğin gönderiler bu telefondan silinir.</p><button type="button" class="danger" data-act="reset-do">Sil</button><button type="button" data-act="close-sheet">Vazgeç</button>`);
  } else if (act === "reset-do") {
    store.reset();
    draft = { bg: CARDS[0], text: "", image: "", blobId: "", videoUrl: "" };
    location.hash = "#/";
    render();
    toast("Bu cihaz sıfırlandı");
  } else if (act === "swatch") {
    rememberDraft();
    draft.bg = zone.dataset.bg;
    draft.image = "";
    draft.videoUrl = "";
    draft.blobId = "";
    render();
  }
});

document.body.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const kind = form.dataset.kind;
  if (kind === "chat") {
    const text = new FormData(form).get("text")?.toString().trim() || "";
    if (!text) return;
    if (!store.sendMessage(form.dataset.user, text.slice(0, 1000))) {
      toast("Mesaj sığmadı");
      return;
    }
    render();
    return;
  }
  if (kind === "comment") {
    const text = new FormData(form).get("text")?.toString().trim() || "";
    if (!text) return;
    if (!store.addComment(form.dataset.id, text.slice(0, 500))) {
      toast("Yorum sığmadı");
      return;
    }
    pinBottom = true;
    render();
    return;
  }
  if (kind === "story") {
    const text = new FormData(form).get("text")?.toString().trim() || "";
    if (!text) return;
    const userId = form.dataset.user;
    if (userId && userId !== ME && getUser(userId)) {
      store.sendMessage(userId, text.slice(0, 500));
      toast("Yanıt gönderildi");
      form.reset();
    }
    return;
  }
  if (kind === "create") {
    rememberDraft();
    const text = (draft.text || "").trim();
    const create = form.dataset.create;
    if (!draft.image && !draft.videoUrl && !text) {
      toast("Bir şey yaz veya fotoğraf seç");
      return;
    }
    const image = draft.image || cardUri(draft.bg, text || kindLabel(create));
    if (create === "hikaye") {
      const ok = store.addFrame({
        id: `me-${Date.now()}`,
        image,
        text: draft.image ? text.slice(0, 140) : "",
        at: Date.now(),
      });
      if (!ok) { toast("Hikaye sığmadı"); return; }
      draft = { bg: CARDS[0], text: "", image: "", blobId: "", videoUrl: "" };
      location.hash = "#/h/bladekv1/0";
      return;
    }
    if (create === "reel") {
      const reel = {
        id: `ur-${Date.now()}`,
        user: ME,
        src: "",
        blobId: draft.blobId || "",
        poster: draft.image || image,
        image,
        caption: text.slice(0, 2200),
        likes: 0,
        at: Date.now(),
        topic: "Sen",
      };
      if (!store.addReel(reel)) { toast("Reel sığmadı"); return; }
      draft = { bg: CARDS[0], text: "", image: "", blobId: "", videoUrl: "" };
      location.hash = `#/reels/${reel.id}`;
      return;
    }
    const post = {
      id: `up-${Date.now()}`,
      user: ME,
      images: [image],
      alt: "Senin gönderin",
      caption: text.slice(0, 2200),
      location: "",
      topic: "Sen",
      likes: 0,
      at: Date.now(),
      likers: [],
      comments: [],
    };
    if (!store.addPost(post)) { toast("Gönderi sığmadı"); return; }
    draft = { bg: CARDS[0], text: "", image: "", blobId: "", videoUrl: "" };
    location.hash = "#/";
    toast("Paylaşıldı");
  }
});

document.body.addEventListener("change", async (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.classList.contains("js-draft-file")) {
    const file = input.files?.[0];
    if (!file) return;
    rememberDraft();
    try {
      if (file.type.startsWith("video/")) {
        if (file.size > 20 * 1024 * 1024) {
          toast("Video 20 MB altında olmalı");
          return;
        }
        const id = `blob-${Date.now()}`;
        await putBlob(id, file);
        draft.blobId = id;
        draft.videoUrl = URL.createObjectURL(file);
        blobUrls.set(id, draft.videoUrl);
        draft.image = "";
      } else if (file.type.startsWith("image/") || file.type === "") {
        draft.image = await compressImage(file, 1080);
        draft.blobId = "";
        draft.videoUrl = "";
      } else {
        toast("JPG, PNG veya MP4 seç");
        return;
      }
      render();
    } catch {
      toast("Bu dosya açılamadı");
    }
  }
  if (input.id === "avatar-file") {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const url = await compressImage(file, 320);
      if (!store.updateProfile({ avatar: url })) {
        toast("Bu fotoğraf sığmadı");
        return;
      }
      render();
    } catch {
      toast("Fotoğraf açılamadı");
    }
  }
});

document.body.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== "edit-form") return;
  event.preventDefault();
  const data = new FormData(form);
  const name = data.get("name")?.toString().trim().slice(0, 40) || null;
  const bio = data.get("bio")?.toString().slice(0, 150) ?? "";
  if (!store.updateProfile({ name, bio })) {
    toast("Profil sığmadı");
    return;
  }
  location.hash = "#/profil";
  toast("Profil güncellendi");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSheet();
  if (!document.querySelector(".story")) return;
  if (event.target instanceof HTMLElement && event.target.matches("input, textarea")) return;
  if (event.key === "ArrowRight") goFrame(1);
  if (event.key === "ArrowLeft") goFrame(-1);
});

document.addEventListener("touchstart", (event) => {
  const frame = event.target.closest?.(".frame");
  if (!frame) return;
  swipe = { id: frame.dataset.id, x: event.touches[0].clientX, y: event.touches[0].clientY };
}, { passive: true });

document.addEventListener("touchend", (event) => {
  if (!swipe) return;
  const dx = event.changedTouches[0].clientX - swipe.x;
  const dy = event.changedTouches[0].clientY - swipe.y;
  if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) shiftCarousel(swipe.id, dx < 0 ? 1 : -1);
  swipe = null;
}, { passive: true });

function syncViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  document.documentElement.style.setProperty("--vvh", `${viewport.height}px`);
  document.documentElement.style.setProperty("--vvtop", `${viewport.offsetTop}px`);
}

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (store.theme() === "system") applyTheme();
});
window.visualViewport?.addEventListener("resize", syncViewport);
window.visualViewport?.addEventListener("scroll", syncViewport);
window.addEventListener("hashchange", render);

async function hydrate() {
  for (const id of store.ownReelBlobs()) {
    try {
      const blob = await getBlob(id);
      if (blob) blobUrls.set(id, URL.createObjectURL(blob));
    } catch { /* keep the reel poster */ }
  }
}

if (!location.hash) history.replaceState(null, "", "#/");
syncViewport();
applyTheme();
hydrate().finally(render);
