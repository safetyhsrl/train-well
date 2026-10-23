// Shared Supabase client for all pages
(function () {
  const cfg = window.TRAINWELL_CONFIG || {};
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR-PROJECT-ID")) {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.insertAdjacentHTML("afterbegin",
        '<div class="alert error" style="margin:0;border-radius:0">Train Well is not connected yet. ' +
        'Open <code>js/config.js</code> and paste your Supabase URL and anon key (see README).</div>');
    });
  }
  window.sb = window.supabase.createClient(cfg.SUPABASE_URL || "http://localhost", cfg.SUPABASE_ANON_KEY || "none");

  // ---- Bot check (Cloudflare Turnstile) for sign-in and password-reset requests.
  // Paste the Turnstile *site key* here (it's public). Leave it empty to switch the check off.
  // Turn it on in Supabase (Authentication -> Attack Protection) only AFTER this key is live.
  const CAPTCHA_SITE_KEY = "";
  let loading = null;
  const loadTurnstile = () => loading || (loading = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true; s.onload = res;
    s.onerror = () => { loading = null; rej(new Error("The security check couldn't load. Check your internet connection and try again.")); };
    document.head.appendChild(s);
  }));
  // Resolves to a one-time token (or undefined when the check is switched off).
  // mount: where to show the check; without one it appears in a small box at the bottom of the screen.
  window.getCaptchaToken = async (mount) => {
    if (!CAPTCHA_SITE_KEY) return undefined;
    await loadTurnstile();
    const host = mount || document.body.appendChild(Object.assign(document.createElement("div"), { className: "captcha-float" }));
    host.innerHTML = "";
    host.classList.remove("hidden");
    return new Promise((resolve, reject) => {
      const done = () => { if (!mount) setTimeout(() => host.remove(), 400); };
      window.turnstile.render(host, {
        sitekey: CAPTCHA_SITE_KEY, action: "signin", appearance: "interaction-only",
        callback: (t) => { resolve(t); done(); },
        "error-callback": () => { reject(new Error("The security check didn't work. Refresh the page and try again.")); done(); },
        "timeout-callback": () => { reject(new Error("The security check timed out. Try again.")); done(); }
      });
    });
  };
})();
