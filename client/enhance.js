(() => {
  const NativeWebSocket = window.WebSocket;
  class SFFWebSocket extends NativeWebSocket {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", (event) => {
        try {
          const v = JSON.parse(event.data);
          // After a new message, an erased conversation may legitimately reappear.
          if (v.type === "message" && hidden.has(Number(v.room))) refreshHidden();
          if (
            v.type === "message" &&
            v.notify === true &&
            document.hidden &&
            window.SFFAndroid?.show
          ) {
            const preview = v.body?.trim() || v.file || "Nova poruka";
            window.SFFAndroid.show(
              String(v.name || "SFF") + ": " + String(preview).slice(0, 90),
            );
          }
        } catch {}
      });
    }
  }
  window.WebSocket = SFFWebSocket;

  const api = async (action, body = {}) => {
    const response = await fetch("/api/" + action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Zahtev nije uspeo.");
    return result;
  };

  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

  const settings = () => ({
    autoMedia: localStorage.getItem("sff.autoMedia") !== "0",
    compact: localStorage.getItem("sff.compact") === "1",
    reduced: localStorage.getItem("sff.reduced") === "1",
  });

  function applySettings() {
    const s = settings();
    document.body.classList.toggle("sffCompact", s.compact);
    document.body.classList.toggle("sffReduced", s.reduced);
  }
  applySettings();

  let hidden = new Set();
  let hiddenReady = false;
  let enhanceTimer;
  let infoRoom = null;
  let infoCache = null;

  const scheduleEnhance = () => {
    clearTimeout(enhanceTimer);
    enhanceTimer = setTimeout(enhance, 45);
  };

  async function refreshHidden() {
    try {
      const rows = await api("hiddenChats");
      hidden = new Set(rows.map((x) => Number(x.room)));
      hiddenReady = true;
      scheduleEnhance();
    } catch {}
  }
  refreshHidden();

  function activeRoomButton() {
    return document.querySelector('.side [data-a="room"].active');
  }

  function roomId() {
    return Number(activeRoomButton()?.dataset.id) || 0;
  }

  function openSffModal(title, html) {
    const dlg = document.querySelector("#dialog");
    if (!dlg) return;
    dlg.innerHTML =
      '<h2>' + esc(title) + '</h2>' + html +
      '<p class="row"><button type="button" data-sff-close>Zatvori</button></p>';
    if (!dlg.open) dlg.showModal();
  }

  async function openProfile(id) {
    try {
      const p = await api("userProfile", { id: Number(id) });
      openSffModal(
        p.name,
        '<section class="sffProfileCard">' +
          '<div class="sffProfileAvatar">' + esc((p.name || "?")[0]) + '</div>' +
          '<div><h3>' + esc(p.name) + '</h3><p class="muted">@' + esc(p.username) + '</p></div>' +
          '</section>' +
          '<div class="sffProfileDetails">' +
            '<p><b>Status</b><br>' + esc(p.status || "Offline") + (p.custom ? ' · ' + esc(p.custom) : '') + '</p>' +
            '<p><b>O meni</b><br>' + esc(p.about || "Nema opisa.") + '</p>' +
          '</div>',
      );
    } catch (e) {
      openSffModal("Profil", '<p class="muted">' + esc(e.message) + '</p>');
    }
  }

  function openSettings() {
    const s = settings();
    openSffModal(
      "Podešavanja",
      '<div class="sffSettings">' +
        '<label><input type="checkbox" data-sff-setting="autoMedia" ' + (s.autoMedia ? "checked" : "") + '> Automatski prikaz slika, videa i zvuka</label>' +
        '<label><input type="checkbox" data-sff-setting="compact" ' + (s.compact ? "checked" : "") + '> Kompaktan prikaz poruka</label>' +
        '<label><input type="checkbox" data-sff-setting="reduced" ' + (s.reduced ? "checked" : "") + '> Smanji animacije</label>' +
        '<p class="muted">Privatnost naloga, promena lozinke, avatar i sistemska obaveštenja nalaze se u tvom SFF profilu.</p>' +
      '</div>',
    );
  }

  function enhanceUnread() {
    let total = 0;
    for (const button of document.querySelectorAll('.side [data-a="room"]')) {
      const id = Number(button.dataset.id);
      if (hiddenReady && hidden.has(id)) continue;
      const existing = button.querySelector(".sffUnread");
      if (existing) {
        total += Number(existing.textContent) || 0;
        continue;
      }
      const text = button.textContent || "";
      const match = text.match(/^(.*)\s+·\s+(\d+)$/s);
      if (!match) continue;
      const count = Number(match[2]);
      total += count;
      button.textContent = match[1].trimEnd() + " ";
      const badge = document.createElement("span");
      badge.className = "sffUnread";
      badge.textContent = count > 99 ? "99+" : String(count);
      button.appendChild(badge);
    }

    const mobileMessages = document.querySelector('.mobileNav [data-a="friends"]');
    if (!mobileMessages) return;
    const badge = mobileMessages.querySelector(".sffUnread");
    const wanted = total > 99 ? "99+" : String(total);
    if (!total) {
      if (badge) badge.remove();
    } else if (badge) {
      if (badge.textContent !== wanted) badge.textContent = wanted;
    } else {
      const next = document.createElement("span");
      next.className = "sffUnread";
      next.textContent = wanted;
      mobileMessages.appendChild(next);
    }
  }

  function enhanceMedia() {
    const auto = settings().autoMedia;
    const input = document.querySelector("#attachment");
    if (input)
      input.setAttribute(
        "accept",
        "image/png,image/jpeg,video/mp4,audio/mpeg,.jpg,.jpeg,.png,.mp4,.mp3",
      );

    for (const link of document.querySelectorAll('.msg a[href^="/media/"]')) {
      if (link.dataset.sffMedia === "1") continue;
      link.dataset.sffMedia = "1";
      if (!auto) continue;
      const name = (link.getAttribute("download") || link.textContent || "").toLowerCase();
      if (name.endsWith(".mp4")) {
        const video = document.createElement("video");
        video.controls = true;
        video.preload = "metadata";
        video.playsInline = true;
        video.src = link.getAttribute("href");
        video.className = "sffVideo";
        link.before(video);
      } else if (/\.(mp3|m4a|ogg|webm)$/.test(name)) {
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "metadata";
        audio.src = link.getAttribute("href");
        audio.className = "sffAudio";
        link.before(audio);
      }
    }
  }

  function enhanceFriendsDialog() {
    const dlg = document.querySelector("#dialog");
    if (!dlg?.open || dlg.querySelector("h2")?.textContent !== "Prijatelji") return;
    for (const row of dlg.querySelectorAll(".person")) {
      if (row.querySelector("[data-sff-profile-user]")) continue;
      const marker = row.querySelector('[data-a="remove"]');
      if (!marker?.dataset.id) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Profil";
      button.dataset.sffProfileUser = marker.dataset.id;
      row.insertBefore(button, marker);
    }
  }

  async function enhanceChatToolbar() {
    const id = roomId();
    const toolbar = document.querySelector(".chat .toolbar");
    if (!toolbar || !id) return;

    if (
      hiddenReady &&
      hidden.has(id) &&
      sessionStorage.getItem("sffAllowHiddenOnce") !== "1"
    ) {
      activeRoomButton()?.style.setProperty("display", "none", "important");
      // Backend /api/state is the source of truth. Never replace .chat.innerHTML:
      // this previously fought with app.js redraws and produced blinking rooms.
      return;
    }

    if (sessionStorage.getItem("sffAllowHiddenOnce") === "1" && hidden.has(id))
      sessionStorage.removeItem("sffAllowHiddenOnce");

    if (infoRoom !== id) {
      infoRoom = id;
      infoCache = null;
      try {
        infoCache = await api("chatInfo", { room: id });
      } catch {
        return;
      }
    }
    if (!infoCache || toolbar.querySelector("[data-sff-delete-chat]")) return;

    if (infoCache.kind === "dm" && infoCache.participants?.length) {
      const profile = document.createElement("button");
      profile.type = "button";
      profile.textContent = "Profil";
      profile.dataset.sffProfileId = String(infoCache.participants[0].id);
      toolbar.appendChild(profile);
    }

    if (["dm", "group"].includes(infoCache.kind)) {
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "Obriši razgovor";
      del.className = "sffDanger";
      del.dataset.sffDeleteChat = String(id);
      toolbar.appendChild(del);
    }
  }

  function hideDeletedRooms() {
    if (!hiddenReady) return;
    const active = roomId();
    const allow = sessionStorage.getItem("sffAllowHiddenOnce") === "1";
    for (const button of document.querySelectorAll('.side [data-a="room"]')) {
      const id = Number(button.dataset.id);
      if (hidden.has(id) && !(allow && active === id))
        button.style.display = "none";
    }
  }

  function addSettingsButton() {
    const footer = document.querySelector(".side footer");
    if (footer && !footer.querySelector("[data-sff-settings]")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "item sffSettingsButton";
      button.textContent = "⚙ Podešavanja";
      button.dataset.sffSettings = "1";
      footer.insertBefore(button, footer.querySelector("#connection"));
    }
  }

  function enhance() {
    applySettings();
    hideDeletedRooms();
    enhanceUnread();
    enhanceMedia();
    enhanceFriendsDialog();
    addSettingsButton();
    enhanceChatToolbar().catch(() => {});
  }

  document.addEventListener(
    "click",
    (event) => {
      if (event.target.closest('[data-a="dm"]'))
        sessionStorage.setItem("sffAllowHiddenOnce", "1");
    },
    true,
  );

  document.addEventListener("click", async (event) => {
    if (event.target.closest("[data-sff-close]"))
      return document.querySelector("#dialog")?.close();

    if (event.target.closest("[data-sff-settings]")) return openSettings();

    const profile = event.target.closest("[data-sff-profile-id]");
    if (profile) return openProfile(profile.dataset.sffProfileId);

    const profileUser = event.target.closest("[data-sff-profile-user]");
    if (profileUser) {
      try {
        const p = await api("userProfile", {
          username: profileUser.dataset.sffProfileUser,
        });
        return openProfile(p.id);
      } catch (e) {
        return openSffModal("Profil", '<p class="muted">' + esc(e.message) + '</p>');
      }
    }

    const del = event.target.closest("[data-sff-delete-chat]");
    if (del) {
      const id = Number(del.dataset.sffDeleteChat);
      if (
        !confirm(
          "Obriši ovaj razgovor iz svoje SFF istorije? Druga osoba zadržava svoju kopiju.",
        )
      )
        return;
      try {
        await api("deleteChat", { room: id });
        hidden.add(id);
        hiddenReady = true;
        infoRoom = null;
        infoCache = null;
        // One reload clears stale selection without touching the other user's chat.
        location.reload();
      } catch (e) {
        openSffModal("Brisanje razgovora", '<p class="muted">' + esc(e.message) + '</p>');
      }
    }
  });

  document.addEventListener("change", (event) => {
    const setting = event.target.closest("[data-sff-setting]");
    if (!setting) return;
    const key = setting.dataset.sffSetting;
    localStorage.setItem("sff." + key, setting.checked ? "1" : "0");
    applySettings();
    if (key === "autoMedia") scheduleEnhance();
  });

  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshHidden();
  });
  setInterval(refreshHidden, 15000);
  scheduleEnhance();
})();
