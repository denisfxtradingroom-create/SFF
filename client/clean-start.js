/* SFF clean start: clear only old app-owned browser preferences/badges ONCE. */
(() => {
  const epoch = "sff-clean-start-20261104-v1";
  const key = "sff.clean-start.applied";
  try {
    if (localStorage.getItem(key) === epoch) return;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const candidate = localStorage.key(i);
      if (candidate?.startsWith("sff.")) localStorage.removeItem(candidate);
    }
    localStorage.setItem(key, epoch);
  } catch {
    // Browsers may block localStorage; server-side account/session reset
    // must still succeed without it.
  }
})();