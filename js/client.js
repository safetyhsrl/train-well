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
})();
