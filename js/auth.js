/* =========================================================
   Luniva — auth.js
   Account screens: sign up (with email verification), log in
   (password, emailed login code, or Google), password reset,
   log out, onboarding, and Settings.
   Requires storage.js, app.js, config.js and the Supabase
   library (loaded from the CDN on the account pages).

   Supabase Auth sends the emails, checks the 6-digit codes and
   stores passwords securely on its servers. Passwords are never
   saved in this browser. Health data still lives only on this
   device (luniva_* keys).
   ========================================================= */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD_LENGTH = 8;
const OTP_PATTERN = /^\d{6}$/;
const RESEND_WAIT_SECONDS = 60;

/* ---------------------------------------------------------
   SUPABASE CLIENT
   --------------------------------------------------------- */

let authClient = null;

/** True when config.js has real Supabase details and the library loaded. */
function isAuthConfigured() {
  return typeof LUNIVA_CONFIG !== "undefined" &&
    !!LUNIVA_CONFIG.supabaseUrl && !!LUNIVA_CONFIG.supabaseAnonKey &&
    !!window.supabase && typeof window.supabase.createClient === "function";
}

/** The shared Supabase client, or null when accounts aren't set up yet. */
function getAuthClient() {
  if (authClient) return authClient;
  if (!isAuthConfigured()) return null;
  authClient = window.supabase.createClient(LUNIVA_CONFIG.supabaseUrl, LUNIVA_CONFIG.supabaseAnonKey, {
    auth: {
      storageKey: AUTH_STORAGE_KEY,   // keep the session under a luniva_ key
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,       // picks up the session after Google sign-in
      flowType: "implicit"
    }
  });
  return authClient;
}

/** Absolute URL of a page in this site (used for Google's redirect). */
function pageUrl(fileName) {
  const url = new URL(fileName, window.location.href);
  url.search = "";
  url.hash = "";
  return url.href;
}

/** Turn Supabase errors into calm, useful sentences. */
function friendlyAuthError(error) {
  const code = (error && error.code) || "";
  const message = (error && error.message) || "";
  const lower = message.toLowerCase();

  if (code === "invalid_credentials" || lower.indexOf("invalid login credentials") !== -1) {
    return "That email and password don't match. Try again, or use an emailed login code.";
  }
  if (code === "email_not_confirmed" || lower.indexOf("email not confirmed") !== -1) {
    return "Please verify your email first — we can send you a new code.";
  }
  if (code === "otp_expired" || lower.indexOf("expired") !== -1 || (lower.indexOf("invalid") !== -1 && lower.indexOf("token") !== -1)) {
    return "That code is wrong or has expired. Check your newest email, or send a new code.";
  }
  if (code === "otp_disabled" || code === "signup_disabled" || lower.indexOf("signups not allowed") !== -1) {
    return "No Luniva account uses that email yet.";
  }
  if (code.indexOf("rate_limit") !== -1 || lower.indexOf("rate limit") !== -1 || lower.indexOf("security purposes") !== -1) {
    return "Too many emails were requested. Please wait a minute and try again.";
  }
  if (code === "user_already_exists" || lower.indexOf("already registered") !== -1) {
    return "An account with this email already exists. Please log in instead.";
  }
  if (code === "weak_password" || lower.indexOf("password should") !== -1) {
    return "Please choose a stronger password (at least " + MIN_PASSWORD_LENGTH + " characters, mixing letters and numbers).";
  }
  if (code === "same_password") {
    return "Your new password must be different from the old one.";
  }
  if (lower.indexOf("failed to fetch") !== -1 || lower.indexOf("network") !== -1) {
    return "We can't reach Luniva right now. Please check your internet connection.";
  }
  return message ? "Something went wrong: " + message : "Something went wrong. Please try again.";
}

/* ---------------------------------------------------------
   SHARED FORM HELPERS
   (setFieldError / clearFieldError / showFormAlert live in app.js)
   --------------------------------------------------------- */

/** Wire every "show password" eye button on the page. */
function setupPasswordToggles() {
  document.querySelectorAll("[data-toggle-password]").forEach(function (button) {
    const input = document.getElementById(button.getAttribute("data-toggle-password"));
    button.addEventListener("click", function () {
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      button.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
      button.setAttribute("aria-pressed", String(isHidden));
      button.querySelector("i").className = isHidden ? "bi bi-eye-slash" : "bi bi-eye";
    });
  });
}

/** Disable a button and show a spinner while a request is running. */
function setBusy(button, isBusy, busyText) {
  if (isBusy) {
    button.setAttribute("data-label", button.innerHTML);
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> ' + escapeHtml(busyText || "Please wait…");
  } else {
    button.disabled = false;
    if (button.hasAttribute("data-label")) button.innerHTML = button.getAttribute("data-label");
  }
}

/** Check an email input; shows the error and returns false if invalid. */
function validateEmailInput(input) {
  clearFieldError(input);
  const email = input.value.trim();
  if (!email) {
    setFieldError(input, "Please enter your email address.");
  } else if (!EMAIL_PATTERN.test(email)) {
    setFieldError(input, "Please enter a valid email, like name@example.com.");
  } else {
    return true;
  }
  input.focus();
  return false;
}

