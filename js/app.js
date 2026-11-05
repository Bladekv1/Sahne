import { everyone, getUser, suggestions, topics } from "./data.js";
import { esc, formatCount, rich, safeSrc, safeVideo, timeAgo } from "./format.js";
import { icon } from "./icons.js";
import { getBlob, putBlob } from "./media.js";
import { qrMatrix, qrSvg } from "./qr.js";
import * as store from "./store.js";

function me() {
  return store.me();
}

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
let inboxTab = "birincil";
let authView = "login";
let authError = "";
let authDraft = { id: "", name: "", contact: "", username: "", day: "", month: "", year: "" };
let activitySort = "new";
let activitySelect = false;
let activitySection = "";
const activityPicked = new Set();
let qrColor = "#111111";
const QR_COLORS = ["#111111", "#083d75", "#ed4956", "#0b3d2e", "#6b2d5b"];
let storyGen = 0;
let toastTimer = 0;
function blankDraft() {
  return {
    bg: CARDS[0],
    text: "",
    image: "",
    blobId: "",
    videoUrl: "",
    location: "",
    alt: "",
    ai: false,
    useCard: false,
    collaborators: [],
    commentsClosed: false,
  };
}

let draft = blankDraft();
let pinBottom = false;
let searchOpen = false;
let navQuery = "";

const app = document.getElementById("app");
const stage = document.getElementById("stage");
const topbar = document.getElementById("topbar");
const tabbar = document.getElementById("tabbar");
const composer = document.getElementById("composer");
const sidenav = document.getElementById("sidenav");
const rail = document.getElementById("rail");
const searchpop = document.getElementById("searchpop");
const modal = document.getElementById("modal");

function isDesktop() {
  return matchMedia("(min-width: 1024px)").matches;
}

function safeId(value) {
  const id = String(value ?? "");
  return /^[a-z0-9._-]{1,64}$/i.test(id) ? id : "";
}

function route() {
  const hash = location.hash || "#/";
  let path = hash.slice(1);
  if (!path.startsWith("/")) path = `/${path}`;
  const parts = path.split("/").filter(Boolean).map((part) => {
    try { return safeId(decodeURIComponent(part)); } catch { return ""; }
  }).filter(Boolean);
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
  const safe = safeId(id);
  if (!safe || safe === me()) return "#/profil";
  return `#/u/${safe}`;
}

function safeHash(href) {
  const value = String(href ?? "");
  return /^#\/[a-z0-9._/-]*$/i.test(value) && value.length <= 120 ? value : "#/";
}

function sideNav(r) {
  const mail = store.unreadTotal();
  const items = [
    ["#/", "akis", "Ana sayfa", r.head === "akis" ? "homeFill" : "home"],
    ["search", "ara", "Ara", "search"],
    ["#/kesfet", "kesfet", "Keşfet", "compass"],
    ["#/reels", "reels", "Reels", r.head === "reels" ? "reelsFill" : "reels"],
    ["#/mesaj", "mesaj", "Mesajlar", "send"],
    ["#/bildirim", "bildirim", "Bildirimler", r.head === "bildirim" ? "heartFill" : "heart"],
    ["#/yeni", "yeni", "Oluştur", "plus"],
    ["#/profil", "profil", "Profil", ""],
  ];
  const links = items.map(([href, id, label, glyph]) => {
    const on = id === "ara" ? searchOpen : id === "profil" ? r.head === "profil" : r.head === id;
    const current = on ? ' aria-current="page"' : "";
    const badge = id === "mesaj" && mail ? `<i class="nav-count count">${mail}</i>` : "";
    const dot = id === "bildirim" && store.activityPending() ? `<i class="dot"></i>` : "";
    const graphic = id === "profil" ? avatar(getUser(me()), 24) : icon(glyph);
    if (id === "ara") {
      return `<button type="button" class="${searchOpen ? "on" : ""}" data-act="toggle-search" aria-label="${label}" aria-pressed="${searchOpen}">${graphic}<span class="label">${label}</span></button>`;
    }
    return `<a href="${href}" aria-label="${label}"${current} class="${on ? "on" : ""}">${graphic}${badge}${dot}<span class="label">${label}</span></a>`;
  }).join("");
  return `<a class="nav-logo" href="#/" aria-label="Bladekv1"><svg class="logo-mark" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="2.2" y="2.2" width="19.6" height="19.6" rx="6" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="12" y="16.2" text-anchor="middle" font-family="Georgia, serif" font-size="12" font-style="italic" fill="currentColor">B</text></svg><span class="logo-word">Bladekv1</span></a>${links}<button type="button" class="nav-end" data-act="profile-menu" aria-label="Daha fazla">${icon("menu")}<span class="label">Daha fazla</span></button>`;
}

function searchResultHtml() {
  const q = navQuery.trim();
  const folded = q.toLocaleLowerCase("tr-TR");
  const people = everyone().filter((user) => user.id !== me() && (!folded || `${user.id} ${user.name}`.toLocaleLowerCase("tr-TR").includes(folded))).slice(0, 8);
  const posts = q ? store.allPosts().filter((post) => matches(post, q)).slice(0, 6) : [];
  const peopleHtml = people.length
    ? people.map((user) => `<a class="person" href="${profileHref(user.id)}">${avatar(user, 44)}<span class="copy"><strong>${esc(user.id)}</strong><small>${esc(user.name)}</small></span></a>`).join("")
    : `<p class="empty">Hesap yok.</p>`;
  const postsHtml = posts.map((post) => {
    const src = safeSrc(post.images?.[0] || "");
    return `<a class="search-post" href="#/g/${esc(post.id)}">${src ? `<img src="${src}" alt="">` : ""}<span>${esc(post.caption || post.location || "Gönderi")}</span></a>`;
  }).join("");
  return `${q ? "" : `<h2 class="section-label">Son aramalar</h2>`}${peopleHtml}${postsHtml ? `<h2 class="section-label">Gönderiler</h2>${postsHtml}` : ""}`;
}

function railHtml() {
  const self = getUser(me());
  const people = suggestions.map((id) => getUser(id)).filter(Boolean);
  return `<div class="rail-me">${avatar(self, 44)}<a href="#/profil"><strong>${esc(self.id)}</strong><small>${esc(store.displayName(self))}</small></a><a class="rail-switch" href="#/profil">Profil</a></div>
    <div class="rail-head"><span>Senin için önerilenler</span><a href="#/kesfet">Tümünü gör</a></div>
    ${people.map((user) => {
      const on = store.isFollowing(user.id);
      return `<div class="rail-person">${avatar(user, 32)}<a href="${profileHref(user.id)}"><strong>${esc(user.id)}</strong><small>Senin için öneriliyor</small></a><button type="button" class="follow-btn${on ? " following" : ""}" data-act="follow" data-follow="${user.id}" data-user="${user.id}" aria-pressed="${on}">${on ? "Takiptesin" : "Takip Et"}</button></div>`;
    }).join("")}
    <p class="rail-foot">Bladekv1 · beğeniler ve mesajlar bu cihazda kalır</p>`;
}

function tabBar(r) {
  const items = [
    ["#/", "akis", "Akış", r.head === "akis" ? "homeFill" : "home"],
    ["#/reels", "reels", "Reels", r.head === "reels" ? "reelsFill" : "reels"],
    ["#/yeni", "yeni", "Oluştur", "plus"],
    ["#/kesfet", "kesfet", "Keşfet", "search"],
    ["#/profil", "profil", "Profil", ""],
  ];
  return items.map(([href, id, label, glyph]) => {
    const on = r.head === id;
    const current = on ? ' aria-current="page"' : "";
    const graphic = id === "profil" ? avatar(getUser(me()), 24) : icon(glyph);
    const klass = id === "yeni" ? ' class="create"' : "";
    return `<a href="${href}" aria-label="${label}"${current}${klass}>${graphic}<span class="sr">${label}</span></a>`;
  }).join("");
}

