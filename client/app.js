import {
  activeVoiceRoom,
  voice,
  voiceAction,
  voiceEvent,
  voiceLeave,
} from "./voice.js";
const root = document.querySelector("#root"),
  dlg = document.querySelector("#dialog");
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const mark = '<img src="/mark.svg" alt="SFF">',
  empty = (title, sub = "") =>
    '<div class="empty">' +
    mark +
    "<h2>" +
    esc(title) +
    '</h2><p class="muted">' +
    esc(sub) +
    "</p></div>";
const btn = (a, label, id = "", cls = "") =>
  '<button type="button" class="' +
  cls +
  '" data-a="' +
  a +
  '" data-id="' +
  esc(id) +
  '">' +
  esc(label) +
  "</button>";
const field = (n, label, value = "", type = "text", required = true) =>
  "<label>" +
  label +
  '<input name="' +
  n +
  '" type="' +
  type +
  '" value="' +
  esc(value) +
  '" ' +
  (required ? "required" : "") +
  "></label>";
const localized = (v) => ({
  Member: "Član",
  Online: "Na mreži",
  Offline: "Van mreže",
  Idle: "Odsutan",
  "Do Not Disturb": "Ne uznemiravaj",
  Invisible: "Nevidljiv"
})[v] || v;
const select = (n, label, opts, val) =>
  "<label>" +
  label +
  '<select name="' +
  n +
  '">' +
  opts
    .map(
      (x) =>
        '<option value="' + esc(x) + '" ' + (x === val ? "selected" : "") +
        ">" + esc(localized(x)) + "</option>",
    )
    .join("") +
  "</select></label>";
const form = (a, fields, submit) =>
  '<form data-form="' +
  a +
  '" class="stack">' +
  fields +
  '<button class="primary">' +
  submit +
  "</button></form>";
const modal = (title, html) => {
  dlg.innerHTML =
    "<h2>" +
    esc(title) +
    "</h2>" +
    html +
    '<p class="row">' +
    btn("close", "Zatvori") +
    "</p>";
  if (!dlg.open) dlg.showModal();
};
let mailEnabled = false;
let authGateTouched = false;
api("capabilities")
  .then((c) => {
    // Capability detection must NEVER redraw an in-progress auth form.
    mailEnabled = Boolean(c.mail);
  })
  .catch(() => {});
const hasArt = (scope, id, slot) =>
  data?.art?.some((x) => x.scope === scope && x.id === id && x.slot === slot);
const art = (scope, id, slot, cls) =>
  hasArt(scope, id, slot)
    ? '<img class="' +
      cls +
      '" src="/art/' +
      scope +
      "/" +
      Number(id) +
      "/" +
      slot +
      '" alt="">'
    : "";
let timer;
function note(msg) {
  const o = document.querySelector("#toast");
  o.textContent = msg;
  clearTimeout(timer);
  timer = setTimeout(() => (o.textContent = ""), 4200);
}
async function api(a, b = {}) {
  const r = await fetch("/api/" + a, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
  });
  const x = await r.json();
  if (!r.ok) throw Error(x.error);
  return x;
}
let resumeVoice = null;
let thread = null;
let data,
  space = null,
  room = null,
  socket,
  alive = false,
  page = "spaces",
  people = [],
  list = [],
  reply = null,
  file = null,
  search = "",
  pins = false,
  seq = 0,
  feedSeq = 0,
  registered = false,
  typing = 0,
  typingTimer,
  retry = 0;
const lastReadSent = new Map();
const current = () => data?.rooms.find((r) => r.id === room),
  community = () => data?.spaces.find((s) => s.id === space);
