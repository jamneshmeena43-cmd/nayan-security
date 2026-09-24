import {
  SAMPLE_NOTE, cities, productCategories, shops, professionals, products, services,
  repairIssues, packages, faqs, serviceFaqs, testimonials, gallery, trustPoints, steps,
  legal, cityName, shopById, productById, serviceById, proById, packageById,
  categoryById, discountPercent, stockLabel, reviewsFor, searchAll,
} from "./data.js";
import {
  getState, setLocation, setShowAllCities, cartCount, addToCart, updateQty,
  setLineInstall, removeLine, addDraft, addTicket, addAddress, removeAddress,
  setProfile, clearProfile, clearCart,
} from "./store.js";
import { icon } from "./icons.js";
import { api, me, setCsrf, uploadFile } from "./api.js";

const INSTALL_EACH = 499;
const DELIVERY_SAMPLE = 149;

const serviceIcon = {
  "cctv-installation": "camera",
  "cctv-repair": "wrench",
  "cctv-maintenance": "shield",
  amc: "calendar",
  "cctv-inspection": "search",
  "dvr-nvr-service": "monitor",
  "cctv-wiring": "cable",
  "remote-viewing": "monitor",
  "ip-camera-setup": "globe",
  "wifi-camera-setup": "wifi",
  "4g-camera-setup": "globe",
};

let ui = { menu: false, search: false, modal: null, toast: "", authTab: "signin" };
let checkoutDraft = {};
let navToken = 0;
let lastPath = "";
let session = { user: null, csrf: "" };
let serverOrders = [];
let orderCache = {};
let securityView = null;
const uploadJobs = new Map();

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const stars = (n) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));
const initials = (name) => name.split(/\s+/).filter((w) => /[A-Za-z]/.test(w[0])).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "NS";
const qs = () => Object.fromEntries(new URLSearchParams(location.search));
const rupees = (paise) => money((Number(paise) || 0) / 100);
const signedIn = () => Boolean(session.user);
const isAdmin = () => session.user?.account_type === "admin";

function friendly(err) {
  const code = err?.message || "request_failed";
  const map = {
    invalid_credentials: "Those details did not match an account.",
    csrf_failed: "This page expired. Refresh and try again.",
    authentication_required: "Sign in to continue.",
    gateway_not_configured: "Payment gateway is not configured. The order stays unpaid.",
    gateway_unavailable: "The payment gateway did not accept the order. Nothing was marked paid.",
    payment_not_verified: "Payment was not verified. Nothing was marked paid.",
    email_in_use: "That email is already registered.",
    phone_in_use: "That mobile number is already registered.",
    forbidden: "Your account does not have permission for that.",
    customers_only: "Only a customer account can place this order.",
    file_rejected: "That file was rejected. Executables and web pages are not accepted.",
    file_type_rejected: "Use a JPEG, PNG, GIF, WEBP or PDF.",
    file_too_large: "That file is larger than 5 MB.",
    mime_mismatch: "The file contents do not match its declared type.",
    rate_limited: "Too many attempts. Wait and try again.",
    invalid_profile: "Enter a name and a valid email.",
  };
  return map[code] || "That did not go through. No payment was marked successful.";
}

function accountLabel() {
  if (!signedIn()) return "Sign in";
  return String(session.user.name || "Account").split(" ")[0];
}

function logoMark() {
  return `<svg class="logo-mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="#0C2340"/><circle cx="20" cy="20" r="11" fill="none" stroke="#F4EFE8" stroke-width="1.7"/><circle cx="20" cy="20" r="5.6" fill="none" stroke="#7EB0FF" stroke-width="1.7"/><circle cx="20" cy="20" r="2.1" fill="#F4EFE8"/></svg>`;
}

function mediaHTML(image, alt, attrs = "") {
  if (image && typeof image === "object" && image.type === "collage") {
    return `<div class="collage" role="img" aria-label="${esc(alt)}">${image.sources.map((s) => `<img src="${esc(s)}" alt="" loading="lazy">`).join("")}</div>`;
  }
  return `<img src="${esc(image)}" alt="${esc(alt)}" ${attrs}>`;
}

function city() { return getState().location.city || "bikaner"; }

function visiblePros() {
  const st = getState();
  const list = st.showAllCities ? professionals : professionals.filter((p) => p.city === city());
  return list;
}
function visibleShops() {
  const st = getState();
  return st.showAllCities ? shops : shops.filter((s) => s.city === city());
}

function lineViews() {
  return getState().cart.map((line) => {
    const product = productById(line.productId);
    if (!product) return null;
    const qty = line.qty;
    const goods = product.price * qty;
    const install = line.install ? INSTALL_EACH * qty : 0;
    return { ...line, product, goods, install, total: goods + install };
  }).filter(Boolean);
}

function cartTotals(delivery = "pickup") {
  const lines = lineViews();
  const goods = lines.reduce((n, l) => n + l.goods, 0);
  const install = lines.reduce((n, l) => n + l.install, 0);
  const deliveryFee = delivery === "home" ? DELIVERY_SAMPLE : 0;
  return { lines, goods, install, deliveryFee, preview: goods + install + deliveryFee };
}

function toast(msg) {
  ui.toast = msg;
  const el = document.getElementById("toast");
  if (el) el.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    ui.toast = "";
    if (el) el.innerHTML = "";
  }, 4200);
}

function openModal(modal) {
  ui.modal = modal;
  paintOverlay();
  const close = document.querySelector(".dialog [data-action='close-modal']");
  close?.focus();
}
function closeModal() {
  ui.modal = null;
  paintOverlay();
}

function paintOverlay() {
  const el = document.getElementById("overlay");
  if (!ui.modal) { el.innerHTML = ""; return; }
  const m = ui.modal;
  el.innerHTML = `<div class="dialog-back" data-action="close-modal"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
    <header><h2 id="dlg-title">${esc(m.title)}</h2><button class="icon-btn" type="button" data-action="close-modal" aria-label="Close">${icon("close")}</button></header>
    <div>${m.html}</div>
  </div></div>`;
}

function skeleton() {
  return `<div class="page wrap" aria-busy="true" aria-live="polite">
    <p class="kicker">Loading</p>
    <div class="skel lg"></div><div class="skel"></div><div class="skel"></div>
    <div class="grid-products" style="margin-top:18px">${"<div class='skeleton-card'><div class='skel lg'></div><div class='skel'></div></div>".repeat(3)}</div>
  </div>`;
}

function emptyState(title, text, href, label) {
  return `<div class="empty"><h2>${esc(title)}</h2><p class="muted" style="margin:8px auto 14px;max-width:36rem">${esc(text)}</p>${href ? `<a class="btn btn-navy" href="${esc(href)}">${esc(label)}</a>` : ""}</div>`;
}
function errorState(text) {
  return `<div class="error-box"><h2>Something did not load</h2><p class="muted" style="margin:8px 0 14px">${esc(text)}</p><button class="btn btn-navy" type="button" data-action="retry">Try again</button></div>`;
}

function crumbs(items) {
  return `<nav class="crumbs" aria-label="Breadcrumb">${items.map((it, i) => i === items.length - 1
    ? `<span aria-current="page">${esc(it.label)}</span>`
    : `<a href="${esc(it.href)}">${esc(it.label)}</a> <span aria-hidden="true">/</span>`).join(" ")}</nav>`;
}

function sampleChip() { return `<span class="chip">Sample</span>`; }

function productCard(p) {
  const off = discountPercent(p);
  const stock = stockLabel(p);
  const seller = shopById(p.seller);
  const disabled = p.stock <= 0 ? "disabled" : "";
  return `<article class="pcard">
    <a class="pcard-media" href="/product/${esc(p.id)}">${mediaHTML(p.image, p.alt, 'loading="lazy"')}${sampleChip()}${off ? `<span class="chip-off">${off}% off</span>` : ""}</a>
    <div class="pcard-body">
      <p class="brand">${esc(p.brand)}</p>
      <h3><a href="/product/${esc(p.id)}">${esc(p.name)}</a></h3>
      <p class="muted"><span class="stars" aria-hidden="true">${stars(p.rating)}</span> Sample rating ${esc(p.rating)} · ${esc(p.warranty)}</p>
      <p class="price"><s>${money(p.mrp)}</s> <strong>${money(p.price)}</strong></p>
      <p class="stock ${stock.key}">${esc(stock.text)}</p>
      <p class="muted" style="font-size:13px">Seller · ${esc(seller?.name || "Sample shop")}</p>
      <div class="actions">
        <button class="btn btn-navy btn-sm" type="button" data-action="add-cart" data-id="${esc(p.id)}" ${disabled}>Add to cart</button>
        <button class="btn btn-green btn-sm" type="button" data-action="buy-now" data-id="${esc(p.id)}" ${disabled}>Buy now</button>
        <button class="btn btn-ghost btn-sm" type="button" data-action="get-install" data-id="${esc(p.id)}" ${disabled}>Get installation</button>
      </div>
    </div>
  </article>`;
}

function serviceCard(s) {
  return `<a class="scard" href="/services/${esc(s.id)}">
    <span class="mark">${icon(serviceIcon[s.id] || "camera")}</span>
    <h3>${esc(s.name)}</h3>
    <p>${esc(s.short)}</p>
    <span class="btn btn-ghost btn-sm" style="margin-top:auto">View service</span>
  </a>`;
}

function proCard(p) {
  const sv = p.services.map((id) => serviceById(id)?.name).filter(Boolean).slice(0, 3);
  return `<article class="procard"><div class="pro-body">
    <div class="pro-top">
      <span class="avatar" aria-hidden="true">${esc(initials(p.name))}</span>
      <div>
        <p class="sample-flag">Sample profile</p>
        <h3><a href="/professionals/${esc(p.id)}">${esc(p.name)}</a></h3>
        <p class="muted">${esc(p.business)}</p>
      </div>
    </div>
    <p class="muted">${esc(cityName(p.city))} · ${esc(p.area)}</p>
    <p class="muted">${esc(p.experienceLabel)} · ${esc(p.hours)}</p>
    <p>${p.starting ? `Starting ${money(p.starting)} · sample` : "Quote based · sample"}</p>
    <div class="chips">${sv.map((n) => `<span>${esc(n)}</span>`).join("")}</div>
    <div class="actions">
      <a class="btn btn-ghost btn-sm" href="/professionals/${esc(p.id)}">View profile</a>
      <a class="btn btn-navy btn-sm" href="/quote/request?service=${esc(p.services[0])}&pro=${esc(p.id)}">Get quote</a>
      <button class="btn btn-line btn-sm" type="button" data-action="contact" data-kind="call" data-name="${esc(p.name)}">Call</button>
    </div>
  </div></article>`;
}

function shopCard(s) {
  return `<article class="shopcard">
    <a class="shop-media" href="/shops/${esc(s.id)}"><img src="${esc(s.image)}" alt="${esc(s.imageAlt)}" loading="lazy">${sampleChip()}</a>
    <div class="shop-body">
      <p class="sample-flag">Sample shop</p>
      <h3><a href="/shops/${esc(s.id)}">${esc(s.name)}</a></h3>
      <p class="muted">${esc(s.area)}, ${esc(cityName(s.city))}</p>
      <p class="muted"><span class="stars" aria-hidden="true">${stars(s.rating)}</span> Sample rating ${esc(s.rating)} · ${esc(s.hours)}</p>
      <p class="muted">${esc(s.productsNote)}</p>
      <div class="chips">${s.services.slice(0, 3).map((n) => `<span>${esc(n)}</span>`).join("")}</div>
      <div class="actions">
        <a class="btn btn-ghost btn-sm" href="/shops/${esc(s.id)}">View shop</a>
        <a class="btn btn-navy btn-sm" href="/shop?seller=${esc(s.id)}">View products</a>
        <button class="btn btn-line btn-sm" type="button" data-action="contact" data-kind="call" data-name="${esc(s.name)}">Call</button>
        ${s.install ? `<a class="btn btn-green btn-sm" href="/book?service=cctv-installation&shop=${esc(s.id)}">Get installation</a>` : ""}
      </div>
    </div>
  </article>`;
}

function reviewList(kind, id) {
  const rows = reviewsFor(kind, id);
  if (!rows.length) return `<p class="muted">No sample notes for this listing.</p>`;
  return `<div class="note">These notes are layout samples. A review can be published only after the backend confirms an eligible completed order. That check is not connected.</div>
  <div class="grid-pros" style="margin-top:12px">${rows.map((r) => `<article class="tcard"><p class="stars" aria-label="Sample rating ${esc(r.rating)} of 5">${stars(r.rating)}</p><p style="margin:8px 0">${esc(r.text)}</p><p class="muted">${esc(r.author)} · ${esc(r.date)} · Sample</p></article>`).join("")}</div>`;
}