function subBar(title, href) {
  return `<a class="icon-btn" href="${esc(safeHash(href))}" aria-label="Geri">${icon("back")}</a><h1>${esc(title)}</h1><span></span>`;
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
    topbar.innerHTML = `<span></span><h1>${esc(me())}</h1><button type="button" class="icon-btn" data-act="new-message" aria-label="Yeni mesaj">${icon("send")}</button>`;
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
    const id = r.head === "profil" ? me() : r.parts[1];
    const user = getUser(id);
    topbar.classList.add("sub");
    if (!user) {
      topbar.innerHTML = subBar("Profil", "#/");
      return;
    }
    const back = r.head === "u"
      ? `<a class="icon-btn" href="#/" aria-label="Geri">${icon("back")}</a>`
      : `<a class="icon-btn" href="#/yeni" aria-label="Oluştur">${icon("plus")}</a>`;
    const menu = user.id === me()
      ? `<button type="button" class="icon-btn" data-act="profile-menu" aria-label="Menü">${icon("menu")}</button>`
      : `<button type="button" class="icon-btn" data-act="more" data-user="${esc(user.id)}" aria-label="Diğer">${icon("more")}</button>`;
    topbar.innerHTML = `${back}<strong class="handle">${esc(user.id)}</strong>${menu}`;
    return;
  }
  const titles = {
    g: ["Gönderi", "#/"],
    bildirim: ["Bildirimler", "#/"],
    duzenle: ["Profili düzenle", "#/profil"],
    ayarlar: ["Ayarlar ve hareketler", "#/profil"],
    pano: ["Panon", "#/profil"],
    kaydedilenler: ["Kaydedilenler", "#/profil"],
    arsiv: ["Arşiv", "#/profil"],
    hareket: ["Hareketlerin", "#/profil"],
    girisler: ["Giriş hareketleri", "#/profil"],
    b: ["Beğenenler", safeId(r.parts[1]) ? `#/g/${safeId(r.parts[1])}` : "#/"],
    takipci: ["Takipçi", profileHref(safeId(r.parts[1]) || me())],
    takip: ["Takip", profileHref(safeId(r.parts[1]) || me())],
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
    ${postExtras(post)}
    ${linkComments ? commentLink : ""}
    <time datetime="${new Date(post.at).toISOString()}">${timeAgo(post.at)}</time>
  </article>`;
}

function postExtras(post) {
  const people = (post.collaborators || []).map((id) => safeId(id)).filter((id) => id && id !== post.user);
  const together = people.length
    ? `<p class="caption collab">Birlikte ${people.map((id) => `<a href="${profileHref(id)}">${esc(id)}</a>`).join(", ")}</p>`
    : "";
  const ai = post.ai ? `<p class="caption ai-note">AI ile oluşturuldu</p>` : "";
  return `${together}${ai}`;
}

function storyStrip() {
  return `<div class="stories">${store.storyRow().map((pack) => {
    const user = getUser(pack.owner);
    if (!user) return "";
    const seen = store.storySeen(pack) ? "seen" : "";
    const mine = pack.user === me();
    return `<div class="story-slot"><a href="#/h/${pack.user}/${store.firstUnseen(pack)}" aria-label="${esc(mine ? "Hikayen" : user.name)}"><span class="ring ${seen}">${avatar(user, 56)}</span><b>${mine ? "Hikayen" : esc(user.id)}</b></a>${mine ? `<a class="add-badge" href="#/yeni/hikaye" aria-label="Hikaye ekle">${icon("plus")}</a>` : ""}</div>`;
  }).join("")}</div>`;
}

function feedScreen() {
  const cards = store.allPosts().map((post, index) => postCard(post, true).replace(
    index > 1 ? 'loading="eager"' : 'loading="eager"',
    index > 1 ? 'loading="lazy"' : 'loading="eager"',
  ));
  const people = suggestions.map((id) => getUser(id)).filter(Boolean);
  return `<p class="desk-label">Takip ettiklerin</p>${storyStrip()}${cards.join("")}<section class="suggest"><h2>Senin için</h2><div class="scards">${people.map((user) => {
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
    const follow = user.id === me() ? "" : `<button type="button" class="follow-btn${store.isFollowing(user.id) ? " following" : ""}" data-act="follow" data-follow="${user.id}" data-user="${user.id}">${store.isFollowing(user.id) ? "Takiptesin" : "Takip et"}</button>`;
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

function noteSlot(user, label, extra) {
  const note = store.noteOf(user);
  const bubble = `<span class="note-bubble">${esc(note || "Not ekle")}</span>`;
  return `<${extra.tag} class="note-slot" ${extra.attrs}><span class="note-face">${bubble}${avatar(user, 56)}</span><b>${esc(label)}</b></${extra.tag}>`;
}

function notesRow() {
  const self = getUser(me());
  const people = everyone().filter((user) => user.id !== me() && store.noteOf(user));
  const mine = noteSlot(self, "Notun", { tag: "button", attrs: `type="button" data-act="edit-note"` });
  const rest = people.map((user) => noteSlot(user, user.name.split(" ")[0], { tag: "a", attrs: `href="${profileHref(user.id)}"` })).join("");
  return `<div class="notes">${mine}${rest}</div>`;
}

function inboxRows() {
  const q = inboxQuery.toLocaleLowerCase("tr-TR");
  const threads = store.inbox().filter((item) => !q || `${item.user.id} ${item.user.name} ${item.last.text}`.toLocaleLowerCase("tr-TR").includes(q));
  const known = new Set(threads.map((item) => item.user.id));
  const primary = threads.filter((item) => store.isFollowing(item.user.id) || item.user.followerIds?.includes(me()));
  const general = threads.filter((item) => !primary.includes(item));
  const requests = everyone().filter((user) => user.id !== me() && !known.has(user.id) && !store.isFollowing(user.id) && (!q || `${user.id} ${user.name}`.toLocaleLowerCase("tr-TR").includes(q)));
  const line = (item) => `<a class="thread${item.unread ? " unread" : ""}" href="#/mesaj/${item.user.id}">${avatar(item.user, 56, true)}<span class="copy"><strong>${esc(item.user.name)}</strong><em>${esc(item.last.text)}</em></span><time>${timeAgo(item.last.at)}</time>${item.unread ? `<i class="unread-pip"></i>` : ""}</a>`;
  const body = inboxTab === "istekler"
    ? (requests.length ? requests.map((user) => `<a class="thread" href="#/mesaj/${user.id}">${avatar(user, 56)}<span class="copy"><strong>${esc(user.name)}</strong><em>Mesaj isteği</em></span></a>`).join("") : `<p class="empty">İstek yok.</p>`)
    : (inboxTab === "genel" ? general : primary).map(line).join("") || `<p class="empty">Bu kutuda mesaj yok.</p>`;
  const badge = primary.filter((item) => item.unread).length;
  const tabs = ["birincil", "istekler", "genel"].map((id) => {
    const label = id === "birincil" ? "Birincil" : id === "istekler" ? "İstekler" : "Genel";
    const count = id === "birincil" && badge ? `<i class="count">${badge}</i>` : "";
    return `<button type="button" data-act="inbox-tab" data-tab="${id}" class="${inboxTab === id ? "on" : ""}">${label}${count}</button>`;
  }).join("");
  return `<div class="inbox-tabs">${tabs}</div>${body}`;
}

function inboxScreen() {
  return `${notesRow()}<input id="inbox-q" class="inbox-search" type="search" placeholder="Ara" value="${esc(inboxQuery)}" aria-label="Mesajlarda ara" autocomplete="off"><div id="inbox-list">${inboxRows()}</div>`;
}

function chatScreen(id) {
  const user = getUser(id);
  if (!user) return missing("Bu sohbet yok.");
  store.markRead(id);
  const bubbles = store.messagesFor(id).map((message) => `<div class="bubble ${message.from === me() ? "me" : "them"}">${esc(message.text)}<time>${timeAgo(message.at)}</time></div>`).join("");
  return `<div class="chat">${bubbles}</div>`;
}

function personRow(user, mode) {
  const follow = user.id === me() ? "" : `<button type="button" class="follow-btn${store.isFollowing(user.id) ? " following" : ""}" data-act="follow" data-follow="${user.id}" data-user="${user.id}" aria-pressed="${store.isFollowing(user.id)}">${store.isFollowing(user.id) ? "Takiptesin" : "Takip et"}</button>`;
  const href = mode === "message" ? `#/mesaj/${user.id}` : profileHref(user.id);
  return `<div class="person">${avatar(user, 48, true)}<a class="copy" href="${href}"><strong>${esc(user.id)}</strong><small>${esc(user.name)}</small></a>${mode === "message" ? "" : follow}</div>`;
}

function profileScreen(id, tab) {
  const user = getUser(id);
  if (!user) return missing("Bu hesap yok.");
  const base = user.id === me() ? "#/profil" : `#/u/${user.id}`;
  const posts = store.postsBy(user.id);
  const reels = store.reelsBy(user.id);
  const tagged = store.tagged(user.id);
  const pack = store.packFor(user.id);
  const photo = pack
    ? `<a href="#/h/${pack.user}/${store.firstUnseen(pack)}" aria-label="Hikaye"><span class="ring ${store.storySeen(pack) ? "seen" : ""}">${avatar(user, 86)}</span></a>`
    : avatar(user, 86);
  const actions = user.id === me()
    ? `<a class="btn" href="#/duzenle">Profili düzenle</a><button type="button" class="btn" data-act="qr-open">Profili paylaş</button>`
    : `<button type="button" class="btn primary follow-btn${store.isFollowing(user.id) ? " following" : ""}" data-act="follow" data-follow="${user.id}" data-user="${user.id}">${store.isFollowing(user.id) ? "Takiptesin" : "Takip et"}</button><a class="btn" href="#/mesaj/${user.id}">Mesaj</a>`;
  const lights = store.highlightsFor(user.id).map((item) => `<a href="#/h/${item.id}/0"><span class="hl"><img src="${safeSrc(item.cover)}" alt=""></span>${esc(item.title)}</a>`).join("");
  const addLight = user.id === me() ? `<a href="#/yeni/hikaye"><span class="hl add">${icon("plus")}</span>Yeni</a>` : "";
  const body = tab === "reels"
    ? reelGrid(reels)
    : tab === "etiket"
      ? photoGrid(tagged)
      : photoGrid(posts);
  if (isDesktop()) return desktopProfile(user, photo, actions, addLight, lights, base, tab, body);
  const note = store.noteOf(user);
  const pronouns = store.pronounsOf(user);
  const category = store.categoryOf(user);
  const link = safeHttp(store.linkOf(user));
  const likes = posts.reduce((sum, post) => sum + store.likeCount(post), 0);
  const panel = user.id === me()
    ? `<a class="panon" href="#/pano"><strong>Panon</strong><span>Gönderilerin ${formatCount(likes)} beğenme aldı.</span></a>`
    : "";
  const locked = user.id === me() && store.isPrivate() ? `<p class="hint">Gizli hesap</p>` : "";
  return `<section class="profile-top"><div class="profile-ava">${note ? `<span class="note-bubble">${esc(note)}</span>` : ""}${photo}</div><div><div class="name-line"><strong>${esc(store.displayName(user))}</strong>${pronouns ? `<span>${esc(pronouns)}</span>` : ""}</div><ul class="stats"><li><strong>${formatCount(posts.length)}</strong><span>gönderi</span></li><li><a href="#/takipci/${user.id}"><strong>${formatCount(store.followerCount(user))}</strong><span>takipçi</span></a></li><li><a href="#/takip/${user.id}"><strong>${formatCount(store.followingCount(user))}</strong><span>takip</span></a></li></ul></div></section>
    <div class="bio">${category ? `<b class="category">${esc(category)}</b>` : ""}${locked}<p>${esc(store.bioOf(user))}</p>${link ? `<a class="profile-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(link.replace(/^https?:\/\//, ""))}</a>` : ""}</div>
    ${panel}
    <div class="row-btns">${actions}</div>
    <div class="highlights">${addLight}${lights}</div>
    <nav class="ptabs">
      <a href="${base}" class="${tab === "grid" ? "on" : ""}" aria-label="Gönderiler">${icon("grid")}</a>
      <a href="${base}/reels" class="${tab === "reels" ? "on" : ""}" aria-label="Reels">${icon("reels")}</a>
      <a href="${base}/etiket" class="${tab === "etiket" ? "on" : ""}" aria-label="Etiketlenenler">${icon("tag")}</a>
    </nav>
    ${body}`;
}

function desktopProfile(user, photo, _actions, addLight, lights, base, tab, body) {
  const pronouns = store.pronounsOf(user);
  const category = store.categoryOf(user);
  const link = safeHttp(store.linkOf(user));
  const locked = user.id === me() && store.isPrivate() ? `<p class="hint">Gizli hesap</p>` : "";
  const buttons = user.id === me()
    ? `<a class="btn" href="#/duzenle">Profili düzenle</a><a class="btn" href="#/arsiv">Arşivi gör</a>`
    : `<button type="button" class="btn primary follow-btn${store.isFollowing(user.id) ? " following" : ""}" data-act="follow" data-follow="${user.id}" data-user="${user.id}">${store.isFollowing(user.id) ? "Takiptesin" : "Takip et"}</button><a class="btn" href="#/mesaj/${user.id}">Mesaj</a>`;
  const bio = esc(store.bioOf(user)).replaceAll("\n", "<br>");
  return `<header class="desk-profile"><div class="desk-ava">${photo}</div><div>
      <h1>${esc(user.id)}</h1>
      <ul class="desk-stats"><li><strong>${formatCount(store.postsBy(user.id).length)}</strong> gönderi</li><li><a href="#/takipci/${user.id}"><strong>${formatCount(store.followerCount(user))}</strong> takipçi</a></li><li><a href="#/takip/${user.id}"><strong>${formatCount(store.followingCount(user))}</strong> takip</a></li></ul>
      <div class="desk-bio"><strong>${esc(store.displayName(user))}</strong>${pronouns ? ` <span>${esc(pronouns)}</span>` : ""}${category ? `<b class="category">${esc(category)}</b>` : ""}${locked}<p>${bio}</p>${link ? `<a class="profile-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(link.replace(/^https:\/\//, ""))}</a>` : ""}</div>
    </div></header>
    <div class="desk-actions">${buttons}</div>
    <div class="highlights desk-highlights">${addLight}${lights}</div>
    <nav class="ptabs">
      <a href="${base}" class="${tab === "grid" ? "on" : ""}" aria-label="Gönderiler">${icon("grid")}</a>
      <a href="${base}/reels" class="${tab === "reels" ? "on" : ""}" aria-label="Reels">${icon("reels")}</a>
      <a href="${base}/etiket" class="${tab === "etiket" ? "on" : ""}" aria-label="Etiketlenenler">${icon("tag")}</a>
    </nav>
    ${body}`;
}

function activityTools(canSelect) {
  const label = activitySort === "new" ? "En yeniden en eskiye" : "En eskiden en yeniye";
  const picked = activityPicked.size;
  const apply = canSelect && picked ? `<button type="button" data-act="act-apply">Uygula (${picked})</button>` : "";
  const select = canSelect ? `<button type="button" data-act="act-select-mode">${activitySelect ? "Vazgeç" : "Seç"}</button>` : "";
  return `<div class="activity-tools"><button type="button" data-act="act-sort">${label}</button><span>${apply}${select}</span></div>`;
}

function activityTiles(items) {
  if (!items.length) return "";
  return `<div class="grid activity-grid">${items.map((item) => {
    const src = safeSrc(item.images?.[0] || item.poster || item.image || "");
    const id = esc(item.id);
    if (activitySelect) {
      const picked = activityPicked.has(item.id);
      return `<button type="button" class="tile-btn${picked ? " picked" : ""}" data-act="act-pick" data-id="${id}">${src ? `<img src="${src}" alt="">` : ""}${picked ? `<i class="pick-mark"></i>` : ""}</button>`;
    }
    const href = item.src ? `#/reels/${id}` : `#/g/${id}`;
    return `<a href="${href}">${src ? `<img src="${src}" alt="">` : ""}${tileMeta(item)}</a>`;
  }).join("")}</div>`;
}

function orderBy(items) {
  return activitySort === "old" ? [...items].reverse() : items;
}

function activityScreen(section) {
  const key = ["yorum", "paylasim", "hikaye", "deger", "gonderi", "reel", "one", "gecmis"].includes(section) ? section : "begeni";
  const group = ["gonderi", "reel", "one"].includes(key) ? "media" : key === "gecmis" ? "history" : "social";
  const side = [
    ["social", "#/hareket", "Etkileşimler", "Beğenmeler, yorumlar ve diğer etkileşimlerin gözden geçir.", "heart"],
    ["media", "#/hareket/gonderi", "Fotoğraflar ve videolar", "Paylaştığın fotoğrafları ve videoları görüntüle veya arşivle.", "grid"],
    ["history", "#/hareket/gecmis", "Hesap geçmişi", "Hesabında yaptığın değişiklikleri gözden geçir.", "clock"],
  ].map(([id, href, title, text, glyph]) => `<a href="${href}" class="${group === id ? "on" : ""}">${icon(glyph)}<span><strong>${title}</strong><small>${text}</small></span></a>`).join("");
  let tabs = "";
  let tools = "";
  let body = "";
  if (group === "social") {
    const tabDefs = [
      ["begeni", "Beğenmeler", "#/hareket"],
      ["yorum", "Yorumlar", "#/hareket/yorum"],
      ["paylasim", "Yeniden paylaşılanlar", "#/hareket/paylasim"],
      ["hikaye", "Hikaye yanıtları", "#/hareket/hikaye"],
      ["deger", "Değerlendirmeler", "#/hareket/deger"],
    ];
    tabs = `<nav class="activity-tabs">${tabDefs.map(([id, label, href]) => `<a href="${href}" class="${key === id ? "on" : ""}">${label}</a>`).join("")}</nav>`;
    if (key === "begeni") {
      const items = orderBy(store.likedMedia());
      tools = activityTools(true);
      body = items.length ? activityTiles(items) : `<p class="activity-empty">Beğenme yok.</p>`;
    } else if (key === "yorum") {
      const rows = orderBy(store.ownComments());
      tools = activityTools(false);
      body = rows.length ? rows.map((comment) => {
        const src = safeSrc(comment.image);
        const href = comment.reel ? `#/reels/${comment.postId}` : `#/g/${comment.postId}`;
        return `<a class="act-row" href="${href}">${avatar(getUser(me()), 44)}<span class="copy"><strong>${esc(me())}</strong><em>${esc(comment.text)}</em><time>${timeAgo(comment.at)}</time></span>${src ? `<img src="${src}" alt="">` : ""}</a>`;
      }).join("") : `<p class="activity-empty">Yorum yok.</p>`;
    } else if (key === "hikaye") {
      const rows = orderBy(store.storyReplies());
      tools = activityTools(false);
      body = rows.length ? rows.map((item) => {
        const user = getUser(item.user);
        return `<div class="act-row">${user ? avatar(user, 44) : ""}<span class="copy"><strong>${esc(item.user)}</strong><em>${esc(item.text)}</em><time>${timeAgo(item.at)}</time></span></div>`;
      }).join("") : `<p class="activity-empty">Hikaye yanıtı yok.</p>`;
    } else if (key === "paylasim") {
      body = `<p class="activity-empty">Yeniden paylaşım yok.</p>`;
    } else {
      body = `<p class="activity-empty">Değerlendirme hareketi yok.</p>`;
    }
  } else if (group === "media") {
    const tabDefs = [
      ["gonderi", "Gönderiler", "#/hareket/gonderi"],
      ["reel", "Reels", "#/hareket/reel"],
      ["one", "Öne çıkanlar", "#/hareket/one"],
    ];
    tabs = `<nav class="activity-tabs">${tabDefs.map(([id, label, href]) => `<a href="${href}" class="${key === id ? "on" : ""}">${label}</a>`).join("")}</nav>`;
    if (key === "one") {
      const lights = store.highlightsFor(me());
      body = lights.length ? `<div class="highlights desk-highlights">${lights.map((item) => `<a href="#/h/${item.id}/0"><span class="hl"><img src="${safeSrc(item.cover)}" alt=""></span>${esc(item.title)}</a>`).join("")}</div>` : `<p class="activity-empty">Öne çıkan yok.</p>`;
    } else {
      const items = orderBy(key === "reel" ? store.reelsBy(me()) : store.postsBy(me()));
      tools = activityTools(key === "gonderi");
      body = items.length ? activityTiles(items) : `<p class="activity-empty">Burada henüz bir şey yok.</p>`;
    }
  } else {
    const items = store.accountHistory();
    const year = new Date().getFullYear();
    const groups = [["Bu yıl", items.filter((item) => new Date(item.at).getFullYear() === year)], ["Daha öncekiler", items.filter((item) => new Date(item.at).getFullYear() !== year)]];
    const when = (at) => (Date.now() - at > 28 * 86400000 ? new Date(at).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }) : timeAgo(at));
    body = groups.filter(([, list]) => list.length).map(([title, list]) => `<h2 class="history-year">${title}</h2>${list.map((item) => `<div class="history-row"><strong>${esc(item.label)}</strong><span>${esc(item.detail)}</span><time>${when(item.at)}</time></div>`).join("")}`).join("") || `<p class="activity-empty">Hesap geçmişi yok.</p>`;
  }
  return `<section class="activity-box"><aside class="activity-side"><h1>Hareketlerin</h1>${side}</aside><div class="activity-main">${tabs}${tools}${body}</div></section>`;
}