const signature = '<small class="signature">Napravio: Denis.D98</small>';
function gate(reg = false) {
  registered = reg;
  root.innerHTML =
    '<div class="gate"><section class="art"><div class="word">' +
    mark +
    ' SFF</div><div><p class="eyebrow">SFF / ZAJEDNICE</p><h1>Tvoj tim.<br><span>Tvoja frekvencija.</span></h1></div><small>Razgovori · Zajednice · Glas</small></section><section class="gateform"><p class="eyebrow">SFF &nbsp; / &nbsp; PRISTUP</p><h2>' +
    (reg ? "Napravi nalog" : "Dobro došao nazad.") +
    '</h2><p class="muted">' +
    (reg
      ? "Izaberi ime pod kojim će te tim pronaći."
      : "Prijavi se da se povežeš sa svojom ekipom.") +
    "</p>" +
    form(
      reg ? "register" : "login",
      (reg
        ? field("firstName", "Ime") +
          field("lastName", "Prezime") +
          field("username", "Korisničko ime · bez razmaka, npr. denisdudas") +
          field("email", "E-pošta", "", "email") +
          field("emailConfirm", "Potvrdi e-poštu", "", "email") +
          field("password", "Lozinka · najmanje 8 znakova", "", "password") +
          field("passwordConfirm", "Potvrdi lozinku", "", "password")
        : field("username", "Korisničko ime") +
          field("password", "Lozinka", "", "password")) +
        '<label class="sffRemember"><input type="checkbox" name="remember" checked> Ostani prijavljen na ovom uređaju</label>',
      reg ? "Napravi nalog" : "Prijavi se",
    ) +
    btn("switch", reg ? "Već imam nalog" : "Napravi novi nalog") +
    (!reg
      ? '<div class="sffRecoveryActions">' +
          btn("forgot", "Zaboravljena lozinka") +
          btn("recoverUsername", "Zaboravljeno korisničko ime") +
        '</div>' +
        (!mailEnabled
          ? '<p class="muted sffRecoveryHint">Oporavak preko e-pošte biće dostupan kada SFF uključi slanje mejlova.</p>'
          : '')
      : "") +
    signature + "</section></div>";
}
function verificationGate(message = "Poslali smo kod na tvoju email adresu.") {
  registered = false;
  root.innerHTML =
    '<div class="gate"><section class="art"><div class="word">' +
    mark +
    ' SFF</div><div><p class="eyebrow">SIGURNOST NALOGA</p><h1>Još samo<br><span>potvrda emaila.</span></h1></div><small>Zaštita naloga · Oporavak pristupa · Verifikacija</small></section><section class="gateform"><p class="eyebrow">SFF &nbsp; / &nbsp; POTVRDA EMAILA</p><h2>Proveri poštu</h2><p class="muted">' +
    esc(message) +
    '</p>' +
    form("verifyCode", field("code", "Kod iz email poruke"), "Potvrdi email") +
    '<div class="row">' + btn("verifyResend", "Pošalji kod ponovo") + btn("logout", "Odjavi se") + "</div>" + signature + "</section></div>";
}
function needsVerification() {
  return Boolean(data?.requireVerifiedEmail && !data?.preferences?.verified);
}
function navigate(p, record = true) {
  page = p;
  const shell = document.querySelector(".shell");
  if (shell) {
    shell.dataset.page = p;
    for (const b of shell.querySelectorAll(".mobileNav button"))
      b.classList.toggle(
        "active",
        b.dataset.a ===
          {
            spaces: "spacesPage",
            chat: "chatPage",
            friends: "friends",
            members: "membersPage",
          }[p],
      );
  }
  if (record && history.state?.page !== p)
    history.pushState({ page: p }, "", "#" + p);
}
onpopstate = (e) => {
  if (dlg.open) dlg.close();
  if (data) navigate(e.state?.page || "spaces", false);
};
async function sync() {
  const n = ++seq,
    next = await api("state");
  if (n !== seq) return;
  data = next;
  if (space && !community()) space = null;
  if (room && !current()) {
    voiceLeave();
    room = null;
    thread = null;
  }
  const s = space;
  const ps = s ? await api("members", { space: s }) : [];
  if (n !== seq || s !== space) return;
  people = ps;
  render();
  if (current()?.kind !== "voice") await historyLoad();
}
function render() {
  const r = current(),
    sp = community(),
    pendingFriends = data.friends.filter((f) => !f.accepted && f.target === data.me.id).length,
    draft = document.querySelector("[name=body]")?.value || "";
  const rail =
    '<aside class="rail">' +
    mark +
    btn("friends", "✉", "", "orbit " + (!sp ? "active" : "")) +
    data.spaces
      .map((s) =>
        hasArt("space", s.id, "avatar")
          ? '<button class="orbit" title="' +
            esc(s.name) +
            '" data-a="space" data-id="' +
            s.id +
            '">' +
            art("space", s.id, "avatar", "spaceIcon") +
            "</button>"
          : btn(
              "space",
              s.name.slice(0, 2).toUpperCase(),
              s.id,
              "orbit " + (s.id === space ? "active" : ""),
            ),
      )
      .join("") +
    btn("spacesMenu", "＋", "", "orbit") +
    "</aside>";
  const rooms = data.rooms
    .filter((x) => (space ? x.space === space : !x.space))
    .sort((a, b) =>
      space
        ? (a.category || "").localeCompare(b.category || "")
        : b.lastActivity - a.lastActivity,
    );
  const side =
    '<aside class="side">' +
    (sp ? art("space", sp.id, "banner", "banner") : "") +
    '<span class="eyebrow">' +
    (sp ? "ZAJEDNICA" : "LIČNI PROSTOR") +
    "</span><h2>" +
    esc(sp?.name || "Razgovori") +
    '</h2><div class="row">' +
    (sp
      ? btn("invite", "Pozivnica") +
        (sp.role !== "Member" ? btn("newChannel", "＋ Kanal") : "") +
        (sp.owner === data.me.id ? btn("spaceSettings", "Uredi") : "")
      : btn("friendsList", pendingFriends ? "Prijatelji · " + pendingFriends : "Prijatelji",
          "", pendingFriends ? "sffFriendPending" : "") +
        btn("group", "Grupa") +
        btn("spacesMenu", "Zajednice")) +
    '</div><div class="list">' +
    rooms
      .map(
        (x, i) =>
          (x.category && x.category !== rooms[i - 1]?.category
            ? '<span class="eyebrow">' + esc(x.category) + "</span>"
            : "") +
          btn(
            "room",
            (x.kind === "voice" ? "◉ " : x.kind === "dm" ? "↗ " : "# ") +
              x.name +
              (x.unread ? "  · " + x.unread : ""),
            x.id,
            "item " + (x.id === room ? "active" : ""),
          ),
      )
      .join("") +
    "</div><footer>" +
    btn("profile", data.me.name + " · Profil", "", "item") +
    '<small id="connection">' +
    (socket?.readyState === 1 ? "● Povezano" : "○ Povezivanje…") +
    "</small></footer></aside>";
  const members =
    '<aside class="members"><p class="eyebrow">' +
    (sp ? "ČLANOVI / " + people.length : "KONTAKTI") +
    "</p>" +
    (sp ? people : data.friends.filter((f) => f.accepted))
      .map(
        (x) =>
          '<div class="person" data-sff-user-id="' +
          Number(x.id) +
          '"><span class="avatar">' +
          esc(x.name.slice(0, 1)) +
          "</span><div><b>" +
          esc(x.name) +
          "</b><br><small>" +
          (x.badge
            ? '<b style="color:' +
              esc(x.badge.color) +
              '">' +
              esc(x.badge.name) +
              "</b> · "
            : "") +
          esc(x.role ? localized(x.role) : (data.online.includes(x.id) ? "Na mreži" : "Prijatelj")) +
          (x.online ? " · " + esc(x.status) : "") +
          "</small></div></div>",
      )
      .join("") +
    (sp && sp.role !== "Member" ? btn("moderation", "Moderacija") : "") +
    "</aside>";
  root.innerHTML =
    '<div class="shell" data-page="' +
    page +
    '">' +
    rail +
    side +
    '<section class="chat"><header class="bar"><div><span class="eyebrow">' +
    esc(sp?.name || "SFF / PRIVATNO") +
    "</span><h2>" +
    esc(r ? (r.kind === "voice" ? "◉ " : "# ") + r.name : "Razgovor") +
    "</h2><small>" +
    esc(r?.topic || "") +
    '</small></div><div class="row toolbar">' +
    (r && r.kind !== "voice"
      ? btn("search", "Pretraga") +
        btn("pins", pins ? "Sve poruke" : "Igle") +
        btn("alerts", "Zvono") +
        (sp && sp.role !== "Member" ? btn("category", "Kategorija") : "")
      : "") +
    "</div></header>" +
    (r
      ? r.kind === "voice"
        ? '<div id="voice" class="voice"></div>'
        : '<div class="feed" id="feed"></div><div class="composer"><small id="context"></small><form data-form="post">' +
          btn("attach", "＋") +
          '<input type="file" hidden id="attachment"><input name="body" aria-label="Poruka" maxlength="4000" autocomplete="off" placeholder="Napiši poruku…"><button class="primary">Pošalji</button></form></div>'
      : empty(
          "Otvori razgovor",
          sp
            ? "Izaberi kanal u zajednici."
            : "Dodaj prijatelja ili kreiraj svoju prvu zajednicu.",
        )) +
    "</section>" +
    members +
    '<nav class="mobileNav">' +
    btn(
      "spacesPage",
      "Zajednice",
      "",
      "" + (page === "spaces" ? "active" : ""),
    ) +
    btn("friends", pendingFriends ? "Poruke · " + pendingFriends : "Poruke") +
    btn("chatPage", "Razgovor") +
    btn("membersPage", "Članovi") +
    btn("profile", "Profil") +
    "</nav></div>";
  if (r?.kind === "voice") voice(r.id);
  const input = document.querySelector("[name=body]");
  if (input) {
    input.value = draft;
    input.oninput = () => {
      if (Date.now() - typing > 1800) {
        typing = Date.now();
        api("typing", { room }).catch(() => {});
      }
    };
    document.querySelector("#attachment").onchange = (e) => {
      file = e.target.files[0];
      context();
    };
    context();
  }
}
function context(t = "") {
  const el = document.querySelector("#context");
  if (el)
    el.innerHTML =
      esc(
        [reply ? "Odgovor na #" + reply : "", file?.name, t]
          .filter(Boolean)
          .join(" · "),
      ) + (reply || file ? btn("cancel", "×") : "");
}
function format(t) {
  return String(t)
    .split(/(https?:\/\/[^\s<>"']+)/gi)
    .map((part, i) => {
      const html = esc(part);
      if (i % 2)
        return (
          '<a href="' +
          html +
          '" rel="noopener noreferrer" target="_blank">' +
          html +
          "</a>"
        );
      return html
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(@[A-Za-z0-9_]+)/g, '<b class="chip">$1</b>');
    })
    .join("");
}
function drawFeed(bottom = true) {
  const feed = document.querySelector("#feed");
  if (!feed) return;
  feed.innerHTML =
    (list.length >= 50 ? btn("older", "Ranije poruke") : "") +
    (thread ? btn("thread", "← Kanal · nit #" + thread, "0") : "") +
    (search ? btn("clearSearch", "Pretraga · " + search + " ×") : "") +
    (list.length
      ? list
          .map(
            (m) =>
              '<article class="msg">' +
              (art("user", m.uid, "avatar", "avatar") ||
                '<span class="avatar">' + esc(m.name[0]) + "</span>") +
              '<div class="bubble"><span class="author" data-sff-user-id="' +
              Number(m.uid) +
              '">' +
              esc(m.name) +
              '</span> <span class="meta">' +
              new Date(m.time).toLocaleString("sr-Latn", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }) +
              (m.edited ? " · izmenjeno" : "") +
              (m.pinned ? " · zakačeno" : "") +
              "</span>" +
              (m.parent
                ? '<div class="chip">↳ #' +
                  m.parent +
                  " " +
                  esc(
                    list.find((x) => x.id === m.parent)?.body.slice(0, 60) ||
                      "",
                  ) +
                  "</div>"
                : "") +
              '<div class="body">' +
              format(m.body) +
              "</div>" +
              (m.file
                ? '<a href="/media/' +
                  m.id +
                  '" download="' +
                  esc(m.file) +
                  '">' +
                  (m.mime.startsWith("image/")
                    ? '<img src="/media/' +
                      m.id +
                      '" alt="' +
                      esc(m.file) +
                      '"><br>'
                    : "") +
                  esc(m.file) +
                  "</a>"
                : "") +
              "<div>" +
              m.reactions
                .map((x) =>
                  btn("react", x.emoji + " " + x.n, m.id + "|" + x.emoji),
                )
                .join("") +
              (!thread
                ? btn(
                    "thread",
                    "Nit" + (m.threadCount ? " · " + m.threadCount : ""),
                    m.id,
                  )
                : "") +
              btn("actions", "•••", m.id) +
              "</div></div></article>",
          )
          .join("")
      : empty(
          pins
            ? "Nema zakačenih poruka"
            : search
              ? "Nema rezultata"
              : "Počni razgovor",
          pins || search ? "" : "Prva poruka može biti tvoja.",
        ));
  if (bottom) feed.scrollTop = feed.scrollHeight;
}
async function historyLoad(older = false) {
  if (!room || !current() || current().kind === "voice") return;
  const id = room,
    n = ++feedSeq,
    feed = document.querySelector("#feed"),
    h = feed?.scrollHeight || 0;
  const rows = await api("history", {
    room: id,
    thread,
    search,
    pins,
    before: older ? list[0]?.id : 0,
  });
  if (room !== id || n !== feedSeq) return;
  list = older ? [...rows, ...list] : rows;
  drawFeed(!older);
  if (older && feed) feed.scrollTop = feed.scrollHeight - h;
  if (
    !older && !search && !pins && !thread &&
    list.length && !document.hidden &&
    (innerWidth > 760 || page === "chat")
  ) {
    const newest = list.at(-1).id;
    if (newest > (lastReadSent.get(id) || 0)) {
      lastReadSent.set(id, newest);
      try {
        // The server pushes a fresh 'state' update to every device after reading.
        await api("read", { room: id, last: newest });
        if (room === id && current()) current().unread = 0;
        if (socket?.readyState !== 1) await sync();
      } catch (error) {
        lastReadSent.delete(id);
        throw error;
      }
    }
  }
}
function live() {
  if (!alive) return;
  socket = new WebSocket(
    (location.protocol === "https:" ? "wss:" : "ws:") +
      "//" +
      location.host +
      "/live",
  );
  socket.onopen = async () => {
    retry = 0;
    try {
      await sync();
      if (resumeVoice && resumeVoice === room && current()?.canVoice) {
        resumeVoice = null;
        await voiceAction("join", room);
      }
    } catch (e) {
      note(e.message);
    }
  };
  socket.onclose = () => {
    resumeVoice = activeVoiceRoom();
    voiceLeave();
    if (alive) {
      const el = document.querySelector("#connection");
      if (el) el.textContent = "Ponovno povezivanje…";
      setTimeout(live, Math.min(15000, 800 * 2 ** retry++));
    }
  };
  socket.onmessage = async (e) => {
    try {
      const v = JSON.parse(e.data);
      if (await voiceEvent(v)) return;
      if (v.type === "error") {
        if (activeVoiceRoom()) voiceLeave();
        return note(v.error);
      }
      if (v.type === "state") return await sync();
      if (v.type === "typing" && v.room === room && v.uid !== data.me.id) {
        context(v.name + " piše…");
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => context(), 2200);
      }
      if (v.type === "message" || v.type === "changed") {
        // Notifications are delivered once by social-notifications.js.
        if (v.room === room) await historyLoad();
        else await sync();
      }
    } catch (e) {
      note(e.message);
    }
  };
}
export function sendVoice(payload) {
  if (socket?.readyState !== 1) throw Error("Veza sa serverom nije dostupna.");
  socket.send(JSON.stringify(payload));
}
async function openRoom(id) {
  if (room !== id) {
    thread = null;
    voiceLeave();
    file = null;
    reply = null;
    list = [];
    search = "";
    pins = false;
  }
  room = id;
  space = current()?.space || null;
  navigate("chat");
  render();
  await historyLoad();
}
function shouldNotify(v) {
  const r = data.rooms.find((r) => r.id === v.room),
    policy =
      data.alerts.find((a) => a.scope === "r" + v.room)?.policy ||
      data.alerts.find((a) => a.scope === "s" + r?.space)?.policy ||
      "all";
  return (
    policy === "all" ||
    (policy === "mentions" &&
      v.mentions?.some((n) =>
        [
          data.me.username,
          "everyone",
          r?.role?.toLowerCase(),
          r?.badge?.toLowerCase(),
        ].includes(n),
      ))
  );
}
function friendsDialog() {
  modal(
    "Prijatelji",
    form("friend", field("username", "Korisničko ime"), "Pošalji zahtev") +
      "<hr>" +
      (data.friends.some((f) => !f.accepted && f.target === data.me.id)
        ? '<h3 class="sffRequestHeading">✦ Novi zahtevi za prijateljstvo</h3>'
        : "") +
      data.friends
        .slice()
        .sort((a, b) => Number(!b.accepted && b.target === data.me.id) -
          Number(!a.accepted && a.target === data.me.id))
        .map(
          (f) =>
            '<div class="person"><div class="spacer"><b>' +
            esc(f.name) +
            "</b><br><small>@" +
            esc(f.username) +
            "</small></div>" +
            (f.accepted
              ? btn("dm", "Razgovor", f.username)
              : f.target === data.me.id
                ? btn("accept", "Prihvati", f.username)
                : "<small>Poslato</small>") +
            btn("remove", "Ukloni", f.username) +
            "</div>",
        )
        .join("") +
      form("block", field("username", "Blokiraj korisnika"), "Blokiraj") +
      data.blocks
        .map((b) => btn("unblock", "Odblokiraj @" + b.username, b.username))
        .join(""),
  );
}
async function act(a, id) {
  if (a === "roles") {
    const roles = await api("roles", { space });
    const bits =
      select("canPost", "Pisanje", ["Da", "Ne"]) +
      select("canVoice", "Glas", ["Da", "Ne"]);
    return modal(
      "Uloge i dozvole",
      form(
        "newRole",
        field("name", "Naziv · slova, cifre ili _") +
          field("color", "Boja", "#ff5967", "color") +
          field("rank", "Prioritet", "10", "number") +
          bits,
        "Napravi ulogu",
      ) +
        (roles.length
          ? "<hr>" +
            roles
              .map(
                (r) =>
                  '<b style="color:' +
                  esc(r.color) +
                  '">' +
                  esc(r.name) +
                  "</b> · " +
                  r.rank,
              )
              .join("<br>") +
            form(
              "assignRole",
              select(
                "role",
                "Uloga",
                roles.map((r) => r.id + " " + r.name),
              ) +
                select(
                  "target",
                  "Član",
                  people.map((p) => p.id + " " + p.name),
                ),
              "Dodeli ulogu",
            ) +
            "<hr>" +
            form(
              "override",
              select(
                "role",
                "Uloga za kanal",
                roles.map((r) => r.id + " " + r.name),
              ) +
                select(
                  "channel",
                  "Kanal",
                  data.rooms
                    .filter((r) => r.space === space)
                    .map((r) => r.id + " " + r.name),
                ) +
                select("visible", "Vidljivost", ["Da", "Ne"]) +
                bits,
              "Sačuvaj dozvole",
            )
          : ""),
    );
  }
  if (a === "group")
    return modal(
      "Grupni razgovor",
      form(
        "group",
        field("name", "Naziv grupe") +
          field("names", "Korisnička imena prijatelja, odvojena zarezom"),
        "Pokreni razgovor",
      ),
    );
  if (a === "category")
    return modal(
      "Kategorija kanala",
      form(
        "category",
        field(
          "category",
          "Naziv kategorije",
          current().category,
          "text",
          false,
        ),
        "Sačuvaj",
      ),
    );
  if (a === "alerts")
    return modal(
      "Obaveštenja",
      form(
        "alerts",
        select("level", "Opseg", space ? ["Kanal", "Zajednica"] : ["Kanal"]) +
          select("policy", "Isporuka", ["all", "mentions", "off"]),
        "Sačuvaj",
      ),
    );
  if (a === "forgot" || a === "recoverUsername") {
    // Recheck capability when initial loading has not yet finished.
    if (!mailEnabled) {
      const capabilities = await api("capabilities");
      mailEnabled = Boolean(capabilities.mail);
    }
    if (!mailEnabled)
      return modal(
        "Oporavak SFF naloga",
        '<p class="muted">Slanje mejlova još nije uključeno na SFF serveru. ' +
        'Oporavak preko e-pošte biće dostupan kada administrator poveže mejl servis.</p>',
      );
    if (a === "forgot")
      return modal(
        "Zaboravljena lozinka",
        '<p class="muted">Unesi e-poštu naloga. Poslaćemo jednokratni kod koji važi 15 minuta.</p>' +
        form("forgot", field("email", "E-pošta naloga", "", "email"), "Pošalji kod"),
      );
    return modal(
      "Zaboravljeno korisničko ime",
      '<p class="muted">Unesi e-poštu kojom je nalog registrovan. ' +
      'Ako postoji nalog sa tom adresom, poslaćemo njegovo korisničko ime.</p>' +
      form("recoverUsername", field("email", "E-pošta naloga", "", "email"), "Pošalji korisničko ime"),
    );
  }
  if (a === "verifyResend") {
    await api("verifySend");
    note("Novi kod je poslat.");
    return;
  }
  if (a === "verifySend") {
    await api("verifySend");
    return modal(
      "Potvrda adrese",
      form("verifyCode", field("code", "Kod iz email poruke"), "Potvrdi"),
    );
  }
  if (a === "privacy")
    return modal(
      "Privatnost",
      form(
        "privacy",
        select(
          "requests",
          "Zahtevi za prijateljstvo",
          ["Dozvoli", "Isključi"],
          data.preferences.requests ? "Dozvoli" : "Isključi",
        ),
        "Sačuvaj",
      ),
    );
  if (a === "art")
    return modal(
      "Slika · PNG ili JPG",
      form(
        "art",
        select("slot", "Vrsta", ["avatar", "banner"]) +
          '<input type="hidden" name="scope" value="' +
          (id === "space" ? "space" : "user") +
          '"><input name="image" type="file" accept="image/png,image/jpeg" required>',
        "Otpremi",
      ),
    );
  if (a === "close") return dlg.close();
  if (a === "switch") {
    authGateTouched = true;
    return gate(!registered);
  }
  if (a === "spacesPage" || a === "membersPage" || a === "chatPage")
    return navigate(
      { spacesPage: "spaces", membersPage: "members", chatPage: "chat" }[a],
    );
  if (a.startsWith("voice-")) return voiceAction(a.slice(6), room);
  if (a === "space" || a === "friends") {
    if (a === "friends" && !space && page === "friends") {
      friendsDialog();
      return;
    }
    thread = null;
    voiceLeave();
    space = a === "friends" ? null : Number(id);
    room =
      data.rooms.find((x) => (space ? x.space === space : !x.space))?.id ||
      null;
    list = [];
    file = null;
    reply = null;
    search = "";
    pins = false;
    navigate(a === "friends" ? "friends" : "spaces");
    await sync();
    return;
  }
  if (a === "room") return openRoom(+id);
  if (a === "spacesMenu")
    return modal(
      "Zajednice",
      form(
        "createSpace",
        field("name", "Nova zajednica"),
        "Kreiraj zajednicu",
      ) +
        "<hr>" +
        form("join", field("invite", "Kod ili link pozivnice"), "Pridruži se"),
    );
  if (a === "invite")
    return modal(
      "Pozovi ekipu",
      field(
        "link",
        "Link za pridruživanje",
        location.origin + "/?invite=" + community().invite,
      ) + btn("copy", "Kopiraj link"),
    );
  if (a === "copy") {
    await navigator.clipboard.writeText(dlg.querySelector("[name=link]").value);
    return note("Link je kopiran.");
  }
  if (a === "newChannel")
    return modal(
      "Novi kanal",
      form(
        "channel",
        field("name", "Naziv") +
          select("kind", "Vrsta", ["text", "announcement", "voice"]) +
          field("topic", "Tema", "", "text", false) +
          select("access", "Vidljivost", ["Svi članovi", "Samo osoblje"]),
        "Kreiraj kanal",
      ),
    );
  if (a === "spaceSettings")
    return modal(
      "Podešavanja zajednice",
      form("rename", field("name", "Naziv", community().name), "Sačuvaj") +
        btn("roles", "Uloge i dozvole") +
        btn("art", "Ikona i baner", "space") +
        btn("deleteSpace", "Obriši zajednicu"),
    );
  if (a === "deleteSpace") {
    if (!confirm("Trajno obriši zajednicu, kanale i poruke?")) return;
    await api(a, { space });
    dlg.close();
    space = room = null;
    return sync();
  }
  if (a === "moderation") {
    const audit = await api("audit", { space });
    return modal(
      "Moderacija",
      form(
        "manage",
        field("target", "ID člana", "", "number") +
          select("op", "Akcija", [
            "kick",
            "ban",
            "unban",
            "timeout",
            ...(community().owner === data.me.id
              ? ["Administrator", "Moderator", "Member"]
              : []),
          ]),
        "Primeni",
      ) +
        "<p>" +
        people.map((x) => "#" + x.id + " " + esc(x.name)).join(" · ") +
        "</p><hr>" +
        audit
          .map(
            (x) =>
              "<small>" +
              esc(x.action) +
              " · " +
              new Date(x.time).toLocaleString() +
              "</small><br>",
          )
          .join(""),
    );
  }
  if (a === "friendsList") return friendsDialog();
  if (["accept", "remove", "unblock", "dm"].includes(a)) {
    const result = await api(a, { username: id });
    await sync();
    if (a === "dm") {
      dlg.close();
      return openRoom(result.id);
    }
    return friendsDialog();
  }
  if (a === "profile") {
    const m = data.me;
    return modal(
      "Tvoj profil",
      art("user", m.id, "banner", "banner") +
        art("user", m.id, "avatar", "avatar") +
        form(
          "profile",
          field("name", "Ime za prikaz", m.name) +
            field("about", "O meni", m.about, "text", false) +
            select(
              "status",
              "Prisustvo",
              ["Online", "Idle", "Do Not Disturb", "Invisible"],
              m.status,
            ) +
            field("custom", "Lični status", m.custom, "text", false),
          "Sačuvaj",
        ) +
        '<hr><div class="row">' +
        btn("privacy", "Privatnost") +
        btn("art", "Avatar i baner") +
        (data.mail && !data.preferences.verified
          ? btn("verifySend", "Potvrdi email")
          : "") +
        btn("password", "Promeni lozinku") +
        (window.Notification || window.SFFAndroid
          ? btn("notifications", "Obaveštenja")
          : "") +
        btn("logout", "Odjavi se") +
        "</div>" + signature,
    );
  }
  if (a === "password")
    return modal(
      "Promeni lozinku",
      form(
        "password",
        field("old", "Trenutna lozinka", "", "password") +
          field("password", "Nova lozinka", "", "password"),
        "Promeni",
      ),
    );
  if (a === "notifications" && window.SFFAndroid)
    return window.SFFAndroid.ask();
  if (a === "notifications")
    return note(
      (await Notification.requestPermission()) === "granted"
        ? "Obaveštenja su omogućena."
        : "Dozvola nije dodeljena.",
    );
  if (a === "logout") {
    await api("logout");
    alive = false;
    voiceLeave();
    socket?.close();
    location.replace("/");
    return;
  }
  if (a === "attach") return document.querySelector("#attachment").click();
  if (a === "cancel") {
    file = reply = null;
    context();
    return;
  }
  if (a === "thread") {
    thread = Number(id) || null;
    reply = null;
    search = "";
    pins = false;
    context();
    await historyLoad();
    return;
  }
  if (a === "older") return historyLoad(true);
  if (a === "search")
    return modal(
      "Pretraga poruka",
      form("search", field("search", "Tekst", search), "Pretraži"),
    );
  if (a === "pins" || a === "clearSearch") {
    if (a === "pins") pins = !pins;
    else search = "";
    render();
    return historyLoad();
  }
  if (a === "actions") {
    const m = list.find((x) => x.id === +id),
      mod = current()?.role && current().role !== "Member";
    return modal(
      "Poruka #" + id,
      '<div class="row">' +
        btn("reply", "Odgovori", id) +
        ["❤️", "👍", "🔥", "🎯", "😂"]
          .map((e) => btn("react", e, id + "|" + e))
          .join("") +
        (mod || !space ? btn("pin", m.pinned ? "Otkači" : "Zakači", id) : "") +
        (m.uid === data.me.id ? btn("edit", "Izmeni", id) : "") +
        (m.uid === data.me.id || mod ? btn("delete", "Obriši", id) : "") +
        "</div>",
    );
  }
  if (a === "reply") {
    reply = +id;
    dlg.close();
    context();
    document.querySelector("[name=body]").focus();
    return;
  }
  if (a === "edit")
    return modal(
      "Izmeni poruku",
      form(
        "edit",
        field("body", "Poruka", list.find((m) => m.id === +id).body) +
          '<input type="hidden" name="id" value="' +
          Number(id) +
          '">',
        "Sačuvaj",
      ),
    );
  if (["react", "pin", "delete"].includes(a)) {
    const [i, emoji] = id.split("|");
    await api(a, { room, id: Number(i), emoji });
    dlg.close();
    return historyLoad();
  }
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-a]");
  if (el) act(el.dataset.a, el.dataset.id).catch((e) => note(e.message));
});
document.addEventListener("submit", async (e) => {
  const f = e.target.closest("[data-form]");
  if (!f) return;
  e.preventDefault();
  const submit = f.querySelector("button:not([type=button])");
  if (submit.disabled) return;
  submit.disabled = true;
  try {
    const a = f.dataset.form,
      b = Object.fromEntries(new FormData(f));
    if (a === "login" || a === "register") {
      // Ignore delayed startup state responses once authentication was submitted.
      authGateTouched = true;
      b.remember = Boolean(f.querySelector('[name="remember"]')?.checked);
      data = await api(a, b);
      if (needsVerification()) {
        verificationGate(
          data.emailDeliveryFailed
            ? "Nalog je sačuvan, ali slanje koda trenutno nije uspelo. Nije potrebno praviti drugi nalog — izaberi Pošalji novi kod kada servis proradi."
            : a === "register"
              ? "Nalog je napravljen. Unesi verifikacioni kod iz emaila."
              : "Ovaj nalog još nema potvrđen email. Unesi kod ili zatraži novi.",
        );
        return;
      }
      await start();
      return;
    }
    if (a === "verifyCode" && needsVerification()) {
      await api("verifyCode", b);
      data = await api("state");
      note("E-pošta je potvrđena. Dobro došao u SFF.");
      await start();
      return;
    }
    if (a === "post") {
      const source = file;
      b.room = room;
      b.thread = thread;
      b.parent = reply;
      if (source) {
        if (source.size > 5242880) throw Error("Najviše 5 MB.");
        b.file = source.name;
        b.data = await new Promise((ok, no) => {
          const r = new FileReader();
          r.onload = () => ok(r.result.split(",")[1]);
          r.onerror = no;
          r.readAsDataURL(source);
        });
      }
      await api(a, b);
      f.reset();
      file = reply = null;
      context();
      await historyLoad();
      return;
    }
    if (a === "search") {
      search = b.search;
      dlg.close();
      await historyLoad();
      return;
    }
    if (a === "join" && b.invite.includes("?invite="))
      b.invite = new URL(b.invite).searchParams.get("invite");
    if (a === "forgot") {
      await api(a, b);
      modal(
        "Unesi kod iz pošte",
        form(
          "reset",
          field("email", "E-pošta", b.email, "email") +
            field("code", "Jednokratni kod") +
            field("password", "Nova lozinka · najmanje 8 znakova", "", "password") +
            field("passwordConfirm", "Potvrdi novu lozinku", "", "password"),
          "Promeni lozinku",
        ),
      );
      return;
    }
    if (a === "recoverUsername") {
      await api(a, b);
      dlg.close();
      note("Ako nalog postoji, korisničko ime će stići na registrovanu e-poštu.");
      return;
    }
    if (a === "reset") {
      await api(a, b);
      dlg.close();
      gate();
      note("Lozinka je promenjena. Sve prethodne prijave su odjavljene.");
      return;
    }
    if (["newRole", "assignRole", "override"].includes(a)) {
      b.canPost = b.canPost === "Da";
      b.canVoice = b.canVoice === "Da";
      b.visible = b.visible === "Da";
      if (b.role) b.role = parseInt(b.role);
      if (b.target) b.target = parseInt(b.target);
    }
    if (a === "privacy") b.requests = b.requests === "Dozvoli";
    if (a === "alerts")
      b.scope = b.level === "Kanal" ? "r" + room : "s" + space;
    if (a === "art") {
      if (!b.image || b.image.size > 1024000) throw Error("Najviše 1 MB.");
      b.data = await new Promise((ok, no) => {
        const r = new FileReader();
        r.onload = () => ok(r.result.split(",")[1]);
        r.onerror = no;
        r.readAsDataURL(b.image);
      });
      delete b.image;
    }
    const result = await api(
      a === "manage" && b.op === "timeout" ? "timeout" : a,
      {
        ...b,
        room: a === "override" ? parseInt(b.channel) : room,
        space,
        target: Number(b.target) || null,
        id: Number(b.id) || null,
        restricted: b.access === "Samo osoblje",
      },
    );
    dlg.close();
    if (["createSpace", "join"].includes(a)) {
      space = result.id;
      room = null;
    }
    await sync();
    if (a === "group") {
      await openRoom(result.id);
      return;
    }
    if (["createSpace", "join"].includes(a)) {
      const first = data.rooms.find((r) => r.space === space);
      if (first) await openRoom(first.id);
    }
    if (["friend", "block"].includes(a)) friendsDialog();
  } catch (e) {
    note(e.message);
    if (dlg.open) {
      let el = dlg.querySelector("[role=alert]");
      if (!el) {
        el = document.createElement("p");
        el.setAttribute("role", "alert");
        dlg.append(el);
      }
      el.textContent = e.message;
    }
  } finally {
    submit.disabled = false;
  }
});
async function start() {
  alive = true;
  const invite = new URLSearchParams(location.search).get("invite");
  if (invite) {
    try {
      space = (await api("join", { invite })).id;
    } catch (e) {
      note(e.message);
    }
    history.replaceState(null, "", "/");
  }
  space = space || data.spaces[0]?.id || null;
  await sync();
  room =
    data.rooms.find((x) => (space ? x.space === space : !x.space))?.id || null;
  render();
  await historyLoad();
  live();
}
let touchX = 0,
  touchY = 0;
root.addEventListener(
  "touchstart",
  (e) => {
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  },
  { passive: true },
);
root.addEventListener(
  "touchend",
  (e) => {
    if (!data || dlg.open || innerWidth > 760 || page !== "chat") return;
    const dx = e.changedTouches[0].clientX - touchX,
      dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 110 && Math.abs(dy) < 40)
      navigate(dx > 0 ? "spaces" : "members");
  },
  { passive: true },
);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && data && room &&
      (innerWidth > 760 || page === "chat"))
    historyLoad().catch((e) => note(e.message));
});

api("state")
  .then(async (d) => {
    if (authGateTouched || data) return;
    data = d;
    if (needsVerification()) return verificationGate();
    await start();
  })
  .catch(() => {
    // A late unauthenticated bootstrap response must not erase a signup form.
    if (!authGateTouched && !data) gate();
  });