function header() {
  const q = qs().q || "";
  const count = cartCount();
  const loc = getState().location;
  const path = location.pathname;
  const item = (href, label) => `<a href="${href}" ${path === href ? 'aria-current="page"' : ""}>${label}</a>`;
  return `<div class="wrap header-row">
    <a class="logo" href="/" aria-label="NAYAN SECURITY home">${logoMark()}<span class="logo-word"><strong>NAYAN</strong><span>SECURITY</span></span></a>
    <nav class="primary-nav" aria-label="Primary">
      ${item("/", "Home")}
      ${item("/services", "Services")}
      ${item("/shop", "Shop")}
      ${item("/professionals", "Professionals")}
      ${item("/orders", "My Orders")}
      ${item("/support", "Support")}
      ${isAdmin() ? item("/admin/security", "Security") : ""}
    </nav>
    <div class="header-tools">
      <form class="search-inline" action="/search" role="search" aria-label="Search the marketplace">
        ${icon("search", "ico ico-sm")}
        <input name="q" type="search" placeholder="Search" value="${esc(q)}" aria-label="Search products, services, professionals, shops">
      </form>
      <button class="text-btn" type="button" data-action="open-location" aria-haspopup="dialog" aria-label="Location, ${esc(cityName(loc.city))}">${icon("pin", "ico ico-sm")} <span class="loc-label">${esc(cityName(loc.city))}</span></button>
      <a class="icon-btn cart-link" href="/cart" aria-label="Cart, ${count} items">${icon("cart")}${count ? `<span class="badge">${count}</span>` : ""}</a>
      <a class="text-btn" href="${signedIn() ? "/profile" : "/auth"}"><span class="signin-label">${esc(accountLabel())}</span>${icon("user", "ico ico-sm")}</a>
      <button class="icon-btn menu-btn" type="button" data-action="toggle-menu" aria-expanded="${ui.menu ? "true" : "false"}" aria-controls="mobile-drawer" aria-label="Menu">${icon(ui.menu ? "close" : "menu")}</button>
    </div>
  </div>
  <div id="mobile-drawer" class="mobile-drawer ${ui.menu ? "open" : ""}">
    <form action="/search" role="search" style="margin:8px 0">
      <label for="msearch">Search</label>
      <input id="msearch" name="q" type="search" placeholder="Products, services, shops" value="${esc(q)}">
    </form>
    <a href="/">Home</a><a href="/services">Services</a><a href="/shop">Shop</a><a href="/shops">CCTV shops</a>
    <a href="/professionals">Professionals</a><a href="/orders">My orders</a><a href="/support">Support</a>
    <a href="/cart">Cart</a><a href="/profile">Profile</a><a href="${signedIn() ? "/profile" : "/auth"}">${esc(accountLabel())}</a>
    ${isAdmin() ? `<a href="/admin/security">Security</a>` : ""}
    <button class="linkish" type="button" data-action="open-location">Location · ${esc(cityName(loc.city))}</button>
  </div>`;
}

function footer() {
  const col = (title, links) => `<div><h2>${title}</h2><ul>${links.map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join("")}</ul></div>`;
  return `<div class="wrap footer-grid">
    <div class="footer-brand">${logoMark()}
      <h2 style="letter-spacing:0.14em;margin-top:10px">NAYAN SECURITY</h2>
      <p>Smart Security. Trusted Service. A CCTV marketplace for products, installation, repair and local shops — starting in Rajasthan.</p>
    </div>
    ${col("Explore", [["/services", "Services"], ["/shop", "Shop"], ["/shops", "CCTV shops"], ["/professionals", "Professionals"], ["/packages/pkg-4", "Packages"]])}
    ${col("Help", [["/support", "Support"], ["/support/ticket", "Create a ticket"], ["/orders", "My orders"], ["/about", "About"], ["/contact", "Contact"]])}
    ${col("Policies", [["/terms", "Terms"], ["/privacy", "Privacy"], ["/refund", "Refund / cancellation"], ["/warranty", "Warranty"], ["/amc", "AMC"]])}
  </div>
  <div class="wrap legal-row"><span>© ${new Date().getFullYear()} NAYAN SECURITY</span><span>Preview build. Social profiles are not connected.</span><span>Initial focus: Bikaner, Rajasthan</span></div>`;
}

function tabbar() {
  const path = location.pathname;
  const on = (href) => (href === "/" ? path === "/" : path.startsWith(href)) ? 'aria-current="page"' : "";
  const tab = (href, name, label) => `<a href="${href}" ${on(href)}>${icon(name)}<span>${label}</span></a>`;
  return `<nav aria-label="Mobile">${tab("/", "home", "Home")}${tab("/services", "grid", "Services")}${tab("/shop", "shop", "Shop")}${tab("/orders", "receipt", "Orders")}${tab("/profile", "user", "Profile")}</nav>`;
}

function previewBar() {
  return `<div class="wrap"><strong>Sample catalog.</strong> Shops, professionals and reviews are labeled samples. Accounts and product orders are saved on the server. An order stays unpaid until the server verifies the gateway. <a href="/about">About this preview</a></div>`;
}