function tileMeta(item) {
  return `<span class="tile-meta">${icon("heartFill")} ${formatCount(store.likeCount(item))} ${icon("comment")} ${formatCount(store.commentsFor(item).length)}</span>`;
}

function photoGrid(items) {
  if (!items.length) return `<p class="empty">Burada henüz bir şey yok.</p>`;
  return `<div class="grid">${items.map((post) => {
    const src = safeSrc(post.images?.[0] || "");
    return `<a href="#/g/${post.id}">${src ? `<img src="${src}" alt="${esc(post.alt || "")}" loading="lazy">` : ""}${tileMeta(post)}</a>`;
  }).join("")}</div>`;
}

function reelGrid(items) {
  if (!items.length) return `<p class="empty">Henüz reel yok.</p>`;
  return `<div class="grid">${items.map((reel) => {
    const src = safeSrc(reel.poster || reel.image || "");
    return `<a class="reel-tile" href="#/reels/${reel.id}">${src ? `<img src="${src}" alt="">` : ""}<span class="play-badge">${icon("play")}</span>${tileMeta(reel)}</a>`;
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
  const list = post.commentsClosed
    ? `<p class="hint">Yorumlar kapalı.</p>`
    : comments.length
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

function choiceLinks() {
  return `<a class="choice" href="#/yeni/gonderi">Gönderi<small>Fotoğraf ya da renkli kart</small></a>
    <a class="choice" href="#/yeni/hikaye">Hikaye<small>Bir kare, birkaç saniye</small></a>
    <a class="choice" href="#/yeni/reel">Reel<small>Fotoğrafı kaydır ya da video seç</small></a>`;
}

function choiceScreen() {
  return `<div class="choices">${choiceLinks()}</div>`;
}

function swatchRow() {
  return CARDS.map((color) => `<button type="button" data-act="swatch" data-bg="${color}" class="${draft.bg === color && draft.useCard && !draft.image ? "on" : ""}" style="background:${color}" aria-label="Renk"></button>`).join("");
}

function postComposer() {
  const self = getUser(me());
  const photo = safeSrc(draft.image || "");
  const preview = draft.videoUrl
    ? `<video src="${draft.videoUrl}" muted playsinline autoplay loop></video>`
    : photo
      ? `<img src="${photo}" alt="">`
      : draft.useCard
        ? `<img src="${cardUri(draft.bg, draft.text || "yeni gönderi")}" alt="">`
        : `<div class="drop-empty">${icon("camera")}<p>Fotoğrafları buraya sürükle</p><label class="btn primary">Bilgisayardan seç<input class="js-draft-file sr" type="file" accept="image/*"></label><label class="btn cam-btn">Kamera<input class="js-draft-file sr" type="file" accept="image/*" capture="environment"></label></div>`;
  const tag = photo ? `<button type="button" class="tag-chip" data-act="tag-people">İnsanları etiketlemek için fotoğrafa tıkla</button>` : "";
  const change = photo || draft.videoUrl || draft.useCard
    ? `<label class="change-photo">Değiştir<input class="js-draft-file sr" type="file" accept="image/*"></label>`
    : "";
  const names = (draft.collaborators || []).map((id) => safeId(id)).filter(Boolean);
  const count = (draft.text || "").length.toLocaleString("tr-TR");
  return `<a class="create-backdrop" href="#/" aria-label="Kapat"></a>
    <form class="composer-page create-form" data-kind="create" data-create="gonderi">
      <div class="create-head"><a class="icon-btn" href="#/yeni" aria-label="Geri">${icon("back")}</a><h1>Yeni gönderi oluştur</h1><button class="share-btn" type="submit">Paylaş</button></div>
      <div class="create-split">
        <div class="create-stage${photo ? " has-photo" : ""}"><div class="preview">${preview}${tag}${change}</div><div class="swatches mobile-swatches">${swatchRow()}</div></div>
        <div class="create-meta">
          <a class="who" href="#/profil">${avatar(self, 32)}<strong>${esc(self.id)}</strong></a>
          <textarea id="draft-text" class="caption-box" name="text" maxlength="2200" placeholder="Bir açıklama ekle...">${esc(draft.text)}</textarea>
          <div class="char-count"><span id="char-count">${count}</span>/2.200</div>
          <input class="meta-field" name="location" maxlength="80" placeholder="Konum ekle" value="${esc(draft.location || "")}" autocomplete="off">
          <button type="button" class="meta-btn" data-act="pick-collab">Katkıda bulunanlar ekle${names.length ? `<small>${esc(names.join(", "))}</small>` : ""}</button>
          <label class="ai-row"><span><strong>AI etiketi ekle</strong><p>Bu etiket, AI ile oluşturulan gerçekçi fotoğraf ve videolar için. İnsanlar gönderide bunu görür.</p></span><input class="switch" type="checkbox" name="ai" ${draft.ai ? "checked" : ""} aria-label="AI etiketi"></label>
          <details><summary>Erişilebilirlik</summary><input class="meta-field" name="alt" maxlength="200" placeholder="Alt metin yaz" value="${esc(draft.alt || "")}"></details>
          <details><summary>Şurada paylaş</summary><p>Gönderi Bladekv1 akışında paylaşılır.</p></details>
          <details><summary>Gelişmiş ayarlar</summary><label class="check-row"><span>Yorumları kapat</span><input class="switch" type="checkbox" name="commentsClosed" ${draft.commentsClosed ? "checked" : ""}></label></details>
        </div>
      </div>
      <button class="btn primary share-bottom" type="submit" style="width:100%;margin-top:12px">Paylaş</button>
    </form>`;
}

function createScreen(kind) {
  if (kind === "gonderi") return postComposer();
  const preview = draft.videoUrl
    ? `<video src="${draft.videoUrl}" muted playsinline autoplay loop></video>`
    : draft.image
      ? `<img src="${safeSrc(draft.image)}" alt="">`
      : `<img src="${cardUri(draft.bg, draft.text || kindLabel(kind))}" alt="">`;
  const capture = kind === "reel" ? "" : `<label class="btn">Kamera<input class="js-draft-file sr" type="file" accept="image/*" capture="environment"></label>`;
  const accept = kind === "reel" ? "image/*,video/mp4,video/quicktime" : "image/*";
  return `<form class="composer-page" data-kind="create" data-create="${esc(kind)}">
    <div class="preview">${preview}</div>
    <div class="swatches">${swatchRow()}</div>
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

function safeHttp(value) {
  const url = String(value || "").trim();
  return /^https:\/\/[\w.-]+(?:\/[\w./#?&=%+-]*)?$/i.test(url) ? url : "";
}

function profileUrl() {
  const url = new URL(location.href);
  url.hash = `#/u/${me()}`;
  return url.toString();
}

function editScreen() {
  const user = getUser(me());
  return `<form id="edit-form" class="form-page">
    <div class="edit-ava">${avatar(user, 86)}<label class="btn">Resmi veya avatarı düzenle<input id="avatar-file" class="sr" type="file" accept="image/*"></label></div>
    <label>Adı<input name="name" type="text" maxlength="40" value="${esc(store.displayName(user))}"></label>
    <label>Kullanıcı adı<input type="text" value="${esc(user.id)}" readonly></label>
    <label>Hitaplar<input name="pronouns" type="text" maxlength="20" value="${esc(store.pronounsOf(user))}"></label>
    <label>Biyografi<textarea name="bio" maxlength="150">${esc(store.bioOf(user))}</textarea></label>
    <label>Bağlantı<input name="link" type="url" inputmode="url" maxlength="120" placeholder="https://" value="${esc(store.linkOf(user))}"></label>
    <label>Not<input name="note" type="text" maxlength="60" value="${esc(store.noteOf(user))}"></label>
    <button class="btn primary" type="submit" style="width:100%">Bitti</button>
  </form>`;
}

function themeLabel() {
  const current = store.theme();
  if (current === "light") return "Aydınlık";
  if (current === "dark") return "Karanlık";
  return "Sistem";
}

function settingsScreen() {
  const sections = [
    ["Hesabın", [
      ["#/duzenle", "Profili düzenle", ""],
      ["#/kaydedilenler", "Kaydedilenler", ""],
    ]],
    ["Bu telefon", [
      ["theme", "Görünüm", themeLabel()],
      ["private", store.isPrivate() ? "Hesap gizliliği" : "Hesap gizliliği", store.isPrivate() ? "Gizli" : "Herkese açık"],
    ]],
    ["İçerik", [
      ["#/bildirim", "Bildirimler", ""],
      ["#/mesaj", "Mesajlar", ""],
    ]],
    ["Daha fazla bilgi", [
      ["about", "Hakkında", ""],
    ]],
  ];
  const blocks = sections.map(([title, rows]) => {
    const body = rows.map(([href, label, value]) => {
      const tail = `${value ? `<span class="val">${esc(value)}</span>` : ""}${icon("chevron")}`;
      if (href.startsWith("#/")) return `<a class="set-row" href="${href}"><span class="grow">${esc(label)}</span>${tail}</a>`;
      return `<button type="button" class="set-row" data-act="setting" data-setting="${href}"><span class="grow">${esc(label)}</span>${tail}</button>`;
    }).join("");
    return `<h2 class="settings-sec">${esc(title)}</h2>${body}`;
  }).join("");
  return `<input id="settings-q" class="inbox-search" type="search" placeholder="Ara" aria-label="Ayarlarda ara" autocomplete="off">${blocks}
    <h2 class="settings-sec">Giriş</h2>
    <button type="button" class="set-row account" data-act="new-account"><span class="grow">Hesap ekle</span></button>
    <a class="set-row" href="#/girisler"><span class="grow">Giriş hareketleri</span>${icon("chevron")}</a>
    <button type="button" class="set-row" data-act="add-account"><span class="grow">Hesap değiştir</span></button>
    <button type="button" class="set-row danger" data-act="logout-ask"><span class="grow">Çıkış yap</span></button>
    <button type="button" class="set-row danger" data-act="reset-ask"><span class="grow">Verileri sil</span></button>`;
}

function missing(text) {
  return `<p class="empty">${esc(text)}</p>`;
}

function screen(r) {
  if (r.head === "h") return storyScreen(r.parts[1], Number(r.parts[2] || 0));
  if (r.head === "kesfet") return exploreScreen();
  if (r.head === "reels") return reelsScreen(r.parts[1] || "");
  if (r.head === "mesaj") return r.parts[1] ? chatScreen(r.parts[1]) : inboxScreen();
  if (r.head === "profil") return profileScreen(me(), r.parts[1] === "reels" || r.parts[1] === "etiket" ? r.parts[1] : "grid");
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
  if (r.head === "yeni") {
    if (isDesktop() && (!r.parts[1] || r.parts[1] === "gonderi")) return feedScreen();
    return r.parts[1] ? createScreen(r.parts[1]) : choiceScreen();
  }
  if (r.head === "duzenle") return editScreen();
  if (r.head === "ayarlar") return settingsScreen();
  if (r.head === "pano") {
    const posts = store.postsBy(me());
    const likes = posts.reduce((sum, post) => sum + store.likeCount(post), 0);
    return `<div class="panon page"><strong>Panon</strong><p>${formatCount(posts.length)} gönderi</p><p>${formatCount(likes)} beğenme</p><p>${formatCount(store.followerCount(getUser(me())))} takipçi</p><p class="hint">Bu sayılar bu telefondaki hesaba ait.</p></div>`;
  }
  if (r.head === "kaydedilenler") return photoGrid(store.savedPosts());
  if (r.head === "arsiv") {
    const hidden = store.hiddenPosts();
    return hidden.length ? photoGrid(hidden) : `<p class="empty">Arşiv boş.</p>`;
  }
  if (r.head === "hareket") return activityScreen(r.parts[1] || "begeni");
  if (r.head === "girisler") {
    const rows = store.loginEvents().filter((item) => item.id === me());
    if (!rows.length) return `<p class="empty">Giriş hareketi yok.</p>`;
    return rows.map((item) => `<div class="history-row"><strong>${esc(item.kind)}</strong><span>${esc(item.id)}</span><time>${timeAgo(item.at)}</time></div>`).join("");
  }
  if (r.head === "b") {
    const post = store.postById(r.parts[1]);
    if (!post) return missing("Bu gönderi yok.");
    const ids = new Set(post.likers || []);
    if (store.liked(post.id)) ids.add(me());
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
  if (r.head === "g") {
    const post = store.postById(r.parts[1]);
    if (post?.commentsClosed) return "";
    if (post || store.reelById(r.parts[1])) {
      return `<form id="composer-form" data-kind="comment" data-id="${esc(r.parts[1])}"><input name="text" maxlength="500" placeholder="Yorum ekle..." enterkeyhint="send" autocomplete="off" aria-label="Yorum"><button type="submit" aria-label="Gönder">${icon("send")}</button></form>`;
    }
  }
  return "";
}

function paintModal(r) {
  if (!isDesktop()) {
    modal.innerHTML = "";
    return;
  }
  if (r.head === "yeni" && r.parts[1] === "gonderi") {
    modal.innerHTML = postComposer();
    return;
  }
  if (r.head === "yeni" && !r.parts[1]) {
    modal.innerHTML = `<a class="create-backdrop lite" href="#/" aria-label="Kapat"></a><div class="choice-pop" role="menu">${choiceLinks()}</div>`;
    return;
  }
  modal.innerHTML = "";
}

function rootTab(r) {
  return r.head === "akis" || r.head === "kesfet" || r.head === "reels" || r.head === "profil" || (r.head === "mesaj" && !r.parts[1]);
}

function authScreen() {
  const months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  const days = Array.from({ length: 31 }, (_, index) => index + 1);
  const yearNow = new Date().getFullYear();
  const years = Array.from({ length: 100 }, (_, index) => yearNow - 13 - index);
  const option = (value, label, selected) => `<option value="${esc(String(value))}"${String(selected) === String(value) ? " selected" : ""}>${esc(label)}</option>`;
  const photos = ["media/photos/laptop.jpg", "media/photos/coffee.jpg", "media/photos/galata.jpg", "media/photos/city.jpg", "media/photos/noodles.jpg", "media/photos/sea.jpg"];
  const hero = `<section class="gate-hero"><h1>Yakınındakilerin gününü gör.</h1><div class="gate-collage">${photos.map((src) => `<img src="${src}" alt="">`).join("")}</div></section>`;
  const error = `<p class="gate-error">${esc(authError)}</p>`;
  const known = store.accounts();
  if (authView === "signup") {
    return `<div class="gate">${hero}<section class="gate-card"><button type="button" class="text-btn" data-act="auth-login">Geri</button><h2>Kaydol</h2><form data-kind="signup"><input name="contact" type="text" inputmode="email" autocomplete="username" maxlength="80" placeholder="Cep telefonu veya e-posta" value="${esc(authDraft.contact)}" required><input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="Şifre" required><label class="born-label">Doğum günü<div class="born-row"><select name="day" aria-label="Gün" required><option value="">Gün</option>${days.map((day) => option(day, String(day), authDraft.day)).join("")}</select><select name="month" aria-label="Ay" required><option value="">Ay</option>${months.map((label, index) => option(index + 1, label, authDraft.month)).join("")}</select><select name="year" aria-label="Yıl" required><option value="">Yıl</option>${years.map((year) => option(year, String(year), authDraft.year)).join("")}</select></div></label><input name="name" type="text" maxlength="40" autocomplete="name" placeholder="Ad" value="${esc(authDraft.name)}" required><input name="username" type="text" maxlength="30" autocapitalize="none" autocomplete="off" placeholder="Kullanıcı adı" value="${esc(authDraft.username)}" required>${error}<button class="btn primary" type="submit">Kaydol</button></form><p class="gate-note">Hesap bu tarayıcıda oluşur. Şifre düz yazı olarak saklanmaz.</p></section></div>`;
  }
  if (authView === "forgot") {
    return `<div class="gate">${hero}<section class="gate-card"><button type="button" class="text-btn" data-act="auth-login">Geri</button><h2>Şifreni yenile</h2><form data-kind="forgot"><input name="username" type="text" autocapitalize="none" placeholder="Kullanıcı adı" value="${esc(authDraft.username || authDraft.id)}" required><label class="born-label">Doğum günü<div class="born-row"><select name="day" aria-label="Gün" required><option value="">Gün</option>${days.map((day) => option(day, String(day), authDraft.day)).join("")}</select><select name="month" aria-label="Ay" required><option value="">Ay</option>${months.map((label, index) => option(index + 1, label, authDraft.month)).join("")}</select><select name="year" aria-label="Yıl" required><option value="">Yıl</option>${years.map((year) => option(year, String(year), authDraft.year)).join("")}</select></div></label><input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="Yeni şifre" required>${error}<button class="btn primary" type="submit">Şifreyi kaydet</button></form></section></div>`;
  }
  const chips = known.length ? `<div class="gate-accounts">${known.map((account) => `<button type="button" data-act="auth-fill" data-user="${esc(account.id)}">${esc(account.id)}</button>`).join("")}</div>` : "";
  return `<div class="gate">${hero}<section class="gate-card"><h2>Bladekv1</h2><form data-kind="login"><input name="id" type="text" autocapitalize="none" autocomplete="username" placeholder="Kullanıcı adı, e-posta veya telefon" value="${esc(authDraft.id)}" required><input name="password" type="password" autocomplete="current-password" placeholder="Şifre" required>${error}<button class="btn primary" type="submit">Giriş yap</button></form>${chips}<button type="button" class="text-btn" data-act="auth-forgot">Şifreni mi unuttun?</button><p class="gate-switch">Hesabın yok mu? <button type="button" data-act="auth-signup">Kaydol</button></p></section></div>`;
}

function paintGate() {
  app.classList.add("gate-mode");
  app.classList.remove("home", "show-rail", "wide", "desk-page", "activity", "reels-mode", "immersive");
  topbar.hidden = true;
  topbar.innerHTML = "";
  tabbar.hidden = true;
  tabbar.innerHTML = "";
  sidenav.innerHTML = "";
  rail.innerHTML = "";
  searchpop.classList.remove("open");
  searchpop.innerHTML = "";
  composer.hidden = true;
  composer.innerHTML = "";
  modal.innerHTML = "";
  const pill = document.getElementById("msgpill");
  if (pill) pill.hidden = true;
  stage.innerHTML = authScreen();
  document.title = authView === "signup" ? "Kaydol · Bladekv1" : "Giriş · Bladekv1";
}

function render() {
  const next = location.hash || "#/";
  if (currentHash) scrollMem.set(currentHash, stage.scrollTop);
  cleanup();
  closeSheet();
  applyTheme();
  if (!store.session()) {
    paintGate();
    currentHash = next;
    return;
  }
  app.classList.remove("gate-mode");
  const r = route();
  if (r.head === "bildirim") store.seeActivity();
  const behindFeed = isDesktop() && r.head === "yeni" && (!r.parts[1] || r.parts[1] === "gonderi");
  const section = r.head === "hareket" ? (r.parts[1] || "begeni") : "";
  if (section !== activitySection) {
    activitySelect = false;
    activityPicked.clear();
    activitySection = section;
  }
  app.classList.toggle("reels-mode", r.head === "reels");
  app.classList.toggle("immersive", r.head === "h");
  app.classList.toggle("home", r.head === "akis" || behindFeed);
  app.classList.toggle("show-rail", r.head === "akis" || behindFeed);
  app.classList.toggle("wide", ["profil", "u", "kesfet", "kaydedilenler", "arsiv", "hareket"].includes(r.head));
  app.classList.toggle("desk-page", isDesktop() && ["profil", "u", "hareket"].includes(r.head));
  app.classList.toggle("activity", r.head === "hareket");
  paintTop(r);
  const showTabs = rootTab(r);
  tabbar.hidden = !showTabs;
  tabbar.innerHTML = showTabs ? tabBar(r) : "";
  sidenav.innerHTML = sideNav(r);
  rail.innerHTML = railHtml();
  searchpop.classList.toggle("open", searchOpen && isDesktop());
  searchpop.innerHTML = searchOpen && isDesktop() ? `<button type="button" class="search-backdrop" data-act="close-search" aria-label="Aramayı kapat"></button><div class="search-card"><input id="nav-q" class="search" type="search" placeholder="Ara" value="${esc(navQuery)}" aria-label="Ara" autocomplete="off"><div id="nav-results">${searchResultHtml()}</div></div>` : "";
  const bar = composerFor(r);
  composer.hidden = !bar;
  composer.innerHTML = bar;
  stage.innerHTML = screen(r);
  paintModal(r);
  const pill = document.getElementById("msgpill");
  const showPill = isDesktop() && r.head !== "reels" && r.head !== "h" && r.head !== "mesaj";
  pill.hidden = !showPill;
  if (showPill) {
    const mail = store.unreadTotal();
    pill.innerHTML = `${icon("send")}<span>Mesajlar</span>${mail ? `<i class="count">${mail}</i>` : ""}`;
  }
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
  const settingsSearch = document.getElementById("settings-q");
  if (settingsSearch) {
    const onInput = () => {
      const query = settingsSearch.value.trim().toLocaleLowerCase("tr-TR");
      document.querySelectorAll(".set-row").forEach((row) => {
        const show = !query || row.textContent.toLocaleLowerCase("tr-TR").includes(query);
        row.hidden = !show;
      });
      document.querySelectorAll(".settings-sec").forEach((title) => {
        let next = title.nextElementSibling;
        let visible = false;
        while (next && !next.classList.contains("settings-sec")) {
          if (next.classList.contains("set-row") && !next.hidden) visible = true;
          next = next.nextElementSibling;
        }
        title.hidden = query ? !visible : false;
      });
    };
    settingsSearch.addEventListener("input", onInput);
    cleanupFns.push(() => settingsSearch.removeEventListener("input", onInput));
  }
  const navSearch = document.getElementById("nav-q");
  if (navSearch) {
    const onInput = () => {
      navQuery = navSearch.value;
      const box = document.getElementById("nav-results");
      if (box) box.innerHTML = searchResultHtml();
    };
    navSearch.addEventListener("input", onInput);
    cleanupFns.push(() => navSearch.removeEventListener("input", onInput));
    navSearch.focus();
    const end = navSearch.value.length;
    navSearch.setSelectionRange(end, end);
  }
  bindCreateDrop();
  const pop = document.querySelector(".choice-pop");
  const trigger = sidenav.querySelector('a[href="#/yeni"]');
  if (pop && trigger) pop.style.top = `${trigger.getBoundingClientRect().top}px`;
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
    button.textContent = on ? "Takiptesin" : button.closest(".rail-person") ? "Takip Et" : "Takip et";
    button.setAttribute("aria-pressed", String(on));
  });
}

function openSheet(html) {
  document.getElementById("sheet").innerHTML = `<div class="backdrop" data-act="close-sheet"></div><div class="sheet" role="dialog">${html}</div>`;
}

function closeSheet() {
  const sheet = document.getElementById("sheet");
  if (sheet) sheet.innerHTML = "";
  document.getElementById("sidenav")?.classList.remove("expanded");
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
  const form = document.querySelector(".create-form, form[data-kind='create']");
  if (!(form instanceof HTMLFormElement)) return;
  const data = new FormData(form);
  if (form.elements.location) draft.location = data.get("location")?.toString() || "";
  if (form.elements.alt) draft.alt = data.get("alt")?.toString() || "";
  if (form.elements.ai) draft.ai = Boolean(form.elements.ai.checked);
  if (form.elements.commentsClosed) draft.commentsClosed = Boolean(form.elements.commentsClosed.checked);
}

function bindCreateDrop() {
  const zone = document.querySelector(".create-stage");
  if (!zone) return;
  const over = (event) => event.preventDefault();
  const drop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) readDraftFile(file);
  };
  zone.addEventListener("dragover", over);
  zone.addEventListener("drop", drop);
  cleanupFns.push(() => {
    zone.removeEventListener("dragover", over);
    zone.removeEventListener("drop", drop);
  });
}

