const paths = {
  lens: '<circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M16 16.5 20 20.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  pin: '<path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="10" r="2.2" fill="currentColor"/>',
  cart: '<path d="M5 7h15l-1.4 8.2a2 2 0 0 1-2 1.6H9.2a2 2 0 0 1-2-1.5L5 7z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 7 7 4H4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="9" cy="20" r="1.2" fill="currentColor"/><circle cx="17" cy="20" r="1.2" fill="currentColor"/>',
  user: '<circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 19.2c1.4-2.6 3.8-3.7 7-3.7s5.6 1.1 7 3.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  close: '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  home: '<path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  shop: '<path d="M4 10 6 5h12l2 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M5 10h14v9H5z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 19v-5h4v5" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  box: '<path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 12 20 7.5M12 12 4 7.5M12 12v9" stroke="currentColor" stroke-width="1.6"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0-5.6 5.1L4 16.5 7.5 20l4.9-4.9a4 4 0 0 0 5.1-5.6l-2.4 2.4-2-2 2.4-2.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  shield: '<path d="M12 3 19 6v6.2c0 4-2.8 6.8-7 8.8-4.2-2-7-4.8-7-8.8V6l7-3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 3.5v3M16 3.5v3M4 9.5h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  cable: '<path d="M7 7c4 0 4 4 8 4s4 4 0 6-6 2-6 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="7" cy="7" r="1.4" fill="currentColor"/><circle cx="9" cy="22" r="1.4" fill="currentColor"/>',
  monitor: '<rect x="3" y="5" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 20h8M12 17v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  wifi: '<path d="M5 10a10 10 0 0 1 14 0M7.5 13a6 6 0 0 1 9 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="17.5" r="1.3" fill="currentColor"/>',
  globe: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 12h16M12 4c2.4 2.5 3.6 5.2 3.6 8S14.4 17.5 12 20c-2.4-2.5-3.6-5.2-3.6-8S9.6 6.5 12 4z" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  phone: '<path d="M8 4h3l1.2 3.2-1.8 1.1a12 12 0 0 0 5.3 5.3l1.1-1.8L20 13v3a2 2 0 0 1-2.2 2A16 16 0 0 1 5 6.2 2 2 0 0 1 7 4h1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  chat: '<path d="M5 6h14v9H8l-3 3V6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  star: '<path d="m12 3.8 2.1 4.6 5 .6-3.7 3.4.9 5-4.3-2.4-4.3 2.4.9-5L4.9 9l5-.6L12 3.8z" fill="currentColor"/>',
  check: '<path d="M5 12.5 9.2 17 19 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4V8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="13" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  alert: '<path d="M12 4 21 19H3L12 4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 10v4M12 16.5v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  receipt: '<path d="M7 3h10v18l-2-1.2L13 21l-2-1.2L9 21l-2-1.2L5 21V5a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
};

export function icon(name, cls = "ico") {
  const d = paths[name] || paths.lens;
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`;
}
