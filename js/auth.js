// Sign-in page logic
(function () {
  const $ = (id) => document.getElementById(id);
  const show = (el, text, kind = "error") => { el.textContent = text; el.className = "alert " + kind; };
  const hide = (el) => el.classList.add("hidden");
  const busy = (btn, on) => { btn.disabled = on; btn.classList.toggle("is-busy", on); };
  const REMEMBER_KEY = "trainwell.email";
  const store = {
    get() { try { return localStorage.getItem(REMEMBER_KEY) || ""; } catch (_) { return ""; } },
    set(v) { try { v ? localStorage.setItem(REMEMBER_KEY, v) : localStorage.removeItem(REMEMBER_KEY); } catch (_) { /* private mode */ } }
  };

  // Arriving from an invite or password-reset email: show "set your password"
  const params = new URLSearchParams(location.search);
  let recovering = params.has("setpw") || /type=(recovery|invite)/.test(location.hash);
  const showReset = () => {
    $("loginForm").classList.add("hidden");
    $("resetForm").classList.remove("hidden");
    $("newPassword").focus();
  };
  if (recovering) showReset();

  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") { recovering = true; showReset(); }
  });

  // Already signed in? Go straight to the app.
  sb.auth.getSession().then(({ data }) => {
    if (data.session && !recovering) location.replace("app.html");
  });

  // Remembered email
  const remembered = store.get();
  if (remembered) { $("email").value = remembered; $("remember").checked = true; }
  if (!recovering) (remembered ? $("password") : $("email")).focus();

  // Show / hide password
  document.querySelectorAll(".pw-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = $(btn.dataset.toggle);
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.textContent = showing ? "Show" : "Hide";
      btn.setAttribute("aria-pressed", String(!showing));
      btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
      input.focus();
    });
  });

  // Caps Lock warning
  document.querySelectorAll("[data-caps]").forEach((hint) => {
    const input = $(hint.dataset.caps);
    const check = (e) => { if (e.getModifierState) hint.classList.toggle("hidden", !e.getModifierState("CapsLock")); };
    input.addEventListener("keydown", check);
    input.addEventListener("keyup", check);
    input.addEventListener("blur", () => hint.classList.add("hidden"));
  });

  // ---- Sign in
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("msg"); hide(msg);
    const email = $("email").value.trim();
    const password = $("password").value;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { show(msg, "Enter the email address you sign in with."); $("email").focus(); return; }
    if (!password) { show(msg, "Enter your password."); $("password").focus(); return; }

    const btn = $("loginBtn"); busy(btn, true);
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      busy(btn, false);
      show(msg, /confirm/i.test(error.message)
        ? "This account hasn't been activated yet. Open the invite email and set your password first."
        : "That email and password don't match. Check them and try again, or use “Forgot password?”.");
      $("password").select();
      return;
    }
    const { data: prof } = await sb.from("profiles").select("active").eq("id", data.user.id).maybeSingle();
    if (!prof || !prof.active) {
      await sb.auth.signOut();
      busy(btn, false);
      show(msg, "This account is switched off. Ask your administrator to turn it back on.");
      return;
    }
    store.set($("remember").checked ? email : "");
    location.replace("app.html");
  });

  // ---- Forgot password
  $("forgotBtn").addEventListener("click", async () => {
    const msg = $("msg");
    const email = $("email").value.trim();
    if (!email) { show(msg, "Type your email address above, then choose “Forgot password?” again.", "info"); $("email").focus(); return; }
    const redirectTo = location.href.split(/[?#]/)[0].replace(/[^/]*$/, "") + "index.html?setpw=1";
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) show(msg, /rate|limit/i.test(error.message)
      ? "Too many reset emails were sent just now. Wait a few minutes and try again."
      : error.message);
    else show(msg, `If ${email} has an account, a reset link is on its way. Check your inbox and junk folder.`, "info");
  });

  // ---- Set a new password
  $("resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("resetMsg"); hide(msg);
    const pw = $("newPassword").value;
    if (pw.length < 8) { show(msg, "Use at least 8 characters."); $("newPassword").focus(); return; }
    if (pw !== $("confirmPassword").value) { show(msg, "The two passwords don't match."); $("confirmPassword").focus(); return; }

    const btn = $("resetBtn"); busy(btn, true);
    const { data: s } = await sb.auth.getSession();
    if (!s.session) {
      busy(btn, false);
      show(msg, "This link has expired or was already used. Ask your administrator for a new one, or use “Forgot password?” on the sign-in page.");
      return;
    }
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) { busy(btn, false); show(msg, error.message); return; }
    location.replace("app.html");
  });
})();
