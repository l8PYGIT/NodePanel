"use strict";

/* ===================== Theme ===================== */
const THEMES = [
  { id: "light", color: "#4f46e5" },
  { id: "dark", color: "#6366f1" },
  { id: "midnight", color: "#38bdf8" },
  { id: "emerald", color: "#0d9488" },
];

function applyTheme(id) {
  document.documentElement.dataset.theme = id;
  localStorage.setItem("pg_theme", id);
  renderThemeDots();
}
function renderThemeDots() {
  const cur = localStorage.getItem("pg_theme") || "light";
  document.getElementById("themeDots").innerHTML = THEMES.map(
    (t) => `<button data-theme-btn="${t.id}" class="${t.id === cur ? "sel" : ""}" style="background:${t.color}" title="${t.id}" aria-label="تم ${t.id}"></button>`
  ).join("");
}

/* ===================== Token ===================== */
const getToken = () => localStorage.getItem("pg_token") || "";
const setToken = (t) => localStorage.setItem("pg_token", t);

function openTokenModal() {
  modal("توکن دسترسی API", `
    <div class="field">
      <label>Bearer Token</label>
      <input id="tokenInput" type="password" placeholder="PANEL_API_TOKEN" value="${getToken()}" />
      <p class="muted" style="font-size:12.5px;margin-top:8px">توکن در مرورگر شما ذخیره می‌شود و در هدر Authorization ارسال می‌گردد.</p>
    </div>
    <div class="actions">
      <button class="btn primary" id="saveToken">ذخیره</button>
      <button class="btn ghost" id="cancelToken">انصراف</button>
    </div>`, () => {
    document.getElementById("saveToken").onclick = () => {
      setToken(document.getElementById("tokenInput").value.trim());
      closeModal();
      toast("توکن ذخیره شد");
      route();
    };
    document.getElementById("cancelToken").onclick = closeModal;
  });
}

/* ===================== API client ===================== */
async function api(path, opts = {}) {
  const token = getToken();
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    openTokenModal();
    throw new Error("توکن نامعتبر یا غایب است");
  }
  if (!res.ok) {
    let msg = "خطا " + res.status;
    try { msg = (await res.json()).error || msg; } catch (_) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

/* ===================== UI helpers ===================== */
function toast(msg, type = "ok") {
  const wrap = document.getElementById("toastWrap");
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}
function modal(title, bodyHTML, onMount, extraClass = "") {
  const root = document.getElementById("modalRoot");
  const cls = extraClass ? `modal ${extraClass}` : "modal";
  root.innerHTML = `<div class="modal-bg"><div class="${cls}" role="dialog" aria-modal="true"><h3>${title}</h3><div>${bodyHTML}</div></div></div>`;
  const bg = root.firstElementChild;
  bg.addEventListener("click", (e) => { if (e.target === bg) closeModal(); });
  const onKey = (e) => { if (e.key === "Escape") { closeModal(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  if (onMount) onMount(root);
}
const closeModal = () => (document.getElementById("modalRoot").innerHTML = "");

// Escapes the single quote as well as the double: several templates interpolate
// values into single-quoted attributes (e.g. onclick="f('...')"), where an
// unescaped ' would break out of the attribute.
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function fmtBytes(n) {
  n = Number(n || 0);
  if (n <= 0) return "0";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + " " + u[i];
}
function fmtDate(sec) {
  if (!sec) return "—";
  try { return new Date(sec * 1000).toLocaleString("fa-IR"); } catch { return String(sec); }
}
// daysLeftLabel returns a small colored " (N روز)" suffix for an expiry epoch.
function daysLeftLabel(endAt) {
  if (!endAt) return "";
  const days = Math.floor((endAt - Date.now() / 1000) / 86400);
  if (days < 0) return ` <span style="color:var(--danger);font-size:12px">(منقضی)</span>`;
  const col = days <= 3 ? "var(--danger)" : days <= 7 ? "var(--warn)" : "var(--muted, #94a3b8)";
  return ` <span style="color:${col};font-size:12px">(${days} روز)</span>`;
}
const STATUS_FA = { active: "فعال", suspended: "معلق", expired: "منقضی", online: "آنلاین", offline: "آفلاین", unknown: "نامشخص" };
const badge = (s) => `<span class="badge ${esc(s)}">${STATUS_FA[s] || esc(s)}</span>`;
function progress(used, quota) {
  const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : (used > 0 ? 100 : 0);
  const col = pct >= 100 ? "var(--danger)" : pct >= 80 ? "var(--warn)" : "var(--ok)";
  return `<div style="background:var(--surface-2);border-radius:999px;height:7px;overflow:hidden;min-width:120px">
    <div style="width:${pct}%;height:100%;border-radius:999px;background:${col};transition:width .3s ease"></div></div>
    <div class="muted" style="font-size:12px;margin-top:4px;font-variant-numeric:tabular-nums">${fmtBytes(used)} / ${fmtBytes(quota)} (${pct}%)</div>`;
}

/* ===================== Navigation / router ===================== */
const ICONS = {
  dashboard: '<path d="M3 13h8V3H3zM13 21h8V3h-8zM3 21h8v-6H3z"/>',
  nodes: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/>',
  customers: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M16 8a3 3 0 0 1 0 6"/>',
  plans: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v16"/>',
  subscriptions: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  webhooks: '<circle cx="6" cy="18" r="2.5"/><circle cx="12" cy="6" r="2.5"/><circle cx="18" cy="14" r="2.5"/><path d="M8 16l3-7M14 7l3 5"/>',
};
const NAV = [
  { id: "dashboard", label: "داشبورد", render: viewDashboard },
  { id: "nodes", label: "نودها", render: viewNodes },
  { id: "customers", label: "مشتری‌ها", render: viewCustomers },
  { id: "plans", label: "پلن‌ها", render: viewPlans },
  { id: "subscriptions", label: "اشتراک‌ها", render: viewSubscriptions },
  { id: "webhooks", label: "وب‌هوک‌ها", render: viewWebhooks },
];

function renderNav() {
  document.getElementById("nav").innerHTML = NAV.map(
    (n) => `<button class="nav-item" data-route="${n.id}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n.id]}</svg>
      ${n.label}</button>`
  ).join("");
}

async function route() {
  const id = (location.hash.replace(/^#\/?/, "").split("?")[0]) || "dashboard";
  const item = NAV.find((n) => n.id === id) || NAV[0];
  document.querySelectorAll(".nav-item[data-route]").forEach((b) =>
    b.classList.toggle("active", b.dataset.route === item.id));
  document.getElementById("pageTitle").textContent = item.label;
  document.getElementById("sidebar").classList.remove("open");
  const view = document.getElementById("view");
  view.innerHTML = `<div class="empty">در حال بارگذاری…</div>`;
  try {
    await item.render(view);
  } catch (e) {
    view.innerHTML = `<div class="card"><p class="muted">${esc(e.message)}</p>
      <button class="btn primary" onclick="openTokenModal()">تنظیم توکن</button></div>`;
  }
}

/* ===================== Bootstrap ===================== */
function boot() {
  applyTheme(localStorage.getItem("pg_theme") || "light");
  renderNav();
  document.getElementById("nav").addEventListener("click", (e) => {
    const b = e.target.closest(".nav-item[data-route]");
    if (b) location.hash = "#/" + b.dataset.route;
  });
  document.getElementById("themeDots").addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme-btn]");
    if (b) applyTheme(b.dataset.themeBtn);
  });
  document.getElementById("tokenBtn").onclick = openTokenModal;
  document.getElementById("docsBtn").onclick = () => window.open("/docs", "_blank");
  const sidebar = document.getElementById("sidebar");
  document.getElementById("hamburger").onclick = () => sidebar.classList.toggle("open");
  document.getElementById("backdrop").onclick = () => sidebar.classList.remove("open");
  window.addEventListener("hashchange", route);
  if (!getToken()) openTokenModal();
  route();
}
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", boot);
}

/* ===================== Shared view helpers ===================== */
function sectionHead(title, actionsHTML) {
  return `<div class="section-head"><h2>${esc(title)}</h2><div class="spacer"></div>${actionsHTML || ""}</div>`;
}
function statCard(label, value, sub) {
  return `<div class="card stat"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub || "")}</div></div>`;
}
function table(headers, rows) {
  const hs = headers.filter((h) => h !== null);
  const head = `<thead><tr>${hs.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`;
  const body = rows
    .map((r) => `<tr>${r.filter((c) => c !== null).map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

/* Generic form modal. fields: {name,label,type,placeholder,value,hint,options}.
   onSubmit(values) is awaited; the modal closes and the view re-renders on success. */
function formModal(title, fields, onSubmit, submitLabel = "ذخیره") {
  const body = fields
    .map((f) => {
      const label = `<label>${esc(f.label)}</label>`;
      const hint = f.hint ? `<p class="muted" style="font-size:12px;margin-top:6px">${esc(f.hint)}</p>` : "";
      let control;
      if (f.type === "select") {
        const opts = (f.options || [])
          .map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? "selected" : ""}>${esc(o.label)}</option>`)
          .join("");
        control = `<select data-f="${f.name}">${opts}</select>`;
      } else if (f.type === "textarea") {
        control = `<textarea data-f="${f.name}" rows="5" placeholder="${esc(f.placeholder || "")}">${esc(f.value || "")}</textarea>`;
      } else {
        control = `<input data-f="${f.name}" type="${f.type || "text"}" placeholder="${esc(f.placeholder || "")}" value="${esc(f.value ?? "")}" />`;
      }
      return `<div class="field">${label}${control}${hint}</div>`;
    })
    .join("");

  modal(
    title,
    `${body}<div class="actions"><button class="btn primary" id="fmOk">${esc(submitLabel)}</button><button class="btn ghost" id="fmCancel">انصراف</button></div>`,
    (root) => {
      root.querySelector("#fmCancel").onclick = closeModal;
      root.querySelector("#fmOk").onclick = async () => {
        const values = {};
        root.querySelectorAll("[data-f]").forEach((el) => (values[el.dataset.f] = el.value.trim()));
        const btn = root.querySelector("#fmOk");
        btn.disabled = true;
        try {
          await onSubmit(values);
          closeModal();
          route();
        } catch (e) {
          toast(e.message, "err");
          btn.disabled = false;
        }
      };
    }
  );
}

async function guard(fn) {
  try { await fn(); } catch (e) { toast(e.message, "err"); }
}
const GB = 1024 * 1024 * 1024;

/* ==============================================================
   RFC 7748 Montgomery Ladder Curve25519 & Reality Key Generation
   Zero dependencies; bit-for-bit matches Xray-core `xray x25519`.
   ============================================================== */
