export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

export function rich(value) {
  return esc(value)
    .replace(/#([\p{L}\p{N}_]+)/gu, (_, tag) => `<button type="button" class="tag" data-act="chip" data-tag="${tag}">#${tag}</button>`)
    .replace(/@([a-z0-9._]+)/g, (_, name) => `<a class="mention" href="#/u/${name}">@${name}</a>`);
}

export function formatCount(value) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  if (n < 10000) return new Intl.NumberFormat("tr-TR").format(n);
  if (n < 1000000) {
    const v = n / 1000;
    const text = v >= 100 ? String(Math.round(v)) : trimOne(v);
    return `${text} B`;
  }
  return `${trimOne(n / 1000000)} Mn`;
}

function trimOne(value) {
  return value.toFixed(1).replace(/\.0$/, "").replace(".", ",");
}

export function timeAgo(timestamp) {
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
  if (seconds < 45) return "şimdi";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} dk`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} sa`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)} g`;
  return `${Math.floor(seconds / (7 * 86400))} hf`;
}

export function safeSrc(src) {
  if (typeof src !== "string") return "";
  if (src.startsWith("media/")) return src;
  if (src.startsWith("data:image/")) return src;
  if (src.startsWith("blob:")) return src;
  return "";
}

export function safeVideo(src) {
  if (typeof src !== "string") return "";
  if (src.startsWith("media/reels/") && src.endsWith(".mp4")) return src;
  if (src.startsWith("blob:")) return src;
  return "";
}
