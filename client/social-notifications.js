/* SFF online social notifications. Does not depend on installing a new APK/EXE. */
(() => {
  "use strict";
  const NativeSocket = window.WebSocket;
  const config = {
    messageNotice: "1",
    friendNotice: "1",
    sounds: "1",
    quiet: "0",
    showPreview: "1",
    banners: "1",
    volume: "50",
    soundTheme: "classic",
  };
  const get = (key) => localStorage.getItem("sff.social." + key) ?? config[key];
  const enabled = (key) => get(key) === "1";
  const escape = (v) => String(v ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let identity = null;
  let gettingIdentity = null;
  let context = null;
  let notificationCount = 0;
  let currentToast = null;
  let toastTimer = null;
  const maxEntries = 30;

  async function userId() {
    if (typeof window.SFFNotificationIdentity === "function") {
      identity = window.SFFNotificationIdentity();
      return identity;
    }
    if (identity) return identity;
    if (!gettingIdentity) {
      gettingIdentity = fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        credentials: "same-origin",
      }).then(async (response) => {
        if (!response.ok) return null;
        const result = await response.json();
        return result.me?.id && result.me?.username ? String(result.me.id) + ":" + String(result.me.username).toLowerCase() : null;
      }).catch(() => null).finally(() => { gettingIdentity = null; });
    }
    const value = await gettingIdentity;
    if (value) identity = value;
    return value;
  }
  function historyKey(id) { return "sff.social.history.v2." + id; }
  function readKey(id) { return "sff.social.lastRead.v2." + id; }
  function history(id) {
    try {
      const rows = JSON.parse(localStorage.getItem(historyKey(id)) || "[]");
      return Array.isArray(rows) ? rows.filter((r) =>
        r && typeof r.title === "string" && typeof r.kind === "string" &&
        Number.isSafeInteger(r.id)).slice(0, maxEntries) : [];
    } catch { return []; }
  }
  async function saveEvent(kind, title, subtitle) {
    const id = await userId();
    if (!id) return;
    const rows = history(id);
    rows.unshift({
      id: Date.now() * 100 + (++notificationCount % 100),
      title: String(title).slice(0, 90),
      subtitle: String(subtitle).slice(0, 110),
      kind,
      at: Date.now(),
    });
    localStorage.setItem(historyKey(id), JSON.stringify(rows.slice(0, maxEntries)));
    updateCenterBadge();
  }

  function audioContext() {
    try {
      const Constructor = window.AudioContext || window.webkitAudioContext;
      if (!Constructor) return null;
      if (!context) context = new Constructor();
      if (context.state === "suspended") context.resume().catch(() => {});
      return context;
    } catch { return null; }
  }
  // Browsers forbid autoplay until a user gesture; intentionally do not bypass it.
  document.addEventListener("pointerdown", () => audioContext(),
    { once: true, passive: true });
  document.addEventListener("keydown", () => audioContext(), { once: true });

  function sound(kind, force = false) {
    if (!force && (!enabled("sounds") || enabled("quiet"))) return;
    if (!force && document.hidden) return; // avoid doubling the OS alert sound
    const ctx = audioContext();
    if (!ctx || ctx.state !== "running") return;
    const volume = Math.min(100, Math.max(0, Number(get("volume")) || 0)) / 100;
    const style = get("soundTheme");
    const notes = style === "soft"
      ? kind === "message" ? [[560, 0, .11]] : [[580, 0, .11], [720, .13, .13]]
      : style === "digital"
        ? kind === "message" ? [[740, 0, .07], [988, .09, .08]]
          : [[660, 0, .06], [880, .08, .07], [1320, .18, .12]]
        : kind === "message" ? [[659, 0, .09], [880, .12, .12]]
          : [[523, 0, .10], [784, .12, .12], [1047, .26, .14]];
    const start = ctx.currentTime + .014;
    for (const [freq, offset, length] of notes) {
      const oscillator = ctx.createOscillator();
      const level = ctx.createGain();
      oscillator.type = style === "digital" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(freq, start + offset);
      level.gain.setValueAtTime(.0001, start + offset);
      level.gain.linearRampToValueAtTime(Math.max(.0002, .05 * volume),
        start + offset + .012);
      level.gain.exponentialRampToValueAtTime(.0001, start + offset + length);
      oscillator.connect(level).connect(ctx.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + length + .012);
    }
  }
  function systemNotify(title, subtitle, kind) {
    if (enabled("quiet") ||
      (kind === "message" && !enabled("messageNotice")) ||
      (kind !== "message" && !enabled("friendNotice"))) return;
    if (!document.hidden) return;
    const body = enabled("showPreview") ? subtitle : "Imaš novo obaveštenje u SFF-u.";
    if (window.SFFAndroid?.show) {
      try { window.SFFAndroid.show((title + ": " + body).slice(0, 100)); } catch {}
    } else if (window.Notification?.permission === "granted") {
      try {
        new Notification("SFF · " + title, {
          body, icon: "/mark.svg", badge: "/mark.svg",
          silent: !enabled("sounds"),
          tag: kind + "-" + Date.now(),
        });
      } catch {}
    }
  }
  function banner(kind, title, subtitle) {
    if (document.hidden || !enabled("banners") || enabled("quiet")) return;
    if ((kind === "message" && !enabled("messageNotice")) ||
        (kind !== "message" && !enabled("friendNotice"))) return;
    currentToast?.remove();
    clearTimeout(toastTimer);
    const node = document.createElement("button");
    node.type = "button";
    node.className = "sffSocialToast";
    node.innerHTML =
      '<img src="/mark.svg" alt="SFF">' +
      '<span class="sffSocialToastText"><strong>' + escape(title) + '</strong><small>' +
      escape(enabled("showPreview") ? subtitle : "Novo SFF obaveštenje") +
      '</small></span><span class="sffSocialToastArrow">›</span>';
    node.addEventListener("click", () => {
      node.remove();
      if (kind === "friend") openFriends();
      else openCenter();
    });
    document.body.appendChild(node);
    currentToast = node;
    toastTimer = setTimeout(() => { node.remove(); currentToast = null; }, 7200);
  }
  function notify(kind, title, subtitle) {
    if (enabled("quiet")) return;
    if ((kind === "message" && !enabled("messageNotice")) ||
        (kind !== "message" && !enabled("friendNotice"))) return;
    saveEvent(kind, title, subtitle).catch(() => {});
    systemNotify(title, subtitle, kind);
    banner(kind, title, subtitle);
    sound(kind);
  }
  function receive(event) {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === "message" && message.notify === true) {
      const body = message.body?.trim() || message.file || "Poslat je prilog.";
      notify("message", String(message.name || "Nova poruka"),
        String(body).slice(0, 120));
    } else if (message.type === "friend_request") {
      notify("friend", "Zahtev za prijateljstvo",
        String(message.name || message.username || "Korisnik") +
        " (@" + String(message.username || "korisnik") + ") želi da bude tvoj prijatelj.");
    } else if (message.type === "friend_accepted") {
      notify("friend", "Zahtev je prihvaćen",
        String(message.name || message.username || "Korisnik") +
        " je prihvatio/la tvoje prijateljstvo.");
    }
  }
  class SocialSocket extends NativeSocket {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", receive);
    }
  }
  window.WebSocket = SocialSocket;

  function openFriends() {
    document.querySelector("#sffSocialDialog")?.close();
    const list = document.querySelector('[data-a="friendsList"]');
    if (list) return list.click();
    const rail = document.querySelector('.rail [data-a="friends"]');
    if (rail) {
      rail.click();
      setTimeout(() => document.querySelector('[data-a="friendsList"]')?.click(), 200);
    }
  }
  function center() {
    let dlg = document.querySelector("#sffSocialDialog");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "sffSocialDialog";
      dlg.className = "sffSocialDialog";
      document.body.appendChild(dlg);
    }
    return dlg;
  }
  async function openCenter() {
    const id = await userId();
    if (!id) return;
    const rows = history(id);
    const dlg = center();
    dlg.innerHTML =
      '<header class="sffSocialHead"><img src="/mark.svg" alt="SFF">' +
        '<div><strong>Obaveštenja</strong><small>Poslednjih ' + maxEntries + ' događaja na ovom uređaju</small></div>' +
      '</header><div class="sffSocialHistory">' +
      (rows.length ? rows.map((x) =>
        '<div class="sffSocialEvent"><span class="sffSocialEventIcon">' +
        (x.kind === "message" ? "✉" : "✦") + '</span><div><b>' + escape(x.title) +
        '</b><p>' + escape(x.subtitle) + '</p><small>' +
        new Date(x.at).toLocaleString("sr-RS") +
        '</small></div></div>').join("") :
        '<p class="sffSocialEmpty">Nema novih obaveštenja. ✨</p>') +
      '</div><div class="sffSocialActions">' +
        '<button type="button" data-social-friends>Prijateljski zahtevi</button>' +
        '<button type="button" data-social-clear>Obriši istoriju</button>' +
        '<button type="button" data-social-close>Zatvori</button>' +
      '</div>';
    localStorage.setItem(readKey(id), String(rows[0]?.id || 0));
    updateCenterBadge();
    if (!dlg.open) dlg.showModal();
  }
  async function updateCenterBadge() {
    const id = identity;
    const count = id ? history(id).filter((x) =>
      x.id > Number(localStorage.getItem(readKey(id)) || 0)).length : 0;
    for (const btn of document.querySelectorAll("[data-social-center]")) {
      const badge = btn.querySelector(".sffSocialCounter");
      if (!count) { badge?.remove(); continue; }
      if (badge) {
        if (badge.textContent !== String(count)) badge.textContent = String(count);
      } else {
        const span = document.createElement("span");
        span.className = "sffSocialCounter";
        span.textContent = count > 99 ? "99+" : String(count);
        btn.appendChild(span);
      }
    }
  }
  function mount() {
    const shell = document.querySelector(".shell");
    if (!shell) {
      identity = null;
      return;
    }
    const footer = shell.querySelector(".side footer");
    if (footer && !footer.querySelector("[data-sff-home]")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "item sffSocialCenterButton";
      button.dataset.sffHome = "1";
      button.innerHTML = '<img src="/mark.svg" alt=""> <span>Početna</span>';
      footer.prepend(button);
    }
    const mobile = shell.querySelector(".mobileNav");
    if (mobile && !mobile.querySelector("[data-sff-home]")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sffSocialMobileButton";
      button.dataset.sffHome = "1";
      button.title = "Početna";
      button.innerHTML = '<img src="/mark.svg" alt=""><small>Početna</small>';
      // Put the main destination first; preserve all existing handlers and tabs.
      mobile.prepend(button);
    }
    if (!identity && !gettingIdentity) userId().then(updateCenterBadge).catch(() => {});
    else updateCenterBadge();
  }
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; mount(); });
  });
  observer.observe(document.documentElement, { subtree: true, childList: true });
  mount();

  document.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-social-center]")) {
      ev.stopImmediatePropagation();
      openCenter().catch(() => {});
    }
    if (ev.target.closest("[data-social-close]")) {
      center().close();
    }
    if (ev.target.closest("[data-social-friends]")) {
      openFriends();
    }
    if (ev.target.closest("[data-social-clear]")) {
      if (!identity) return;
      localStorage.removeItem(historyKey(identity));
      localStorage.setItem(readKey(identity), "0");
      openCenter().catch(() => {});
    }
    if (ev.target.closest("[data-social-test]")) {
      ev.preventDefault();
      const key = ev.target.closest("[data-social-test]").dataset.socialTest;
      audioContext();
      sound(key === "friend" ? "friend" : "message", true);
    }
  }, true);

  document.addEventListener("input", (event) => {
    const slider = event.target.closest('[data-sff-setting="volume"]');
    if (slider) {
      localStorage.setItem("sff.social.volume", String(slider.value));
      const label = document.querySelector("[data-social-volume]");
      if (label) label.textContent = slider.value + "%";
    }
  });

  function settingsHTML() {
    const checked = (name) => enabled(name) ? "checked" : "";
    const checkbox = (name, text) =>
      '<label><input type="checkbox" data-social-setting="' + name + '" ' +
      checked(name) + '> ' + escape(text) + '</label>';
    return '<div class="sffSocialSettings">' +
      '<h3>🔔 Poruke i obaveštenja</h3>' +
      checkbox("messageNotice", "Obaveštenja o novim porukama") +
      checkbox("friendNotice", "Obaveštenja o zahtevima i prihvatanju prijateljstva") +
      checkbox("banners", "Prikaži obaveštenje unutar aplikacije") +
      checkbox("showPreview", "Prikaži tekst poruke u obaveštenju") +
      checkbox("quiet", "Tihi režim (isključi SFF obaveštenja i zvuk)") +
      '<h3>🎵 Zvukovi</h3>' +
      checkbox("sounds", "Zvuk u aplikaciji kada stigne poruka ili zahtev") +
      '<label>Melodija' +
      '<select data-social-setting="soundTheme">' +
      [["classic", "SFF klasični"], ["soft", "SFF nežni"], ["digital", "SFF digitalni"]]
      .map(([value, label]) => '<option value="' + value + '" ' +
        (get("soundTheme") === value ? "selected" : "") + '>' + label + '</option>')
      .join("") + '</select></label>' +
      '<label>Jačina zvuka <span data-social-volume>' + escape(get("volume")) +
      '%</span><input type="range" min="0" max="100" step="5" value="' +
      escape(get("volume")) + '" data-social-setting="volume" ></label>' +
      '<div class="sffSocialSoundTests"><button type="button" data-social-test="message">' +
      '▶ Test poruke</button><button type="button" data-social-test="friend">' +
      '▶ Test zahteva</button></div>' +
      '<p class="muted">Ova podešavanja važe za ovaj uređaj. Na Androidu zvuk sistemskog ' +
      'obaveštenja dok je aplikacija u pozadini podešava se u Android podešavanjima ' +
      'obaveštenja, a ne preko web stranice. Kada je aplikacija potpuno ugašena, ' +
      'za nova obaveštenja je potreban poseban push servis.</p>' +
    '</div>';
  }
  document.addEventListener("change", (event) => {
    const input = event.target.closest("[data-social-setting]");
    if (!input) return;
    const key = input.dataset.socialSetting;
    localStorage.setItem("sff.social." + key,
      input.type === "checkbox" ? (input.checked ? "1" : "0") : String(input.value));
  });
  window.SFFSocial = { settingsHTML, playTest: sound };
})();