/** Check a "new password + confirm" pair. */
function validateNewPassword(passwordInput, confirmInput) {
  [passwordInput, confirmInput].forEach(clearFieldError);
  const password = passwordInput.value;
  let firstInvalid = null;
  if (!password) {
    setFieldError(passwordInput, "Please create a password.");
    firstInvalid = passwordInput;
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    setFieldError(passwordInput, "Your password needs at least " + MIN_PASSWORD_LENGTH + " characters.");
    firstInvalid = passwordInput;
  }
  if (!confirmInput.value) {
    setFieldError(confirmInput, "Please confirm your password.");
    firstInvalid = firstInvalid || confirmInput;
  } else if (password && confirmInput.value !== password) {
    setFieldError(confirmInput, "Passwords don't match yet.");
    firstInvalid = firstInvalid || confirmInput;
  }
  if (firstInvalid) firstInvalid.focus();
  return !firstInvalid;
}

/** Show exactly one panel inside the auth card (form, code, switch…). */
function showAuthPanel(panelId) {
  document.querySelectorAll(".auth-panel").forEach(function (panel) {
    panel.hidden = panel.id !== panelId;
  });
  const heading = document.querySelector("#" + panelId + " h1");
  if (heading) heading.focus();
}

/** If accounts aren't configured, explain and disable the forms. */
function guardAuthConfigured(alertElement) {
  if (getAuthClient()) return true;
  showFormAlert(alertElement,
    "Luniva accounts aren't connected yet. Add your Supabase project details to <code>js/config.js</code> to turn on sign-up and login.");
  document.querySelectorAll(".auth-card button, .auth-card input").forEach(function (element) {
    element.disabled = true;
  });
  return false;
}

/**
 * Ask Supabase whether Google sign-in is switched on, so people see a
 * friendly message instead of a raw error page. If the check itself
 * fails (e.g. offline), we let the sign-in attempt continue.
 */
function isGoogleEnabled() {
  return fetch(LUNIVA_CONFIG.supabaseUrl + "/auth/v1/settings", {
    headers: { apikey: LUNIVA_CONFIG.supabaseAnonKey }
  })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (settings) {
      return !(settings && settings.external && settings.external.google === false);
    })
    .catch(function () { return true; });
}

/** Start Google sign-in. Google sends the user back to login.html. */
function startGoogleSignIn(button, alertElement) {
  const client = getAuthClient();
  if (!client) return;
  setBusy(button, true, "Opening Google…");
  isGoogleEnabled().then(function (enabled) {
    if (enabled) return openGoogleSignIn(client, button, alertElement);
    setBusy(button, false);
    showFormAlert(alertElement, "Google sign-in isn't available yet. Please use your email and password, or an emailed login code.");
  });
}

function openGoogleSignIn(client, button, alertElement) {
  return client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: pageUrl("login.html") }
  }).then(function (result) {
    if (result.error) {
      setBusy(button, false);
      showFormAlert(alertElement, escapeHtml(friendlyAuthError(result.error)));
    }
    // On success the browser leaves this page for Google.
  });
}

/* ---------------------------------------------------------
   AFTER SIGN-IN: CONNECT THE ACCOUNT TO THIS DEVICE
   --------------------------------------------------------- */

/** Does this device already hold data for a DIFFERENT account? */
function isDifferentAccount(authUser) {
  const existing = getUser();
  if (!existing) return false;
  if (existing.id) return existing.id !== authUser.id;
  return String(existing.email || "").toLowerCase() !== String(authUser.email || "").toLowerCase();
}

/**
 * Create or update the local profile (luniva_user) for the signed-in
 * account. Data from the same account is kept.
 */
function saveProfileFromAuthUser(authUser) {
  const existing = getUser();
  const meta = authUser.user_metadata || {};
  const base = existing && !isDifferentAccount(authUser) ? existing : {};
  const profile = {
    id: authUser.id,
    name: base.name || meta.name || meta.full_name || String(authUser.email).split("@")[0],
    email: authUser.email,
    heightCm: typeof base.heightCm === "number" ? base.heightCm : null,
    createdAt: base.createdAt || todayString(),
    onboardingComplete: base.onboardingComplete === true
  };
  saveData(STORAGE_KEYS.user, profile);
  return profile;
}

function goToApp(profile) {
  window.location.href = profile.onboardingComplete ? "dashboard.html" : "onboarding.html";
}

/**
 * Finish signing in. If this device holds another account's data,
 * ask before replacing it (health data only lives on this device).
 */
function finishSignIn(authUser) {
  if (!isDifferentAccount(authUser)) {
    goToApp(saveProfileFromAuthUser(authUser));
    return;
  }

  const oldUser = getUser();
  document.getElementById("switch-old-email").textContent = oldUser.email || "another account";
  document.getElementById("switch-new-email").textContent = authUser.email;
  showAuthPanel("switch-panel");

  document.getElementById("switch-confirm").onclick = function () {
    clearUserData();
    goToApp(saveProfileFromAuthUser(authUser));
  };
  document.getElementById("switch-cancel").onclick = function () {
    getAuthClient().auth.signOut().finally(function () {
      deleteData(AUTH_STORAGE_KEY);
      window.location.replace("login.html");
    });
  };
}