async function readDraftFile(file) {
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
      draft.useCard = false;
    } else if (file.type.startsWith("image/") || file.type === "") {
      draft.image = await compressImage(file, 1080);
      draft.blobId = "";
      draft.videoUrl = "";
      draft.useCard = false;
    } else {
      toast("JPG, PNG veya MP4 seç");
      return;
    }
    render();
  } catch {
    toast("Bu dosya açılamadı");
  }
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

function openProfileMenu() {
  if (!isDesktop()) {
    openSheet(`<div class="grab"></div><a href="#/hareket">Hareketlerin</a><a href="#/kaydedilenler">Kaydedilenler</a><a href="#/girisler">Giriş hareketleri</a><button type="button" data-act="qr-open">QR kodu</button><a href="#/ayarlar">Ayarlar ve gizlilik</a><button type="button" class="danger" data-act="logout-ask">Çıkış yap</button><button type="button" data-act="close-sheet">Vazgeç</button>`);
    return;
  }
  document.getElementById("sidenav")?.classList.add("expanded");
  document.getElementById("sheet").innerHTML = `<button type="button" class="menu-backdrop" data-act="close-sheet" aria-label="Kapat"></button><div class="more-menu" role="menu"><a href="#/ayarlar"><span>Ayarlar ve gizlilik</span></a><a href="#/hareket"><span>Hareketlerin</span></a><a href="#/kaydedilenler"><span>Kaydedilenler</span></a><a href="#/girisler"><span>Giriş hareketleri</span></a><button type="button" data-act="qr-open"><span>QR kodu</span></button><button type="button" data-act="theme-toggle"><span>Görünümü değiştir</span></button><button type="button" data-act="add-account"><span>Hesap değiştir</span></button><button type="button" class="danger" data-act="logout-ask"><span>Çıkış yap</span></button></div>`;
}

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
    const own = post.user === me();
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
    const rows = everyone().filter((user) => user.id !== me()).map((user) => `<a href="#/mesaj/${user.id}">${esc(user.name)}</a>`).join("");
    openSheet(`<div class="grab"></div>${rows}<button type="button" data-act="close-sheet">Vazgeç</button>`);
  } else if (act === "inbox-tab") {
    inboxTab = zone.dataset.tab || "birincil";
    const list = document.getElementById("inbox-list");
    if (list) list.innerHTML = inboxRows();
  } else if (act === "edit-note") {
    openSheet(`<div class="grab"></div><form data-kind="note"><input name="note" maxlength="60" value="${esc(store.noteOf(getUser(me())))}" placeholder="Notun" aria-label="Not"><button type="submit">Kaydet</button></form>`);
  } else if (act === "qr-open") {
    openQr();
  } else if (act === "qr-color") {
    const index = QR_COLORS.indexOf(qrColor);
    qrColor = QR_COLORS[(index + 1) % QR_COLORS.length];
    openQr();
  } else if (act === "copy-profile") {
    copyText(profileUrl());
  } else if (act === "share-profile") {
    const url = profileUrl();
    if (navigator.share) navigator.share({ title: me(), url }).catch((error) => { if (error?.name !== "AbortError") copyText(url); });
    else copyText(url);
  } else if (act === "download-qr") {
    downloadQr();
  } else if (act === "setting") {
    if (zone.dataset.setting === "theme") {
      const current = store.theme();
      const seg = ["system", "light", "dark"].map((value) => {
        const label = value === "system" ? "Sistem" : value === "light" ? "Aydınlık" : "Karanlık";
        return `<button type="button" data-act="theme" data-theme="${value}" class="${current === value ? "on" : ""}">${label}</button>`;
      }).join("");
      openSheet(`<div class="grab"></div><div class="seg" style="padding:12px">${seg}</div><button type="button" data-act="close-sheet">Vazgeç</button>`);
    } else if (zone.dataset.setting === "private") {
      store.setPrivate(!store.isPrivate());
      render();
      toast(store.isPrivate() ? "Hesap gizli" : "Hesap herkese açık");
    } else if (zone.dataset.setting === "about") {
      openSheet(`<div class="grab"></div><p class="hint">Beğeniler, mesajlar ve yeni gönderiler bu telefonda kalır. Fotoğraflar Unsplash lisansı ile eklendi.</p><button type="button" data-act="close-sheet">Kapat</button>`);
    }
  } else if (act === "new-account") {
    store.logout();
    authView = "signup";
    authError = "";
    location.hash = "#/";
    render();
  } else if (act === "add-account") {
    store.logout();
    authView = "login";
    authError = "";
    location.hash = "#/";
    render();
  } else if (act === "auth-signup") {
    authView = "signup";
    authError = "";
    render();
  } else if (act === "auth-login") {
    authView = "login";
    authError = "";
    render();
  } else if (act === "auth-forgot") {
    authView = "forgot";
    authError = "";
    render();
  } else if (act === "auth-fill") {
    authDraft = { ...authDraft, id: safeId(zone.dataset.user) };
    authView = "login";
    authError = "";
    render();
  } else if (act === "logout-ask") {
    openSheet(`<div class="grab"></div><p class="hint">Çıkış yapılır. Hesabın ve gönderilerin bu telefonda durur.</p><button type="button" class="danger" data-act="logout-do">Çıkış yap</button><button type="button" data-act="close-sheet">Vazgeç</button>`);
  } else if (act === "logout-do") {
    store.logout();
    authView = "login";
    authError = "";
    location.hash = "#/";
    render();
  } else if (act === "profile-menu") {
    openProfileMenu();
  } else if (act === "theme-toggle") {
    const dark = document.documentElement.dataset.theme === "dark";
    store.setTheme(dark ? "light" : "dark");
    render();
    toast(dark ? "Aydınlık görünüm" : "Karanlık görünüm");
  } else if (act === "act-sort") {
    activitySort = activitySort === "new" ? "old" : "new";
    render();
  } else if (act === "act-select-mode") {
    activitySelect = !activitySelect;
    if (!activitySelect) activityPicked.clear();
    render();
  } else if (act === "act-pick") {
    const id = safeId(zone.dataset.id);
    if (!id) return;
    if (activityPicked.has(id)) activityPicked.delete(id);
    else activityPicked.add(id);
    render();
  } else if (act === "act-apply") {
    const mode = route().parts[1] || "begeni";
    for (const id of activityPicked) {
      if (mode === "begeni" && store.liked(id)) store.toggleLike(id);
      if (mode === "gonderi") store.hidePost(id);
    }
    activityPicked.clear();
    activitySelect = false;
    render();
    toast(mode === "gonderi" ? "Arşive alındı" : "Beğeni kaldırıldı");
  } else if (act === "theme") {
    store.setTheme(zone.dataset.theme);
    render();
  } else if (act === "reset-ask") {
    openSheet(`<div class="grab"></div><p class="hint">Beğeniler, mesajlar ve eklediğin gönderiler bu telefondan silinir.</p><button type="button" class="danger" data-act="reset-do">Sil</button><button type="button" data-act="close-sheet">Vazgeç</button>`);
  } else if (act === "reset-do") {
    store.reset();
    draft = blankDraft();
    location.hash = "#/";
    render();
    toast("Bu cihaz sıfırlandı");
  } else if (act === "swatch") {
    rememberDraft();
    draft.bg = zone.dataset.bg;
    draft.image = "";
    draft.videoUrl = "";
    draft.blobId = "";
    draft.useCard = true;
    render();
  } else if (act === "toggle-search") {
    searchOpen = !searchOpen;
    render();
  } else if (act === "close-search") {
    searchOpen = false;
    render();
  } else if (act === "tag-people") {
    rememberDraft();
    const rows = everyone().filter((user) => user.id !== me()).map((user) => `<button type="button" data-act="mention" data-user="${esc(user.id)}">${esc(user.name)}</button>`).join("");
    openSheet(`<div class="grab"></div><p class="hint">Etiketle</p>${rows}<button type="button" data-act="close-sheet">Vazgeç</button>`);
  } else if (act === "mention") {
    rememberDraft();
    const id = safeId(zone.dataset.user);
    if (id) draft.text = `${draft.text.trim()} @${id}`.trim();
    closeSheet();
    render();
  } else if (act === "pick-collab") {
    rememberDraft();
    const chosen = new Set(draft.collaborators || []);
    const rows = everyone().filter((user) => user.id !== me()).map((user) => `<button type="button" data-act="toggle-collab" data-user="${esc(user.id)}">${esc(user.name)}${chosen.has(user.id) ? " · eklendi" : ""}</button>`).join("");
    openSheet(`<div class="grab"></div><p class="hint">Katkıda bulunanlar</p>${rows}<button type="button" data-act="close-sheet">Vazgeç</button>`);
  } else if (act === "toggle-collab") {
    rememberDraft();
    const id = safeId(zone.dataset.user);
    if (id) {
      const chosen = new Set(draft.collaborators || []);
      if (chosen.has(id)) chosen.delete(id);
      else if (chosen.size < 5) chosen.add(id);
      draft.collaborators = [...chosen];
    }
    closeSheet();
    render();
  }
});