function homePage() {
  const loc = cityName(city());
  const pros = visiblePros().slice(0, 3);
  const shopList = visibleShops().slice(0, 4);
  const popular = ["bullet-4mp", "dome-2mp", "wifi-indoor", "nvr-8ch", "ptz-4mp", "kit-4"].map(productById);
  return `<div class="page">
    <section class="wrap hero">
      <div>
        <p class="kicker">CCTV marketplace · ${esc(loc)}</p>
        <h1>Secure Your Home &amp; Business With Trusted CCTV Experts</h1>
        <p class="lede">Buy CCTV products, book installation and repair services, and connect with trusted local security professionals.</p>
        <div class="cta-row">
          <a class="btn btn-navy" href="/shop">Buy CCTV</a>
          <a class="btn btn-green" href="/book?service=cctv-installation">Book installation</a>
          <a class="btn btn-line" href="/services/cctv-repair">Get CCTV repair</a>
        </div>
        <div class="hero-points"><span class="pill">Products</span><span class="pill">Services</span><span class="pill">Local shops</span><span class="pill">Local professionals</span></div>
      </div>
      <div class="hero-frame">
        <img src="/images/hero-camera.jpg" alt="White security camera under the eaves of a limestone home" width="1586" height="992" fetchpriority="high">
        <aside class="hero-card">
          <p class="kicker">Marketplace desk</p>
          <ul>
            <li><span>Product</span><small>4MP bullet · sample</small></li>
            <li><span>Professional</span><small>Sample profile · ${esc(loc)}</small></li>
            <li><span>Order</span><small>Not booked</small></li>
          </ul>
        </aside>
      </div>
    </section>

    <section class="section wrap" aria-labelledby="svc-h">
      <div class="section-head"><div><p class="kicker">01 — Services</p><h2 id="svc-h">CCTV services</h2></div><a href="/services">All services</a></div>
      <div class="grid-services">${services.map(serviceCard).join("")}</div>
    </section>

    <section class="section wrap" aria-labelledby="cat-h">
      <div class="section-head"><div><p class="kicker">02 — Shop</p><h2 id="cat-h">Product categories</h2></div><a href="/shop">Open shop</a></div>
      <div class="grid-cats">${productCategories.map((c) => `<a class="ccard" href="/shop?cat=${esc(c.id)}"><h3>${esc(c.name)}</h3><span>${esc(c.blurb)}</span></a>`).join("")}</div>
    </section>

    <section class="section wrap" aria-labelledby="pop-h">
      <div class="section-head"><div><p class="kicker">03 — Catalog</p><h2 id="pop-h">Popular CCTV products</h2><p>Sample prices. A seller invoice can still differ.</p></div></div>
      <div class="grid-products">${popular.map(productCard).join("")}</div>
    </section>

    <section class="section wrap" aria-labelledby="pkg-h">
      <div class="section-head"><div><p class="kicker">04 — Packages</p><h2 id="pkg-h">Complete camera packages</h2><p>Starting prices are samples. Installation can be added, not assumed.</p></div></div>
      <div class="grid-packages">${packages.map(packageCard).join("")}</div>
    </section>

    <section class="section wrap">
      <div class="band">
        <div>
          <p class="kicker" style="color:#9eb7e6">Installation</p>
          <h2>Book CCTV installation</h2>
          <p style="margin:10px 0 14px">Home installation, business installation, camera configuration, networking and remote viewing. You request, see who covers the city, confirm a price or quote, schedule, then review the work.</p>
          <ul class="chips" style="margin-bottom:16px"><li class="tag">Request</li><li class="tag">Provider discovery</li><li class="tag">Quote or price</li><li class="tag">Schedule</li><li class="tag">Installation</li><li class="tag">Completion</li><li class="tag">Review</li></ul>
          <a class="btn btn-green" href="/book?service=cctv-installation">Book installation</a>
        </div>
        <img src="/images/install-scene.jpg" alt="Technician installing a camera on a shopfront">
      </div>
    </section>

    <section class="section wrap" aria-labelledby="rep-h">
      <div class="section-head"><div><p class="kicker">Repair</p><h2 id="rep-h">CCTV repair</h2><p>Existing systems. Price comes from a quote, not a guess.</p></div><a class="btn btn-navy" href="/book?service=cctv-repair">Book repair</a></div>
      <div class="issues">${repairIssues.map((r) => `<a class="issue" href="/book?service=${esc(r.service)}&issue=${esc(r.id)}"><span>${esc(r.name)}</span>${icon("arrow", "ico ico-sm")}</a>`).join("")}</div>
    </section>

    <section class="section wrap" aria-labelledby="pro-h">
      <div class="section-head"><div><p class="kicker">Professionals · ${esc(loc)}</p><h2 id="pro-h">Nearby professionals</h2><p>Sample profiles only. Live distance is not calculated.</p></div><a href="/professionals">View all</a></div>
      ${pros.length ? `<div class="grid-pros">${pros.map(proCard).join("")}</div>` : emptyState("No sample professionals in this city", "Change city, or show every sample city.", "/professionals", "Browse professionals")}
    </section>

    <section class="section wrap" aria-labelledby="shop-h">
      <div class="section-head"><div><p class="kicker">Shops · ${esc(loc)}</p><h2 id="shop-h">CCTV shops</h2></div><a href="/shops">All shops</a></div>
      ${shopList.length ? `<div class="grid-shops">${shopList.map(shopCard).join("")}</div>` : emptyState("No sample shops in this city", "Try another city from the location control.", "/shops", "Browse shops")}
    </section>

    <section class="section wrap" aria-labelledby="why-h">
      <div class="section-head"><div><p class="kicker">Trust</p><h2 id="why-h">Why NAYAN SECURITY?</h2></div></div>
      <div class="grid-trust">${trustPoints.map((t) => `<article class="tcard"><h3>${esc(t.title)}</h3><p class="muted" style="margin-top:8px">${esc(t.text)}</p></article>`).join("")}</div>
    </section>

    <section class="section wrap" aria-labelledby="how-h">
      <div class="section-head"><div><p class="kicker">How it works</p><h2 id="how-h">Four steps</h2></div></div>
      <div class="steps">${steps.map((s) => `<article class="step"><b>${esc(s.n)}</b><h3>${esc(s.title)}</h3><p class="muted" style="margin-top:8px">${esc(s.text)}</p></article>`).join("")}</div>
    </section>

    <section class="section wrap" aria-labelledby="gal-h">
      <div class="section-head"><div><p class="kicker">Gallery</p><h2 id="gal-h">Before and after reference</h2><p>Sample photos for layout. Not NAYAN SECURITY project work.</p></div></div>
      <div class="grid-packages">${gallery.map((g) => `<figure class="pkg"><div class="pkg-media"><img src="${esc(g.src)}" alt="${esc(g.alt)}" loading="lazy"></div><figcaption class="pkg-body"><p>${esc(g.caption)}</p></figcaption></figure>`).join("")}</div>
    </section>

    <section class="section wrap" aria-labelledby="tes-h">
      <div class="section-head"><div><p class="kicker">Voices</p><h2 id="tes-h">Testimonials</h2></div></div>
      <div class="note" style="margin-bottom:12px">Sample quotes for layout preview. Not real customer reviews.</div>
      <div class="grid-pros">${testimonials.map((t) => `<blockquote class="tcard"><q>${esc(t.quote)}</q><p class="muted">${esc(t.who)} · ${esc(t.city)}</p></blockquote>`).join("")}</div>
    </section>

    <section class="section wrap" aria-labelledby="faq-h">
      <div class="section-head"><div><p class="kicker">FAQ</p><h2 id="faq-h">Questions</h2></div></div>
      <div class="faq">${faqs.map((f, i) => `<details ${i === 0 ? "open" : ""}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</div>
    </section>

    <section class="section wrap">
      <div class="panel" style="padding:22px;display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center">
        <div><h2>Need a hand with a booking?</h2><p class="muted">Support tickets stay on this device until a support inbox is connected.</p></div>
        <a class="btn btn-navy" href="/support">Create support ticket</a>
      </div>
    </section>
  </div>`;
}

function packageCard(p) {
  return `<article class="pkg ${p.featured ? "featured" : ""}">
    <div class="pkg-media"><img src="${esc(p.image)}" alt="${esc(p.alt)}" loading="lazy">${sampleChip()}</div>
    <div class="pkg-body">
      <p class="brand">${p.cameras} cameras</p>
      <h3>${esc(p.name)}</h3>
      <p>${esc(p.bestFor)}</p>
      <ul>${p.includes.slice(0, 4).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
      <p class="price"><strong>From ${money(p.starting)}</strong></p>
      <p class="muted">Sample starting price</p>
      <a class="btn ${p.featured ? "btn-green" : "btn-navy"}" href="/packages/${esc(p.id)}">View package</a>
    </div>
  </article>`;
}

function servicesPage() {
  return `<div class="page wrap">
    ${crumbs([{ href: "/", label: "Home" }, { label: "Services" }])}
    <p class="kicker">Services</p>
    <h1>CCTV services</h1>
    <p class="lede" style="margin:10px 0 18px">Installation, repair, maintenance, AMC and setup. Fixed starting prices are samples. Site-dependent work is quoted.</p>
    <div class="grid-services">${services.map(serviceCard).join("")}</div>
  </div>`;
}

function servicePage(id) {
  const s = serviceById(id);
  if (!s) return notFound("Service");
  const pros = visiblePros().filter((p) => p.services.includes(s.id));
  const extra = serviceFaqs[s.id] || [];
  const price = s.priceType === "quote" ? "Quote based" : `Starting ${money(s.startingPrice)}`;
  return `<div class="page wrap">
    ${crumbs([{ href: "/", label: "Home" }, { href: "/services", label: "Services" }, { label: s.name }])}
    <div class="service-hero">
      <div>
        <div class="cover"><img src="${esc(s.image)}" alt="${esc(s.alt)}">${sampleChip()}</div>
        <div class="video-slot">
          <img src="${esc(s.image)}" alt="">
          <div><p class="kicker" style="color:#d7e4ff">Video</p><p>Service video is not connected. Nothing will autoplay.</p></div>
        </div>
      </div>
      <div>
        <p class="sample-flag">Sample service</p>
        <h1>${esc(s.name)}</h1>
        <p class="muted" style="margin:8px 0"><span class="stars" aria-hidden="true">${stars(4.6)}</span> Sample rating · not a live score</p>
        <p class="price"><strong>${esc(price)}</strong></p>
        <p style="margin:10px 0">${esc(s.description)}</p>
        <div class="cta-row">
          <a class="btn btn-green" href="/book?service=${esc(s.id)}">Book now</a>
          <a class="btn btn-navy" href="/quote/request?service=${esc(s.id)}">Get quote</a>
          <button class="btn btn-ghost" type="button" data-action="contact" data-kind="call" data-name="${esc(s.name)}">Call</button>
          <button class="btn btn-ghost" type="button" data-action="contact" data-kind="whatsapp" data-name="${esc(s.name)}">WhatsApp</button>
        </div>
        <div class="panel" style="margin-top:16px;padding:14px">
          <h2 style="font-size:1.3rem">What's included</h2>
          <ul style="margin-top:8px">${s.included.map((i) => `<li>• ${esc(i)}</li>`).join("")}</ul>
          <h2 style="font-size:1.3rem;margin-top:12px">What's not included</h2>
          <ul style="margin-top:8px">${s.excluded.map((i) => `<li>• ${esc(i)}</li>`).join("")}</ul>
          <p style="margin-top:10px"><strong>Duration.</strong> ${esc(s.duration)}</p>
          <p style="margin-top:6px"><strong>Warranty.</strong> ${esc(s.warranty)}</p>
        </div>
      </div>
    </div>
    <section class="section">
      <h2>Nearby professionals</h2>
      <p class="muted" style="margin:6px 0 12px">Filtered to ${esc(cityName(city()))}${getState().showAllCities ? " and other sample cities" : ""}. Profiles are samples.</p>
      ${pros.length ? `<div class="grid-pros">${pros.map(proCard).join("")}</div>` : emptyState("No sample professional for this service in the selected city", "Change city or show all sample cities.", "/professionals", "See professionals")}
    </section>
    <section>
      <h2>FAQ</h2>
      <div class="faq" style="margin-top:10px">${[...extra, ...faqs.slice(0, 3)].map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</div>
    </section>
    <section class="section"><h2>Sample reviews</h2>${reviewList("service", s.id)}</section>
  </div>`;
}

function shopPage() {
  const q = qs();
  const cat = q.cat || "";
  const seller = q.seller || "";
  const sort = q.sort || "featured";
  const stock = q.stock || "all";
  const brand = q.brand || "";
  const text = (q.q || "").trim().toLowerCase();
  let list = products.slice();
  if (cat) list = list.filter((p) => p.categories.includes(cat));
  if (seller) list = list.filter((p) => p.seller === seller);
  if (brand) list = list.filter((p) => p.brand === brand);
  if (stock === "in") list = list.filter((p) => p.stock > 0);
  if (text) list = list.filter((p) => (p.name + p.brand + p.model).toLowerCase().includes(text));
  if (sort === "price-asc") list.sort((a, b) => a.price - b.price);
  if (sort === "price-desc") list.sort((a, b) => b.price - a.price);
  if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
  const brands = [...new Set(products.map((p) => p.brand))];
  const title = cat ? (categoryById(cat)?.name || "Shop") : seller ? (shopById(seller)?.name || "Shop") : "Shop";
  const opt = (value, label, current) => `<option value="${esc(value)}" ${current === value ? "selected" : ""}>${esc(label)}</option>`;
  return `<div class="page wrap">
    ${crumbs([{ href: "/", label: "Home" }, { label: "Shop" }])}
    <p class="kicker">Marketplace</p>
    <h1>${esc(title)}</h1>
    <p class="lede" style="margin:8px 0 16px">Sample catalog. Stock and prices are not a live inventory feed.</p>
    <div class="layout-2">
      <form class="filters" id="shop-filters" aria-label="Filter products">
        <div class="field"><label for="fq">Search in shop</label><input id="fq" name="q" type="search" value="${esc(q.q || "")}"></div>
        <div class="field"><label for="fcat">Category</label><select id="fcat" name="cat"><option value="">All categories</option>${productCategories.map((c) => opt(c.id, c.name, cat)).join("")}</select></div>
        <div class="field"><label for="fbrand">Brand</label><select id="fbrand" name="brand"><option value="">All sample brands</option>${brands.map((b) => opt(b, b, brand)).join("")}</select></div>
        <div class="field"><label for="fseller">Seller</label><select id="fseller" name="seller"><option value="">All sample sellers</option>${shops.map((s) => opt(s.id, s.name, seller)).join("")}</select></div>
        <div class="field"><label for="fsort">Sort</label><select id="fsort" name="sort">${opt("featured", "Featured", sort)}${opt("price-asc", "Price: low to high", sort)}${opt("price-desc", "Price: high to low", sort)}${opt("name", "Name", sort)}</select></div>
        <div class="field"><label for="fstock">Stock</label><select id="fstock" name="stock">${opt("all", "All", stock)}${opt("in", "In stock only", stock)}</select></div>
        <button class="btn btn-navy btn-block" type="submit">Apply</button>
      </form>
      <div>
        <p class="muted" style="margin-bottom:10px">${list.length} sample product${list.length === 1 ? "" : "s"}</p>
        ${list.length ? `<div class="grid-products">${list.map(productCard).join("")}</div>` : emptyState("No products", "No sample product matches these filters.", "/shop", "Clear filters")}
      </div>
    </div>
  </div>`;
}

function productPage(id) {
  const p = productById(id);
  if (!p) return notFound("Product");
  const seller = shopById(p.seller);
  const off = discountPercent(p);
  const stock = stockLabel(p);
  const disabled = p.stock <= 0;
  const delivers = seller?.deliveryCities.includes(city());
  return `<div class="page wrap">
    ${crumbs([{ href: "/", label: "Home" }, { href: "/shop", label: "Shop" }, { label: p.name }])}
    <div class="product-hero">
      <div>
        <div class="cover">${mediaHTML(p.image, p.alt)}${sampleChip()}${off ? `<span class="chip-off">${off}% off</span>` : ""}</div>
        <div class="video-slot"><div><p class="kicker" style="color:#d7e4ff">Product video</p><p>No product video is attached. It will not autoplay.</p></div></div>
      </div>
      <div>
        <p class="brand">${esc(p.brand)} · ${esc(p.model)}</p>
        <h1>${esc(p.name)}</h1>
        <p class="muted" style="margin:8px 0">Sample rating ${esc(p.rating)} · SKU ${esc(p.sku)}</p>
        <p class="price"><s>${money(p.mrp)}</s> <strong>${money(p.price)}</strong></p>
        <p class="stock ${stock.key}">${esc(stock.text)}</p>
        <p style="margin:10px 0">${esc(p.description)}</p>
        <p><strong>Warranty.</strong> ${esc(p.warranty)}</p>
        <p style="margin-top:6px"><strong>Delivery.</strong> ${delivers ? `Sample seller lists ${esc(cityName(city()))}.` : `This sample seller does not list delivery in ${esc(cityName(city()))}. Pickup may still be discussed.`}</p>
        <p style="margin-top:6px"><strong>Installation.</strong> Optional. A starting labour estimate can be added. It is not a site quote.</p>
        <div class="panel" style="margin:12px 0;padding:12px">
          <p class="sample-flag">Seller</p>
          <h2 style="font-size:1.35rem"><a href="/shops/${esc(seller.id)}">${esc(seller.name)}</a></h2>
          <p class="muted">${esc(seller.area)}, ${esc(cityName(seller.city))} · ${esc(seller.hours)}</p>
          <p class="muted">Verification is not live. This shop is a sample profile.</p>
        </div>
        <div class="cta-row">
          <button class="btn btn-navy" type="button" data-action="add-cart" data-id="${esc(p.id)}" ${disabled ? "disabled" : ""}>Add to cart</button>
          <button class="btn btn-green" type="button" data-action="buy-now" data-id="${esc(p.id)}" ${disabled ? "disabled" : ""}>Buy now</button>
          <button class="btn btn-ghost" type="button" data-action="get-install" data-id="${esc(p.id)}" ${disabled ? "disabled" : ""}>Get installation</button>
          <button class="btn btn-line" type="button" data-action="contact" data-kind="call" data-name="${esc(seller.name)}">Contact shop</button>
        </div>
      </div>
    </div>
    <section class="section">
      <h2>Specifications</h2>
      <table class="spec-table"><tbody>${p.specs.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>
    </section>
    <section><h2>Sample reviews</h2>${reviewList("product", p.id)}</section>
  </div>`;
}

function packagePage(id) {
  const p = packageById(id);
  if (!p) return notFound("Package");
  return `<div class="page wrap">
    ${crumbs([{ href: "/", label: "Home" }, { label: p.name }])}
    <div class="product-hero">
      <div class="cover"><img src="${esc(p.image)}" alt="${esc(p.alt)}">${sampleChip()}</div>
      <div>
        <p class="sample-flag">Sample package</p>
        <h1>${esc(p.name)}</h1>
        <p class="lede" style="margin-top:8px">${esc(p.bestFor)}</p>
        <p class="price" style="margin:10px 0"><strong>From ${money(p.starting)}</strong></p>
        <p class="muted">Starting price for layout. Not a confirmed quote. Tax is not calculated.</p>
        <h2 style="font-size:1.3rem;margin-top:16px">Included in the sample outline</h2>
        <ul>${p.includes.map((i) => `<li>• ${esc(i)}</li>`).join("")}</ul>
        <h2 style="font-size:1.3rem;margin-top:12px">Not assumed</h2>
        <ul>${p.excludes.map((i) => `<li>• ${esc(i)}</li>`).join("")}</ul>
        <form id="package-form" class="panel" style="margin-top:16px;padding:14px">
          <input type="hidden" name="package" value="${esc(p.id)}">
          <label class="check"><input type="checkbox" name="install" value="yes"> Add installation option to this request</label>
          <p class="muted" style="margin:8px 0">Installation is optional and still needs a site quote.</p>
          <button class="btn btn-green" type="submit">Request this package</button>
        </form>
      </div>
    </div>
  </div>`;
}

function professionalsPage() {
  const q = qs();
  const service = q.service || "";
  let list = visiblePros();
  if (service) list = list.filter((p) => p.services.includes(service));
  return `<div class="page wrap">
    ${crumbs([{ href: "/", label: "Home" }, { label: "Professionals" }])}
    <p class="kicker">Local network</p>
    <h1>CCTV professionals</h1>
    <p class="lede" style="margin:8px 0 12px">Showing ${getState().showAllCities ? "all sample cities" : esc(cityName(city()))}. Badges say sample because verification is not connected. Distance is hidden on purpose.</p>
    <div class="cta-row" style="margin-bottom:14px">
      <button class="btn btn-ghost" type="button" data-action="toggle-cities">${getState().showAllCities ? "Limit to selected city" : "Show other sample cities"}</button>
      <a class="btn btn-line" href="/professionals">All services</a>
    </div>
    <form id="pro-filters" class="filters" style="position:static;margin-bottom:14px">
      <label for="psvc">Service</label>
      <select id="psvc" name="service">${`<option value="">Any service</option>` + services.map((s) => `<option value="${esc(s.id)}" ${service === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
    </form>
    ${list.length ? `<div class="grid-pros">${list.map(proCard).join("")}</div>` : emptyState("No sample professionals", "None match this city and service.", "/professionals", "Reset")}
  </div>`;
}

function professionalPage(id) {
  const p = proById(id);
  if (!p) return notFound("Professional");
  const sv = p.services.map(serviceById).filter(Boolean);
  return `<div class="page wrap">
    ${crumbs([{ href: "/", label: "Home" }, { href: "/professionals", label: "Professionals" }, { label: p.name }])}
    <div class="profile-hero">
      <div>
        <div class="pro-top" style="margin-bottom:12px">
          <span class="avatar" style="width:72px;height:72px;font-size:22px" aria-hidden="true">${esc(initials(p.name))}</span>
          <div>
            <p class="sample-flag">Sample profile · not verified live</p>
            <h1>${esc(p.name)}</h1>
            <p class="muted">${esc(p.business)}</p>
          </div>
        </div>
        <p>${esc(p.bio)}</p>
        <p style="margin-top:8px"><strong>Area.</strong> ${esc(p.area)}, ${esc(cityName(p.city))}</p>
        <p><strong>Hours.</strong> ${esc(p.hours)} · sample availability</p>
        <p><strong>Experience line.</strong> ${esc(p.experienceLabel)}</p>
        <p><strong>Price.</strong> ${p.starting ? `Starting ${money(p.starting)} sample labour` : "Quote based"}</p>
        <div class="cta-row">
          <a class="btn btn-green" href="/book?service=${esc(p.services[0])}&pro=${esc(p.id)}">Book service</a>
          <a class="btn btn-navy" href="/quote/request?service=${esc(p.services[0])}&pro=${esc(p.id)}">Get quote</a>
          <button class="btn btn-ghost" type="button" data-action="contact" data-kind="call" data-name="${esc(p.name)}">Call</button>
          <button class="btn btn-ghost" type="button" data-action="contact" data-kind="whatsapp" data-name="${esc(p.name)}">WhatsApp</button>
        </div>
      </div>
      <div class="panel" style="padding:14px">
        <h2 style="font-size:1.3rem">Services</h2>
        <div class="chips" style="margin-top:8px">${sv.map((s) => `<a class="tag" href="/services/${esc(s.id)}">${esc(s.name)}</a>`).join("")}</div>
        <h2 style="font-size:1.3rem;margin-top:16px">Portfolio</h2>
        <div class="gallery-row" style="grid-template-columns:1fr 1fr">${p.portfolio.map((g) => `<figure><img src="${esc(g.src)}" alt="${esc(g.alt)}" loading="lazy"><figcaption class="muted" style="font-size:13px;margin-top:4px">${esc(g.caption)}</figcaption></figure>`).join("")}</div>
      </div>
    </div>
    <section class="section"><h2>Sample reviews</h2>${reviewList("professional", p.id)}</section>
  </div>`;
}

function shopsPage() {
  const list = visibleShops();
  return `<div class="page wrap">
    ${crumbs([{ href: "/", label: "Home" }, { label: "CCTV shops" }])}
    <p class="kicker">Sellers</p>
    <h1>CCTV shops</h1>
    <p class="lede" style="margin:8px 0 14px">Sample shops for ${getState().showAllCities ? "all preview cities" : esc(cityName(city()))}. A verified badge is not shown, because none of these shops have passed a live check.</p>
    <button class="btn btn-ghost" type="button" data-action="toggle-cities" style="margin-bottom:14px">${getState().showAllCities ? "Limit to selected city" : "Show other sample cities"}</button>
    ${list.length ? `<div class="grid-shops">${list.map(shopCard).join("")}</div>` : emptyState("No sample shops", "Change the city.", "/shops", "Refresh")}
  </div>`;
}

function shopProfile(id) {
  const s = shopById(id);
  if (!s) return notFound("Shop");
  const q = (qs().q || "").toLowerCase();
  const sort = qs().sort || "featured";
  let list = products.filter((p) => p.seller === s.id);
  if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
  if (sort === "price-asc") list.sort((a, b) => a.price - b.price);
  if (sort === "price-desc") list.sort((a, b) => b.price - a.price);
  return `<div class="page wrap">
    ${crumbs([{ href: "/", label: "Home" }, { href: "/shops", label: "Shops" }, { label: s.name }])}
    <div class="cover" style="aspect-ratio:16/7;margin-bottom:16px"><img src="${esc(s.image)}" alt="${esc(s.imageAlt)}">${sampleChip()}</div>
    <div class="profile-hero">
      <div>
        <p class="sample-flag">Sample shop · verification not live</p>
        <h1>${esc(s.name)}</h1>
        <p class="muted">${esc(s.area)}, ${esc(cityName(s.city))} · ${esc(s.hours)}</p>
        <p style="margin:8px 0">${esc(s.about)}</p>
        <p>Sample rating ${esc(s.rating)}. ${esc(s.reviewCount)} layout notes, not verified reviews.</p>
        <div class="chips" style="margin-top:8px">${s.services.map((n) => `<span>${esc(n)}</span>`).join("")}</div>
        <div class="cta-row">
          <a class="btn btn-navy" href="/shop?seller=${esc(s.id)}">View products</a>
          ${s.install ? `<a class="btn btn-green" href="/book?service=cctv-installation&shop=${esc(s.id)}">Get installation</a>` : ""}
          <button class="btn btn-ghost" type="button" data-action="contact" data-kind="call" data-name="${esc(s.name)}">Call</button>
        </div>
      </div>
      <div class="panel" style="padding:14px">
        <h2 style="font-size:1.25rem">About this sample shop</h2>
        <p style="margin-top:8px"><strong>Delivery.</strong> Listed sample cities: ${s.deliveryCities.map(cityName).join(", ")}.</p>
        <p><strong>Installation.</strong> ${s.install ? "Listed as available in sample data." : "Not listed."}</p>
        <p><strong>Repair.</strong> ${s.repair ? "Listed as available in sample data." : "Not listed."}</p>
        <p class="muted" style="margin-top:8px">Opening hours are sample text.</p>
      </div>
    </div>
    <section class="section">
      <div class="section-head"><h2>Products</h2></div>
      <form id="seller-filters" class="filters filter-bar" style="position:static;margin-bottom:12px">
        <div><label for="sq">Search</label><input id="sq" name="q" type="search" value="${esc(qs().q || "")}"></div>
        <div><label for="ss">Sort</label><select id="ss" name="sort"><option value="featured" ${sort === "featured" ? "selected" : ""}>Featured</option><option value="price-asc" ${sort === "price-asc" ? "selected" : ""}>Price low</option><option value="price-desc" ${sort === "price-desc" ? "selected" : ""}>Price high</option></select></div>
        <button class="btn btn-navy" type="submit">Apply</button>
      </form>
      ${list.length ? `<div class="grid-products">${list.map(productCard).join("")}</div>` : emptyState("No products", "This sample shop has no matching product.", `/shops/${s.id}`, "Clear")}
    </section>
    <section><h2>Sample reviews</h2>${reviewList("shop", s.id)}</section>
  </div>`;
}

function searchPage() {
  const q = (qs().q || "").trim();
  const res = searchAll(q);
  const total = res.products.length + res.services.length + res.professionals.length + res.shops.length;
  const block = (title, html, empty) => `<section class="section"><h2>${title}</h2>${html || `<p class="muted">${empty}</p>`}</section>`;
  return `<div class="page wrap">
    <p class="kicker">Search</p>
    <h1>${q ? `Results for “${esc(q)}”` : "Search"}</h1>
    <form action="/search" class="filters" style="position:static;margin:12px 0" role="search">
      <label for="gq">Search products, services, professionals and shops</label>
      <input id="gq" name="q" type="search" value="${esc(q)}" autofocus>
    </form>
    ${!q ? emptyState("Type a search", "Try camera, repair, Bikaner, PoE or installation.", "/shop", "Browse the shop") : ""}
    ${q && !total ? emptyState("No matches", "Nothing in the sample catalog matches that search.", "/shop", "Browse products") : ""}
    ${q && total ? `
      ${block("Products", res.products.length ? `<div class="grid-products">${res.products.map(productCard).join("")}</div>` : "", "No products.")}
      ${block("Services", res.services.length ? `<div class="grid-services">${res.services.map(serviceCard).join("")}</div>` : "", "No services.")}
      ${block("Professionals", res.professionals.length ? `<div class="grid-pros">${res.professionals.map(proCard).join("")}</div>` : "", "No professionals.")}
      ${block("Shops", res.shops.length ? `<div class="grid-shops">${res.shops.map(shopCard).join("")}</div>` : "", "No shops.")}
    ` : ""}
  </div>`;
}

function fieldsFor(serviceId) {
  const common = [
    { name: "name", label: "Your name", type: "text", required: true },
    { name: "phone", label: "Mobile number", type: "tel", required: true },
    { name: "address", label: "Service address", type: "textarea", required: true },
    { name: "area", label: "Area", type: "text" },
    { name: "pincode", label: "PIN code", type: "text" },
    { name: "date", label: "Preferred date", type: "date", required: true },
    { name: "time", label: "Preferred time", type: "time" },
    { name: "notes", label: "Notes", type: "textarea" },
    { name: "photos", label: "Photos of the site or fault", type: "file" },
  ];
  const extra = {
    "cctv-installation": [
      { name: "cameras", label: "Camera count", type: "number", required: true },
      { name: "property", label: "Property type", type: "select", options: ["Home", "Shop", "Office", "Warehouse", "Other"] },
      { name: "existing", label: "Existing equipment", type: "text" },
    ],
    "cctv-repair": [
      { name: "issue", label: "Problem", type: "select", options: repairIssues.map((r) => r.name) },
      { name: "existing", label: "Existing cameras / recorder", type: "text" },
    ],
    "dvr-nvr-service": [
      { name: "device", label: "Recorder type", type: "select", options: ["DVR", "NVR", "Not sure"] },
      { name: "symptom", label: "What you see", type: "text", required: true },
    ],
    "cctv-wiring": [{ name: "length", label: "Approximate run", type: "text" }],
    amc: [{ name: "cameras", label: "Cameras on site", type: "number" }],
    "remote-viewing": [{ name: "phoneos", label: "Phone", type: "select", options: ["Android", "iPhone", "Other"] }],
    "wifi-camera-setup": [{ name: "router", label: "Router already working?", type: "select", options: ["Yes", "No", "Not sure"] }],
    "4g-camera-setup": [{ name: "sim", label: "SIM ready?", type: "select", options: ["Yes", "No"] }],
    "ip-camera-setup": [{ name: "cameras", label: "Cameras to add", type: "number" }],
    "cctv-maintenance": [{ name: "cameras", label: "Camera count", type: "number" }],
    "cctv-inspection": [{ name: "cameras", label: "Camera count", type: "number" }],
  };
  return [...(extra[serviceId] || [{ name: "detail", label: "Requirement", type: "text" }]), ...common];
}

function fieldHTML(f, preset = {}) {
  const req = f.required ? "required" : "";
  const val = preset[f.name] || "";
  if (f.type === "textarea") return `<div class="field"><label for="${esc(f.name)}">${esc(f.label)}</label><textarea id="${esc(f.name)}" name="${esc(f.name)}" ${req}>${esc(val)}</textarea></div>`;
  if (f.type === "select") return `<div class="field"><label for="${esc(f.name)}">${esc(f.label)}</label><select id="${esc(f.name)}" name="${esc(f.name)}" ${req}>${f.options.map((o) => `<option ${val === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`;
  if (f.type === "file") return `<div class="field"><label for="${esc(f.name)}">${esc(f.label)}</label><input id="${esc(f.name)}" name="${esc(f.name)}" type="file" accept="image/*,video/*" multiple><p class="file-names muted">Files stay on this device. Upload is not connected.</p></div>`;
  return `<div class="field"><label for="${esc(f.name)}">${esc(f.label)}</label><input id="${esc(f.name)}" name="${esc(f.name)}" type="${esc(f.type)}" value="${esc(val)}" ${req}></div>`;
}

function bookPage() {
  const q = qs();
  const s = serviceById(q.service || "cctv-installation") || services[0];
  const pro = proById(q.pro || "");
  const issue = repairIssues.find((r) => r.id === q.issue);
  const preset = {};
  if (issue) preset.issue = issue.name;
  return `<div class="page wrap">
    ${crumbs([{ href: "/", label: "Home" }, { href: `/services/${s.id}`, label: s.name }, { label: "Book" }])}
    <p class="kicker">Booking draft</p>
    <h1>Book ${esc(s.name)}</h1>
    <p class="lede" style="margin:8px 0 12px">This form matches the fields this service needs. Submitting saves a draft on this device. No professional is notified.</p>
    <div class="split">
      <form id="book-form" class="panel" style="padding:16px" novalidate>
        <input type="hidden" name="service" value="${esc(s.id)}">
        <input type="hidden" name="pro" value="${esc(pro?.id || "")}">
        <input type="hidden" name="shop" value="${esc(q.shop || "")}">
        ${pro ? `<p class="note">Requested with sample profile ${esc(pro.name)}. They will not receive this.</p>` : ""}
        ${fieldsFor(s.id).map((f) => fieldHTML(f, preset)).join("")}
        <button class="btn btn-green" type="submit">Save booking draft</button>
      </form>
      <aside class="summary">
        <h2 style="font-size:1.3rem">What happens next, when live</h2>
        <ol style="margin:10px 0 0 18px;color:var(--muted)">
          <li>Request received</li>
          <li>Eligible professional sees it</li>
          <li>Quote if the price is not fixed</li>
          <li>You accept</li>
          <li>Visit and work</li>
          <li>You confirm completion</li>
        </ol>
        <p class="muted" style="margin-top:10px">${esc(s.priceType === "quote" ? "This service is quote-based." : "Starting figure " + money(s.startingPrice) + " is a sample, not your bill.")}</p>
      </aside>
    </div>
  </div>`;
}

function quoteRequestPage() {
  const q = qs();
  const s = serviceById(q.service || "cctv-repair") || services[1];
  const pro = proById(q.pro || "");
  return `<div class="page wrap">
    ${crumbs([{ href: "/", label: "Home" }, { label: "Get quote" }])}
    <h1>Request a quote</h1>
    <p class="lede" style="margin:8px 0 12px">A live quote would list material, quantity, unit price, labour, installation, travel, extra charges, discount, tax and the total. None of that is calculated as a binding figure here.</p>
    <div class="split">
      <form id="quote-form" class="panel" style="padding:16px" novalidate>
        <input type="hidden" name="service" value="${esc(s.id)}">
        <input type="hidden" name="pro" value="${esc(pro?.id || "")}">
        <div class="field"><label for="svc">Service</label><input id="svc" value="${esc(s.name)}" readonly></div>
        ${pro ? `<div class="field"><label>Professional</label><input value="${esc(pro.name)} · sample" readonly></div>` : ""}
        ${fieldHTML({ name: "name", label: "Your name", type: "text", required: true })}
        ${fieldHTML({ name: "phone", label: "Mobile number", type: "tel", required: true })}
        ${fieldHTML({ name: "detail", label: "What should be quoted?", type: "textarea", required: true })}
        ${fieldHTML({ name: "photos", label: "Photos", type: "file" })}
        <button class="btn btn-navy" type="submit">Save quote request</button>
      </form>
      <aside class="summary">
        <h2 style="font-size:1.25rem">See the quote screen</h2>
        <p class="muted" style="margin:8px 0 12px">A sample quote is available so you can try accept, reject and modification. It was not sent by a professional.</p>
        <a class="btn btn-green btn-block" href="/quote/sample">Open sample quote</a>
      </aside>
    </div>
  </div>`;
}

function sampleQuotePage() {
  const lines = [
    ["Material · connector set", 450],
    ["Labour", 800],
    ["Installation", 0],
    ["Travel", 150],
    ["Additional charges", 0],
    ["Discount", 0],
  ];
  const total = 1400;
  return `<div class="page wrap">
    <div class="note" style="margin-bottom:12px">Sample quote layout. Not sent by a professional. Accepting it does not create a payment or a job.</div>
    <h1>Sample quote · CCTV repair</h1>
    <p class="muted">Quote SQ-PREVIEW · historical sample total stays ${money(total)} even if catalog prices change later.</p>
    <table class="spec-table" style="margin-top:12px"><tbody>
      ${lines.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v ? money(v) : "—"}</td></tr>`).join("")}
      <tr><th scope="row">Tax</th><td>Not calculated in this preview</td></tr>
      <tr><th scope="row">Platform fee</th><td>Not added here. If a fee applies later, it is calculated on the server.</td></tr>
      <tr><th scope="row">Final total</th><td><strong>${money(total)}</strong> · sample</td></tr>
    </tbody></table>
    <div class="cta-row">
      <button class="btn btn-green" type="button" data-action="quote-decision" data-decision="accept">Accept</button>
      <button class="btn btn-ghost" type="button" data-action="quote-decision" data-decision="reject">Reject</button>
      <button class="btn btn-line" type="button" data-action="quote-decision" data-decision="modify">Request modification</button>
    </div>
  </div>`;
}

function cartPage() {
  const totals = cartTotals("pickup");
  if (!totals.lines.length) {
    return `<div class="page wrap"><h1>Cart</h1>${emptyState("Your cart is empty", "Sample products you add are stored in this browser only.", "/shop", "Continue shopping")}</div>`;
  }
  return `<div class="page wrap">
    <h1>Cart</h1>
    <p class="muted" style="margin:6px 0 12px">Catalog prices are samples. Installation lines are starting estimates, not quotes. Tax is not added.</p>
    <div class="split">
      <div class="panel" style="padding:8px 14px">
        ${totals.lines.map((l) => `<div class="line">
          ${mediaHTML(l.product.image, "", 'width="84" height="72"')}
          <div>
            <h2 style="font-family:var(--font);font-size:1rem"><a href="/product/${esc(l.product.id)}">${esc(l.product.name)}</a></h2>
            <p class="muted">${esc(shopById(l.product.seller)?.name || "")}</p>
            <p>${money(l.product.price)} each</p>
            <label class="check" style="margin-top:6px"><input type="checkbox" data-action="toggle-install" data-id="${esc(l.id)}" ${l.install ? "checked" : ""}> Installation option · ${money(INSTALL_EACH)} / unit sample estimate</label>
            <div class="qty" style="margin-top:8px" aria-label="Quantity">
              <button type="button" data-action="qty" data-id="${esc(l.id)}" data-dir="-1" aria-label="Decrease quantity">−</button>
              <span>${l.qty}</span>
              <button type="button" data-action="qty" data-id="${esc(l.id)}" data-dir="1" aria-label="Increase quantity">+</button>
            </div>
          </div>
          <div class="line-end" style="text-align:right">
            <strong>${money(l.total)}</strong>
            <button class="btn btn-ghost btn-sm" type="button" data-action="remove-line" data-id="${esc(l.id)}" style="margin-top:8px">Remove</button>
          </div>
        </div>`).join("")}
      </div>
      <aside class="summary">
        <h2 style="font-size:1.3rem">Summary</h2>
        <p style="display:flex;justify-content:space-between;margin-top:8px"><span>Products</span><span>${money(totals.goods)}</span></p>
        <p style="display:flex;justify-content:space-between"><span>Installation estimates</span><span>${money(totals.install)}</span></p>
        <p style="display:flex;justify-content:space-between"><span>Delivery</span><span>Chosen at checkout</span></p>
        <p style="display:flex;justify-content:space-between"><span>Tax</span><span>Not calculated</span></p>
        <p style="display:flex;justify-content:space-between;margin:8px 0 12px"><strong>Preview subtotal</strong><strong>${money(totals.goods + totals.install)}</strong></p>
        <a class="btn btn-ghost btn-block" href="/shop">Continue shopping</a>
        <a class="btn btn-navy btn-block" href="/checkout" style="margin-top:8px">Proceed to checkout</a>
      </aside>
    </div>
  </div>`;
}

function checkoutPage() {
  const q = qs();
  const delivery = checkoutDraft.delivery || (q.delivery === "home" ? "home" : "pickup");
  const totals = cartTotals(delivery);
  if (!totals.lines.length) return `<div class="page wrap"><h1>Checkout</h1>${emptyState("Nothing to check out", "Add a sample product first.", "/shop", "Go to shop")}</div>`;
  const loc = getState().location;
  return `<div class="page wrap">
    <h1>Checkout</h1>
    <p class="muted" style="margin:6px 0 12px">${signedIn() ? "The server calculates the total. This page cannot mark the order paid." : "Sign in before placing an order. A local draft is not an order."}</p>
    <div class="split">
      <form id="checkout-form" class="panel" style="padding:16px" novalidate>
        <h2 style="font-size:1.3rem">Customer information</h2>
        ${fieldHTML({ name: "name", label: "Name", type: "text", required: true }, checkoutDraft)}
        ${fieldHTML({ name: "phone", label: "Mobile", type: "tel", required: true }, checkoutDraft)}
        ${fieldHTML({ name: "email", label: "Email", type: "email" }, checkoutDraft)}
        <h2 style="font-size:1.3rem;margin-top:8px">Address</h2>
        ${fieldHTML({ name: "address", label: "Address", type: "textarea", required: true }, checkoutDraft)}
        ${fieldHTML({ name: "area", label: "Area", type: "text" }, { area: checkoutDraft.area || loc.area || "" })}
        ${fieldHTML({ name: "pincode", label: "PIN code", type: "text" }, { pincode: checkoutDraft.pincode || loc.pincode || "" })}
        <fieldset class="field" style="border:0;padding:0">
          <legend style="font-weight:700;margin-bottom:6px">Delivery option</legend>
          <label class="check"><input type="radio" name="delivery" value="pickup" ${delivery === "pickup" ? "checked" : ""}> Shop pickup · ${money(0)} sample</label>
          <label class="check"><input type="radio" name="delivery" value="home" ${delivery === "home" ? "checked" : ""}> Home delivery · ${money(DELIVERY_SAMPLE)} sample estimate</label>
        </fieldset>
        <div class="pay-box">
          <h2 style="font-size:1.2rem">Payment</h2>
          <p>Card details are not collected here. If Razorpay keys are configured, the server creates the payment first. A success message in the browser is ignored unless the server verifies the signature and the amount.</p>
          <p class="muted" style="margin-top:8px">Cashfree is not connected. This form cannot mark an order paid.</p>
        </div>
        <button class="btn btn-navy" type="submit" name="intent" value="server" style="margin-top:12px">Place unpaid order</button>
        <button class="btn btn-ghost" type="submit" name="intent" value="draft" style="margin-top:8px">Save draft on this device only</button>
      </form>
      <aside class="summary">
        <h2 style="font-size:1.25rem">Order summary</h2>
        ${totals.lines.map((l) => `<p style="margin-top:8px">${esc(l.product.name)} × ${l.qty}${l.install ? " + installation estimate" : ""}<br><strong>${money(l.total)}</strong></p>`).join("")}
        <hr style="border:0;border-top:1px solid var(--line);margin:10px 0">
        <p style="display:flex;justify-content:space-between"><span>Products</span><span>${money(totals.goods)}</span></p>
        <p style="display:flex;justify-content:space-between"><span>Installation</span><span>${money(totals.install)}</span></p>
        <p style="display:flex;justify-content:space-between"><span>Delivery</span><span>${money(totals.deliveryFee)}</span></p>
        <p style="display:flex;justify-content:space-between"><span>Tax</span><span>Not calculated</span></p>
        <p style="display:flex;justify-content:space-between;margin-top:8px"><strong>Preview total</strong><strong>${money(totals.preview)}</strong></p>
        <p class="muted" style="margin-top:8px">Hidden charges are not added. Commission on the provider side is a server calculation and is not part of this customer total.</p>
      </aside>
    </div>
  </div>`;
}

function orderCardServer(order) {
  const paid = order.payment_status === "PAID";
  return `<article class="order-card" style="padding:14px">
    <p class="sample-flag">${esc(order.status)} · ${esc(order.payment_status)}</p>
    <h2 style="font-size:1.25rem">Server order</h2>
    <p class="muted">${esc(order.id)} · ${esc(order.created_at ? new Date(order.created_at).toLocaleString("en-IN") : "")}</p>
    <p style="margin:6px 0">${(order.items || []).map((item) => `${esc(item.name)} × ${esc(item.qty)}`).join(", ") || "No lines"}</p>
    <p><strong>${rupees(order.total_paise)}</strong> · ${paid ? "Paid after server verification" : "Unpaid"}</p>
    <a class="btn btn-ghost btn-sm" href="/orders/${esc(order.id)}">View order</a>
  </article>`;
}

function ordersPage() {
  const tab = qs().tab || "all";
  const drafts = getState().drafts.filter((d) => {
    if (tab === "services") return d.kind === "service" || d.kind === "quote";
    if (tab === "products") return d.kind === "checkout" || d.kind === "package";
    if (tab === "active") return true;
    if (tab === "completed") return false;
    return true;
  });
  const live = (serverOrders || []).filter((order) => {
    if (tab === "services") return order.order_type === "service";
    if (tab === "products") return order.order_type !== "service";
    if (tab === "completed") return order.status === "ORDER_CLOSED" || order.status === "DELIVERED";
    if (tab === "active") return order.status !== "ORDER_CLOSED" && order.status !== "CANCELLED";
    return true;
  });
  const tabs = ["all", "services", "products", "active", "completed"].map((t) => `<a href="/orders?tab=${t}" ${tab === t ? 'aria-current="page"' : ""}>${t[0].toUpperCase() + t.slice(1)}</a>`).join("");
  const intro = signedIn()
    ? "Server orders are limited to what your account is allowed to see. Device drafts are not submitted jobs."
    : "Sign in to see server orders. Drafts below stay on this device and are not orders.";
  return `<div class="page wrap">
    <h1>My orders</h1>
    <p class="lede" style="margin:8px 0 0">${intro}</p>
    <div class="tabs" role="tablist">${tabs}</div>
    ${live.length ? `<h2 style="font-size:1.2rem">Server orders</h2><div class="grid-pros">${live.map(orderCardServer).join("")}</div>` : `<p class="muted">No server orders in this tab.</p>`}
    <h2 style="font-size:1.2rem;margin-top:18px">Device drafts</h2>
    ${tab === "completed" ? emptyState("No completed orders", "A completed order appears only after fulfilment is recorded on the server.", "/orders", "Back to all") : ""}
    ${tab !== "completed" && !drafts.length ? `<p class="muted">No device drafts in this tab.</p>` : ""}
    <div class="grid-pros">${drafts.map((d) => `<article class="order-card" style="padding:14px">
      <p class="sample-flag">${esc(d.status)}</p>
      <h2 style="font-size:1.25rem">${esc(d.title)}</h2>
      <p class="muted">${esc(d.id)} · ${esc(new Date(d.createdAt).toLocaleString("en-IN"))}</p>
      <p style="margin:6px 0">${esc(d.summary || "")}</p>
      <p><strong>${d.amount ? money(d.amount) + " preview" : "Amount not fixed"}</strong></p>
      <a class="btn btn-ghost btn-sm" href="/orders/${esc(d.id)}">View draft</a>
    </article>`).join("")}</div>
    <section class="section">
      <div class="note navy">The tracking screen below is a layout preview. It is not your order and not a live job.</div>
      <div class="cta-row">
        <a class="btn btn-navy" href="/orders/sample">Preview service tracking</a>
        <a class="btn btn-ghost" href="/orders/sample-product">Preview product tracking</a>
      </div>
    </section>
  </div>`;
}

function timeline(steps, current) {
  return `<ol class="timeline">${steps.map((label, i) => {
    const cls = i < current ? "done" : i === current ? "current" : "";
    const state = i < current ? "Done in this sample" : i === current ? "Current sample step" : "Not reached";
    return `<li class="tl ${cls}"><div class="rail"><span class="dot"></span><span class="stem"></span></div><div><h3>${esc(label)}</h3><p>${state}</p></div></li>`;
  }).join("")}</ol>`;
}

function orderPage(id) {
  if (id === "sample") {
    const steps = ["Booking Received", "Finding Professional", "Professional Assigned", "Professional Accepted", "Visit Scheduled", "On The Way", "Work Started", "Work In Progress", "Work Completed", "Customer Confirmation", "Payment Completed", "Order Closed"];
    return `<div class="page wrap">
      <div class="note">Sample service timeline. Not your order. No professional is on the way.</div>
      <h1 style="margin-top:12px">Sample service order</h1>
      <p class="muted">NS-SAMPLE-SVC · Layout only · Amount not a transaction</p>
      ${timeline(steps, 5)}
    </div>`;
  }
  if (id === "sample-product") {
    return `<div class="page wrap">
      <div class="note">Sample product timeline. Not a delivery. Other possible states include ready for pickup, cancelled, return and refund.</div>
      <h1 style="margin-top:12px">Sample product order</h1>
      <p class="muted">NS-SAMPLE-PRD · Layout only</p>
      ${timeline(["Confirmed", "Processing", "Out for Delivery", "Delivered"], 1)}
    </div>`;
  }
  const live = orderCache[id];
  if (live) {
    const paid = live.payment_status === "PAID";
    return `<div class="page wrap">
      ${crumbs([{ href: "/orders", label: "My orders" }, { label: live.id }])}
      <p class="sample-flag">${esc(live.status)} · ${esc(live.payment_status)}</p>
      <h1>Order ${esc(live.id.slice(0, 8))}</h1>
      <p class="muted">Saved on the server. ${paid ? "Payment was verified by the server." : "This order is not paid."}</p>
      <div class="panel" style="padding:14px;margin-top:12px">
        ${(live.items || []).map((item) => `<p>${esc(item.name)} × ${esc(item.qty)} · ${rupees(item.unit_paise)}${item.install ? " · installation estimate included" : ""}</p>`).join("")}
        <p style="margin-top:8px"><strong>Server total ${rupees(live.total_paise)}</strong></p>
        <p class="muted">Goods ${rupees(live.goods_paise)} · Installation ${rupees(live.install_paise)} · Delivery ${rupees(live.delivery_paise)} · Tax ${rupees(live.tax_paise)}</p>
      </div>
      ${live.payment_status === "UNPAID" && live.status === "CONFIRMED" && session.user?.id ? `<button class="btn btn-ghost" type="button" data-action="cancel-order" data-id="${esc(live.id)}" style="margin-top:12px">Cancel unpaid order</button>` : ""}
      <h2 style="margin-top:16px">Payment</h2>
      <p>${paid ? "Marked paid only after signature or webhook verification." : "Paying from this page is blocked until the gateway verifies the amount. Refresh does not create a payment."}</p>
    </div>`;
  }
  const d = getState().drafts.find((x) => x.id === id);
  if (!d) return notFound("Order");
  return `<div class="page wrap">
    ${crumbs([{ href: "/orders", label: "My orders" }, { label: d.id }])}
    <p class="sample-flag">${esc(d.status)}</p>
    <h1>${esc(d.title)}</h1>
    <p class="muted">${esc(d.id)} · saved on this device · not submitted</p>
    <div class="panel" style="padding:14px;margin-top:12px"><p>${esc(d.summary || "")}</p><p style="margin-top:8px">${d.amount ? money(d.amount) + " preview total" : "No payable amount was captured."}</p></div>
    <h2 style="margin-top:16px">Status</h2>
    <p class="muted">A live job would move through assigned, on the way, work started and your confirmation. This draft has not entered that flow.</p>
    ${timeline(["Draft saved on this device", "Not submitted", "No professional assigned", "No visit", "No payment"], 0)}
  </div>`;
}

function profilePage() {
  const st = getState();
  const profile = st.profile || {};
  const user = session.user;
  const account = user ? `<section class="panel" style="padding:14px;margin-bottom:12px">
      <h2 style="font-size:1.2rem">Signed-in account</h2>
      <p>${esc(user.name)}</p>
      <p class="muted">${esc(user.email || "")}${user.phone ? " · " + esc(user.phone) : ""}</p>
      <p class="muted">Role: ${esc(user.account_type)}${user.admin_role ? " · " + esc(user.admin_role) : ""} · ${esc(user.status || "")}</p>
      <button class="btn btn-ghost" type="button" data-action="logout" style="margin-top:8px">Log out</button>
    </section>` : `<p class="note">No server session. <a href="/auth">Sign in</a></p>`;
  return `<div class="page wrap">
    <h1>Profile</h1>
    <p class="lede" style="margin:8px 0 12px">${user ? "This session is checked by the server on every private request." : "Sign in to use the server account. Notes below stay in this browser."}</p>
    ${account}
    <div class="split">
      <form id="profile-form" class="panel" style="padding:16px">
        <h2 style="font-size:1.3rem">Personal information</h2>
        ${fieldHTML({ name: "name", label: "Name", type: "text" }, profile)}
        ${fieldHTML({ name: "phone", label: "Phone", type: "tel" }, profile)}
        ${fieldHTML({ name: "email", label: "Email", type: "email" }, profile)}
        <button class="btn btn-navy" type="submit">Save on this device</button>
        <p class="muted" style="margin-top:8px">These notes are not your login and are not sent to the server.</p>
      </form>
      <div>
        <section class="panel" style="padding:14px;margin-bottom:12px">
          <h2 style="font-size:1.2rem">Addresses</h2>
          ${st.addresses.length ? st.addresses.map((a) => `<p style="margin:8px 0">${esc(a.line)} <button class="btn btn-ghost btn-sm" type="button" data-action="remove-address" data-id="${esc(a.id)}">Remove</button></p>`).join("") : `<p class="muted">No saved address.</p>`}
          <form id="address-form" style="margin-top:8px">
            <label for="aline">Add address</label>
            <input id="aline" name="line" type="text" required>
            <button class="btn btn-ghost btn-sm" type="submit" style="margin-top:8px">Save address</button>
          </form>
        </section>
        <section class="panel" style="padding:14px">
          <h2 style="font-size:1.2rem">Shortcuts</h2>
          <div class="cta-row">
            <a class="btn btn-ghost btn-sm" href="/orders">Orders</a>
            <a class="btn btn-ghost btn-sm" href="/support">Support</a>
            <a class="btn btn-ghost btn-sm" href="/warranty">Warranty</a>
            <a class="btn btn-ghost btn-sm" href="/amc">AMC</a>
            <a class="btn btn-ghost btn-sm" href="/auth">Sign in</a>
          </div>
        </section>
      </div>
    </div>
    <section class="section"><h2>Reviews</h2><p class="muted">You can review a professional, shop, product or service only after an eligible completed order. None exist. Sample layout notes are labeled on each listing.</p></section>
    <section><h2>Warranty</h2>${emptyState("No warranty records", "A record appears with a real purchase: period, start, end, covered item and terms.", "/warranty", "Read warranty notes")}</section>
    <section class="section"><h2>AMC</h2>${emptyState("No active AMC", "An annual plan is not running on this preview.", "/amc", "Read about AMC")}</section>
    <section><h2>Notifications</h2>
      ${st.drafts.length ? `<ul>${st.drafts.slice(0, 5).map((d) => `<li class="panel" style="padding:10px;margin:8px 0">Draft saved · ${esc(d.title)} · ${esc(d.id)}</li>`).join("")}</ul>` : `<p class="muted">No local notifications.</p>`}
    </section>
  </div>`;
}

function supportPage() {
  const topics = ["Booking help", "Payment help", "Product help", "Installation help", "Repair help", "Warranty", "AMC", "Complaint"];
  return `<div class="page wrap">
    <h1>Support</h1>
    <p class="lede" style="margin:8px 0 14px">Tell us what is stuck. A ticket saved here is local. Status labels match the future inbox: open, in progress, waiting, resolved, closed.</p>
    <div class="grid-trust">${topics.map((t) => `<a class="tcard" href="/support/ticket?topic=${encodeURIComponent(t)}" style="text-decoration:none;color:inherit"><h3>${esc(t)}</h3><p class="muted" style="margin-top:8px">Open a draft ticket</p></a>`).join("")}</div>
    <p style="margin-top:16px"><a class="btn btn-navy" href="/support/ticket">Create support ticket</a></p>
    <section class="section"><h2>Your local tickets</h2>
      ${getState().tickets.length ? getState().tickets.map((t) => `<article class="panel" style="padding:12px;margin-top:8px"><p class="sample-flag">${esc(t.status)} · local only</p><h3>${esc(t.topic)}</h3><p>${esc(t.message)}</p><p class="muted">${esc(t.id)}</p></article>`).join("") : `<p class="muted">No tickets saved on this device.</p>`}
    </section>
  </div>`;
}

function ticketPage() {
  const topic = qs().topic || "Booking help";
  return `<div class="page wrap">
    <h1>Create support ticket</h1>
    <form id="ticket-form" class="panel" style="padding:16px;margin-top:12px" novalidate>
      <div class="field"><label for="topic">Topic</label><select id="topic" name="topic">${["Booking help", "Payment help", "Product help", "Installation help", "Repair help", "Warranty", "AMC", "Complaint"].map((t) => `<option ${t === topic ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
      ${fieldHTML({ name: "name", label: "Name", type: "text", required: true })}
      ${fieldHTML({ name: "phone", label: "Mobile", type: "tel", required: true })}
      ${fieldHTML({ name: "message", label: "What happened?", type: "textarea", required: true })}
      <button class="btn btn-navy" type="submit">Save ticket locally</button>
    </form>
  </div>`;
}

function authPage() {
  const tab = qs().tab || ui.authTab || "signin";
  const tabs = [["signin", "Sign in"], ["register", "Register"], ["forgot", "Forgot password"], ["otp", "OTP"]].map(([id, label]) => `<a href="/auth?tab=${id}" ${tab === id ? 'aria-current="page"' : ""}>${label}</a>`).join("");
  let form = "";
  if (tab === "register") {
    form = `${fieldHTML({ name: "name", label: "Name", type: "text", required: true })}${fieldHTML({ name: "email", label: "Email", type: "email", required: true })}${fieldHTML({ name: "phone", label: "Mobile", type: "tel" })}${fieldHTML({ name: "password", label: "Password", type: "password", required: true })}
      <div class="field"><label for="account_type">Account type</label><select id="account_type" name="account_type"><option value="customer">Customer</option><option value="professional">Professional</option><option value="seller">Seller</option></select></div>
      ${fieldHTML({ name: "shop_name", label: "Shop name, if you are a seller", type: "text" })}
      ${fieldHTML({ name: "city", label: "City", type: "text" })}
      <button class="btn btn-navy" type="submit">Create account</button>
      <p class="muted" style="margin-top:8px">Admin accounts cannot be created here. A professional or seller starts as pending verification.</p>`;
  } else if (tab === "forgot") {
    form = `${fieldHTML({ name: "email", label: "Email", type: "email", required: true })}<button class="btn btn-navy" type="submit">Request reset</button><p class="muted" style="margin-top:8px">The reply is the same whether or not the email exists. Email delivery is not configured, so no reset link is sent.</p>`;
  } else if (tab === "otp") {
    form = `${fieldHTML({ name: "phone", label: "Mobile", type: "tel", required: true })}${fieldHTML({ name: "otp", label: "OTP", type: "text" })}<button class="btn btn-navy" type="submit">Verify code</button><p class="muted" style="margin-top:8px">SMS is not configured. No code will be sent or accepted.</p>`;
  } else {
    form = `${fieldHTML({ name: "email", label: "Email or mobile", type: "text", required: true })}${fieldHTML({ name: "password", label: "Password", type: "password", required: true })}<button class="btn btn-navy" type="submit">Sign in</button><p class="muted" style="margin-top:8px">There is no published development password.</p>`;
  }
  const current = signedIn() ? `<p class="note">Signed in as ${esc(session.user.name)} · ${esc(session.user.account_type)}. <button class="linkish" type="button" data-action="logout">Log out</button></p>` : "";
  return `<div class="page wrap" style="max-width:640px">
    <h1>Account</h1>
    <p class="lede" style="margin:8px 0 12px">Sign-in creates a server session. The password is not stored in this browser.</p>
    ${current}
    <div class="tabs">${tabs}</div>
    <form id="auth-form" class="panel" style="padding:16px" data-tab="${esc(tab)}" novalidate>${form}</form>
  </div>`;
}

function securityPage() {
  if (!signedIn()) {
    return `<div class="page wrap"><h1>Security</h1>${emptyState("Sign in required", "A hidden address is not access. The server rejected this view.", "/auth?next=/admin/security", "Sign in")}</div>`;
  }
  if (!securityView || securityView.error) {
    const message = securityView && securityView.error === "forbidden" ? "Your role cannot read the security log." : friendly({ message: securityView && securityView.error });
    return `<div class="page wrap"><h1>Security</h1><div class="note">${esc(message)}</div></div>`;
  }
  const table = (rows, columns) => {
    if (!rows || !rows.length) return `<p class="muted">None recorded.</p>`;
    return `<div style="overflow-x:auto"><table class="sec-table"><thead><tr>${columns.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((c) => `<td>${esc(row[c.key] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  };
  return `<div class="page wrap">
    <p class="kicker">Admin</p>
    <h1>Security</h1>
    <p class="lede" style="margin:8px 0 12px">Recent sign-ins, failed attempts, suspicious events and admin actions. Passwords and secrets are not shown.</p>
    <section class="section"><h2>Recent sign-ins</h2>${table(securityView.login_activity, [{ key: "created_at", label: "When" }, { key: "action", label: "Action" }, { key: "actor_id", label: "Actor" }, { key: "ip", label: "IP" }])}</section>
    <section class="section"><h2>Failed logins</h2>${table(securityView.failed_logins, [{ key: "created_at", label: "When" }, { key: "kind", label: "Event" }, { key: "actor_id", label: "Actor" }, { key: "ip", label: "IP" }])}</section>
    <section class="section"><h2>Suspicious activity</h2>${table(securityView.suspicious, [{ key: "created_at", label: "When" }, { key: "kind", label: "Event" }, { key: "detail", label: "Detail" }, { key: "ip", label: "IP" }])}</section>
    <section class="section"><h2>Admin and audit actions</h2>${table(securityView.admin_actions, [{ key: "created_at", label: "When" }, { key: "action", label: "Action" }, { key: "resource_type", label: "Resource" }, { key: "actor_id", label: "Actor" }])}</section>
    <section class="section"><h2>Active sessions</h2>${table(securityView.sessions, [{ key: "created_at", label: "Started" }, { key: "user_id", label: "User" }, { key: "ip", label: "IP" }, { key: "expires_at", label: "Expires" }])}</section>
  </div>`;
}

function legalPage(key) {
  const doc = legal[key];
  if (!doc) return notFound("Page");
  return `<div class="page wrap" style="max-width:760px"><h1>${esc(doc.title)}</h1>${doc.body.map((p) => `<p style="margin-top:12px">${esc(p)}</p>`).join("")}</div>`;
}

function aboutPage() {
  return `<div class="page wrap" style="max-width:760px">
    <p class="kicker">About</p>
    <h1>NAYAN SECURITY</h1>
    <p class="lede" style="margin-top:10px">Smart Security. Trusted Service.</p>
    <p style="margin-top:12px">NAYAN SECURITY is a CCTV and security marketplace. Customers buy cameras and accessories, book installation, repair, maintenance and AMC, and reach local shops and professionals. The platform is the connection layer. It does not require the company to perform every job itself.</p>
    <p style="margin-top:10px">Catalog shops, professionals and reviews are sample data. Accounts and product orders are stored by the server. Provider verification starts as pending. An order is paid only after the server verifies the gateway signature or webhook. This site is not claimed to be unhackable.</p>
    <p style="margin-top:10px">CCTV is the first category. The structure can later hold other home services, which are not promoted on this site yet.</p>
  </div>`;
}

function contactPage() {
  return `<div class="page wrap" style="max-width:720px">
    <h1>Contact</h1>
    <p class="lede" style="margin:8px 0 12px">A public phone line and office address are not published in this preview, so none are invented here. Initial market focus: Bikaner, Rajasthan.</p>
    <form id="contact-form" class="panel" style="padding:16px" novalidate>
      ${fieldHTML({ name: "name", label: "Name", type: "text", required: true })}
      ${fieldHTML({ name: "phone", label: "Mobile", type: "tel", required: true })}
      ${fieldHTML({ name: "message", label: "Message", type: "textarea", required: true })}
      <button class="btn btn-navy" type="submit">Save message locally</button>
    </form>
  </div>`;
}

function notFound(what = "Page") {
  return `<div class="page wrap"><div class="empty"><h1>${esc(what)} not found</h1><p class="muted" style="margin:8px auto 14px;max-width:36rem">That link is not in this preview.</p><a class="btn btn-navy" href="/">Back home</a></div></div>`;
}

const routes = [
  ["/", homePage],
  ["/services", servicesPage],
  ["/shop", shopPage],
  ["/shops", shopsPage],
  ["/professionals", professionalsPage],
  ["/cart", cartPage],
  ["/checkout", checkoutPage],
  ["/orders", ordersPage],
  ["/profile", profilePage],
  ["/support", supportPage],
  ["/support/ticket", ticketPage],
  ["/auth", authPage],
  ["/about", aboutPage],
  ["/contact", contactPage],
  ["/search", searchPage],
  ["/quote/request", quoteRequestPage],
  ["/quote/sample", sampleQuotePage],
  ["/book", bookPage],
  ["/terms", () => legalPage("terms")],
  ["/privacy", () => legalPage("privacy")],
  ["/refund", () => legalPage("refund")],
  ["/warranty", () => legalPage("warranty")],
  ["/amc", () => legalPage("amc")],
  ["/admin", securityPage],
  ["/admin/security", securityPage],
];

function renderPage() {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const direct = routes.find(([p]) => p === path);
  if (direct) return direct[1]();
  const bits = path.split("/").filter(Boolean);
  if (bits[0] === "services" && bits[1]) return servicePage(bits[1]);
  if (bits[0] === "product" && bits[1]) return productPage(bits[1]);
  if (bits[0] === "packages" && bits[1]) return packagePage(bits[1]);
  if (bits[0] === "shops" && bits[1]) return shopProfile(bits[1]);
  if (bits[0] === "professionals" && bits[1]) return professionalPage(bits[1]);
  if (bits[0] === "orders" && bits[1]) return orderPage(bits[1]);
  if (bits[0] === "admin") return securityPage();
  return notFound();
}

function metaFor() {
  const path = location.pathname;
  const map = {
    "/": ["NAYAN SECURITY — CCTV marketplace", "Buy CCTV products, book installation and repair, and find local shops and professionals. Smart Security. Trusted Service."],
    "/services": ["CCTV services — NAYAN SECURITY", "Installation, repair, maintenance, AMC, wiring and remote viewing."],
    "/shop": ["CCTV shop — NAYAN SECURITY", "Cameras, recorders, cable, power and kits from sample local sellers."],
    "/professionals": ["CCTV professionals — NAYAN SECURITY", "Sample local installer and repair profiles by city."],
    "/shops": ["CCTV shops — NAYAN SECURITY", "Sample CCTV shop profiles, products and services."],
    "/cart": ["Cart — NAYAN SECURITY", "Review sample products before checkout."],
    "/checkout": ["Checkout — NAYAN SECURITY", "Checkout preview. Payment is not connected."],
    "/orders": ["My orders — NAYAN SECURITY", "Local drafts and a sample tracking layout."],
    "/support": ["Support — NAYAN SECURITY", "Help with bookings, products, warranty and AMC."],
    "/about": ["About — NAYAN SECURITY", "NAYAN SECURITY is a CCTV and security marketplace."],
    "/contact": ["Contact — NAYAN SECURITY", "Contact NAYAN SECURITY."],
  };
  let title = "NAYAN SECURITY";
  let desc = "CCTV and security marketplace.";
  if (map[path]) [title, desc] = map[path];
  const svc = path.match(/^\/services\/([^/]+)/);
  if (svc) {
    const s = serviceById(svc[1]);
    if (s) { title = `${s.name} — NAYAN SECURITY`; desc = s.short; }
  }
  const prod = path.match(/^\/product\/([^/]+)/);
  if (prod) {
    const p = productById(prod[1]);
    if (p) { title = `${p.name} — NAYAN SECURITY`; desc = p.description.slice(0, 150); }
  }
  return { title, desc };
}

function updateMeta() {
  const { title, desc } = metaFor();
  document.title = title;
  const set = (sel, attr, val) => { const n = document.querySelector(sel); if (n) n.setAttribute(attr, val); };
  set('meta[name="description"]', "content", desc);
  set('link[rel="canonical"]', "href", location.href);
  set('meta[property="og:title"]', "content", title);
  set('meta[property="og:description"]', "content", desc);
  set('meta[property="og:url"]', "content", location.href);
  set('meta[name="twitter:title"]', "content", title);
  set('meta[name="twitter:description"]', "content", desc);
  const ld = document.getElementById("ld-json");
  if (ld) {
    ld.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "NAYAN SECURITY",
      slogan: "Smart Security. Trusted Service.",
      description: "CCTV and security marketplace for products, installation, repair and local professionals.",
      areaServed: "IN",
      url: location.origin,
    });
  }
}

function paint(opts = {}) {
  document.getElementById("preview-bar").innerHTML = previewBar();
  document.getElementById("site-header").innerHTML = header();
  document.getElementById("site-footer").innerHTML = footer();
  document.getElementById("tabbar").innerHTML = tabbar();
  const main = document.getElementById("main");
  try {
    main.innerHTML = renderPage();
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="page wrap">${errorState("This page hit a problem while drawing.")}</div>`;
  }
  updateMeta();
  paintOverlay();
  if (opts.focus) {
    const h = main.querySelector("h1");
    if (h) { h.tabIndex = -1; h.focus(); }
  }
  window.scrollTo(0, opts.keepScroll ? window.scrollY : 0);
}

async function prepareRoute() {
  try {
    session = await me();
  } catch {
    session = { user: null, csrf: "" };
  }
  const path = location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/orders" || path.startsWith("/orders/")) {
    serverOrders = [];
    if (session.user) {
      try {
        serverOrders = (await api("/api/orders")).orders || [];
        serverOrders.forEach((order) => { orderCache[order.id] = order; });
      } catch {
        serverOrders = [];
      }
    }
    const id = path.split("/")[2];
    if (id && session.user && id !== "sample" && id !== "sample-product" && !orderCache[id]) {
      try { orderCache[id] = await api(`/api/orders/${id}`); } catch { orderCache[id] = null; }
    }
  }
  if (path === "/admin" || path.startsWith("/admin/")) {
    securityView = null;
    if (!session.user) securityView = { error: "authentication_required" };
    else {
      try { securityView = await api("/api/admin/security"); }
      catch (err) { securityView = { error: err.message }; }
    }
  }
}

function navigate(href, { replace = false, focus = true, keepScroll = false } = {}) {
  const url = new URL(href, location.origin);
  const next = url.pathname + url.search;
  const curr = location.pathname + location.search;
  if (next === curr && !replace) { ui.menu = false; paint({ focus: false, keepScroll: true }); return; }
  if (replace) history.replaceState({ nayan: 1 }, "", url);
  else history.pushState({ nayan: 1 }, "", url);
  ui.menu = false;
  const pathChanged = url.pathname !== lastPath;
  lastPath = url.pathname;
  const token = ++navToken;
  if (pathChanged) document.getElementById("main").innerHTML = skeleton();
  prepareRoute().then(() => {
    if (token !== navToken) return;
    paint({ focus: pathChanged ? focus : false, keepScroll: pathChanged ? keepScroll : true });
  });
}

function validPhone(v) { return /^[6-9]\d{9}$/.test(String(v || "").replace(/\s+/g, "")); }

function readForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const files = form.querySelector('input[type="file"]');
  if (files?.files?.length) data.photos = [...files.files].map((f) => f.name).join(", ");
  return data;
}

function requireFields(data, names) {
  for (const n of names) if (!String(data[n] || "").trim()) return `Please fill ${n}.`;
  if (data.phone && !validPhone(data.phone)) return "Enter a 10-digit mobile number starting with 6, 7, 8 or 9.";
  if (data.pincode && !/^\d{6}$/.test(data.pincode)) return "PIN code should be 6 digits.";
  return "";
}

function guardStock(id) {
  const p = productById(id);
  if (!p) return "That product is not in the sample catalog.";
  if (p.stock <= 0) return "That sample product is out of stock.";
  return "";
}

function onClick(e) {
  if (e.target.classList?.contains("dialog-back")) { closeModal(); return; }
  const a = e.target.closest("a[href]");
  const hrefAttr = a?.getAttribute("href") || "";
  if (a && hrefAttr.startsWith("#")) return;
  if (a && a.origin === location.origin && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
    e.preventDefault();
    navigate(a.getAttribute("href"));
    return;
  }
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === "toggle-menu") { ui.menu = !ui.menu; paint({ focus: false, keepScroll: true }); return; }
  if (action === "close-modal") { closeModal(); return; }
  if (action === "open-location") { openLocation(); return; }
  if (action === "set-city") {
    setLocation({ city: btn.dataset.city, source: "manual" });
    closeModal();
    paint({ keepScroll: true, focus: false });
    toast(`Showing sample listings for ${cityName(btn.dataset.city)}.`);
    return;
  }
  if (action === "use-geo") { useGeo(); return; }
  if (action === "toggle-cities") { setShowAllCities(!getState().showAllCities); paint({ keepScroll: true, focus: false }); return; }
  if (action === "retry") { paint({ focus: true }); return; }
  if (action === "add-cart" || action === "buy-now" || action === "get-install") {
    const err = guardStock(btn.dataset.id);
    if (err) { toast(err); return; }
    addToCart(btn.dataset.id, { install: action === "get-install" });
    toast(action === "get-install" ? "Added with an installation estimate. Not a confirmed quote." : "Added to cart. Sample catalog only.");
    if (action === "buy-now") navigate("/checkout");
    else if (action === "get-install") navigate("/cart");
    else paint({ keepScroll: true, focus: false });
    return;
  }
  if (action === "qty") {
    const line = getState().cart.find((l) => l.id === btn.dataset.id);
    if (!line) return;
    const product = productById(line.productId);
    const next = line.qty + Number(btn.dataset.dir);
    if (product && next > product.stock) { toast("Sample stock does not cover that quantity."); return; }
    if (next < 1) return;
    updateQty(line.id, next);
    paint({ keepScroll: true, focus: false });
    return;
  }
  if (action === "remove-line") { removeLine(btn.dataset.id); paint({ keepScroll: true, focus: false }); return; }
  if (action === "toggle-install") { setLineInstall(btn.dataset.id, btn.checked); paint({ keepScroll: true, focus: false }); return; }
  if (action === "contact") {
    openModal({
      title: btn.dataset.kind === "whatsapp" ? "WhatsApp" : "Call",
      html: `<p>${esc(btn.dataset.name)} is sample data. A live number is not published, so this preview will not place a call or open WhatsApp.</p><p class="muted" style="margin-top:8px">When verification is live, contact details are shown only to the people who need them for the job.</p>`,
    });
    return;
  }
  if (action === "quote-decision") {
    const decision = btn.dataset.decision;
    const item = addDraft({
      kind: "quote",
      title: `Sample quote ${decision}`,
      summary: "Local note only. No professional was notified and no payment was taken. The sample total remains ₹1,400.",
      amount: decision === "accept" ? 1400 : 0,
    });
    toast("Saved on this device only.");
    navigate(`/orders/${item.id}`);
    return;
  }
  if (action === "logout") {
    api("/api/auth/logout", { method: "POST" }).catch(() => {}).finally(() => {
      session = { user: null, csrf: "" };
      setCsrf("");
      clearProfile();
      toast("Signed out.");
      navigate("/auth");
    });
    return;
  }
  if (action === "cancel-order") {
    api(`/api/orders/${btn.dataset.id}/status`, { method: "POST", body: { status: "CANCELLED" } })
      .then(() => { toast("Unpaid order cancelled. Payment was not taken."); navigate("/orders"); })
      .catch((err) => toast(friendly(err)));
    return;
  }
  if (action === "retry-upload") { retryUpload(btn.dataset.job); return; }
  if (action === "remove-upload") { removeUpload(btn.dataset.job); return; }
  if (action === "remove-address") { removeAddress(btn.dataset.id); paint({ keepScroll: true, focus: false }); }
}

function openLocation() {
  const current = city();
  openModal({
    title: "Location",
    html: `<p class="muted">Choose a city or PIN code. GPS is optional and never required.</p>
      <div class="city-list" style="margin-top:10px">${cities.map((c) => `<button type="button" data-action="set-city" data-city="${esc(c.id)}" aria-pressed="${c.id === current ? "true" : "false"}"><strong>${esc(c.name)}</strong><br><span class="muted">${esc(c.state)} · ${esc(c.areas.slice(0, 3).join(", "))}</span></button>`).join("")}</div>
      <form id="pin-form" style="margin-top:12px"><label for="pin">PIN code</label><input id="pin" name="pincode" inputmode="numeric" maxlength="6" placeholder="334001"><button class="btn btn-ghost" type="submit" style="margin-top:8px">Save PIN</button></form>
      <button class="btn btn-line" type="button" data-action="use-geo" style="margin-top:8px">Use current location if allowed</button>
      <p id="geo-msg" class="muted" style="margin-top:8px"></p>`,
  });
}

function useGeo() {
  const msg = document.getElementById("geo-msg");
  if (!navigator.geolocation) { if (msg) msg.textContent = "This browser has no location service."; return; }
  if (msg) msg.textContent = "Asking for permission…";
  navigator.geolocation.getCurrentPosition(() => {
    if (msg) msg.textContent = "Permission granted, but city matching from GPS is not connected. Please pick a city.";
  }, () => {
    if (msg) msg.textContent = "Location permission was denied or failed. You can still pick a city. Nothing is forced.";
  }, { timeout: 8000 });
}

function onSubmit(e) {
  const form = e.target;
  if (form.id === "shop-filters") {
    e.preventDefault();
    const p = new URLSearchParams(new FormData(form));
    navigate(`/shop?${p.toString()}`);
    return;
  }
  if (form.id === "seller-filters") {
    e.preventDefault();
    const id = location.pathname.split("/")[2];
    const p = new URLSearchParams(new FormData(form));
    navigate(`/shops/${id}?${p.toString()}`);
    return;
  }
  if (form.id === "pro-filters") return;
  if (form.matches("form[action='/search']") || form.classList.contains("search-inline")) return;
  if (form.id === "pin-form") {
    e.preventDefault();
    const pin = new FormData(form).get("pincode");
    if (!/^\d{6}$/.test(pin || "")) { toast("Enter a 6-digit PIN code."); return; }
    setLocation({ pincode: pin, source: "manual" });
    closeModal();
    toast("PIN saved on this device. City filter is unchanged until you pick a city.");
    return;
  }
  if (form.id === "book-form" || form.id === "quote-form" || form.id === "checkout-form" || form.id === "ticket-form" || form.id === "contact-form" || form.id === "package-form" || form.id === "auth-form" || form.id === "profile-form" || form.id === "address-form") {
    e.preventDefault();
  } else return;

  const data = readForm(form);
  if (form.id === "address-form") {
    if (!data.line?.trim()) return;
    addAddress({ line: data.line.trim() });
    paint({ keepScroll: true, focus: false });
    toast("Address saved on this device only.");
    return;
  }
  if (form.id === "profile-form") {
    setProfile({ name: data.name || "", phone: data.phone || "", email: data.email || "" });
    toast("Profile saved on this device. This is not an account.");
    return;
  }
  if (form.id === "auth-form") {
    submitAuth(form.dataset.tab, data);
    return;
  }
  if (form.id === "ticket-form" || form.id === "contact-form") {
    const err = requireFields(data, ["name", "phone", "message"]);
    if (err) { toast(err); return; }
    if (form.id === "ticket-form") {
      const t = addTicket({ topic: data.topic, message: data.message, name: data.name });
      toast("Ticket saved on this device. Support inbox is not connected.");
      navigate("/support");
      return t;
    }
    addDraft({ kind: "contact", title: "Contact message", summary: data.message, amount: 0 });
    toast("Message saved locally. It was not sent.");
    return;
  }
  if (form.id === "package-form") {
    const pkg = packageById(data.package);
    const item = addDraft({
      kind: "package",
      title: pkg?.name || "Package request",
      summary: `Sample package request. Installation ${data.install ? "requested" : "not requested"}. Not submitted to a shop.`,
      amount: pkg?.starting || 0,
    });
    toast("Package request saved locally.");
    navigate(`/orders/${item.id}`);
    return;
  }
  if (form.id === "book-form" || form.id === "quote-form") {
    const err = requireFields(data, ["name", "phone", "address", ...(form.id === "quote-form" ? ["detail"] : []), ...(data.cameras !== undefined && serviceById(data.service)?.id === "cctv-installation" ? ["cameras"] : [])]);
    if (form.id === "book-form" && !data.date) { toast("Choose a preferred date."); return; }
    if (err) { toast(err); return; }
    const s = serviceById(data.service);
    const item = addDraft({
      kind: form.id === "quote-form" ? "quote" : "service",
      title: form.id === "quote-form" ? `Quote request · ${s?.name || "Service"}` : `Booking draft · ${s?.name || "Service"}`,
      summary: [data.detail || data.notes || data.issue || "", data.photos ? `Photos named: ${data.photos}` : ""].filter(Boolean).join(" · ") || "Draft saved. Not submitted.",
      amount: 0,
    });
    toast("Saved on this device. No professional was notified.");
    navigate(`/orders/${item.id}`);
    return;
  }
  if (form.id === "checkout-form") {
    const err = requireFields(data, ["name", "phone", "address"]);
    if (err) { toast(err); return; }
    const delivery = data.delivery === "home" ? "home" : "pickup";
    const totals = cartTotals(delivery);
    if ((e.submitter?.value || "server") === "draft") {
      const item = addDraft({
        kind: "checkout",
        title: "Checkout draft",
        summary: `${totals.lines.map((l) => `${l.product.name} × ${l.qty}`).join(", ")}. ${delivery === "home" ? "Home delivery" : "Pickup"}. Not submitted.`,
        amount: totals.preview,
      });
      toast("Draft saved on this device. You were not charged.");
      navigate(`/orders/${item.id}`);
      return;
    }
    placeServerOrder(data, delivery, totals);
  }
}

async function submitAuth(tab, data) {
  if (tab === "otp") {
    openModal({ title: "SMS not configured", html: "<p>No code was sent or accepted. Use email and password.</p>" });
    return;
  }
  if (tab === "forgot") {
    if (!data.email) { toast("Enter an email."); return; }
    try {
      const res = await api("/api/auth/forgot", { method: "POST", body: { email: data.email } });
      openModal({ title: "Reset request recorded", html: `<p>${esc(res.message || "If an account exists, a reset can be sent once email delivery is configured.")}</p>` });
    } catch (err) { toast(friendly(err)); }
    return;
  }
  if (tab === "register") {
    if (!data.name || !data.email || !data.password) { toast("Name, email and password are required."); return; }
    if (data.phone && !validPhone(data.phone)) { toast("Enter a 10-digit mobile number starting with 6, 7, 8 or 9."); return; }
    try {
      const res = await api("/api/auth/register", { method: "POST", body: {
        name: data.name, email: data.email, phone: data.phone || "", password: data.password,
        account_type: data.account_type || "customer", shop_name: data.shop_name || "", city: data.city || "",
      }});
      session = res;
      setCsrf(res.csrf);
      toast("Account created. Provider accounts stay pending until reviewed.");
      navigate("/profile");
    } catch (err) { toast(friendly(err)); }
    return;
  }
  if (!data.email || !data.password) { toast("Enter your email or mobile and password."); return; }
  try {
    const body = data.email.includes("@") ? { email: data.email, password: data.password } : { phone: data.email, password: data.password };
    const res = await api("/api/auth/login", { method: "POST", body });
    session = res;
    setCsrf(res.csrf);
    toast("Signed in.");
    const next = qs().next;
    navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : "/profile");
  } catch (err) { toast(friendly(err)); }
}

async function placeServerOrder(data, delivery, totals) {
  if (!signedIn()) {
    toast("Sign in to place an order. Nothing was charged.");
    navigate("/auth?next=/checkout");
    return;
  }
  if (session.user.account_type !== "customer") {
    toast("Only a customer account can place this order.");
    return;
  }
  const key = checkoutDraft.idem || crypto.randomUUID();
  checkoutDraft.idem = key;
  try {
    const order = await api("/api/orders", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: {
        items: totals.lines.map((line) => ({ product_id: line.product.id, qty: line.qty, install: Boolean(line.install) })),
        delivery,
        address: { name: data.name, phone: data.phone, line: data.address, area: data.area || "", pincode: data.pincode || "" },
        idempotency_key: key,
      },
    });
    clearCart();
    checkoutDraft = {};
    orderCache[order.id] = order;
    try {
      await api("/api/payments/initiate", { method: "POST", body: { order_id: order.id } });
      toast("Gateway accepted a payment request. This page will not mark it paid without server verification.");
    } catch (err) {
      toast(err.message === "gateway_not_configured"
        ? "Unpaid order saved. Gateway keys are not configured, so you were not charged."
        : friendly(err));
    }
    navigate(`/orders/${order.id}`);
  } catch (err) {
    toast(friendly(err));
  }
}

function renderUploads(list) {
  list.innerHTML = [...uploadJobs.values()].filter((job) => job.list === list).map((job) => `<div class="upload-row">
    ${job.preview ? `<img src="${esc(job.preview)}" alt="">` : `<div class="file-fallback"></div>`}
    <div>
      <strong>${esc(job.name)}</strong>
      <p class="muted">${esc(job.status)}${job.id ? " · " + esc(job.id) : ""}</p>
      <progress max="100" value="${job.progress}"></progress>
    </div>
    <div>
      ${job.failed ? `<button class="btn btn-ghost btn-sm" type="button" data-action="retry-upload" data-job="${esc(job.key)}">Retry</button>` : ""}
      ${job.id ? `<button class="btn btn-ghost btn-sm" type="button" data-action="remove-upload" data-job="${esc(job.key)}">Remove</button>` : ""}
    </div>
  </div>`).join("");
}

async function sendUpload(job) {
  job.failed = false;
  job.status = "Uploading";
  renderUploads(job.list);
  try {
    const saved = await uploadFile(job.file, {
      purpose: "site-photo",
      onProgress: (value) => { job.progress = value; renderUploads(job.list); },
    });
    job.id = saved.id;
    job.progress = 100;
    job.status = "Stored by the server";
    if (saved.mime?.startsWith("image/")) job.preview = `/api/uploads/${saved.id}`;
  } catch (err) {
    job.failed = true;
    job.status = friendly(err);
  }
  renderUploads(job.list);
}

function retryUpload(key) {
  const job = uploadJobs.get(key);
  if (job) sendUpload(job);
}

async function removeUpload(key) {
  const job = uploadJobs.get(key);
  if (!job) return;
  if (job.id) {
    try { await api(`/api/uploads/${job.id}`, { method: "DELETE" }); }
    catch (err) { toast(friendly(err)); return; }
  }
  uploadJobs.delete(key);
  if (job.list) renderUploads(job.list);
}

function onChange(e) {
  if (e.target.matches("#pro-filters select")) {
    const v = e.target.value;
    navigate(v ? `/professionals?service=${encodeURIComponent(v)}` : "/professionals");
  }
  if (e.target.matches("#checkout-form input[name='delivery']")) {
    const form = document.getElementById("checkout-form");
    checkoutDraft = Object.fromEntries(new FormData(form).entries());
    checkoutDraft.delivery = e.target.value;
    history.replaceState({ nayan: 1 }, "", `/checkout?delivery=${e.target.value}`);
    paint({ keepScroll: true, focus: false });
  }
  if (e.target.matches('input[type="file"]')) {
    const list = e.target.parentElement.querySelector(".file-names");
    if (!list) return;
    if (!signedIn()) {
      toast("Sign in before uploading. The file stayed on this device.");
      e.target.value = "";
      return;
    }
    [...e.target.files].forEach((file) => {
      const key = crypto.randomUUID();
      const job = { key, file, name: file.name, list, progress: 0, status: "Waiting", failed: false, id: "", preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : "" };
      uploadJobs.set(key, job);
      sendUpload(job);
    });
    e.target.value = "";
  }
}

function onKey(e) {
  if (e.key === "Escape") {
    if (ui.modal) closeModal();
    else if (ui.menu) { ui.menu = false; paint({ keepScroll: true, focus: false }); }
  }
  if (e.key === "Tab" && ui.modal) {
    const dialog = document.querySelector(".dialog");
    if (!dialog) return;
    const nodes = [...dialog.querySelectorAll("button, a, input, select, textarea")].filter((el) => !el.disabled);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

function boot() {
  document.getElementById("year")?.replaceWith();
  lastPath = location.pathname;
  prepareRoute().then(() => paint({ focus: false }));
  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  document.addEventListener("change", onChange);
  document.addEventListener("keydown", onKey);
  window.addEventListener("popstate", () => {
    lastPath = location.pathname;
    ui.menu = false;
    prepareRoute().then(() => paint({ focus: true }));
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

boot();