/* ---------------------------------------------------------
   6-DIGIT EMAIL CODE STEP
   Used for: verifying a new account ("signup"), logging in
   with a code ("email"), and resetting a password ("recovery").
   --------------------------------------------------------- */

const OTP_TEXT = {
  signup: {
    title: "Verify your email",
    intro: "We sent a 6-digit code to",
    button: "Verify & continue"
  },
  email: {
    title: "Enter your login code",
    intro: "We sent a 6-digit login code to",
    button: "Log in"
  },
  recovery: {
    title: "Reset your password",
    intro: "We sent a 6-digit reset code to",
    button: "Save new password"
  }
};

let otpState = { email: "", type: "signup", timer: null };

/** Ask Supabase to email a fresh code of the current type. */
function requestCode(email, type) {
  const auth = getAuthClient().auth;
  if (type === "signup") return auth.resend({ type: "signup", email: email });
  if (type === "recovery") return auth.resetPasswordForEmail(email, { redirectTo: pageUrl("login.html") });
  return auth.signInWithOtp({ email: email, options: { shouldCreateUser: false } });
}

/** Count down before "Resend code" can be used again. */
function startResendTimer() {
  const resendButton = document.getElementById("otp-resend");
  const timerText = document.getElementById("otp-timer");
  let secondsLeft = RESEND_WAIT_SECONDS;
  clearInterval(otpState.timer);
  resendButton.disabled = true;
  timerText.textContent = "You can resend in " + secondsLeft + "s";
  otpState.timer = setInterval(function () {
    secondsLeft--;
    if (secondsLeft <= 0) {
      clearInterval(otpState.timer);
      resendButton.disabled = false;
      timerText.textContent = "Didn't get it? Check spam, or resend.";
    } else {
      timerText.textContent = "You can resend in " + secondsLeft + "s";
    }
  }, 1000);
}

/** Switch the card to the code step for `email`. */
function showOtpStep(email, type) {
  otpState.email = email;
  otpState.type = type;
  const text = OTP_TEXT[type];

  document.getElementById("otp-title").textContent = text.title;
  document.getElementById("otp-intro").textContent = text.intro;
  document.getElementById("otp-email").textContent = email;
  document.getElementById("otp-submit").innerHTML = escapeHtml(text.button) + ' <i class="bi bi-arrow-right" aria-hidden="true"></i>';
  document.getElementById("otp-new-password").hidden = type !== "recovery";
  document.getElementById("otp-code").value = "";
  hideFormAlert(document.getElementById("otp-alert"));
  ["otp-code", "otp-password", "otp-confirm"].forEach(function (id) { clearFieldError(document.getElementById(id)); });

  showAuthPanel("otp-panel");
  startResendTimer();
  document.getElementById("otp-code").focus();
}

/** Wire the code form once per page. */
function setupOtpStep(backPanelId) {
  const form = document.getElementById("otp-form");
  const codeInput = document.getElementById("otp-code");
  const alertBox = document.getElementById("otp-alert");
  const submitButton = document.getElementById("otp-submit");

  // Keep only digits, max 6.
  codeInput.addEventListener("input", function () {
    codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6);
    clearFieldError(codeInput);
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    hideFormAlert(alertBox);
    const code = codeInput.value.trim();
    clearFieldError(codeInput);
    if (!OTP_PATTERN.test(code)) {
      setFieldError(codeInput, "Enter the 6-digit code from your email.");
      codeInput.focus();
      return;
    }

    const isRecovery = otpState.type === "recovery";
    const passwordInput = document.getElementById("otp-password");
    const confirmInput = document.getElementById("otp-confirm");
    if (isRecovery && !validateNewPassword(passwordInput, confirmInput)) return;

    setBusy(submitButton, true, "Checking…");
    const auth = getAuthClient().auth;
    auth.verifyOtp({ email: otpState.email, token: code, type: otpState.type })
      .then(function (result) {
        if (result.error) throw result.error;
        if (!isRecovery) return result.data.user;
        // A recovery code signs the user in; now save the new password.
        return auth.updateUser({ password: passwordInput.value }).then(function (update) {
          if (update.error) throw update.error;
          showToast("Your password has been updated 🌷", "success");
          return update.data.user || result.data.user;
        });
      })
      .then(function (user) {
        clearInterval(otpState.timer);
        finishSignIn(user);
      })
      .catch(function (error) {
        setBusy(submitButton, false);
        showFormAlert(alertBox, escapeHtml(friendlyAuthError(error)));
      });
  });

  document.getElementById("otp-resend").addEventListener("click", function () {
    const button = document.getElementById("otp-resend");
    hideFormAlert(alertBox);
    button.disabled = true;
    requestCode(otpState.email, otpState.type).then(function (result) {
      if (result.error) {
        button.disabled = false;
        showFormAlert(alertBox, escapeHtml(friendlyAuthError(result.error)));
        return;
      }
      showToast("A new code is on its way to " + otpState.email + ".", "info");
      startResendTimer();
    }).catch(function (error) {
      button.disabled = false;
      showFormAlert(alertBox, escapeHtml(friendlyAuthError(error)));
    });
  });

  document.getElementById("otp-back").addEventListener("click", function () {
    clearInterval(otpState.timer);
    showAuthPanel(backPanelId);
  });

  ["otp-password", "otp-confirm"].forEach(function (id) {
    const input = document.getElementById(id);
    input.addEventListener("input", function () { clearFieldError(input); });
  });
}