function bornValue(data) {
  const year = data.get("year")?.toString() || "";
  const month = data.get("month")?.toString().padStart(2, "0") || "";
  const day = data.get("day")?.toString().padStart(2, "0") || "";
  return year && month && day ? `${year}-${month}-${day}` : "";
}

async function submitAuth(form, kind) {
  const data = new FormData(form);
  const button = form.querySelector("button[type=submit]");
  if (button) button.disabled = true;
  authDraft = {
    id: data.get("id")?.toString() || authDraft.id,
    name: data.get("name")?.toString() || "",
    contact: data.get("contact")?.toString() || "",
    username: data.get("username")?.toString() || "",
    day: data.get("day")?.toString() || "",
    month: data.get("month")?.toString() || "",
    year: data.get("year")?.toString() || "",
  };
  let result = { error: "Giriş tamamlanamadı." };
  if (kind === "login") result = await store.loginAccount(authDraft.id, data.get("password")?.toString() || "");
  else if (kind === "signup") {
    result = await store.registerAccount({
      name: authDraft.name,
      username: authDraft.username,
      contact: authDraft.contact,
      password: data.get("password")?.toString() || "",
      born: bornValue(data),
    });
  } else {
    result = await store.resetPassword({
      username: data.get("username")?.toString() || "",
      born: bornValue(data),
      password: data.get("password")?.toString() || "",
    });
    if (result.ok) {
      authView = "login";
      authDraft.id = data.get("username")?.toString() || "";
      authError = "";
      toast("Şifre yenilendi. Giriş yap.");
      render();
      return;
    }
  }
  if (!result.ok) {
    authError = result.error || "Olmadı.";
    render();
    return;
  }
  authError = "";
  authView = "login";
  location.hash = "#/";
  render();
  toast(kind === "signup" ? "Hesap oluşturuldu" : "Giriş yapıldı");
}