function curve25519(scalar, point = 9n) {
  const p = (1n << 255n) - 19n;
  const a24 = 121665n;
  const mul = (a, b) => (a * b) % p;
  const add = (a, b) => (a + b) % p;
  const sub = (a, b) => (a - b + p) % p;
  function inv(a) {
    let res = 1n, base = a, exp = p - 2n;
    while (exp > 0n) {
      if (exp & 1n) res = mul(res, base);
      base = mul(base, base);
      exp >>= 1n;
    }
    return res;
  }
  let x1 = point, x2 = 1n, z2 = 0n, x3 = point, z3 = 1n, swap = 0;
  for (let t = 254; t >= 0; t--) {
    const k_t = Number((scalar >> BigInt(t)) & 1n);
    swap ^= k_t;
    if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
    swap = k_t;
    const A = add(x2, z2), AA = mul(A, A);
    const B = sub(x2, z2), BB = mul(B, B);
    const E = sub(AA, BB);
    const C = add(x3, z3), D = sub(x3, z3);
    const DA = mul(D, A), CB = mul(C, B);
    x3 = mul(add(DA, CB), add(DA, CB));
    z3 = mul(x1, mul(sub(DA, CB), sub(DA, CB)));
    x2 = mul(AA, BB);
    z2 = mul(E, add(AA, mul(a24, E)));
  }
  if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
  return mul(x2, inv(z2));
}

function generateRealityKeys() {
  const rand = (typeof crypto !== "undefined" && crypto.getRandomValues)
    ? crypto.getRandomValues(new Uint8Array(32))
    : new Uint8Array(32).map(() => Math.floor(Math.random() * 256));
  // RFC 7748 clamping
  rand[0] &= 248;
  rand[31] &= 127;
  rand[31] |= 64;
  let scalar = 0n;
  for (let i = 0; i < 32; i++) scalar += BigInt(rand[i]) << (8n * BigInt(i));
  const pubBig = curve25519(scalar);
  const pubBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) pubBytes[i] = Number((pubBig >> (8n * BigInt(i))) & 0xffn);

  function b64url(u8) {
    let bin = "";
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    const b64 = (typeof btoa !== "undefined") ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  const sidBytes = (typeof crypto !== "undefined" && crypto.getRandomValues)
    ? crypto.getRandomValues(new Uint8Array(8))
    : new Uint8Array(8).map(() => Math.floor(Math.random() * 256));
  let shortId = "";
  for (let i = 0; i < sidBytes.length; i++) shortId += sidBytes[i].toString(16).padStart(2, "0");

  return {
    privateKey: b64url(rand),
    publicKey: b64url(pubBytes),
    shortId,
  };
}

/* ==============================================================
   Xray Config Parser & Serializer (Bidirectional JSON <-> Visual Model)
   ============================================================== */
function parseXrayConfig(jsonStr) {
  let parsed;
  try {
    parsed = typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
  } catch (e) {
    return { error: "JSON نامعتبر است: " + e.message, inbounds: [], outbounds: [], rawOther: {} };
  }

  if (!parsed || typeof parsed !== "object") {
    return { error: "کانفیگ نامعتبر است", inbounds: [], outbounds: [], rawOther: {} };
  }

  const inbounds = Array.isArray(parsed.inbounds) ? parsed.inbounds.map((ib, idx) => {
    const ss = ib.streamSettings || {};
    const ws = ss.wsSettings || {};
    const grpc = ss.grpcSettings || {};
    const xhttp = ss.xhttpSettings || ss.splithttpSettings || {};
    const httpupgrade = ss.httpupgradeSettings || {};
    const kcp = ss.kcpSettings || {};
    const h2 = ss.httpSettings || {};
    const tls = ss.tlsSettings || {};
    const reality = ss.realitySettings || {};

    let realityServerNames = "";
    if (Array.isArray(reality.serverNames)) {
      realityServerNames = reality.serverNames.join(", ");
    } else if (typeof reality.serverNames === "string") {
      realityServerNames = reality.serverNames;
    }

    let realityShortIds = "";
    if (Array.isArray(reality.shortIds)) {
      realityShortIds = reality.shortIds.filter(Boolean).join(", ");
    } else if (typeof reality.shortIds === "string") {
      realityShortIds = reality.shortIds;
    }

    let h2Host = "";
    if (Array.isArray(h2.host)) {
      h2Host = h2.host.join(", ");
    } else if (typeof h2.host === "string") {
      h2Host = h2.host;
    }

    const certObj = tls.certificates?.[0] || {};
    let tlsCertFile = certObj.certificateFile || "";
    let tlsKeyFile = certObj.keyFile || "";
    let tlsCertPem = "";
    let tlsKeyPem = "";

    if (Array.isArray(certObj.certificate)) {
      tlsCertPem = certObj.certificate.join("\n");
    } else if (typeof certObj.certificate === "string") {
      tlsCertPem = certObj.certificate;
    }

    if (Array.isArray(certObj.key)) {
      tlsKeyPem = certObj.key.join("\n");
    } else if (typeof certObj.key === "string") {
      tlsKeyPem = certObj.key;
    }

    const tlsCertType = (tlsCertPem || tlsKeyPem) ? "pem" : "file";

    return {
      tag: ib.tag || `inbound-${idx + 1}`,
      listen: ib.listen || "0.0.0.0",
      port: Number(ib.port) || 443,
      protocol: String(ib.protocol || "vless").toLowerCase(),
      network: String(ss.network || "tcp").toLowerCase(),
      security: String(ss.security || "none").toLowerCase(),
      wsPath: ws.path || "/",
      grpcServiceName: grpc.serviceName || "",
      xhttpPath: xhttp.path || "/",
      xhttpHost: xhttp.host || "",
      xhttpMode: xhttp.mode || "auto",
      httpupgradePath: httpupgrade.path || "/",
      httpupgradeHost: httpupgrade.host || "",
      kcpHeaderType: kcp.header?.type || "none",
      kcpSeed: kcp.seed || "",
      h2Path: h2.path || "/",
      h2Host: h2Host,
      tlsServerName: tls.serverName || "",
      tlsCertType: tlsCertType,
      tlsCertFile: tlsCertFile,
      tlsKeyFile: tlsKeyFile,
      tlsCertPem: tlsCertPem,
      tlsKeyPem: tlsKeyPem,
      realityDest: reality.dest || "www.microsoft.com:443",
      realityServerNames: realityServerNames || "www.microsoft.com",
      realityPrivateKey: reality.privateKey || "",
      realityPublicKey: reality.publicKey || "",
      realityShortIds: realityShortIds,
      realitySpiderX: reality.spiderX || "/",
      realityFingerprint: reality.fingerprint || ss.sockopt?.fingerprint || "chrome",
      sniffing: ib.sniffing?.enabled !== false,
      raw: JSON.parse(JSON.stringify(ib)),
    };
  }) : [];

  const outbounds = Array.isArray(parsed.outbounds) ? parsed.outbounds : [{ tag: "direct", protocol: "freedom" }];
  const rawOther = { ...parsed };
  delete rawOther.inbounds;
  delete rawOther.outbounds;

  return {
    error: null,
    inbounds,
    outbounds,
    rawOther,
  };
}