/* ---------------------------------------------------------
   SIGN UP
   --------------------------------------------------------- */

function initSignupPage() {
  const form = document.getElementById("signup-form");
  const nameInput = document.getElementById("signup-name");
  const emailInput = document.getElementById("signup-email");
  const passwordInput = document.getElementById("signup-password");
  const confirmInput = document.getElementById("signup-confirm");
  const agreeInput = document.getElementById("signup-agree");
  const formAlert = document.getElementById("signup-alert");
  const submitButton = form.querySelector('button[type="submit"]');

  setupPasswordToggles();
  clearErrorOnInput([nameInput, emailInput, passwordInput, confirmInput, agreeInput]);
  if (!guardAuthConfigured(formAlert)) return;
  setupOtpStep("signup-panel");

  // Already signed in? Go straight to the app.
  getAuthClient().auth.getSession().then(function (result) {
    if (result.data && result.data.session) finishSignIn(result.data.session.user);
  });

  document.getElementById("google-button").addEventListener("click", function () {
    if (!agreeInput.checked) {
      setFieldError(agreeInput, "Please confirm you understand this before continuing.");
      agreeInput.focus();
      return;
    }
    startGoogleSignIn(document.getElementById("google-button"), formAlert);
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    hideFormAlert(formAlert);
    [nameInput, agreeInput].forEach(clearFieldError);

    const name = nameInput.value.trim();
    let valid = true;
    if (!name) {
      setFieldError(nameInput, "Please enter your name.");
      nameInput.focus();
      valid = false;
    }
    if (valid && !validateEmailInput(emailInput)) valid = false;
    if (valid && !validateNewPassword(passwordInput, confirmInput)) valid = false;
    if (valid && !agreeInput.checked) {
      setFieldError(agreeInput, "Please confirm you understand this before continuing.");
      agreeInput.focus();
      valid = false;
    }
    if (!valid) return;

    const email = emailInput.value.trim();
    setBusy(submitButton, true, "Creating your Luniva…");

    // Supabase stores the password securely and emails a 6-digit code.
    getAuthClient().auth.signUp({
      email: email,
      password: passwordInput.value,
      options: { data: { name: name }, emailRedirectTo: pageUrl("login.html") }
    }).then(function (result) {
      setBusy(submitButton, false);
      if (result.error) {
        showFormAlert(formAlert, escapeHtml(friendlyAuthError(result.error)));
        return;
      }
      const user = result.data.user;
      // Supabase hides whether an email is taken: an existing, verified
      // address comes back with no identities.
      if (user && Array.isArray(user.identities) && user.identities.length === 0) {
        showFormAlert(formAlert, 'An account with this email already exists. <a href="login.html">Log in instead</a>.');
        return;
      }
      // If email confirmation is switched off in Supabase, we're already in.
      if (result.data.session) {
        finishSignIn(result.data.session.user);
        return;
      }
      showOtpStep(email, "signup");
    }).catch(function (error) {
      setBusy(submitButton, false);
      showFormAlert(formAlert, escapeHtml(friendlyAuthError(error)));
    });
  });
}

/* ---------------------------------------------------------
   LOG IN / LOG OUT
   --------------------------------------------------------- */