document.body.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const kind = form.dataset.kind;
  if (kind === "login" || kind === "signup" || kind === "forgot") {
    submitAuth(form, kind);
    return;
  }
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
    if (userId && userId !== me() && getUser(userId)) {
      store.sendMessage(userId, text.slice(0, 500));
      store.addStoryReply(userId, text.slice(0, 500));
      toast("Yanıt gönderildi");
      form.reset();
    }
    return;
  }
  if (kind === "note") {
    const note = new FormData(form).get("note")?.toString().trim().slice(0, 60) || "";
    if (!store.updateProfile({ note })) { toast("Not sığmadı"); return; }
    closeSheet();
    render();
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
      draft = blankDraft();
      location.hash = `#/h/${me()}/0`;
      return;
    }
    if (create === "reel") {
      const reel = {
        id: `ur-${Date.now()}`,
        user: me(),
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
      draft = blankDraft();
      location.hash = `#/reels/${reel.id}`;
      return;
    }
    const post = {
      id: `up-${Date.now()}`,
      user: me(),
      images: [image],
      alt: (draft.alt || "").trim().slice(0, 200) || "Senin gönderin",
      caption: text.slice(0, 2200),
      location: (draft.location || "").trim().slice(0, 80),
      topic: "Sen",
      likes: 0,
      at: Date.now(),
      likers: [],
      comments: [],
      ai: Boolean(draft.ai),
      collaborators: (draft.collaborators || []).map((id) => safeId(id)).filter(Boolean),
      commentsClosed: Boolean(draft.commentsClosed),
    };
    if (!store.addPost(post)) { toast("Gönderi sığmadı"); return; }
    draft = blankDraft();
    location.hash = "#/";
    toast("Paylaşıldı");
  }
});

