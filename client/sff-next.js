/* SFF 0.5: responsive profile, presence and recorded voice messages.
   Works in Android WebView, Windows WebView2 and regular browsers. */
(() => {
  "use strict";
  const escape = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
  const api = async (action, params = {}) => {
    const r = await fetch("/api/" + action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(params),
    });
    const v = await r.json();
    if (!r.ok) throw Error(v.error || "Zahtev nije uspeo.");
    return v;
  };
  const toast = (value) => {
    const node = document.querySelector("#toast");
    if (node) {
      node.textContent = value;
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => { node.textContent = ""; }, 5000);
    }
  };
  const dlgEl = document.querySelector("#dialog");
  dlgEl?.addEventListener("close", () => dlgEl.classList.remove("sffProfileDialog"));
  const statusClass = (p) =>
    p.displayStatus === "Online" ? "online" :
    p.displayStatus === "Idle" ? "idle" :
    p.displayStatus === "Do Not Disturb" ? "busy" : "offline";
  const statusLabel = (p) => ({
    Online: "Na mreži", Idle: "Odsutan",
    "Do Not Disturb": "Ne uznemiravaj", Offline: "Van mreže"
  })[p.displayStatus] || p.displayStatus || "Van mreže";
  const photo = (p, slot) =>
    p[slot] ? '<img alt="' + (slot === "avatar" ? "Profilna slika" : "Naslovna slika") +
      '" src="/art/user/' + Number(p.id) + '/' + slot + '?v=' + Date.now() + '">' : "";
  let profileId = 0;

  async function openProfile(id = 0) {
    const dlg = document.querySelector("#dialog");
    if (!dlg) return;
    try {
      const state = await api("state");
      const target = Number(id) || Number(state.me.id);
      const p = await api("userProfile", { id: target });
      const own = target === state.me.id;
      profileId = target;
      dlg.classList.add("sffProfileDialog");
      dlg.innerHTML =
        '<div class="sffV5Profile">' +
          '<div class="sffV5Cover">' +
            (photo(p, "banner") || '<div class="sffV5CoverPattern"></div>') +
            (own ? '<button type="button" class="sffV5CoverEdit" data-v5-pick="banner">✎ Naslovna</button>' : '') +
          '</div>' +
          '<div class="sffV5Identity">' +
            '<div class="sffV5BigAvatar">' +
              (photo(p, "avatar") || '<span>' + escape((p.name || "?").slice(0, 1).toUpperCase()) + '</span>') +
              '<span class="sffV5Dot ' + statusClass(p) + '"></span>' +
            '</div>' +
            '<div class="sffV5Name"><h2>' + escape(p.name) + '</h2>' +
              '<div class="sffV5Handle">@' + escape(p.username) + '</div>' +
              '<div class="sffV5Presence"><span class="sffV5Dot ' + statusClass(p) + '"></span>' +
                escape(statusLabel(p)) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="sffV5ProfileBody">' +
            '<section class="sffV5Panel"><div class="sffV5Label">O MENI</div><p>' +
              escape(p.about || "Još nema opisa profila.") + '</p></section>' +
            (p.custom ? '<section class="sffV5Panel"><div class="sffV5Label">STATUS</div><p>' +
              escape(p.custom) + '</p></section>' : '') +
            (own ?
              '<section class="sffV5Panel"><div class="sffV5Label">IZMENI PROFIL</div>' +
                '<form class="sffV5ProfileForm" data-v5-profile-form>' +
                  '<label>Ime za prikaz<input name="name" maxlength="80" required value="' + escape(p.name) + '"></label>' +
                  '<label>O meni<textarea name="about" rows="3" maxlength="400">' + escape(p.about) + '</textarea></label>' +
                  '<label>Lični status<input name="custom" maxlength="100" value="' + escape(p.custom) + '"></label>' +
                  '<label>Prisustvo<select name="status">' +
                    ["Online", "Idle", "Do Not Disturb", "Invisible"].map((value) =>
                      '<option value="' + value + '" ' + (p.status === value ? "selected" : "") + '>' +
                      ({ Online: "Online", Idle: "Odsutan", "Do Not Disturb": "Ne uznemiravaj", Invisible: "Nevidljiv" })[value] +
                      '</option>').join("") + '</select></label>' +
                  '<button type="submit" class="sffV5Primary">Sačuvaj profil</button>' +
                '</form>' +
                '<div class="sffV5Buttons"><button type="button" data-v5-pick="avatar">Promeni profilnu</button>' +
                '<button type="button" data-v5-pick="banner">Promeni naslovnu</button></div>' +
                '<input type="file" data-v5-image hidden accept="image/png,image/jpeg">' +
              '</section>' +
              '<section class="sffV5Panel"><div class="sffV5Label">NALOG I SIGURNOST</div>' +
                '<div class="sffV5Buttons">' +
                '<button type="button" data-v5-legacy="password">Promeni lozinku</button>' +
                '<button type="button" data-v5-legacy="privacy">Privatnost</button>' +
                '<button type="button" data-v5-legacy="notifications">Obaveštenja</button>' +
                '<button type="button" data-v5-logout>Odjavi se</button></div>' +
              '</section>' : '') +
            '<button type="button" class="sffV5Close" data-v5-close>Zatvori</button>' +
          '</div>' +
        '</div>';
      if (!dlg.open) dlg.showModal();
    } catch (err) {
      toast(err.message);
    }
  }

  async function accountDialog(kind) {
    const dlg = document.querySelector("#dialog");
    if (!dlg) return;
    const state = await api("state");
    dlg.classList.add("sffProfileDialog");
    const privacy = kind === "privacy";
    dlg.innerHTML =
      '<div class="sffV5Profile"><div class="sffV5ProfileBody" style="padding-top:22px">' +
        '<h2>' + (privacy ? "Privatnost naloga" : "Promena lozinke") + '</h2>' +
        '<form class="sffV5ProfileForm" data-v5-account-form="' + kind + '">' +
          (privacy ?
            '<label class="sffRemember"><input type="checkbox" name="requests" ' +
            (state.preferences?.requests ? "checked" : "") +
            '> Dozvoli zahteve za prijateljstvo</label>' :
            '<label>Trenutna lozinka<input type="password" name="old" required autocomplete="current-password"></label>' +
            '<label>Nova lozinka<input type="password" name="password" required minlength="8" autocomplete="new-password"></label>' +
            '<label>Potvrdi novu lozinku<input type="password" name="confirm" required minlength="8" autocomplete="new-password"></label>') +
          '<button type="submit" class="sffV5Primary">Sačuvaj</button>' +
        '</form>' +
        '<button type="button" class="sffV5Close" data-v5-close>Zatvori</button>' +
      '</div></div>';
    if (!dlg.open) dlg.showModal();
  }

  function currentRoomId() {
    return Number(document.querySelector('.side [data-a="room"].active')?.dataset.id) || 0;
  }
  let mediaRecorder = null, mediaStream = null, recordTarget = 0, discard = false;
  let durationTimer = null, startedAt = 0;
  function releaseAudio() {
    if (durationTimer) clearInterval(durationTimer);
    durationTimer = null;
    if (mediaStream) for (const track of mediaStream.getTracks()) track.stop();
    mediaStream = null;
  }
  function showRecording() {
    const button = document.querySelector('[data-v5-record]');
    if (!button) return;
    const on = mediaRecorder && mediaRecorder.state === "recording";
    button.classList.toggle("recording", Boolean(on));
    const seconds = Math.min(120, Math.floor((Date.now() - startedAt) / 1000));
    button.textContent = on ? "■ " + Math.floor(seconds / 60) + ":" +
      String(seconds % 60).padStart(2, "0") : "🎙 Glasovna";
    const cancel = document.querySelector('[data-v5-cancel]');
    if (cancel) cancel.hidden = !on;
  }
  function insertVoiceButton() {
    const form = document.querySelector('.composer form[data-form="post"]');
    if (!form || form.querySelector('[data-v5-record]')) return;
    const attach = form.querySelector('[data-a="attach"]');
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.v5Record = "1";
    button.className = "sffV5Record";
    button.textContent = "🎙 Glasovna";
    if (attach) attach.after(button);
    else form.prepend(button);
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.dataset.v5Cancel = "1";
    cancel.className = "sffV5Cancel";
    cancel.hidden = true;
    cancel.textContent = "Otkaži";
    button.after(cancel);
    showRecording();
  }
  async function sendRecording(blob, type, target) {
    if (!blob.size || blob.size > 5 * 1024 * 1024)
      throw Error("Glasovna poruka mora biti kraća od 5 MB.");
    const format = type.includes("mp4") ? "m4a" :
      type.includes("ogg") ? "ogg" : "webm";
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(Error("Čitanje snimka nije uspelo."));
      reader.readAsDataURL(blob);
    });
    await api("post", {
      room: target,
      body: "",
      file: "glasovna-" + Date.now() + "." + format,
      data,
    });
    toast("Glasovna poruka je poslata.");
  }
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
      return toast("Snimanje nije podržano. Ažuriraj Chrome / Android System WebView.");
    recordTarget = currentRoomId();
    if (!recordTarget) return toast("Prvo otvori razgovor.");
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const opts = [
        "audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"
      ];
      const format = opts.find((m) => MediaRecorder.isTypeSupported(m));
      mediaRecorder = new MediaRecorder(mediaStream, format ? { mimeType: format } : {});
      const chunks = [];
      discard = false;
      const target = recordTarget;
      mediaRecorder.ondataavailable = (ev) => { if (ev.data?.size) chunks.push(ev.data); };
      mediaRecorder.onstop = async () => {
        const canceled = discard;
        const mime = mediaRecorder?.mimeType || "audio/webm";
        mediaRecorder = null;
        releaseAudio();
        showRecording();
        if (canceled) return toast("Snimanje otkazano.");
        try { await sendRecording(new Blob(chunks, { type: mime }), mime, target); }
        catch (err) { toast(err.message); }
      };
      mediaRecorder.onerror = () => toast("Mikrofon je prijavio grešku.");
      startedAt = Date.now();
      mediaRecorder.start(500);
      showRecording();
      durationTimer = setInterval(() => {
        showRecording();
        if (mediaRecorder?.state === "recording" &&
            (Date.now() - startedAt >= 120000)) mediaRecorder.stop();
      }, 350);
    } catch (err) {
      releaseAudio();
      mediaRecorder = null;
      toast("Mikrofon nije dostupan: " + err.message);
    }
  }

  function enhancePresence() {
    const footer = document.querySelector(".side footer");
    const profile = footer?.querySelector('[data-a="profile"]');
    if (profile && !profile.querySelector(".sffV5Dot")) {
      const dot = document.createElement("span");
      dot.className = "sffV5Dot online";
      dot.title = "Online";
      profile.prepend(dot);
    }
    for (const row of document.querySelectorAll(".members .person")) {
      if (row.querySelector(".sffV5Dot")) continue;
      const small = row.querySelector("small");
      if (!small) continue;
      const dot = document.createElement("span");
      const online = /Online|· Online/.test(small.textContent || "");
      dot.className = "sffV5Dot " + (online ? "online" : "offline");
      dot.title = online ? "Online" : "Van mreže";
      row.querySelector(".avatar")?.append(dot);
    }
  }
  let domScheduled = false;
  const observer = new MutationObserver(() => {
    if (domScheduled) return;
    domScheduled = true;
    requestAnimationFrame(() => {
      domScheduled = false;
      insertVoiceButton();
      enhancePresence();
    });
  });
  observer.observe(document.documentElement, { subtree: true, childList: true });
  insertVoiceButton();
  enhancePresence();

  document.addEventListener("click", (event) => {
    const el = event.target;
    const own = el.closest('[data-a="profile"]');
    const other = el.closest("[data-sff-profile-id], [data-sff-user-id], [data-sff-profile-user]");
    const close = el.closest("[data-v5-close]");
    const record = el.closest("[data-v5-record]");
    const cancel = el.closest("[data-v5-cancel]");
    const pick = el.closest("[data-v5-pick]");
    const legacy = el.closest("[data-v5-legacy]");
    const logout = el.closest("[data-v5-logout]");
    if (!(own || other || close || record || cancel || pick || legacy || logout)) return;
    // Do not steal native chat buttons inside clickable contact rows.
    if (other && !own && !close && !record && !cancel && !pick && !legacy && !logout &&
        el.closest('[data-a]') && !el.closest('[data-sff-profile-id],[data-sff-profile-user]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (close) {
      document.querySelector("#dialog")?.close();
      return;
    }
    if (logout) {
      if (confirm("Odjaviti se sa SFF naloga na ovom uređaju?"))
        api("logout").then(() => location.replace("/")).catch((e) => toast(e.message));
      return;
    }
    if (record) {
      if (mediaRecorder?.state === "recording") mediaRecorder.stop();
      else startRecording();
      return;
    }
    if (cancel) {
      if (mediaRecorder?.state === "recording") {
        discard = true;
        mediaRecorder.stop();
      }
      return;
    }
    if (pick) {
      const input = document.querySelector("[data-v5-image]");
      if (input) {
        input.dataset.slot = pick.dataset.v5Pick;
        input.click();
      }
      return;
    }
    if (legacy) {
      const action = legacy.dataset.v5Legacy;
      if (action === "notifications") {
        if (window.SFFAndroid?.ask) window.SFFAndroid.ask();
        else if (window.Notification) window.Notification.requestPermission();
      } else if (action === "privacy" || action === "password")
        accountDialog(action).catch((e) => toast(e.message));
      return;
    }
    if (own) return void openProfile();
    if (other) {
      if (el.closest('[data-a="remove"],[data-a="dm"],[data-a="accept"]')) return;
      const id = other.dataset.sffProfileId || other.dataset.sffUserId;
      if (id) return void openProfile(id);
      const user = other.dataset.sffProfileUser;
      if (user) api("userProfile", { username: user })
        .then((p) => openProfile(p.id)).catch((e) => toast(e.message));
    }
  }, true);

  document.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-v5-image]");
    if (!input?.files?.length) return;
    event.stopImmediatePropagation();
    const file = input.files[0];
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 1024000)
      return toast("Odaberi PNG ili JPG sliku do 1 MB.");
    try {
      const b64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      await api("art", { scope: "user", slot: input.dataset.slot, data: b64 });
      await openProfile(profileId);
      toast("Slika je sačuvana.");
    } catch (err) { toast(err.message); }
    input.value = "";
  }, true);

  document.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-v5-profile-form],[data-v5-account-form]");
    if (!form) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const params = Object.fromEntries(new FormData(form));
      const accountKind = form.dataset.v5AccountForm;
      if (accountKind === "password") {
        if (params.password !== params.confirm) throw Error("Lozinke se ne podudaraju.");
        delete params.confirm;
        await api("password", params);
        toast("Lozinka je uspešno promenjena.");
      } else if (accountKind === "privacy") {
        await api("privacy", { requests: Boolean(form.querySelector('[name="requests"]')?.checked) });
        toast("Privatnost je sačuvana.");
      } else {
        await api("profile", params);
        toast("Profil je ažuriran.");
      }
      await openProfile(profileId);
    } catch (err) { toast(err.message); }
    finally { button.disabled = false; }
  }, true);
})();