function initLoginPage() {
  const form = document.getElementById("login-form");
  const emailInput = document.getElementById("login-email");
  const passwordInput = document.getElementById("login-password");
  const formAlert = document.getElementById("login-alert");
  const submitButton = form.querySelector('button[type="submit"]');
  const codeButton = document.getElementById("login-code-button");

  setupPasswordToggles();
  clearErrorOnInput([emailInput, passwordInput]);
  emailInput.addEventListener("input", function () { hideFormAlert(formAlert); });
  if (!guardAuthConfigured(formAlert)) return;
  setupOtpStep("login-panel");

  const client = getAuthClient();
  const params = new URLSearchParams(window.location.search);

  // Errors sent back by Google / Supabase in the URL (e.g. #error_description=…).
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const urlError = hashParams.get("error_description") || params.get("error_description");
  if (urlError) {
    showFormAlert(formAlert, escapeHtml(friendlyAuthError({ message: urlError })));
    window.history.replaceState(null, "", "login.html");
  }

  // Arriving from "Log out" (login.html?logout=1): end the session first.
  const ready = params.get("logout") === "1"
    ? logoutUser().then(function () { window.history.replaceState(null, "", "login.html"); })
    : Promise.resolve();

  // Already signed in (or just back from Google)? Continue to the app.
  ready.then(function () { return client.auth.getSession(); }).then(function (result) {
    if (result && result.data && result.data.session) finishSignIn(result.data.session.user);
  });

  document.getElementById("google-button").addEventListener("click", function () {
    startGoogleSignIn(document.getElementById("google-button"), formAlert);
  });

  // Log in with email + password.
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    hideFormAlert(formAlert);
    clearFieldError(passwordInput);
    if (!validateEmailInput(emailInput)) return;
    if (!passwordInput.value) {
      setFieldError(passwordInput, "Please enter your password.");
      passwordInput.focus();
      return;
    }

    const email = emailInput.value.trim();
    setBusy(submitButton, true, "Logging in…");
    client.auth.signInWithPassword({ email: email, password: passwordInput.value }).then(function (result) {
      if (!result.error) {
        finishSignIn(result.data.user);
        return;
      }
      setBusy(submitButton, false);
      const notVerified = result.error.code === "email_not_confirmed" ||
        String(result.error.message).toLowerCase().indexOf("email not confirmed") !== -1;
      if (notVerified) {
        // Send a fresh verification code and ask for it.
        requestCode(email, "signup").then(function () { showOtpStep(email, "signup"); });
        return;
      }
      showFormAlert(formAlert, escapeHtml(friendlyAuthError(result.error)));
    }).catch(function (error) {
      setBusy(submitButton, false);
      showFormAlert(formAlert, escapeHtml(friendlyAuthError(error)));
    });
  });

  // Log in with a 6-digit code instead of a password.
  codeButton.addEventListener("click", function () {
    hideFormAlert(formAlert);
    if (!validateEmailInput(emailInput)) return;
    const email = emailInput.value.trim();
    setBusy(codeButton, true, "Sending code…");
    requestCode(email, "email").then(function (result) {
      setBusy(codeButton, false);
      if (result.error) {
        let message = escapeHtml(friendlyAuthError(result.error));
        if (message.indexOf("No Luniva account") === 0) message += ' <a href="signup.html">Create one</a>.';
        showFormAlert(formAlert, message);
        return;
      }
      showOtpStep(email, "email");
    }).catch(function (error) {
      setBusy(codeButton, false);
      showFormAlert(formAlert, escapeHtml(friendlyAuthError(error)));
    });
  });

  // Forgot password: email a reset code, then set a new password.
  document.getElementById("forgot-password").addEventListener("click", function (event) {
    event.preventDefault();
    hideFormAlert(formAlert);
    if (!validateEmailInput(emailInput)) {
      showToast("Enter your email first, then tap “Forgot password?”.", "info");
      return;
    }
    const email = emailInput.value.trim();
    requestCode(email, "recovery").then(function (result) {
      if (result.error) {
        showFormAlert(formAlert, escapeHtml(friendlyAuthError(result.error)));
        return;
      }
      showOtpStep(email, "recovery");
    }).catch(function (error) {
      showFormAlert(formAlert, escapeHtml(friendlyAuthError(error)));
    });
  });
}

/**
 * Log out: end the Supabase session. Health data stays on this
 * device so the same person can log back in and continue.
 */
function logoutUser() {
  const client = getAuthClient();
  const signOut = client ? client.auth.signOut() : Promise.resolve();
  return signOut
    .catch(function () { /* offline: still clear the local session below */ })
    .then(function () {
      deleteData(AUTH_STORAGE_KEY);
      showToast("You've logged out. Your data stays private on this device.", "info");
    });
}

/* ---------------------------------------------------------
   ONBOARDING
   --------------------------------------------------------- */

const ONBOARDING_TOTAL_STEPS = 4;

