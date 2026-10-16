// Login page logic
(function () {
  const $ = (id) => document.getElementById(id);
  const show = (el, text, kind = "error") => {
    el.textContent = text; el.className = "alert " + kind;
  };

  let recovering = location.hash.includes("type=recovery");

  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      recovering = true;
      $("loginForm").classList.add("hidden");
      $("resetForm").classList.remove("hidden");
    }
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
    const redirectTo = location.href.split("#")[0].replace(/[^/]*$/, "") + "index.html";
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) show($("msg"), error.message);
    else show($("msg"), "If that email has an account, a reset link is on its way.", "info");
  });

  $("resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: $("newPassword").value });
    if (error) { show($("resetMsg"), error.message); return; }
    location.replace("app.html");
  });
})();
