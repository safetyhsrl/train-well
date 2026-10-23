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
  const FORMS = ["loginForm", "resetForm", "mfaSetupForm", "mfaCodeForm"];
  const only = (id) => FORMS.forEach((f) => $(f).classList.toggle("hidden", f !== id));
  // Password rule (matches the Supabase setting): 10+ characters with letters and numbers
  const pwProblem = (pw) => pw.length < 10 ? "Use at least 10 characters."
    : !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw) ? "Use both letters and numbers." : "";

  // Arriving from an invite or password-reset email: show "set your password"
  const params = new URLSearchParams(location.search);
  let recovering = params.has("setpw") || /type=(recovery|invite)/.test(location.hash);
  const showReset = () => { only("resetForm"); $("newPassword").focus(); };
  if (recovering) showReset();

  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") { recovering = true; showReset(); }
  });

  // ---- After the password: admins and managers also need their authenticator code
  let factorId = null;
  let pendingPassword = null;   // new password waiting until the code step is done
  async function continueSignIn() {
    const { data: u } = await sb.auth.getUser();
    if (!u.user) { only("loginForm"); return; }
    const { data: prof } = await sb.from("profiles").select("role, active").eq("id", u.user.id).maybeSingle();
    if (!prof || !prof.active) {
      await sb.auth.signOut();
      only("loginForm");
      show($("msg"), "This account is switched off. Ask your administrator to turn it back on.");
      return;
    }
    if (prof.role === "employee") { location.replace("app.html"); return; }

    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.currentLevel === "aal2") { location.replace("app.html"); return; }

    const { data: list, error } = await sb.auth.mfa.listFactors();
    if (error) throw error;
    const verified = (list.totp || []).find((f) => f.status === "verified");
    if (verified) {
      factorId = verified.id;
      only("mfaCodeForm"); $("mfaCode").value = ""; $("mfaCode").focus();
      return;
    }
    // First time: clear any half-finished setup, then show a fresh QR code
    for (const f of (list.all || []).filter((x) => x.status !== "verified")) await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data: en, error: enErr } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Train Well " + new Date().toISOString().slice(0, 10), issuer: "Train Well" });
    if (enErr) throw enErr;
    factorId = en.id;
    const img = new Image(); img.alt = ""; img.width = 184; img.height = 184; img.src = en.totp.qr_code;
    $("mfaQr").replaceChildren(img);
    $("mfaSecret").textContent = en.totp.secret.replace(/(.{4})/g, "$1 ").trim();
    only("mfaSetupForm"); $("mfaSetupCode").focus();
  }

  async function verifyCode(input, msg, btn) {
    hide(msg);
    const code = input.value.replace(/\D/g, "");
    if (code.length !== 6) { show(msg, "Type the 6 digits from your authenticator app."); input.focus(); return; }
    busy(btn, true);
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      busy(btn, false);
      show(msg, /invalid|expired|code/i.test(error.message)
        ? "That code didn't work. Codes change every 30 seconds, so type the one showing now."
        : error.message);
      input.select();
      return;
    }
    if (pendingPassword) {
      const { error: pwErr } = await sb.auth.updateUser({ password: pendingPassword });
      pendingPassword = null;
      if (pwErr) { busy(btn, false); show(msg, pwErr.message); return; }
    }
    location.replace("app.html");
  }
  $("mfaSetupForm").addEventListener("submit", (e) => { e.preventDefault(); verifyCode($("mfaSetupCode"), $("mfaSetupMsg"), $("mfaSetupBtn")); });
  $("mfaCodeForm").addEventListener("submit", (e) => { e.preventDefault(); verifyCode($("mfaCode"), $("mfaCodeMsg"), $("mfaCodeBtn")); });
  document.querySelectorAll(".code-input").forEach((inp) => inp.addEventListener("input", () => {
    inp.value = inp.value.replace(/\D/g, "").slice(0, 6);
    if (inp.value.length === 6) inp.form.requestSubmit();
  }));
  document.querySelectorAll("[data-signout]").forEach((b) => b.addEventListener("click", async () => {
    await sb.auth.signOut(); only("loginForm"); $("password").value = ""; $("password").focus();
  }));

  // Already signed in? Carry on (straight to the app, or to the code step).
  sb.auth.getSession().then(({ data }) => {
    if (data.session && !recovering) continueSignIn().catch((ex) => show($("msg"), ex.message));
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
    let captchaToken;
    try { captchaToken = await getCaptchaToken($("captcha")); }
    catch (ex) { busy(btn, false); show(msg, ex.message); return; }
    const { error } = await sb.auth.signInWithPassword({ email, password, options: { captchaToken } });
    if (error) {
      busy(btn, false);
      show(msg, /confirm/i.test(error.message)
        ? "This account hasn't been activated yet. Open the invite email and set your password first."
        : /captcha/i.test(error.message) ? "The security check didn't go through. Try signing in again."
        : /rate|too many/i.test(error.message) ? "Too many sign-in attempts. Wait a few minutes and try again."
        : "That email and password don't match. Check them and try again, or use “Forgot password?”.");
      $("password").select();
      return;
    }
    store.set($("remember").checked ? email : "");
    try { await continueSignIn(); }
    catch (ex) { show(msg, ex.message); }
    busy(btn, false);
  });

  // ---- Forgot password
  $("forgotBtn").addEventListener("click", async () => {
    const msg = $("msg");
    const email = $("email").value.trim();
    if (!email) { show(msg, "Type your email address above, then choose “Forgot password?” again.", "info"); $("email").focus(); return; }
    const redirectTo = location.href.split(/[?#]/)[0].replace(/[^/]*$/, "") + "index.html?setpw=1";
    let captchaToken;
    try { captchaToken = await getCaptchaToken($("captcha")); }
    catch (ex) { show(msg, ex.message); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo, captchaToken });
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
    const problem = pwProblem(pw);
    if (problem) { show(msg, problem); $("newPassword").focus(); return; }
    if (pw !== $("confirmPassword").value) { show(msg, "The two passwords don't match."); $("confirmPassword").focus(); return; }

    const btn = $("resetBtn"); busy(btn, true);
    const { data: s } = await sb.auth.getSession();
    if (!s.session) {
      busy(btn, false);
      show(msg, "This link has expired or was already used. Ask your administrator for a new one, or use “Forgot password?” on the sign-in page.");
      return;
    }
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error && /aal2|assurance|two|mfa/i.test(error.message)) {
      // Admins/managers confirm with their authenticator code first; the password is saved right after.
      pendingPassword = pw; recovering = false; busy(btn, false);
      try { await continueSignIn(); } catch (ex) { show(msg, ex.message); }
      return;
    }
    if (error) {
      busy(btn, false);
      show(msg, /pwned|leak|breach|known/i.test(error.message)
        ? "This password has shown up in a data leak somewhere else. Choose a different one."
        : /weak|characters|length/i.test(error.message) ? "Use at least 10 characters, with letters and numbers." : error.message);
      return;
    }
    recovering = false;
    try { await continueSignIn(); } catch (ex) { busy(btn, false); show(msg, ex.message); }
  });
})();