function initOnboardingPage() {
  const user = getUser();
  if (!user || !hasAuthSession()) {
    window.location.replace("login.html");
    return;
  }
  if (user.onboardingComplete) {
    window.location.replace("dashboard.html");
    return;
  }

  const form = document.getElementById("onboarding-form");
  const steps = Array.prototype.slice.call(document.querySelectorAll(".onboarding-step"));
  const backButton = document.getElementById("onboarding-back");
  const nextButton = document.getElementById("onboarding-next");
  const actions = document.getElementById("onboarding-actions");
  const progress = document.getElementById("onboarding-progress");
  const progressFill = document.getElementById("progress-fill");
  const stepLabel = document.getElementById("step-label");
  const stepName = document.getElementById("step-name");

  const nameInput = document.getElementById("ob-name");
  const lastStartInput = document.getElementById("ob-last-start");
  const cycleInput = document.getElementById("ob-cycle-length");
  const periodInput = document.getElementById("ob-period-length");
  const padToggle = document.getElementById("remind-pad");
  const padDayInputs = document.querySelectorAll('input[name="pad-days"]');

  const STEP_NAMES = ["Your name", "Your cycle", "What to track", "Reminders"];
  let currentStep = 1;

  // Pre-fill from sign-up and sensible defaults.
  nameInput.value = user.name || "";
  lastStartInput.max = todayString();
  cycleInput.value = DEFAULT_SETTINGS.cycleLength;
  periodInput.value = DEFAULT_SETTINGS.periodLength;

  clearErrorOnInput([nameInput, lastStartInput, cycleInput, periodInput]);

  // The 1/2/3-days choice only makes sense when the pad reminder is on.
  function syncPadDays() {
    padDayInputs.forEach(function (input) { input.disabled = !padToggle.checked; });
  }
  padToggle.addEventListener("change", syncPadDays);
  syncPadDays();

  /** Show one step, update the progress bar and move focus to its heading. */
  function showStep(stepNumber, moveFocus) {
    currentStep = stepNumber;
    steps.forEach(function (step) {
      const isCurrent = Number(step.getAttribute("data-step")) === stepNumber;
      step.classList.toggle("is-active", isCurrent);
      step.hidden = !isCurrent;
    });

    const isFinish = stepNumber > ONBOARDING_TOTAL_STEPS;
    progress.hidden = isFinish;
    actions.hidden = isFinish;

    if (!isFinish) {
      const percent = (stepNumber / ONBOARDING_TOTAL_STEPS) * 100;
      progressFill.style.width = percent + "%";
      progress.querySelector(".progress-track").setAttribute("aria-valuenow", String(stepNumber));
      stepLabel.textContent = "Step " + stepNumber + " of " + ONBOARDING_TOTAL_STEPS;
      stepName.textContent = STEP_NAMES[stepNumber - 1];
      backButton.hidden = stepNumber === 1;
      nextButton.innerHTML = stepNumber === ONBOARDING_TOTAL_STEPS
        ? 'Finish <i class="bi bi-check2" aria-hidden="true"></i>'
        : 'Next <i class="bi bi-arrow-right" aria-hidden="true"></i>';
    }

    if (moveFocus) {
      const heading = document.querySelector('.onboarding-step[data-step="' + stepNumber + '"] h1');
      if (heading) heading.focus();
    }
  }

  /** Validate the current step. Returns true when it is OK to continue. */
  function validateStep(stepNumber) {
    if (stepNumber === 1) {
      clearFieldError(nameInput);
      if (!nameInput.value.trim()) {
        setFieldError(nameInput, "Please tell us what to call you.");
        nameInput.focus();
        return false;
      }
    }

    if (stepNumber === 2) {
      let firstInvalid = null;
      [lastStartInput, cycleInput, periodInput].forEach(clearFieldError);

      const lastStart = lastStartInput.value;
      if (!lastStart) {
        setFieldError(lastStartInput, "Please choose the date your last period started.");
        firstInvalid = lastStartInput;
      } else if (!isValidDateString(lastStart)) {
        setFieldError(lastStartInput, "Please choose a valid date.");
        firstInvalid = lastStartInput;
      } else if (lastStart > todayString()) {
        setFieldError(lastStartInput, "This date can't be in the future.");
        firstInvalid = lastStartInput;
      }

      const cycleLength = Number(cycleInput.value);
      if (!Number.isInteger(cycleLength) || cycleLength < CYCLE_LENGTH_MIN || cycleLength > CYCLE_LENGTH_MAX) {
        setFieldError(cycleInput, "Enter a whole number between " + CYCLE_LENGTH_MIN + " and " + CYCLE_LENGTH_MAX + ".");
        firstInvalid = firstInvalid || cycleInput;
      }

      const periodLength = Number(periodInput.value);
      if (!Number.isInteger(periodLength) || periodLength < PERIOD_LENGTH_MIN || periodLength > PERIOD_LENGTH_MAX) {
        setFieldError(periodInput, "Enter a whole number between " + PERIOD_LENGTH_MIN + " and " + PERIOD_LENGTH_MAX + ".");
        firstInvalid = firstInvalid || periodInput;
      }

      if (firstInvalid) {
        firstInvalid.focus();
        return false;
      }
    }
    return true;
  }

  /** Read a checkbox by id. */
  function isChecked(id) {
    return document.getElementById(id).checked;
  }

  /** Save everything collected during onboarding (Section 11 → "On finish"). */
  function saveOnboarding() {
    const selectedPadDays = document.querySelector('input[name="pad-days"]:checked');

    saveData(STORAGE_KEYS.settings, {
      cycleLength: Number(cycleInput.value),
      periodLength: Number(periodInput.value),
      padReminderDays: selectedPadDays ? Number(selectedPadDays.value) : DEFAULT_SETTINGS.padReminderDays,
      trackWeight: isChecked("track-weight"),
      tracking: {
        pain: isChecked("track-pain"),
        flow: isChecked("track-flow"),
        sleep: isChecked("track-sleep"),
        mood: isChecked("track-mood"),
        cravings: isChecked("track-cravings"),
        symptoms: isChecked("track-symptoms")
      },
      notifications: {
        period: isChecked("remind-period"),
        pad: isChecked("remind-pad"),
        checkin: isChecked("remind-checkin"),
        sleep: isChecked("remind-sleep"),
        motivation: isChecked("remind-motivation"),
        companion: isChecked("remind-companion")
      }
    });

    // Record the last period start as an ACTIVE period. Luniva never
    // assumes it has ended — the user confirms the end date later.
    const lastStart = lastStartInput.value;
    const periods = getPeriods();
    const alreadySaved = periods.some(function (period) { return period.startDate === lastStart; });
    if (!alreadySaved) {
      periods.push({ id: generateId(), startDate: lastStart, endDate: null, status: "active" });
      savePeriods(periods);
    }

    updateData(STORAGE_KEYS.user, { name: nameInput.value.trim(), onboardingComplete: true });
  }

  /** Fill the finish screen with numbers computed from the saved data. */
  function renderFinishSummary() {
    const name = nameInput.value.trim();
    document.getElementById("finish-name").textContent = name;

    const cycleDay = getCycleDay();
    const daysUntil = getDaysUntilNextPeriod();
    const nextStart = getNextPredictedStart();

    document.getElementById("finish-cycle-day").textContent = cycleDay !== null ? cycleDay : "—";
    document.getElementById("finish-cycle-length").textContent = getAverageCycleLength().value;
    document.getElementById("finish-next").textContent = nextStart ? formatDisplayDate(nextStart, { withWeekday: true }) : "—";

    const note = document.getElementById("finish-note");
    if (daysUntil !== null && daysUntil < 0) {
      note.textContent = "Your last recorded start was a while ago — you can add newer dates in the Period Tracker.";
    } else {
      note.textContent = "These numbers will become more personal as you log more cycles.";
    }
  }

  backButton.addEventListener("click", function () {
    if (currentStep > 1) showStep(currentStep - 1, true);
  });

  // The form's submit (Next button or Enter key) moves forward one step.
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!validateStep(currentStep)) return;

    if (currentStep < ONBOARDING_TOTAL_STEPS) {
      showStep(currentStep + 1, true);
      return;
    }

    saveOnboarding();
    renderFinishSummary();
    showStep(ONBOARDING_TOTAL_STEPS + 1, true);
  });

  showStep(1, false);
}

