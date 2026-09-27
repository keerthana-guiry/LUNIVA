/* =========================================================
   Luniva — auth.js
   Account screens: sign up, log in, log out, onboarding and
   Settings (profile, preferences, export and delete data).
   Requires storage.js and app.js.

   Demo note: this is a single-user, browser-only prototype.
   Passwords are validated on the sign-up form but NEVER stored,
   and the login form only checks the email address.
   ========================================================= */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD_LENGTH = 8;

/* ---------------------------------------------------------
   FORM HELPERS
   (setFieldError / clearFieldError live in app.js)
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
  const existingNotice = document.getElementById("existing-profile-notice");

  setupPasswordToggles();
  clearErrorOnInput([nameInput, emailInput, passwordInput, confirmInput, agreeInput]);

  // If a profile already lives on this device, say so before it is replaced.
  const existingUser = getUser();
  if (existingUser && existingUser.email) {
    existingNotice.innerHTML =
      '<i class="bi bi-info-circle" aria-hidden="true"></i><span>A Luniva profile for <strong>' +
      escapeHtml(existingUser.email) + '</strong> already exists on this device. ' +
      'Creating a new one will replace it and its data. <a href="login.html">Log in instead</a>.</span>';
    existingNotice.classList.add("is-visible");
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const confirmPassword = confirmInput.value;
    let firstInvalid = null;

    function fail(input, message) {
      setFieldError(input, message);
      if (!firstInvalid) firstInvalid = input;
    }

    [nameInput, emailInput, passwordInput, confirmInput, agreeInput].forEach(clearFieldError);

    if (!name) fail(nameInput, "Please enter your name.");

    if (!email) fail(emailInput, "Please enter your email address.");
    else if (!EMAIL_PATTERN.test(email)) fail(emailInput, "Please enter a valid email, like name@example.com.");

    if (!password) fail(passwordInput, "Please create a password.");
    else if (password.length < MIN_PASSWORD_LENGTH) {
      fail(passwordInput, "Your password needs at least " + MIN_PASSWORD_LENGTH + " characters.");
    }

    if (!confirmPassword) fail(confirmInput, "Please confirm your password.");
    else if (password && confirmPassword !== password) fail(confirmInput, "Passwords don't match yet.");

    if (!agreeInput.checked) fail(agreeInput, "Please confirm you understand this before continuing.");

    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    // A new profile replaces any older one (single-user demo).
    if (existingUser) clearAllData();

    // Note: the password is intentionally NOT saved.
    saveData(STORAGE_KEYS.user, {
      name: name,
      email: email,
      heightCm: null,
      createdAt: todayString(),
      onboardingComplete: false
    });

    window.location.href = "onboarding.html";
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
  const forgotLink = document.getElementById("forgot-password");

  setupPasswordToggles();
  clearErrorOnInput([emailInput, passwordInput]);
  emailInput.addEventListener("input", function () { hideFormAlert(formAlert); });

  // Arriving from "Log out" (login.html?logout=1).
  const params = new URLSearchParams(window.location.search);
  if (params.get("logout") === "1") {
    logoutUser();
    window.history.replaceState(null, "", "login.html");
  }

  forgotLink.addEventListener("click", function (event) {
    event.preventDefault();
    showToast("Password reset will arrive with Luniva accounts. In this demo, only your email is checked.", "info");
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    hideFormAlert(formAlert);
    clearFieldError(emailInput);
    clearFieldError(passwordInput);

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    let firstInvalid = null;

    if (!email) {
      setFieldError(emailInput, "Please enter your email address.");
      firstInvalid = emailInput;
    } else if (!EMAIL_PATTERN.test(email)) {
      setFieldError(emailInput, "Please enter a valid email, like name@example.com.");
      firstInvalid = emailInput;
    }
    if (!password) {
      setFieldError(passwordInput, "Please enter your password.");
      firstInvalid = firstInvalid || passwordInput;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    const user = getUser();
    if (!user) {
      showFormAlert(formAlert, 'No Luniva profile was found on this device. <a href="signup.html">Create one</a> to get started.');
      return;
    }
    if (String(user.email).toLowerCase() !== email.toLowerCase()) {
      showFormAlert(formAlert, "That email doesn't match the Luniva profile on this device.");
      emailInput.focus();
      return;
    }

    window.location.href = user.onboardingComplete ? "dashboard.html" : "onboarding.html";
  });
}

/**
 * Log out. With no server session to end, this simply returns the
 * user to the login screen; their data stays on this device.
 */
function logoutUser() {
  showToast("You've logged out. Your data stays private on this device.", "info");
}

/* ---------------------------------------------------------
   ONBOARDING
   --------------------------------------------------------- */

const ONBOARDING_TOTAL_STEPS = 4;

function initOnboardingPage() {
  const user = getUser();
  if (!user) {
    window.location.replace("signup.html");
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
  document.getElementById("profile-email").value = user.email || "";
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
  const emailInput = document.getElementById("profile-email");
  const heightInput = document.getElementById("profile-height");
  [nameInput, emailInput, heightInput].forEach(clearFieldError);

  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const heightText = heightInput.value.trim();
  let firstInvalid = null;

  if (!name) {
    setFieldError(nameInput, "Please enter your name.");
    firstInvalid = nameInput;
  }
  if (!EMAIL_PATTERN.test(email)) {
    setFieldError(emailInput, "Please enter a valid email, like name@example.com.");
    firstInvalid = firstInvalid || emailInput;
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

  updateData(STORAGE_KEYS.user, { name: name, email: email, heightCm: heightCm });
  renderAppNav();   // the avatar initial and name may have changed
  showToast("Profile saved.", "success");
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
  clearErrorOnInput([
    document.getElementById("profile-name"),
    document.getElementById("profile-email"),
    document.getElementById("profile-height"),
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
    clearAllData();
    window.location.href = "index.html";
  });
}

/* ---------------------------------------------------------
   START-UP: run the code for whichever page is open
   --------------------------------------------------------- */

if (document.getElementById("signup-form")) initSignupPage();
if (document.getElementById("login-form")) initLoginPage();
if (document.getElementById("onboarding-form")) initOnboardingPage();
if (document.getElementById("settings-page") && APP_PAGE_ALLOWED) initSettingsPage();