function serializeXrayConfig(model) {
  const inbounds = (model.inbounds || []).map((inb, idx) => {
    const proto = String(inb.protocol || "vless").toLowerCase();
    const net = String(inb.network || "tcp").toLowerCase();
    const sec = String(inb.security || "none").toLowerCase();

    const ib = {
      tag: inb.tag || (idx === 0 ? "vless-in" : `inbound-${idx + 1}`),
      listen: inb.listen || "0.0.0.0",
      port: Number(inb.port) || 443,
      protocol: proto,
      settings: {
        clients: [], // Must remain empty: PasarGuard agent dynamically injects buyer clients
        ...(proto === "vless" ? { decryption: "none" } : {}),
      },
      streamSettings: {
        network: net,
        security: sec,
      },
    };

    if (inb.sniffing !== false) {
      ib.sniffing = {
        enabled: true,
        destOverride: ["http", "tls", "quic"],
      };
    }

    // Transport streamSettings
    if (net === "ws") {
      ib.streamSettings.wsSettings = {
        path: inb.wsPath || "/",
      };
    } else if (net === "grpc") {
      ib.streamSettings.grpcSettings = {
        serviceName: inb.grpcServiceName || "grpc-service",
      };
    } else if (net === "xhttp") {
      ib.streamSettings.xhttpSettings = {
        path: inb.xhttpPath || "/",
        mode: inb.xhttpMode || "auto",
        ...(inb.xhttpHost ? { host: inb.xhttpHost } : {}),
      };
    } else if (net === "httpupgrade") {
      ib.streamSettings.httpupgradeSettings = {
        path: inb.httpupgradePath || "/",
        ...(inb.httpupgradeHost ? { host: inb.httpupgradeHost } : {}),
      };
    } else if (net === "kcp") {
      ib.streamSettings.kcpSettings = {
        header: {
          type: inb.kcpHeaderType || "none",
        },
        ...(inb.kcpSeed ? { seed: inb.kcpSeed } : {}),
      };
    } else if (net === "h2") {
      const hosts = String(inb.h2Host || "").split(",").map((s) => s.trim()).filter(Boolean);
      ib.streamSettings.httpSettings = {
        path: inb.h2Path || "/",
        ...(hosts.length ? { host: hosts } : {}),
      };
    }

    // Security streamSettings
    if (sec === "tls") {
      let certs = [];
      if (inb.tlsCertType === "pem" || (inb.tlsCertPem && inb.tlsKeyPem)) {
        certs = [{
          certificate: String(inb.tlsCertPem || "").split("\n").map((s) => s.replace(/\r$/, "")),
          key: String(inb.tlsKeyPem || "").split("\n").map((s) => s.replace(/\r$/, "")),
        }];
      } else if (inb.tlsCertFile || inb.tlsKeyFile) {
        certs = [{
          certificateFile: inb.tlsCertFile || "",
          keyFile: inb.tlsKeyFile || "",
        }];
      }
      ib.streamSettings.tlsSettings = {
        serverName: inb.tlsServerName || "",
        certificates: certs,
      };
    } else if (sec === "reality") {
      const sns = String(inb.realityServerNames || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const sids = String(inb.realityShortIds || "")
        .split(",")
        .map((s) => s.trim());
      if (!sids.includes("")) sids.unshift(""); // Allow empty shortId

      ib.streamSettings.realitySettings = {
        show: false,
        dest: inb.realityDest || "www.microsoft.com:443",
        xver: 0,
        serverNames: sns.length ? sns : ["www.microsoft.com"],
        privateKey: inb.realityPrivateKey || "",
        shortIds: sids,
        spiderX: inb.realitySpiderX || "/",
        fingerprint: inb.realityFingerprint || "chrome",
      };
      if (inb.realityPublicKey) {
        ib.streamSettings.realitySettings.publicKey = inb.realityPublicKey;
      }
    }

    return ib;
  });

  const full = {
    log: model.rawOther?.log || { loglevel: "warning" },
    ...(model.rawOther || {}),
    inbounds,
    outbounds: (model.outbounds && model.outbounds.length)
      ? model.outbounds
      : [{ tag: "direct", protocol: "freedom" }],
  };

  return JSON.stringify(full, null, 2);
}

// Ready-made Xray core templates for the node config editor. Keep `clients`
// empty — the system injects users per tenant. The inbound tag should match the
// node's PG_AGENT_FORCE_INBOUNDS (default "vless-in").
const CONFIG_TEMPLATES = [
  {
    label: "VLESS + TCP (ساده / تست — بدون TLS)",
    config: {
      log: { loglevel: "warning" },
      inbounds: [
        { tag: "vless-in", listen: "0.0.0.0", port: 443, protocol: "vless",
          settings: { clients: [], decryption: "none" },
          streamSettings: { network: "tcp" },
          sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] } },
      ],
      outbounds: [{ tag: "direct", protocol: "freedom" }],
    },
  },
  {
    label: "VLESS + WS + TLS (دامنه/CDN)",
    config: {
      log: { loglevel: "warning" },
      inbounds: [
        { tag: "vless-in", listen: "0.0.0.0", port: 443, protocol: "vless",
          settings: { clients: [], decryption: "none" },
          streamSettings: { network: "ws", security: "tls",
            wsSettings: { path: "/vless" },
            tlsSettings: { serverName: "your.domain.com",
              certificates: [{ certificateFile: "/etc/ssl/your.crt", keyFile: "/etc/ssl/your.key" }] } },
          sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] } },
      ],
      outbounds: [{ tag: "direct", protocol: "freedom" }],
    },
  },
  {
    label: "VLESS + Reality + TCP (بدون دامنه / ضد فیلتر)",
    config: {
      log: { loglevel: "warning" },
      inbounds: [
        { tag: "vless-in", listen: "0.0.0.0", port: 443, protocol: "vless",
          settings: { clients: [], decryption: "none" },
          streamSettings: { network: "tcp", security: "reality",
            realitySettings: { show: false, dest: "www.microsoft.com:443", xver: 0,
              serverNames: ["www.microsoft.com"],
              privateKey: "REPLACE_WITH_xray_x25519_PRIVATE_KEY",
              shortIds: ["", "0123456789abcdef"],
              spiderX: "/",
              fingerprint: "chrome" } },
          sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] } },
      ],
      outbounds: [{ tag: "direct", protocol: "freedom" }],
    },
  },
  {
    label: "VLESS + Reality + xhttp (مدرن‌ترین ضد فیلتر CDN / تکه‌تکه)",
    config: {
      log: { loglevel: "warning" },
      inbounds: [
        { tag: "vless-in", listen: "0.0.0.0", port: 443, protocol: "vless",
          settings: { clients: [], decryption: "none" },
          streamSettings: { network: "xhttp", security: "reality",
            xhttpSettings: { path: "/xhttp", mode: "auto" },
            realitySettings: { show: false, dest: "www.microsoft.com:443", xver: 0,
              serverNames: ["www.microsoft.com"],
              privateKey: "REPLACE_WITH_xray_x25519_PRIVATE_KEY",
              shortIds: ["", "0123456789abcdef"],
              spiderX: "/",
              fingerprint: "chrome" } },
          sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] } },
      ],
      outbounds: [{ tag: "direct", protocol: "freedom" }],
    },
  },
  {
    label: "VLESS + HTTPUpgrade + TLS (جایگزین فوق‌سبک WS برای CDN)",
    config: {
      log: { loglevel: "warning" },
      inbounds: [
        { tag: "vless-in", listen: "0.0.0.0", port: 443, protocol: "vless",
          settings: { clients: [], decryption: "none" },
          streamSettings: { network: "httpupgrade", security: "tls",
            httpupgradeSettings: { path: "/upgrade" },
            tlsSettings: { serverName: "your.domain.com",
              certificates: [{ certificateFile: "/etc/ssl/your.crt", keyFile: "/etc/ssl/your.key" }] } },
          sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] } },
      ],
      outbounds: [{ tag: "direct", protocol: "freedom" }],
    },
  },
  {
    label: "VMess + WS",
    config: {
      log: { loglevel: "warning" },
      inbounds: [
        { tag: "vless-in", listen: "0.0.0.0", port: 443, protocol: "vmess",
          settings: { clients: [] },
          streamSettings: { network: "ws", wsSettings: { path: "/vmess" } },
          sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] } },
      ],
      outbounds: [{ tag: "direct", protocol: "freedom" }],
    },
  },
  {
    label: "Trojan + TCP + TLS",
    config: {
      log: { loglevel: "warning" },
      inbounds: [
        { tag: "vless-in", listen: "0.0.0.0", port: 443, protocol: "trojan",
          settings: { clients: [] },
          streamSettings: { network: "tcp", security: "tls",
            tlsSettings: { serverName: "your.domain.com",
              certificates: [{ certificateFile: "/etc/ssl/your.crt", keyFile: "/etc/ssl/your.key" }] } },
          sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] } },
      ],
      outbounds: [{ tag: "direct", protocol: "freedom" }],
    },
  },
];

// confirmModal asks for confirmation before a destructive action.
function confirmModal(message, onYes) {
  modal(
    "تایید",
    `<p style="margin:0 0 4px">${esc(message)}</p>
     <div class="actions"><button class="btn danger" id="cfYes">تایید</button><button class="btn ghost" id="cfNo">انصراف</button></div>`,
    (root) => {
      root.querySelector("#cfNo").onclick = closeModal;
      root.querySelector("#cfYes").onclick = () =>
        guard(async () => { await onYes(); closeModal(); toast("انجام شد"); route(); });
    }
  );
}

/* ===================== Dashboard ===================== */
async function viewDashboard(view) {
  const [nodes, customers, plans] = await Promise.all([
    api("/api/v1/nodes"),
    api("/api/v1/customers"),
    api("/api/v1/plans"),
  ]);
  const online = nodes.filter((n) => n.status === "online").length;

  // Gather subscriptions across customers for the alert lists.
  const custName = Object.fromEntries(customers.map((c) => [c.id, c.name]));
  const subs = [];
  for (const c of customers) {
    try { (await api(`/api/v1/customers/${c.id}/subscriptions`)).forEach((s) => subs.push(s)); } catch (_) {}
  }
  const now = Date.now() / 1000;
  const active = subs.filter((s) => s.status === "active").length;
  const expiring = subs
    .filter((s) => s.end_at && s.end_at - now > 0 && s.end_at - now <= 7 * 86400)
    .sort((a, b) => a.end_at - b.end_at);
  const nearQuota = subs
    .filter((s) => s.quota_bytes > 0 && s.used_bytes / s.quota_bytes >= 0.8)
    .sort((a, b) => b.used_bytes / b.quota_bytes - a.used_bytes / a.quota_bytes);
  const totalUsed = subs.reduce((a, s) => a + (s.used_bytes || 0), 0);

  const listCard = (title, rows) =>
    `<div class="card"><h3>${esc(title)}</h3>${
      rows.length
        ? table(["مشتری", "وضعیت", "مصرف", "انقضا"],
            rows.slice(0, 8).map((s) => [
              esc(custName[s.customer_id] || "—"),
              badge(s.status),
              progress(s.used_bytes, s.quota_bytes),
              fmtDate(s.end_at) + daysLeftLabel(s.end_at),
            ]))
        : `<div class="empty">موردی نیست</div>`
    }</div>`;

  view.innerHTML = `
    <div class="grid cols-4">
      ${statCard("نودها", nodes.length, `${online} آنلاین`)}
      ${statCard("مشتری‌ها", customers.length, "")}
      ${statCard("اشتراک‌های فعال", active, `از ${subs.length}`)}
      ${statCard("مصرف کل", fmtBytes(totalUsed), "")}
    </div>
    <div class="grid cols-2" style="margin-top:18px">
      ${listCard("رو به انقضا (۷ روز آینده)", expiring)}
      ${listCard("نزدیک به اتمام حجم (≥۸۰٪)", nearQuota)}
    </div>
    <div class="card" style="margin-top:18px">
      <h3>نودها</h3>
      ${nodesTable(nodes, false)}
    </div>`;
}

/* ===================== Nodes ===================== */
function nodesTable(nodes, withActions) {
  if (!nodes.length) return `<div class="empty">نودی ثبت نشده است</div>`;
  return table(
    ["نام", "آدرس", "وضعیت", "نسخه", "آخرین بازدید", withActions ? "عملیات" : null],
    nodes.map((n) => [
      esc(n.name),
      `<span class="mono">${esc(n.address)}</span>`,
      badge(n.status),
      esc(n.version || "—"),
      fmtDate(n.last_seen_at),
      withActions
        ? `<div class="row" style="gap:6px">
            <button class="btn sm ghost" data-detail="${n.id}">جزئیات</button>
            <button class="btn sm ghost" data-health="${n.id}">سلامت</button>
            <button class="btn sm ghost" data-cfg="${n.id}">کانفیگ</button>
            <button class="btn sm danger" data-delnode="${n.id}">حذف</button>
          </div>`
        : null,
    ])
  );
}
async function viewNodes(view) {
  const nodes = await api("/api/v1/nodes");
  view.innerHTML =
    sectionHead("نودها", `<button class="btn primary" id="addNode">+ ثبت نود</button>`) +
    `<div class="card">${nodesTable(nodes, true)}</div>`;
  document.getElementById("addNode").onclick = nodeModal;
  view.querySelectorAll("[data-health]").forEach((b) => {
    b.onclick = () =>
      guard(async () => {
        const h = await api(`/api/v1/nodes/${b.dataset.health}/health`);
        toast(`هسته ${h.core_version || "?"} — ${h.core_started ? "فعال" : "خاموش"}`);
        route();
      });
  });
  view.querySelectorAll("[data-delnode]").forEach((b) => {
    b.onclick = () => confirmModal("این نود حذف شود؟", () => api(`/api/v1/nodes/${b.dataset.delnode}`, { method: "DELETE" }));
  });
  view.querySelectorAll("[data-cfg]").forEach((b) => {
    b.onclick = () => guard(() => nodeConfigModal(b.dataset.cfg));
  });
  view.querySelectorAll("[data-detail]").forEach((b) => {
    b.onclick = () => guard(() => nodeDetailModal(b.dataset.detail));
  });
}