/* ---------------------------------------------------------
   SETTINGS
   --------------------------------------------------------- */

/** Save a partial settings object merged over the current settings. */
function saveSettings(partial) {
  const merged = Object.assign({}, getSettings(), partial);
  saveData(STORAGE_KEYS.settings, merged);
  return merged;
}

function fillSettingsForms() {
  const user = getUser() || {};
  const settings = getSettings();

  document.getElementById("profile-name").value = user.name || "";
  document.getElementById("profile-email").value = user.email || "";   // read-only: it's the login
  document.getElementById("profile-height").value = typeof user.heightCm === "number" ? user.heightCm : "";

  document.getElementById("settings-cycle-length").value = settings.cycleLength;
  document.getElementById("settings-period-length").value = settings.periodLength;
  const padInput = document.getElementById("settings-pad-" + settings.padReminderDays);
  if (padInput) padInput.checked = true;

  // Explain which numbers the predictions use right now.
  const cycle = getAverageCycleLength();
  const period = getAveragePeriodLength();
  const notes = [];
  if (cycle.fromHistory) notes.push("Predictions use your recorded average cycle (" + roundOne(cycle.value) + " days).");
  if (period.fromHistory) notes.push("Your recorded average period is " + roundOne(period.value) + " days.");
  document.getElementById("cycle-settings-note").textContent = notes.length
    ? notes.join(" ") + " These settings are used until there's enough history."
    : "Used for predictions until you've logged enough periods.";

  document.getElementById("setting-trackWeight").checked = settings.trackWeight;
  document.querySelectorAll("[data-tracking-key]").forEach(function (input) {
    input.checked = settings.tracking[input.getAttribute("data-tracking-key")] !== false;
  });
  document.querySelectorAll("[data-notification-key]").forEach(function (input) {
    input.checked = settings.notifications[input.getAttribute("data-notification-key")] === true;
  });
}

function saveProfileForm() {
  const nameInput = document.getElementById("profile-name");
  const heightInput = document.getElementById("profile-height");
  [nameInput, heightInput].forEach(clearFieldError);

  const name = nameInput.value.trim();
  const heightText = heightInput.value.trim();
  let firstInvalid = null;

  if (!name) {
    setFieldError(nameInput, "Please enter your name.");
    firstInvalid = nameInput;
  }
  let heightCm = null;
  if (heightText !== "") {
    heightCm = Number(heightText);
    if (isNaN(heightCm) || heightCm < 50 || heightCm > 250) {
      setFieldError(heightInput, "Enter a height between 50 and 250 cm, or leave it empty.");
      firstInvalid = firstInvalid || heightInput;
    } else {
      heightCm = Math.round(heightCm * 10) / 10;
    }
  }
  if (firstInvalid) {
    firstInvalid.focus();
    return;
  }

  // The email is the login and is managed by Supabase, so only these change.
  updateData(STORAGE_KEYS.user, { name: name, heightCm: heightCm });
  renderAppNav();   // the avatar initial and name may have changed
  showToast("Profile saved.", "success");
}

