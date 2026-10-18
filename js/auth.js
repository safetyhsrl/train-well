// Login page logic
(function () {
  const $ = (id) => document.getElementById(id);
  const show = (el, text, kind = "error") => {
    el.textContent = text; el.className = "alert " + kind;
  };

  // Arriving from an invite or password-reset email: show "set a new password"
  const params = new URLSearchParams(location.search);
  let recovering = params.has("setpw") || /type=(recovery|invite)/.test(location.hash);
  const showReset = () => {
    $("loginForm").classList.add("hidden");
    $("resetForm").classList.remove("hidden");
  };
  if (recovering) showReset();

  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") { recovering = true; showReset(); }
  });

  // Already signed in? Go straight to the app.
  sb.auth.getSession().then(({ data }) => {
    if (data.session && !recovering) location.replace("app.html");
  });

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("loginBtn");
    btn.disabled = true; btn.textContent = "Signing in…";
    const { data, error } = await sb.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value
    });
    if (error) {
      show($("msg"), "Incorrect email or password.");
      btn.disabled = false; btn.textContent = "Sign in";
      return;
    }
    const { data: prof } = await sb.from("profiles").select("active").eq("id", data.user.id).maybeSingle();
    if (!prof || !prof.active) {
      await sb.auth.signOut();
      show($("msg"), "This account is not active. Contact your Train Well administrator.");
      btn.disabled = false; btn.textContent = "Sign in";
      return;
    }
    location.replace("app.html");
  });

  $("forgotBtn").addEventListener("click", async () => {
    const email = $("email").value.trim();
    if (!email) { show($("msg"), "Type your email above first, then click “Forgot password?”."); return; }
    const redirectTo = location.href.split(/[?#]/)[0].replace(/[^/]*$/, "") + "index.html?setpw=1";
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) show($("msg"), error.message);
    else show($("msg"), "If that email has an account, a reset link is on its way.", "info");
  });

  $("resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { data: s } = await sb.auth.getSession();
    if (!s.session) { show($("resetMsg"), "This link has expired or was already used. Ask your administrator to send a new one, or use “Forgot password?”."); return; }
    const { error } = await sb.auth.updateUser({ password: $("newPassword").value });
    if (error) { show($("resetMsg"), error.message); return; }
    location.replace("app.html");
  });
})();