document.body.addEventListener("change", async (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.classList.contains("js-draft-file")) {
    const file = input.files?.[0];
    if (file) readDraftFile(file);
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
  const pronouns = data.get("pronouns")?.toString().trim().slice(0, 20) || "";
  const note = data.get("note")?.toString().trim().slice(0, 60) || "";
  const rawLink = data.get("link")?.toString().trim().slice(0, 120) || "";
  const link = rawLink && !safeHttp(rawLink) ? null : rawLink;
  if (link === null) {
    toast("Bağlantı https ile başlamalı");
    return;
  }
  if (!store.updateProfile({ name, bio, pronouns, note, link })) {
    toast("Profil sığmadı");
    return;
  }
  location.hash = "#/profil";
  toast("Profil güncellendi");
});

document.body.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLInputElement)) return;
  if (target.id === "draft-text") {
    draft.text = target.value;
    const count = document.getElementById("char-count");
    if (count) count.textContent = target.value.length.toLocaleString("tr-TR");
  } else if (target.name === "location") draft.location = target.value;
  else if (target.name === "alt") draft.alt = target.value;
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (document.querySelector("#sheet .sheet")) {
      closeSheet();
      return;
    }
    if (searchOpen) {
      searchOpen = false;
      render();
      return;
    }
    if (modal.innerHTML && isDesktop()) location.hash = "#/";
    return;
  }
  if (!document.querySelector(".story")) return;
  if (event.target instanceof HTMLElement && event.target.matches("input, textarea")) return;
  if (event.key === "ArrowRight") goFrame(1);
  if (event.key === "ArrowLeft") goFrame(-1);
});