/** Change the account password (the user is already signed in). */
function savePasswordForm() {
  const passwordInput = document.getElementById("new-password");
  const confirmInput = document.getElementById("new-password-confirm");
  const button = document.querySelector('#password-form button[type="submit"]');
  const alertBox = document.getElementById("password-alert");
  hideFormAlert(alertBox);
  if (!validateNewPassword(passwordInput, confirmInput)) return;

  const client = getAuthClient();
  if (!client) {
    showFormAlert(alertBox, "Accounts aren't connected yet (see js/config.js).");
    return;
  }
  setBusy(button, true, "Saving…");
  client.auth.updateUser({ password: passwordInput.value }).then(function (result) {
    setBusy(button, false);
    if (result.error) {
      showFormAlert(alertBox, escapeHtml(friendlyAuthError(result.error)));
      return;
    }
    passwordInput.value = "";
    confirmInput.value = "";
    showToast("Your password has been changed.", "success");
  }).catch(function (error) {
    setBusy(button, false);
    showFormAlert(alertBox, escapeHtml(friendlyAuthError(error)));
  });
}

function saveCycleForm() {
  const cycleInput = document.getElementById("settings-cycle-length");
  const periodInput = document.getElementById("settings-period-length");
  [cycleInput, periodInput].forEach(clearFieldError);

  const cycleLength = Number(cycleInput.value);
  const periodLength = Number(periodInput.value);
  let firstInvalid = null;

  if (!Number.isInteger(cycleLength) || cycleLength < CYCLE_LENGTH_MIN || cycleLength > CYCLE_LENGTH_MAX) {
    setFieldError(cycleInput, "Enter a whole number between " + CYCLE_LENGTH_MIN + " and " + CYCLE_LENGTH_MAX + ".");
    firstInvalid = cycleInput;
  }
  if (!Number.isInteger(periodLength) || periodLength < PERIOD_LENGTH_MIN || periodLength > PERIOD_LENGTH_MAX) {
    setFieldError(periodInput, "Enter a whole number between " + PERIOD_LENGTH_MIN + " and " + PERIOD_LENGTH_MAX + ".");
    firstInvalid = firstInvalid || periodInput;
  }
  if (firstInvalid) {
    firstInvalid.focus();
    return;
  }

  const padChoice = document.querySelector('input[name="settings-pad-days"]:checked');
  saveSettings({
    cycleLength: cycleLength,
    periodLength: periodLength,
    padReminderDays: padChoice ? Number(padChoice.value) : DEFAULT_SETTINGS.padReminderDays
  });
  showToast("Cycle settings saved.", "success");
}

/** Download every luniva_* key as a .json file, built in the browser with a Blob. */
function exportAllData() {
  const exportObject = {
    exportedAt: new Date().toString(),
    app: "Luniva",
    data: getAllData()
  };
  const blob = new Blob([JSON.stringify(exportObject, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "luniva-data-" + todayString() + ".json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  showToast("Your data file is downloading.", "success");
}

function initSettingsPage() {
  fillSettingsForms();

  document.getElementById("profile-form").addEventListener("submit", function (event) {
    event.preventDefault();
    saveProfileForm();
  });
  document.getElementById("cycle-form").addEventListener("submit", function (event) {
    event.preventDefault();
    saveCycleForm();
  });
  document.getElementById("password-form").addEventListener("submit", function (event) {
    event.preventDefault();
    savePasswordForm();
  });
  setupPasswordToggles();
  clearErrorOnInput([
    document.getElementById("profile-name"),
    document.getElementById("profile-height"),
    document.getElementById("new-password"),
    document.getElementById("new-password-confirm"),
    document.getElementById("settings-cycle-length"),
    document.getElementById("settings-period-length")
  ]);

  // Toggles save as soon as they change.
  document.getElementById("setting-trackWeight").addEventListener("change", function (event) {
    saveSettings({ trackWeight: event.target.checked });
    showToast(event.target.checked ? "Weight tracking is on." : "Weight tracking is off.", "info");
  });
  document.querySelectorAll("[data-tracking-key]").forEach(function (input) {
    input.addEventListener("change", function () {
      const tracking = getSettings().tracking;
      tracking[input.getAttribute("data-tracking-key")] = input.checked;
      saveSettings({ tracking: tracking });
      showToast("Tracking preferences saved.", "info");
    });
  });
  document.querySelectorAll("[data-notification-key]").forEach(function (input) {
    input.addEventListener("change", function () {
      const notifications = getSettings().notifications;
      notifications[input.getAttribute("data-notification-key")] = input.checked;
      saveSettings({ notifications: notifications });
      showToast("Notification preferences saved.", "info");
    });
  });

  document.getElementById("export-data").addEventListener("click", exportAllData);
  document.getElementById("confirm-delete-data").addEventListener("click", function () {
    const button = document.getElementById("confirm-delete-data");
    setBusy(button, true, "Deleting…");
    // Sign out of the account, then remove every luniva_* key (incl. the session).
    const client = getAuthClient();
    const signOut = client ? client.auth.signOut().catch(function () {}) : Promise.resolve();
    signOut.then(function () {
      clearAllData();
      window.location.href = "index.html";
    });
  });
}

/* ---------------------------------------------------------
   START-UP: run the code for whichever page is open
   --------------------------------------------------------- */

if (document.getElementById("signup-form")) initSignupPage();
if (document.getElementById("login-form")) initLoginPage();
if (document.getElementById("onboarding-form")) initOnboardingPage();
if (document.getElementById("settings-page") && APP_PAGE_ALLOWED) initSettingsPage();
