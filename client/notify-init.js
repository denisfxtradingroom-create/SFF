(() => {
  if (!window.SFFAndroid?.ask) return;
  const timer = setInterval(() => {
    if (!document.querySelector(".shell")) return;
    clearInterval(timer);
    if (localStorage.getItem("sff.notificationPrompted") === "1") return;
    localStorage.setItem("sff.notificationPrompted", "1");
    setTimeout(() => {
      try {
        window.SFFAndroid.ask();
      } catch {}
    }, 700);
  }, 400);
  setTimeout(() => clearInterval(timer), 30000);
})();
