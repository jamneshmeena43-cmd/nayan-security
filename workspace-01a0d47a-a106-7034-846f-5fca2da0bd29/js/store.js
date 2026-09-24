const KEY = "nayan-security-preview-v1";

const defaultState = () => ({
  location: { city: "bikaner", area: "", pincode: "", source: "preview-default" },
  cart: [],
  drafts: [],
  tickets: [],
  addresses: [],
  profile: {},
  showAllCities: false,
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

let state = load();
const listeners = new Set();

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((fn) => fn(state));
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setLocation(location) {
  state = { ...state, location: { ...state.location, ...location } };
  save();
}

export function setShowAllCities(value) {
  state = { ...state, showAllCities: value };
  save();
}

export function cartCount() {
  return state.cart.reduce((n, line) => n + line.qty, 0);
}

export function addToCart(productId, { qty = 1, install = false } = {}) {
  const existing = state.cart.find((l) => l.productId === productId && l.install === install);
  let cart;
  if (existing) {
    cart = state.cart.map((l) =>
      l === existing ? { ...l, qty: Math.min(l.qty + qty, 20) } : l
    );
  } else {
    cart = [...state.cart, { id: crypto.randomUUID(), productId, qty, install }];
  }
  state = { ...state, cart };
  save();
}

export function updateQty(lineId, qty) {
  const next = Math.max(1, Math.min(20, qty));
  state = {
    ...state,
    cart: state.cart.map((l) => (l.id === lineId ? { ...l, qty: next } : l)),
  };
  save();
}

export function setLineInstall(lineId, install) {
  state = {
    ...state,
    cart: state.cart.map((l) => (l.id === lineId ? { ...l, install } : l)),
  };
  save();
}

export function removeLine(lineId) {
  state = { ...state, cart: state.cart.filter((l) => l.id !== lineId) };
  save();
}

export function clearCart() {
  state = { ...state, cart: [] };
  save();
}

export function addDraft(draft) {
  const item = {
    id: "DR-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
    createdAt: new Date().toISOString(),
    status: "Draft · not submitted",
    ...draft,
  };
  state = { ...state, drafts: [item, ...state.drafts] };
  save();
  return item;
}

export function addTicket(ticket) {
  const item = {
    id: "TK-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
    createdAt: new Date().toISOString(),
    status: "OPEN",
    localOnly: true,
    ...ticket,
  };
  state = { ...state, tickets: [item, ...state.tickets] };
  save();
  return item;
}

export function addAddress(address) {
  const item = { id: crypto.randomUUID(), ...address };
  state = { ...state, addresses: [item, ...state.addresses] };
  save();
  return item;
}

export function removeAddress(id) {
  state = { ...state, addresses: state.addresses.filter((a) => a.id !== id) };
  save();
}

export function setProfile(profile) {
  state = { ...state, profile: { ...state.profile, ...profile } };
  save();
}

export function clearProfile() {
  state = { ...state, profile: {} };
  save();
}