function openQr() {
  const svg = qrSvg(profileUrl(), qrColor);
  document.getElementById("sheet").innerHTML = `<div class="backdrop" data-act="close-sheet"></div><div class="qr-modal" role="dialog" aria-label="Profil kodu"><div class="qr-top"><button type="button" class="icon-btn" data-act="close-sheet" aria-label="Kapat">${icon("close")}</button><button type="button" class="text-btn" data-act="qr-color">RENK</button></div><div class="qr-card">${svg}<strong>@${esc(me())}</strong></div><div class="qr-actions"><button type="button" data-act="share-profile">Profili paylaş</button><button type="button" data-act="copy-profile">Bağlantıyı kopyala</button><button type="button" data-act="download-qr">İndir</button></div></div>`;
}

function downloadQr() {
  const matrix = qrMatrix(profileUrl());
  const cell = 12;
  const quiet = 4;
  const span = matrix.n + quiet * 2;
  const canvas = document.createElement("canvas");
  canvas.width = span * cell;
  canvas.height = span * cell;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = qrColor;
  for (let y = 0; y < matrix.n; y += 1) {
    for (let x = 0; x < matrix.n; x += 1) {
      if (!matrix.dark(x, y)) continue;
      ctx.fillRect((x + quiet) * cell, (y + quiet) * cell, cell, cell);
    }
  }
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `${me()}-profil.png`;
  link.click();
}

let stageSwipe = null;
document.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (event.target.closest("a, button, input, textarea, .frame, .stories, .highlights, .chips, .notes")) return;
  const r = route();
  if (r.head !== "akis" && !(r.head === "mesaj" && !r.parts[1])) return;
  stageSwipe = { x: event.clientX, y: event.clientY, head: r.head };
});
document.addEventListener("pointerup", (event) => {
  if (!stageSwipe) return;
  const dx = event.clientX - stageSwipe.x;
  const dy = event.clientY - stageSwipe.y;
  const head = stageSwipe.head;
  stageSwipe = null;
  if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
  if (head === "akis" && dx < 0) location.hash = "#/mesaj";
  if (head === "mesaj" && dx > 0) location.hash = "#/";
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
window.addEventListener("hashchange", () => {
  searchOpen = false;
  render();
});
matchMedia("(min-width: 1024px)").addEventListener("change", render);

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