// nodeDetailModal shows a node's connection info (host, ports, gRPC address,
// keys and certificate) with copy buttons, plus shortcuts to edit/config.
async function nodeDetailModal(nodeID) {
  const d = await api(`/api/v1/nodes/${nodeID}`);
  const field = (label, value, btnId) =>
    `<div class="field"><label>${esc(label)}</label>
      <div class="row" style="gap:6px;align-items:stretch">
        <input readonly value="${esc(value)}" style="flex:1" />
        ${btnId ? `<button class="btn ghost" id="${btnId}">کپی</button>` : ""}
      </div></div>`;
  modal(
    "جزئیات نود — " + esc(d.name),
    `${field("IP / هاست", d.host, "cpHost")}
     ${field("آدرس سرویس (کنترل، HTTPS)", d.address, "cpAddr")}
     ${field("پورت سرویس (HTTP)", d.service_port)}
     ${field("آدرس gRPC (برای پنل PasarGuard)", d.grpc_address, "cpGrpc")}
     ${field("پورت gRPC", d.grpc_port)}
     ${field("پروتکل", d.protocol)}
     ${field("Master key (پنل فروش / مدیریت کامل)", d.master_key || "—", "cpMaster")}
     ${field("Core key (پنل PasarGuard تو / کانفیگ هسته)", d.core_key || "— (تنظیم نشده)", "cpCore")}
     ${field("وضعیت", (STATUS_FA[d.status] || d.status) + (d.version ? " — " + d.version : ""))}
     <div class="field"><label>اطلاعات هاست (برای کانفیگ مشتری — در ربات به خریدار نمایش داده می‌شود)</label>
       <textarea id="dHost" rows="3" readonly spellcheck="false" style="font-family:ui-monospace,monospace;font-size:12px">${esc(d.host_info || "— (تنظیم نشده)")}</textarea></div>
     <div class="field"><label>گواهی نود (Certificate)</label>
       <textarea id="dCert" rows="6" readonly spellcheck="false" style="font-family:ui-monospace,monospace;font-size:12px">${esc(d.cert_pem || "—")}</textarea></div>
     ${d.cert_pinned ? "" : `<p class="muted" style="font-size:12px;margin:0 0 8px;color:#c0392b">⚠️ گواهی این نود پین نشده است؛ ارتباط پنل با نود بدون تأیید هویت انجام می‌شود (master key در هر درخواست ارسال می‌شود). برای رفع، گواهی نود را در فرم ویرایش ثبت کنید.</p>`}
     <p class="muted" style="font-size:12px;margin:0 0 8px">برای فروش، مشتری از کلید اشتراکش استفاده می‌کند. برای مدیریت هسته‌ی مشترک از پنل PasarGuard خودت، از Core key استفاده کن.</p>
     <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:6px">
       <button class="btn sm ghost" id="cStart">شروع هسته</button>
       <button class="btn sm ghost" id="cRestart">ری‌استارت هسته</button>
       <button class="btn sm danger" id="cStop">توقف هسته</button>
       <button class="btn sm ghost" id="cXray">تغییر نسخه Xray</button>
       <button class="btn sm ghost" id="cUpd">آپدیت نود</button>
     </div>
     <div class="actions">
       <button class="btn primary" id="dCfg">کانفیگ Xray</button>
       <button class="btn ghost" id="dEdit">ویرایش نود</button>
       <button class="btn ghost" id="dCertCopy">کپی گواهی</button>
       <button class="btn ghost" id="dClose">بستن</button>
     </div>`,
    (root) => {
      const copy = (t) => { if (navigator.clipboard) navigator.clipboard.writeText(t); toast("کپی شد"); };
      root.querySelector("#cpHost").onclick = () => copy(d.host);
      root.querySelector("#cpAddr").onclick = () => copy(d.address);
      root.querySelector("#cpGrpc").onclick = () => copy(d.grpc_address);
      root.querySelector("#cpMaster").onclick = () => copy(d.master_key || "");
      root.querySelector("#cpCore").onclick = () => copy(d.core_key || "");
      root.querySelector("#dCertCopy").onclick = () => copy(d.cert_pem || "");
      root.querySelector("#dClose").onclick = closeModal;
      root.querySelector("#dCfg").onclick = () => { closeModal(); guard(() => nodeConfigModal(nodeID)); };
      root.querySelector("#dEdit").onclick = () => { closeModal(); nodeEditModal(d); };
      const core = (action, msg) => guard(async () => {
        await api(`/api/v1/nodes/${nodeID}/core/${action}`, { method: "POST" });
        toast(msg);
      });
      root.querySelector("#cStart").onclick = () => core("start", "هسته شروع شد");
      root.querySelector("#cRestart").onclick = () => core("restart", "هسته ری‌استارت شد");
      root.querySelector("#cStop").onclick = () => confirmModal("هسته‌ی این نود متوقف شود؟ (همه‌ی مشتری‌ها قطع می‌شوند تا دوباره شروع شود)", async () => {
        await api(`/api/v1/nodes/${nodeID}/core/stop`, { method: "POST" });
      });
      root.querySelector("#cXray").onclick = () => {
        closeModal();
        formModal("تغییر نسخه Xray-core", [{ name: "version", label: "نسخه (مثلاً v1.8.23 یا latest)", value: "latest" }], async (v) => {
          toast("در حال دانلود و اعمال... ممکن است کمی طول بکشد");
          await api(`/api/v1/nodes/${nodeID}/xray-version`, { method: "POST", body: JSON.stringify({ version: v.version || "latest" }) });
          toast("نسخه‌ی Xray عوض و هسته ری‌استارت شد");
        }, "اعمال");
      };
      root.querySelector("#cUpd").onclick = () => {
        closeModal();
        formModal("آپدیت باینری نود", [{ name: "version", label: "نسخه (خالی = آخرین)", placeholder: "latest" }], async (v) => {
          toast("در حال دانلود و آپدیت نود... سرویس ری‌استارت می‌شود");
          await api(`/api/v1/nodes/${nodeID}/update`, { method: "POST", body: JSON.stringify({ version: v.version || "latest" }) });
          toast("نود در حال آپدیت و ری‌استارت است");
        }, "آپدیت");
      };
    }
  );
}

