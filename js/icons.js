const paths = {
  home: '<path d="M4 10.6 12 4l8 6.6V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.4Z"/>',
  homeFill: '<path fill="currentColor" stroke="none" d="M4 10.6 12 4l8 6.6V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.4Z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  compass: '<circle cx="12" cy="12" r="8.2"/><path d="m14.8 9.2-1.3 4.3-4.3 1.3 1.3-4.3 4.3-1.3Z"/>',
  reels: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M10 8.5v7l6-3.5-6-3.5Z" fill="currentColor" stroke="none"/>',
  reelsFill: '<rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="currentColor" stroke="none"/><path d="M10 8.5v7l6-3.5-6-3.5Z" fill="var(--bg)" stroke="none"/>',
  heart: '<path d="M12 19.2s-6.4-4-6.4-8.2a3.6 3.6 0 0 1 6.4-1.8 3.6 3.6 0 0 1 6.4 1.8c0 4.2-6.4 8.2-6.4 8.2Z"/>',
  heartFill: '<path fill="currentColor" stroke="none" d="M12 19.4s-6.6-4.1-6.6-8.4A3.7 3.7 0 0 1 12 9.2a3.7 3.7 0 0 1 6.6 1.8c0 4.3-6.6 8.4-6.6 8.4Z"/>',
  comment: '<path d="M6 16.2 4 20.5l4.2-1.5A8.2 8.2 0 1 0 6 16.2Z"/>',
  send: '<path d="m3.5 11.2 17-8-6.8 17-2.2-6.6-8-2.4Z"/>',
  bookmark: '<path d="M7 3.5h10a1 1 0 0 1 1 1V21l-6-3.4L6 21V4.5a1 1 0 0 1 1-1Z"/>',
  bookmarkFill: '<path fill="currentColor" stroke="none" d="M7 3.5h10a1 1 0 0 1 1 1V21l-6-3.4L6 21V4.5a1 1 0 0 1 1-1Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="6" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="18" cy="12" r="1" fill="currentColor"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
  tag: '<path d="M4.5 8.2V4.5H8.2L20 16.3 16.3 20 4.5 8.2Z"/><circle cx="8" cy="8" r=".8" fill="currentColor"/>',
  camera: '<path d="M8 7.5 9.2 5.5h5.6L16 7.5h2.5a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17V9a1.5 1.5 0 0 1 1.5-1.5H8Z"/><circle cx="12" cy="12.5" r="2.6"/>',
  menu: '<path d="M5 7h14M5 12h14M5 17h14"/>',
  bell: '<path d="M6 16V10a6 6 0 1 1 12 0v6l1.2 2H4.8L6 16Z"/><path d="M10 18a2 2 0 0 0 4 0"/>',
  play: '<path d="M8 6.5v11l10-5.5-10-5.5Z" fill="currentColor" stroke="none"/>',
};

export function icon(name) {
  const body = paths[name] || paths.plus;
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