// nodeEditModal edits an existing node (set core key, change address/port/cert).
function nodeEditModal(d) {
  formModal(
    "ویرایش نود — " + esc(d.name),
    [
      { name: "name", label: "نام", value: d.name },
      { name: "address", label: "آدرس", value: d.address },
      { name: "grpc_port", label: "پورت gRPC", type: "number", value: String(d.grpc_port || 62050) },
      { name: "core_key", label: "Core key (برای مدیریت هسته از پنل PasarGuard تو)", value: d.core_key || "" },
      { name: "host_info", label: "اطلاعات هاست (به خریدار در ربات نمایش داده می‌شود؛ خالی = حذف)", type: "textarea", value: d.host_info || "", hint: "مثلاً: SNI، دامنه‌ی CDN یا نکته‌ی کانفیگ که مشتری برای کاربرهایش لازم دارد." },
      { name: "master_key", label: "Master key (خالی = بدون تغییر)", type: "password", hint: "فقط اگر کلید مستر نود را عوض کرده‌ای پر کن." },
      { name: "cert_pem", label: "گواهی نود (PEM، خالی = بدون تغییر)", type: "textarea" },
    ],
    async (v) => {
      const body = { name: v.name, address: v.address, core_key: v.core_key, host_info: v.host_info };
      if (v.grpc_port) body.grpc_port = parseInt(v.grpc_port, 10);
      if (v.master_key) body.master_key = v.master_key;
      if (v.cert_pem) body.cert_pem = v.cert_pem;
      await api(`/api/v1/nodes/${d.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast("نود به‌روزرسانی شد");
    }
  );
}

// nodeConfigModal lets the operator edit and push a node's fixed Xray config
// with a full visual inbound form builder, Reality key generator, and raw JSON editor.
async function nodeConfigModal(nodeID) {
  const res = await fetch(`/api/v1/nodes/${nodeID}/config`, {
    headers: { Authorization: "Bearer " + getToken() },
  });
  if (res.status === 401) { openTokenModal(); return; }
  const current = await res.text();

  let configModel = parseXrayConfig(current);
  if (!configModel.inbounds || configModel.inbounds.length === 0) {
    // Default to a standard VLESS inbound if empty
    configModel = parseXrayConfig(JSON.stringify(CONFIG_TEMPLATES[0].config));
  }

  const tmplOptions = CONFIG_TEMPLATES.map((t, i) => `<option value="${i}">${esc(t.label)}</option>`).join("");

  function renderInboundCard(inb, idx, totalCount) {
    const isWs = inb.network === "ws";
    const isGrpc = inb.network === "grpc";
    const isXhttp = inb.network === "xhttp";
    const isHttpupgrade = inb.network === "httpupgrade";
    const isKcp = inb.network === "kcp";
    const isH2 = inb.network === "h2";
    const isTls = inb.security === "tls";
    const isReality = inb.security === "reality";

    return `
      <div class="inbound-card" data-idx="${idx}">
        <div class="inbound-card-header">
          <div class="inbound-card-title">
            <span>اینباند #${idx + 1}</span>
            <span class="inbound-chip">${esc(inb.protocol.toUpperCase())}</span>
            <span class="inbound-chip" style="background:var(--surface)">${esc(inb.network.toUpperCase())}</span>
            ${inb.security !== "none" ? `<span class="inbound-chip" style="background:var(--ok);color:#fff">${esc(inb.security.toUpperCase())}</span>` : ""}
          </div>
          ${totalCount > 1 ? `<button class="btn sm danger" type="button" data-del-inb="${idx}" title="حذف اینباند">حذف</button>` : ""}
        </div>

        <div class="inbound-grid">
          <div class="field">
            <label>تگ (Tag)</label>
            <input type="text" data-prop="tag" value="${esc(inb.tag)}" placeholder="vless-in" />
          </div>
          <div class="field">
            <label>آدرس Listen</label>
            <input type="text" data-prop="listen" value="${esc(inb.listen)}" placeholder="0.0.0.0" />
          </div>
          <div class="field">
            <label>پورت (Port)</label>
            <input type="number" data-prop="port" value="${esc(inb.port)}" placeholder="443" />
          </div>
          <div class="field">
            <label>پروتکل (Protocol)</label>
            <select data-prop="protocol">
              <option value="vless" ${inb.protocol === "vless" ? "selected" : ""}>VLESS</option>
              <option value="vmess" ${inb.protocol === "vmess" ? "selected" : ""}>VMess</option>
              <option value="trojan" ${inb.protocol === "trojan" ? "selected" : ""}>Trojan</option>
            </select>
          </div>
          <div class="field">
            <label>انتقال (Transport / Network)</label>
            <select data-prop="network">
              <option value="tcp" ${inb.network === "tcp" ? "selected" : ""}>TCP</option>
              <option value="xhttp" ${inb.network === "xhttp" ? "selected" : ""}>xhttp (SplitHTTP — ضد فیلتر جدید)</option>
              <option value="httpupgrade" ${inb.network === "httpupgrade" ? "selected" : ""}>HTTPUpgrade (کلادفلر / CDN سبک)</option>
              <option value="ws" ${inb.network === "ws" ? "selected" : ""}>WebSocket (WS)</option>
              <option value="grpc" ${inb.network === "grpc" ? "selected" : ""}>gRPC</option>
              <option value="kcp" ${inb.network === "kcp" ? "selected" : ""}>mKCP (UDP)</option>
              <option value="h2" ${inb.network === "h2" ? "selected" : ""}>HTTP/2</option>
            </select>
          </div>
          <div class="field">
            <label>امنیت (Security / TLS)</label>
            <select data-prop="security">
              <option value="none" ${inb.security === "none" ? "selected" : ""}>None (بدون رمزنگاری)</option>
              <option value="tls" ${inb.security === "tls" ? "selected" : ""}>TLS (گواهی SSL/دامنه)</option>
              <option value="reality" ${inb.security === "reality" ? "selected" : ""}>Reality (ضد فیلتر بدون دامنه)</option>
            </select>
          </div>
        </div>

        <!-- xhttp Transport Settings -->
        ${isXhttp ? `
          <div class="inbound-grid" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
            <div class="field">
              <label>مسیر xhttp (Path)</label>
              <input type="text" data-prop="xhttpPath" value="${esc(inb.xhttpPath || "/")}" placeholder="/xhttp" />
            </div>
            <div class="field">
              <label>هاست xhttp (Host اختیاری)</label>
              <input type="text" data-prop="xhttpHost" value="${esc(inb.xhttpHost || "")}" placeholder="cdn.example.com" />
            </div>
            <div class="field">
              <label>حالت انتقال (Mode)</label>
              <select data-prop="xhttpMode">
                <option value="auto" ${(!inb.xhttpMode || inb.xhttpMode === "auto") ? "selected" : ""}>auto (خودکار — پیشنهادی)</option>
                <option value="stream-up" ${inb.xhttpMode === "stream-up" ? "selected" : ""}>stream-up (استریم آپلود)</option>
                <option value="packet-up" ${inb.xhttpMode === "packet-up" ? "selected" : ""}>packet-up (پکت آپلود)</option>
                <option value="stream-one" ${inb.xhttpMode === "stream-one" ? "selected" : ""}>stream-one (تک استریم)</option>
              </select>
            </div>
          </div>
        ` : ""}

        <!-- HTTPUpgrade Transport Settings -->
        ${isHttpupgrade ? `
          <div class="inbound-grid" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
            <div class="field">
              <label>مسیر HTTPUpgrade (Path)</label>
              <input type="text" data-prop="httpupgradePath" value="${esc(inb.httpupgradePath || "/")}" placeholder="/upgrade" />
            </div>
            <div class="field">
              <label>هاست HTTPUpgrade (Host اختیاری)</label>
              <input type="text" data-prop="httpupgradeHost" value="${esc(inb.httpupgradeHost || "")}" placeholder="upgrade.example.com" />
            </div>
          </div>
        ` : ""}

        <!-- WS Transport Settings -->
        ${isWs ? `
          <div class="inbound-grid" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
            <div class="field" style="grid-column: 1 / -1">
              <label>مسیر وب‌سوکت (WS Path)</label>
              <input type="text" data-prop="wsPath" value="${esc(inb.wsPath || "/")}" placeholder="/vless" />
            </div>
          </div>
        ` : ""}

        <!-- gRPC Transport Settings -->
        ${isGrpc ? `
          <div class="inbound-grid" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
            <div class="field" style="grid-column: 1 / -1">
              <label>نام سرویس gRPC (Service Name)</label>
              <input type="text" data-prop="grpcServiceName" value="${esc(inb.grpcServiceName || "")}" placeholder="grpc-service" />
            </div>
          </div>
        ` : ""}

        <!-- mKCP Transport Settings -->
        ${isKcp ? `
          <div class="inbound-grid" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
            <div class="field">
              <label>نوع جعل هدر (Header Type)</label>
              <select data-prop="kcpHeaderType">
                <option value="none" ${(!inb.kcpHeaderType || inb.kcpHeaderType === "none") ? "selected" : ""}>none (ساده)</option>
                <option value="wireguard" ${inb.kcpHeaderType === "wireguard" ? "selected" : ""}>wireguard (شبیه‌ساز وایرگارد)</option>
                <option value="wechat-video" ${inb.kcpHeaderType === "wechat-video" ? "selected" : ""}>wechat-video (ویدیوکال)</option>
                <option value="dtls" ${inb.kcpHeaderType === "dtls" ? "selected" : ""}>dtls 1.2</option>
                <option value="srtp" ${inb.kcpHeaderType === "srtp" ? "selected" : ""}>srtp</option>
                <option value="utp" ${inb.kcpHeaderType === "utp" ? "selected" : ""}>utp (بیت‌تورنت)</option>
              </select>
            </div>
            <div class="field">
              <label>رمز مبهم‌سازی (KCP Seed اختیاری)</label>
              <input type="text" data-prop="kcpSeed" value="${esc(inb.kcpSeed || "")}" placeholder="seed password" />
            </div>
          </div>
        ` : ""}

        <!-- HTTP/2 Transport Settings -->
        ${isH2 ? `
          <div class="inbound-grid" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
            <div class="field">
              <label>مسیر HTTP/2 (Path)</label>
              <input type="text" data-prop="h2Path" value="${esc(inb.h2Path || "/")}" placeholder="/h2" />
            </div>
            <div class="field">
              <label>هاست‌های مجاز (Host — با کاما جدا کنید)</label>
              <input type="text" data-prop="h2Host" value="${esc(inb.h2Host || "")}" placeholder="h2.example.com" />
            </div>
          </div>
        ` : ""}

        <!-- TLS Settings -->
        ${isTls ? `
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
            <div class="inbound-grid">
              <div class="field">
                <label>دامنه / SNI (Server Name)</label>
                <input type="text" data-prop="tlsServerName" value="${esc(inb.tlsServerName)}" placeholder="your.domain.com" />
              </div>
              <div class="field">
                <label>روش تعریف گواهی (Certificate Mode)</label>
                <select data-prop="tlsCertType">
                  <option value="file" ${(!inb.tlsCertType || inb.tlsCertType === "file") ? "selected" : ""}>مسیر فایل روی سرور (File Path)</option>
                  <option value="pem" ${inb.tlsCertType === "pem" ? "selected" : ""}>محتوای متنی مستقیم (PEM Text)</option>
                </select>
              </div>
            </div>

            ${inb.tlsCertType === "pem" ? `
              <div class="inbound-grid" style="margin-top:10px">
                <div class="field" style="grid-column: 1 / -1">
                  <label>محتوای متنی گواهی (Certificate PEM — شامل BEGIN و END)</label>
                  <textarea data-prop="tlsCertPem" rows="5" placeholder="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----" style="font-family:var(--font-mono);font-size:12px">${esc(inb.tlsCertPem || "")}</textarea>
                </div>
                <div class="field" style="grid-column: 1 / -1">
                  <label>محتوای کلید خصوصی (Private Key PEM — شامل BEGIN و END)</label>
                  <textarea data-prop="tlsKeyPem" rows="5" placeholder="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----" style="font-family:var(--font-mono);font-size:12px">${esc(inb.tlsKeyPem || "")}</textarea>
                </div>
              </div>
            ` : `
              <div class="inbound-grid" style="margin-top:10px">
                <div class="field">
                  <label>مسیر فایل گواهی (Cert File)</label>
                  <input type="text" data-prop="tlsCertFile" value="${esc(inb.tlsCertFile || "")}" placeholder="/etc/ssl/cert.pem" />
                </div>
                <div class="field">
                  <label>مسیر فایل کلید (Key File)</label>
                  <input type="text" data-prop="tlsKeyFile" value="${esc(inb.tlsKeyFile || "")}" placeholder="/etc/ssl/key.pem" />
                </div>
              </div>
            `}
          </div>
        ` : ""}

        <!-- Reality Settings -->
        ${isReality ? `
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
            <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px">
              <span style="font-size:12.5px;font-weight:700;color:var(--accent)">تنظیمات پروتکل Reality</span>
              <button class="btn-gen-keys" type="button" data-gen-reality="${idx}">
                🎲 تولید خودکار کلیدهای Reality
              </button>
            </div>
            <div class="inbound-grid">
              <div class="field">
                <label>هدف فریب (Dest)</label>
                <input type="text" data-prop="realityDest" value="${esc(inb.realityDest)}" placeholder="www.microsoft.com:443" />
              </div>
              <div class="field">
                <label>دامنه‌های مجاز (Server Names — با کاما جدا کنید)</label>
                <input type="text" data-prop="realityServerNames" value="${esc(inb.realityServerNames)}" placeholder="www.microsoft.com, learn.microsoft.com" />
              </div>
              <div class="field">
                <label>شناسه کوتاه (Short IDs — هگز ۸ یا ۱۶ کاراکتر)</label>
                <input type="text" data-prop="realityShortIds" value="${esc(inb.realityShortIds)}" placeholder="0123456789abcdef" />
              </div>
              <div class="field">
                <label>مسیر خزنده (SpiderX)</label>
                <input type="text" data-prop="realitySpiderX" value="${esc(inb.realitySpiderX || "/")}" placeholder="/" />
              </div>
              <div class="field">
                <label>فینگرپرینت کلاینت (uTLS Fingerprint)</label>
                <select data-prop="realityFingerprint">
                  <option value="chrome" ${(!inb.realityFingerprint || inb.realityFingerprint === "chrome") ? "selected" : ""}>chrome (پیش‌فرض)</option>
                  <option value="firefox" ${inb.realityFingerprint === "firefox" ? "selected" : ""}>firefox</option>
                  <option value="safari" ${inb.realityFingerprint === "safari" ? "selected" : ""}>safari</option>
                  <option value="ios" ${inb.realityFingerprint === "ios" ? "selected" : ""}>ios</option>
                  <option value="android" ${inb.realityFingerprint === "android" ? "selected" : ""}>android</option>
                  <option value="edge" ${inb.realityFingerprint === "edge" ? "selected" : ""}>edge</option>
                  <option value="random" ${inb.realityFingerprint === "random" ? "selected" : ""}>random</option>
                  <option value="randomized" ${inb.realityFingerprint === "randomized" ? "selected" : ""}>randomized</option>
                </select>
              </div>
              <div class="field" style="grid-column: 1 / -1">
                <label>کلید خصوصی (Private Key)</label>
                <input type="text" data-prop="realityPrivateKey" value="${esc(inb.realityPrivateKey)}" placeholder="Base64 RawURL Private Key" style="font-family:var(--font-mono);font-size:12px" />
              </div>
              ${inb.realityPublicKey ? `
                <div class="field" style="grid-column: 1 / -1">
                  <label>کلید عمومی (Public Key — ذخیره‌شده برای لینک اتصال)</label>
                  <div class="row" style="gap:6px">
                    <input readonly value="${esc(inb.realityPublicKey)}" style="font-family:var(--font-mono);font-size:12px;flex:1" />
                    <button class="btn sm ghost" type="button" data-copy-pub="${esc(inb.realityPublicKey)}">کپی</button>
                  </div>
                </div>
              ` : ""}
            </div>
          </div>
        ` : ""}
      </div>
    `;
  }

  modal(
    "کانفیگ هسته‌ی نود",
    `<div class="cfg-mode-tabs">
       <button class="cfg-mode-tab active" type="button" id="tabVisual">🎛️ ویرایشگر گرافیکی</button>
       <button class="cfg-mode-tab" type="button" id="tabRaw">📝 کد خام JSON</button>
     </div>
     <div class="field" style="margin-bottom:12px">
       <label>بارگذاری از قالب آماده</label>
       <select id="cfgTmpl"><option value="">— انتخاب قالب برای بارگذاری —</option>${tmplOptions}</select>
     </div>
     <div id="cfgVisualSection">
       <p class="muted" style="font-size:12px;margin:0 0 10px">اینباندهای هسته را به‌صورت گرافیکی تنظیم کنید. خریداران و کاربران به‌صورت پویا توسط سرویس نود تزریق می‌شوند.</p>
       <div id="cfgInboundsList"></div>
       <button class="btn ghost sm" type="button" id="cfgAddInbound" style="border:1px dashed var(--border);width:100%;margin-top:6px">+ افزودن اینباند جدید</button>
     </div>
     <div id="cfgRawSection" style="display:none">
       <div class="field">
         <label>JSON کامل کانفیگ Xray</label>
         <textarea id="cfgEditor" rows="18" spellcheck="false" style="font-family:var(--font-mono);font-size:12px">${esc(serializeXrayConfig(configModel))}</textarea>
       </div>
     </div>
     <div class="actions">
       <button class="btn primary" id="cfgApply">اعمال روی نود</button>
       <button class="btn ghost" id="cfgCancel">انصراف</button>
     </div>`,
    (root) => {
      let activeMode = "visual";
      const listEl = root.querySelector("#cfgInboundsList");
      const editorEl = root.querySelector("#cfgEditor");
      const visualSec = root.querySelector("#cfgVisualSection");
      const rawSec = root.querySelector("#cfgRawSection");
      const tabVisual = root.querySelector("#tabVisual");
      const tabRaw = root.querySelector("#tabRaw");

      function attachInboundEvents() {
        listEl.querySelectorAll("[data-prop]").forEach((input) => {
          const handler = (e) => {
            const card = e.target.closest(".inbound-card");
            if (!card) return;
            const idx = Number(card.dataset.idx);
            const prop = e.target.dataset.prop;
            configModel.inbounds[idx][prop] = e.target.value.trim();

            // Re-render if protocol, transport, security, or certificate mode changed
            if (prop === "protocol" || prop === "network" || prop === "security" || prop === "tlsCertType") {
              renderInbounds();
            }
          };
          input.oninput = handler;
          input.onchange = handler;
        });

        listEl.querySelectorAll("[data-del-inb]").forEach((btn) => {
          btn.onclick = (e) => {
            const idx = Number(e.currentTarget.dataset.delInb);
            if (configModel.inbounds.length <= 1) return;
            configModel.inbounds.splice(idx, 1);
            renderInbounds();
            toast("اینباند حذف شد");
          };
        });

        listEl.querySelectorAll("[data-gen-reality]").forEach((btn) => {
          btn.onclick = (e) => {
            const idx = Number(e.currentTarget.dataset.genReality);
            const keys = generateRealityKeys();
            configModel.inbounds[idx].realityPrivateKey = keys.privateKey;
            configModel.inbounds[idx].realityPublicKey = keys.publicKey;
            configModel.inbounds[idx].realityShortIds = keys.shortId;
            renderInbounds();
            toast("کلیدهای جدید Reality و ShortID با موفقیت تولید شدند");
          };
        });

        listEl.querySelectorAll("[data-copy-pub]").forEach((btn) => {
          btn.onclick = (e) => {
            const text = e.currentTarget.dataset.copyPub;
            if (navigator.clipboard) navigator.clipboard.writeText(text);
            toast("کلید عمومی کپی شد");
          };
        });
      }

      function renderInbounds() {
        listEl.innerHTML = configModel.inbounds.map((inb, i) =>
          renderInboundCard(inb, i, configModel.inbounds.length)
        ).join("");
        attachInboundEvents();
      }

      renderInbounds();

      // Mode switching
      tabVisual.onclick = () => {
        if (activeMode === "visual") return;
        const res = parseXrayConfig(editorEl.value.trim());
        if (res.error) {
          toast(res.error, "err");
          return;
        }
        configModel = res;
        activeMode = "visual";
        tabVisual.classList.add("active");
        tabRaw.classList.remove("active");
        visualSec.style.display = "block";
        rawSec.style.display = "none";
        renderInbounds();
      };

      tabRaw.onclick = () => {
        if (activeMode === "raw") return;
        editorEl.value = serializeXrayConfig(configModel);
        activeMode = "raw";
        tabRaw.classList.add("active");
        tabVisual.classList.remove("active");
        rawSec.style.display = "block";
        visualSec.style.display = "none";
      };

      // Template selection
      root.querySelector("#cfgTmpl").onchange = (e) => {
        const idx = e.target.value;
        if (idx === "") return;
        const t = CONFIG_TEMPLATES[Number(idx)];
        if (!t) return;
        if (!confirm("قالب «" + t.label + "» بارگذاری شود؟ تنظیمات فعلی جایگزین خواهند شد.")) {
          e.target.value = "";
          return;
        }
        configModel = parseXrayConfig(JSON.stringify(t.config));
        editorEl.value = serializeXrayConfig(configModel);
        renderInbounds();
        toast("قالب «" + t.label + "» بارگذاری شد");
        e.target.value = "";
      };

      // Add Inbound
      root.querySelector("#cfgAddInbound").onclick = () => {
        const nextIdx = configModel.inbounds.length + 1;
        configModel.inbounds.push({
          tag: "inbound-" + nextIdx,
          listen: "0.0.0.0",
          port: 443 + (nextIdx - 1),
          protocol: "vless",
          network: "tcp",
          security: "none",
          wsPath: "/vless",
          grpcServiceName: "",
          tlsServerName: "",
          tlsCertFile: "",
          tlsKeyFile: "",
          realityDest: "www.microsoft.com:443",
          realityServerNames: "www.microsoft.com",
          realityPrivateKey: "",
          realityPublicKey: "",
          realityShortIds: "",
          sniffing: true,
        });
        renderInbounds();
        toast("اینباند جدید اضافه شد");
      };

      root.querySelector("#cfgCancel").onclick = closeModal;

      // Apply
      root.querySelector("#cfgApply").onclick = () =>
        guard(async () => {
          let rawPayload;
          if (activeMode === "visual") {
            if (!configModel.inbounds || !configModel.inbounds.length) {
              throw new Error("حداقل یک اینباند باید تعریف شده باشد");
            }
            for (const inb of configModel.inbounds) {
              const p = Number(inb.port);
              if (!p || p < 1 || p > 65535) {
                throw new Error(`پورت نامعتبر است: ${inb.port}`);
              }
              if (!inb.tag) {
                throw new Error("تگ اینباند نمی‌تواند خالی باشد");
              }
            }
            rawPayload = serializeXrayConfig(configModel);
          } else {
            rawPayload = editorEl.value.trim();
            if (!rawPayload) throw new Error("کانفیگ خالی است");
            try { JSON.parse(rawPayload); } catch { throw new Error("JSON نامعتبر است"); }
          }

          const r = await fetch(`/api/v1/nodes/${nodeID}/config`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
            body: rawPayload,
          });
          if (!r.ok) {
            let msg = "خطا " + r.status;
            try { msg = (await r.json()).error || msg; } catch (_) {}
            throw new Error(msg);
          }
          closeModal();
          toast("کانفیگ روی نود اعمال شد");
          route();
        });
    },
    "modal-lg"
  );
}
function nodeModal() {
  formModal(
    "ثبت نود",
    [
      { name: "name", label: "نام" },
      { name: "address", label: "آدرس", placeholder: "https://1.2.3.4:8090" },
      { name: "master_key", label: "کلید مستر", type: "password" },
      { name: "core_key", label: "Core key (اختیاری — برای مدیریت هسته از پنل PasarGuard تو)", hint: "همان PG_AGENT_CORE_KEY نود؛ با pg-node-agent edit-env قابل دیدن است." },
      { name: "grpc_port", label: "پورت gRPC (پیش‌فرض 62050)", type: "number", value: "62050" },
      { name: "cert_pem", label: "گواهی نود (PEM، اختیاری)", type: "textarea", hint: "خالی بگذارید تا پنل خودکار گواهی نود را دریافت و pin کند (TOFU)." },
      { name: "config", label: "کانفیگ ثابت Xray (JSON، اختیاری)", type: "textarea", hint: "در صورت ورود، روی نود اعمال و هسته راه‌اندازی می‌شود." },
    ],
    async (v) => {
      const body = { name: v.name, address: v.address, master_key: v.master_key };
      if (v.core_key) body.core_key = v.core_key;
      if (v.grpc_port) body.grpc_port = parseInt(v.grpc_port, 10);
      if (v.cert_pem) body.cert_pem = v.cert_pem;
      if (v.config) {
        try { body.config = JSON.parse(v.config); } catch { throw new Error("کانفیگ JSON نامعتبر است"); }
      }
      await api("/api/v1/nodes", { method: "POST", body: JSON.stringify(body) });
      toast("نود ثبت شد");
    }
  );
}

/* ===================== Customers ===================== */
async function viewCustomers(view) {
  const customers = await api("/api/v1/customers");
  view.innerHTML =
    sectionHead("مشتری‌ها", `<button class="btn primary" id="addCust">+ مشتری جدید</button>`) +
    `<div class="card">${
      customers.length
        ? table(
            ["نام", "وضعیت", "شناسه در ربات", "ساخته‌شده", "عملیات"],
            customers.map((c) => [
              esc(c.name),
              badge(c.status),
              `<span class="mono">${esc(c.external_ref || "—")}</span>`,
              fmtDate(c.created_at),
              `<div class="row" style="gap:6px">
                <button class="btn sm ghost" data-cust="${c.id}">جزئیات</button>
                ${c.status === "disabled"
                  ? `<button class="btn sm ghost" data-encust="${c.id}">فعال‌سازی</button>`
                  : `<button class="btn sm ghost" data-discust="${c.id}">غیرفعال</button>`}
                <button class="btn sm danger" data-delcust="${c.id}">حذف</button>
              </div>`,
            ])
          )
        : `<div class="empty">مشتری‌ای ثبت نشده است</div>`
    }</div>`;
  document.getElementById("addCust").onclick = () =>
    formModal(
      "مشتری جدید",
      [
        { name: "name", label: "نام" },
        { name: "external_ref", label: "شناسه در ربات فروش (اختیاری)" },
      ],
      async (v) => {
        await api("/api/v1/customers", { method: "POST", body: JSON.stringify(v) });
        toast("مشتری ساخته شد");
      }
    );
  view.querySelectorAll("[data-cust]").forEach((b) => (b.onclick = () => guard(() => customerDetail(b.dataset.cust))));
  view.querySelectorAll("[data-encust]").forEach((b) =>
    (b.onclick = () => guard(async () => { await api(`/api/v1/customers/${b.dataset.encust}/enable`, { method: "POST" }); toast("فعال شد"); route(); })));
  view.querySelectorAll("[data-discust]").forEach((b) =>
    (b.onclick = () => guard(async () => { await api(`/api/v1/customers/${b.dataset.discust}/disable`, { method: "POST" }); toast("غیرفعال شد"); route(); })));
  view.querySelectorAll("[data-delcust]").forEach((b) =>
    (b.onclick = () => confirmModal("این مشتری و همه‌ی اشتراک‌هایش حذف شوند؟", () => api(`/api/v1/customers/${b.dataset.delcust}`, { method: "DELETE" }))));
}
async function customerDetail(id) {
  const [usage, subs] = await Promise.all([
    api(`/api/v1/customers/${id}/usage`),
    api(`/api/v1/customers/${id}/subscriptions`),
  ]);
  modal(
    "جزئیات مشتری",
    `<div class="row" style="gap:24px;margin-bottom:16px">
      <div><div class="muted" style="font-size:12px">مصرف کل</div><b>${fmtBytes(usage.used_bytes)} / ${fmtBytes(usage.quota_bytes)}</b></div>
      <div><div class="muted" style="font-size:12px">مصرف اضافه</div><b style="color:var(--danger)">${fmtBytes(usage.overage_bytes)}</b></div>
    </div>
    ${
      subs.length
        ? table(
            ["وضعیت", "مصرف", "انقضا", ""],
            subs.map((s) => [
              badge(s.status),
              progress(s.used_bytes, s.quota_bytes),
              fmtDate(s.end_at),
              s.sub_token ? `<button class="btn sm ghost" onclick="subLinkModal('${esc(s.sub_token)}')">لینک</button>` : "",
            ])
          )
        : `<div class="empty">اشتراکی ندارد</div>`
    }
    <div class="actions"><button class="btn ghost" id="cdClose">بستن</button></div>`,
    (root) => (root.querySelector("#cdClose").onclick = closeModal)
  );
}

/* ===================== Plans ===================== */
async function viewPlans(view) {
  const plans = await api("/api/v1/plans");
  view.innerHTML =
    sectionHead("پلن‌ها", `<button class="btn primary" id="addPlan">+ پلن جدید</button>`) +
    `<div class="card">${
      plans.length
        ? table(
            ["نام", "حجم", "مدت (روز)", "سقف کاربر", "هسته", "اینباندها", "ساخته‌شده", "عملیات"],
            plans.map((p) => [
              esc(p.name),
              fmtBytes(p.quota_bytes),
              esc(p.duration_days),
              esc(p.max_users ? p.max_users : "∞"),
              p.core_type === "dedicated" ? `<span class="badge" style="background:#8b5cf6">اختصاصی</span>` : `<span class="badge">اشتراکی</span>`,
              esc(p.allowed_inbounds && p.allowed_inbounds.length ? p.allowed_inbounds.join(", ") : "همه"),
              fmtDate(p.created_at),
              `<button class="btn sm danger" data-delplan="${p.id}">حذف</button>`,
            ])
          )
        : `<div class="empty">پلنی تعریف نشده است</div>`
    }</div>`;
  document.getElementById("addPlan").onclick = () =>
    formModal(
      "پلن جدید",
      [
        { name: "name", label: "نام" },
        { name: "quota_gb", label: "حجم (گیگابایت)", type: "number", placeholder: "100" },
        { name: "duration_days", label: "مدت (روز)", type: "number", placeholder: "30" },
        { name: "max_users", label: "سقف کاربر (۰ = نامحدود)", type: "number", value: "0" },
        { name: "core_type", label: "نوع هسته", type: "select", options: [
          { value: "shared", label: "اشتراکی (Shared)" },
          { value: "dedicated", label: "اختصاصی (Dedicated)" },
        ], value: "shared" },
        { name: "allowed_inbounds", label: "اینباندهای مجاز (با کاما جدا کنید؛ خالی = همه)", placeholder: "vless-in, vmess-in", hint: "تگ اینباندهای مجاز نود برای این پلن" },
        { name: "max_ips", label: "سقف IP همزمان برای هر کاربر (۰ = نامحدود)", type: "number", value: "0" },
        { name: "speed_limit_mbps", label: "محدودیت سرعت به مگابیت (۰ = نامحدود)", type: "number", value: "0" },
      ],
      async (v) => {
        const quota_bytes = Math.round(parseFloat(v.quota_gb || "0") * GB);
        if (quota_bytes <= 0) throw new Error("حجم باید بزرگ‌تر از صفر باشد");
        const allowed_inbounds = (v.allowed_inbounds || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        await api("/api/v1/plans", {
          method: "POST",
          body: JSON.stringify({
            name: v.name,
            quota_bytes,
            duration_days: parseInt(v.duration_days || "0", 10),
            max_users: parseInt(v.max_users || "0", 10),
            core_type: v.core_type || "shared",
            allowed_inbounds: allowed_inbounds,
            max_ips: parseInt(v.max_ips || "0", 10),
            speed_limit_mbps: parseInt(v.speed_limit_mbps || "0", 10),
          }),
        });
        toast("پلن ساخته شد");
      }
    );
  view.querySelectorAll("[data-delplan]").forEach((b) =>
    (b.onclick = () => confirmModal("این پلن حذف شود؟", () => api(`/api/v1/plans/${b.dataset.delplan}`, { method: "DELETE" }))));
}

/* ===================== Subscriptions ===================== */
function subActions(s) {
  const toggle =
    s.status === "suspended"
      ? `<button class="btn sm ghost" data-resume="${s.id}">فعال‌سازی</button>`
      : `<button class="btn sm ghost" data-suspend="${s.id}">تعلیق</button>`;
  return `<div class="row" style="gap:6px">${toggle}
    <button class="btn sm ghost" data-conn="${s.id}">اتصال مشتری</button>
    ${s.sub_token ? `<button class="btn sm ghost" data-sublink="${s.sub_token}">لینک</button>` : ""}
    <button class="btn sm ghost" data-topup="${s.id}">شارژ حجم</button>
    <button class="btn sm ghost" data-renew="${s.id}">تمدید</button>
    <button class="btn sm danger" data-delsub="${s.id}">حذف</button></div>`;
}
async function viewSubscriptions(view) {
  const [customers, nodes, plans] = await Promise.all([
    api("/api/v1/customers"),
    api("/api/v1/nodes"),
    api("/api/v1/plans"),
  ]);
  const nodeName = Object.fromEntries(nodes.map((n) => [n.id, n.name]));
  const planName = Object.fromEntries(plans.map((p) => [p.id, p.name]));
  const all = [];
  for (const c of customers) {
    const subs = await api(`/api/v1/customers/${c.id}/subscriptions`);
    subs.forEach((s) => all.push({ ...s, _customer: c.name }));
  }
  const rowsHTML = (list) =>
    list.length
      ? table(
          ["مشتری", "نود", "پلن", "وضعیت", "هسته", "کاربران", "مصرف", "انقضا", "عملیات"],
          list.map((s) => [
            esc(s._customer),
            esc(nodeName[s.node_id] || "—"),
            esc(planName[s.plan_id] || "—"),
            badge(s.status),
            s.core_type === "dedicated" ? `<span class="badge" style="background:#8b5cf6">اختصاصی</span>` : `<span class="badge">اشتراکی</span>`,
            esc(`${s.active_users || 0} / ${s.max_users ? s.max_users : "∞"}`),
            progress(s.used_bytes, s.quota_bytes),
            fmtDate(s.end_at) + daysLeftLabel(s.end_at),
            subActions(s),
          ])
        )
      : `<div class="empty">موردی یافت نشد</div>`;

  view.innerHTML =
    sectionHead("اشتراک‌ها", `<button class="btn primary" id="addSub">+ اشتراک جدید</button>`) +
    `<div class="card">
       <input id="subSearch" class="search" placeholder="جست‌وجو: مشتری / نود / پلن / وضعیت" />
       <div id="subTable">${rowsHTML(all)}</div>
     </div>`;

  const searchEl = document.getElementById("subSearch");
  searchEl.oninput = () => {
    const q = searchEl.value.trim().toLowerCase();
    const f = q
      ? all.filter((s) =>
          [s._customer, nodeName[s.node_id], planName[s.plan_id], STATUS_FA[s.status] || s.status]
            .some((x) => String(x || "").toLowerCase().includes(q)))
      : all;
    document.getElementById("subTable").innerHTML = rowsHTML(f);
    wireSubActions(view);
  };

  document.getElementById("addSub").onclick = () => guard(() => subscriptionModal(customers));
  wireSubActions(view);
}

// wireSubActions binds the per-row action buttons (re-run after re-rendering rows).
function wireSubActions(view) {
  view.querySelectorAll("[data-suspend]").forEach((b) =>
    (b.onclick = () => guard(async () => { await api(`/api/v1/subscriptions/${b.dataset.suspend}/suspend`, { method: "POST" }); toast("اشتراک معلق شد"); route(); }))
  );
  view.querySelectorAll("[data-resume]").forEach((b) =>
    (b.onclick = () => guard(async () => { await api(`/api/v1/subscriptions/${b.dataset.resume}/resume`, { method: "POST" }); toast("اشتراک فعال شد"); route(); }))
  );
  view.querySelectorAll("[data-topup]").forEach((b) =>
    (b.onclick = () =>
      formModal("شارژ حجم", [{ name: "gb", label: "افزودن حجم (گیگابایت)", type: "number", placeholder: "50" }], async (v) => {
        const add_bytes = Math.round(parseFloat(v.gb || "0") * GB);
        if (add_bytes <= 0) throw new Error("حجم باید بزرگ‌تر از صفر باشد");
        await api(`/api/v1/subscriptions/${b.dataset.topup}/topup-quota`, { method: "POST", body: JSON.stringify({ add_bytes }) });
        toast("حجم شارژ شد");
      }))
  );
  view.querySelectorAll("[data-renew]").forEach((b) =>
    (b.onclick = () => confirmModal("اشتراک تمدید شود؟ (مصرف صفر و انقضا تمدید می‌شود)", () => api(`/api/v1/subscriptions/${b.dataset.renew}/renew`, { method: "POST" }))));
  view.querySelectorAll("[data-conn]").forEach((b) =>
    (b.onclick = () => guard(() => connectionModal(b.dataset.conn))));
  view.querySelectorAll("[data-sublink]").forEach((b) =>
    (b.onclick = () => subLinkModal(b.dataset.sublink)));
  view.querySelectorAll("[data-delsub]").forEach((b) =>
    (b.onclick = () => confirmModal("این اشتراک حذف و از نود حذف شود؟", () => api(`/api/v1/subscriptions/${b.dataset.delsub}`, { method: "DELETE" }))));
}

// subLinkModal shows the public subscription link with copy/open actions.
function subLinkModal(token) {
  const link = location.origin + "/sub/" + token;
  modal(
    "لینک اشتراک مشتری",
    `<p class="muted" style="font-size:12.5px;margin:0 0 8px">این لینک را به مشتری بده؛ کانفیگ نود و وضعیت حجم/انقضا را می‌بیند (نیازی به توکن ادمین ندارد).</p>
     <div class="field"><input id="slv" readonly value="${esc(link)}" /></div>
     <div class="actions">
       <button class="btn primary" id="slCopy">کپی لینک</button>
       <button class="btn ghost" id="slOpen">باز کردن</button>
       <button class="btn ghost" id="slClose">بستن</button>
     </div>`,
    (root) => {
      root.querySelector("#slCopy").onclick = () => { const i = root.querySelector("#slv"); i.select(); if (navigator.clipboard) navigator.clipboard.writeText(link); toast("کپی شد"); };
      root.querySelector("#slOpen").onclick = () => window.open(link, "_blank");
      root.querySelector("#slClose").onclick = closeModal;
    }
  );
}
async function subscriptionModal(customers) {
  const [plans, nodes] = await Promise.all([api("/api/v1/plans"), api("/api/v1/nodes")]);
  if (!customers.length || !plans.length || !nodes.length) {
    toast("ابتدا باید مشتری، پلن و نود داشته باشید", "err");
    return;
  }
  formModal(
    "اشتراک جدید",
    [
      { name: "customer_id", label: "مشتری", type: "select", options: customers.map((c) => ({ value: c.id, label: c.name })) },
      { name: "plan_id", label: "پلن", type: "select", options: plans.map((p) => ({ value: p.id, label: `${p.name} (${fmtBytes(p.quota_bytes)})` })) },
      { name: "node_id", label: "نود", type: "select", options: nodes.map((n) => ({ value: n.id, label: `${n.name} — ${STATUS_FA[n.status] || n.status}` })) },
      { name: "domains", label: "دامنه‌ها (اختیاری برای هسته اختصاصی؛ با کاما جدا کنید)", placeholder: "sub.example.com", hint: "برای هدایت SNI روی هسته اختصاصی" },
      { name: "allowed_inbounds", label: "اینباندهای مجاز (اختیاری؛ بازنویسی پلن با کاما)", placeholder: "خالی = ارث‌بری از پلن" },
      { name: "max_users", label: "سقف کاربر (اختیاری؛ خالی = ارث‌بری از پلن)", type: "number", placeholder: "خالی = ارث‌بری از پلن" },
    ],
    async (v) => {
      const body = { plan_id: v.plan_id, node_id: v.node_id };
      if (v.domains) {
        body.domains = v.domains.split(",").map((s) => s.trim()).filter(Boolean);
      }
      if (v.allowed_inbounds) {
        body.allowed_inbounds = v.allowed_inbounds.split(",").map((s) => s.trim()).filter(Boolean);
      }
      if (v.max_users !== "" && v.max_users !== undefined) {
        const mu = parseInt(v.max_users, 10);
        if (!isNaN(mu) && mu >= 0) body.max_users = mu;
      }
      const res = await api(`/api/v1/customers/${v.customer_id}/subscriptions`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast("اشتراک provision شد");
      // Defer so the key modal opens after formModal closes its own modal.
      setTimeout(() => showApiKey(res.api_key, res.node_address, res.sub_token), 60);
    },
    "ساخت و provision"
  );
}
function showApiKey(key, nodeAddr, subToken) {
  const subLink = subToken ? location.origin + "/sub/" + subToken : "";
  modal(
    "کلید مشتری ساخته شد",
    `<p class="muted" style="font-size:13px">این کلید فقط همین یک‌بار نمایش داده می‌شود؛ آن را ذخیره و به مشتری بدهید.</p>
     <div class="field"><label>API Key</label><input id="akv" readonly value="${esc(key)}" /></div>
     <div class="field"><label>آدرس نود</label><input readonly value="${esc(nodeAddr)}" /></div>
     ${subLink ? `<div class="field"><label>لینک اشتراک مشتری (کانفیگ + وضعیت حجم/انقضا)</label><input id="aksub" readonly value="${esc(subLink)}" /></div>` : ""}
     <div class="actions">
       <button class="btn primary" id="akCopy">کپی کلید</button>
       ${subLink ? `<button class="btn ghost" id="akSubCopy">کپی لینک</button><button class="btn ghost" id="akSubOpen">باز کردن</button>` : ""}
       <button class="btn ghost" id="akClose">بستن</button>
     </div>`,
    (root) => {
      root.querySelector("#akCopy").onclick = () => {
        const inp = root.querySelector("#akv");
        inp.select();
        if (navigator.clipboard) navigator.clipboard.writeText(key);
        toast("کپی شد");
      };
      if (subLink) {
        root.querySelector("#akSubCopy").onclick = () => { if (navigator.clipboard) navigator.clipboard.writeText(subLink); toast("کپی شد"); };
        root.querySelector("#akSubOpen").onclick = () => window.open(subLink, "_blank");
      }
      root.querySelector("#akClose").onclick = closeModal;
    }
  );
}

// connectionModal shows everything the customer needs to add this node in their
// own PasarGuard panel: gRPC address, protocol, certificate and the node's real
// inbound(s). The inbound must be replicated exactly so end-user links work.
async function connectionModal(subID) {
  const info = await api(`/api/v1/subscriptions/${subID}/connection`);
  let inboundsPretty;
  try { inboundsPretty = JSON.stringify(info.inbounds, null, 2); }
  catch { inboundsPretty = String(info.inbounds || ""); }

  modal(
    "اطلاعات اتصال مشتری",
    `<p class="muted" style="font-size:12.5px;margin:0 0 10px">این مقادیر را به مشتری بدهید تا نود را در پنل PasarGuard خودش اضافه کند. کلید مشتری فقط هنگام ساخت اشتراک نمایش داده می‌شود.</p>
     ${info.sub_token ? `<div class="field"><label>لینک اشتراک مشتری (کانفیگ + وضعیت حجم/انقضا)</label>
       <div class="row" style="gap:6px;align-items:stretch"><input id="connSub" readonly value="${esc(location.origin + "/sub/" + info.sub_token)}" style="flex:1" /><button class="btn ghost" id="connSubOpen">باز</button></div></div>` : ""}
     <div class="field"><label>نوع هسته</label><input readonly value="${info.core_type === "dedicated" ? "هسته اختصاصی (Dedicated Core)" : "هسته اشتراکی (Shared)"}" /></div>
     ${info.domains && info.domains.length ? `<div class="field"><label>دامنه‌های اختصاصی</label><input readonly value="${esc(info.domains.join(", "))}" /></div>` : ""}
     <div class="field"><label>آدرس gRPC</label><input id="connAddr" readonly value="${esc(info.grpc_address)}" /></div>
     <div class="field"><label>پروتکل</label><input readonly value="${esc(info.protocol)}" /></div>
     <div class="field"><label>گواهی نود (Certificate)</label><textarea id="connCert" rows="5" readonly spellcheck="false" style="font-family:ui-monospace,monospace;font-size:12px">${esc(info.cert_pem || "—")}</textarea></div>
     <div class="field"><label>inboundها (دقیقاً همین را در پنل خود بسازید)</label><textarea id="connIn" rows="10" readonly spellcheck="false" style="font-family:ui-monospace,monospace;font-size:12px">${esc(inboundsPretty)}</textarea></div>
     <p class="muted" style="font-size:12px;margin:0 0 8px">${esc(info.note || "")}</p>
     <div class="actions">
       <button class="btn primary" id="connCopyAddr">کپی آدرس</button>
       <button class="btn ghost" id="connCopyCert">کپی گواهی</button>
       <button class="btn ghost" id="connCopyIn">کپی inbounds</button>
       ${info.sub_token ? `<button class="btn ghost" id="connCopySub">کپی لینک</button>` : ""}
       <button class="btn ghost" id="connClose">بستن</button>
     </div>`,
    (root) => {
      const copy = (text) => { if (navigator.clipboard) navigator.clipboard.writeText(text); toast("کپی شد"); };
      root.querySelector("#connCopyAddr").onclick = () => copy(info.grpc_address);
      root.querySelector("#connCopyCert").onclick = () => copy(info.cert_pem || "");
      root.querySelector("#connCopyIn").onclick = () => copy(inboundsPretty);
      if (info.sub_token) {
        const subLink = location.origin + "/sub/" + info.sub_token;
        root.querySelector("#connCopySub").onclick = () => copy(subLink);
        root.querySelector("#connSubOpen").onclick = () => window.open(subLink, "_blank");
      }
      root.querySelector("#connClose").onclick = closeModal;
    }
  );
}

/* ===================== Webhooks ===================== */
async function viewWebhooks(view) {
  const hooks = await api("/api/v1/webhooks");
  view.innerHTML =
    sectionHead("وب‌هوک‌ها", `<button class="btn primary" id="addWh">+ وب‌هوک جدید</button>`) +
    `<div class="card">${
      hooks.length
        ? table(
            ["URL", "رویدادها", "وضعیت"],
            hooks.map((h) => [`<span class="mono">${esc(h.url)}</span>`, esc(h.events), badge(h.status)])
          )
        : `<div class="empty">وب‌هوکی ثبت نشده است</div>`
    }</div>
    <div class="card" style="margin-top:16px">
      <h3>رویدادهای قابل ارسال</h3>
      <p class="muted" style="font-size:13px;line-height:2">
        <span class="mono">usage.threshold</span> (۸۰٪/۹۵٪) ·
        <span class="mono">usage.over_quota</span> ·
        <span class="mono">users.threshold</span> (۸۰٪/۹۰٪) ·
        <span class="mono">users.limit_reached</span> (۱۰۰٪) ·
        <span class="mono">subscription.suspended</span> ·
        <span class="mono">subscription.resumed</span> ·
        <span class="mono">subscription.expired</span><br/>
        هر درخواست با هدر <span class="mono">X-PG-Signature: sha256=...</span> امضا می‌شود.
      </p>
    </div>`;
  document.getElementById("addWh").onclick = () =>
    formModal(
      "وب‌هوک جدید",
      [
        { name: "url", label: "URL", placeholder: "https://bot.example/webhook" },
        { name: "secret", label: "Secret (برای امضای HMAC)", type: "password" },
        { name: "events", label: "رویدادها (کاما-جدا یا *)", value: "*" },
      ],
      async (v) => {
        await api("/api/v1/webhooks", { method: "POST", body: JSON.stringify(v) });
        toast("وب‌هوک ثبت شد");
      }
    );
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    curve25519,
    generateRealityKeys,
    parseXrayConfig,
    serializeXrayConfig,
    CONFIG_TEMPLATES,
  };
}
