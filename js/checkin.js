/* =========================================================
   Luniva — checkin.js
   Daily Check-in page. Reads and writes luniva_dailyLogs[date]
   through saveDailyLog() in app.js — the single source of truth
   for flow, pain, mood, sleep and cravings.
   Requires storage.js and app.js.
   ========================================================= */

// Which option list fills each group on the page.
const SINGLE_CHOICE_GROUPS = {
  mood: MOOD_OPTIONS,
  energy: ENERGY_OPTIONS,
  flow: FLOW_OPTIONS,
  sleepQuality: SLEEP_QUALITY_OPTIONS
};
const MULTI_CHOICE_GROUPS = {
  painLocations: PAIN_LOCATIONS,
  symptoms: SYMPTOM_OPTIONS,
  cravings: CRAVING_OPTIONS
};

const checkinState = {
  painRecorded: false   // stays false until the user moves the pain slider
};

/* ---------------------------------------------------------
   BUILDING THE CHOICE CHIPS
   --------------------------------------------------------- */

/** Single-choice groups use toggle buttons so a choice can be un-selected. */
function buildSingleChoiceGroup(groupName, options) {
  const container = document.querySelector('[data-single="' + groupName + '"]');
  container.innerHTML = options.map(function (option) {
    return (
      '<button type="button" class="chip-button" aria-pressed="false" data-value="' + option.value + '">' +
      (option.emoji ? '<span aria-hidden="true">' + option.emoji + "</span> " : "") + option.label +
      "</button>"
    );
  }).join("");

  container.addEventListener("click", function (event) {
    const button = event.target.closest(".chip-button");
    if (!button) return;
    const wasPressed = button.getAttribute("aria-pressed") === "true";
    container.querySelectorAll(".chip-button").forEach(function (other) {
      other.setAttribute("aria-pressed", "false");
    });
    button.setAttribute("aria-pressed", String(!wasPressed));
    updateLiveHints();
  });
}

/** Multi-choice groups use checkboxes. */
function buildMultiChoiceGroup(groupName, options) {
  const container = document.querySelector('[data-multi="' + groupName + '"]');
  container.innerHTML = options.map(function (option) {
    const id = groupName + "-" + option.value;
    return (
      '<div class="chip"><input type="checkbox" id="' + id + '" value="' + option.value + '">' +
      '<label for="' + id + '">' + (option.emoji ? '<span aria-hidden="true">' + option.emoji + "</span> " : "") +
      option.label + "</label></div>"
    );
  }).join("");
}

function getSingleChoice(groupName) {
  const pressed = document.querySelector('[data-single="' + groupName + '"] [aria-pressed="true"]');
  return pressed ? pressed.getAttribute("data-value") : null;
}

function setSingleChoice(groupName, value) {
  document.querySelectorAll('[data-single="' + groupName + '"] .chip-button').forEach(function (button) {
    button.setAttribute("aria-pressed", String(button.getAttribute("data-value") === value));
  });
}

function getMultiChoice(groupName) {
  return Array.prototype.map.call(
    document.querySelectorAll('[data-multi="' + groupName + '"] input:checked'),
    function (input) { return input.value; }
  );
}

function setMultiChoice(groupName, values) {
  const list = Array.isArray(values) ? values : [];
  document.querySelectorAll('[data-multi="' + groupName + '"] input').forEach(function (input) {
    input.checked = list.indexOf(input.value) !== -1;
  });
}

/* ---------------------------------------------------------
   PAIN, SLEEP AND HINTS
   --------------------------------------------------------- */

function setPainDisplay(value, recorded) {
  const slider = document.getElementById("pain-level");
  checkinState.painRecorded = recorded;
  slider.value = value;
  slider.setAttribute("aria-valuetext", recorded ? value + " out of 10" : "Not recorded");
  slider.classList.toggle("is-unset", !recorded);
  document.getElementById("pain-value").textContent = recorded ? value : "–";
  document.getElementById("pain-state").hidden = recorded;
  document.getElementById("pain-clear").hidden = !recorded;
  // Fill the track up to the thumb.
  slider.style.setProperty("--fill", (recorded ? value * 10 : 0) + "%");
}

/**
 * Hours slept between two "HH:MM" times. If the wake-up time is not
 * after bedtime, the sleep crossed midnight, so add 24 hours.
 */
function calculateSleepHours(bedtime, wakeTime) {
  if (!bedtime || !wakeTime) return null;
  const bedParts = bedtime.split(":").map(Number);
  const wakeParts = wakeTime.split(":").map(Number);
  let minutes = (wakeParts[0] * 60 + wakeParts[1]) - (bedParts[0] * 60 + bedParts[1]);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 100) / 100;
}

function updateSleepTotal() {
  const hours = calculateSleepHours(
    document.getElementById("sleep-bedtime").value,
    document.getElementById("sleep-wake").value
  );
  document.getElementById("sleep-total").innerHTML =
    "Total sleep: <strong>" + (hours === null ? "—" : formatHours(hours)) + "</strong>";
}

/** Show the calm care note and the "not a period day" hint when relevant. */
function updateLiveHints() {
  const painHigh = checkinState.painRecorded && Number(document.getElementById("pain-level").value) >= 9;
  const flow = getSingleChoice("flow");
  const settings = getSettings();
  const painShown = settings.tracking.pain;
  const flowShown = settings.tracking.flow;

  document.getElementById("care-note").hidden = !((painShown && painHigh) || (flowShown && flow === "veryHeavy"));

  const date = document.getElementById("checkin-date").value;
  const bleeding = ["light", "medium", "heavy", "veryHeavy"].indexOf(flow) !== -1;
  document.getElementById("flow-period-hint").hidden = !(bleeding && isValidDateString(date) && !isPeriodDay(date));
}

/* ---------------------------------------------------------
   LOADING AND SAVING A DAY
   --------------------------------------------------------- */

/** Fill the form from the saved log for `dateString` (or clear it). */
function loadCheckin(dateString) {
  const log = getDailyLog(dateString);
  const hasLog = !!log;
  const data = log || {};

  document.getElementById("checkin-mode").textContent = hasLog
    ? "Editing your check-in for " + formatDisplayDate(dateString, { withWeekday: true })
    : "New check-in for " + formatDisplayDate(dateString, { withWeekday: true });
  document.getElementById("save-label").textContent = dateString === todayString()
    ? (hasLog ? "Update Today's Check-in" : "Save Today's Check-in")
    : (hasLog ? "Update Check-in" : "Save Check-in");

  setSingleChoice("mood", data.mood || null);
  setSingleChoice("energy", data.energy || null);
  setSingleChoice("flow", data.flow || null);

  const hasPain = typeof data.pain === "number";
  setPainDisplay(hasPain ? data.pain : 0, hasPain);
  setMultiChoice("painLocations", data.painLocations);
  setMultiChoice("symptoms", data.symptoms);
  setMultiChoice("cravings", data.cravings);

  const sleep = data.sleep || {};
  document.getElementById("sleep-bedtime").value = sleep.bedtime || "";
  document.getElementById("sleep-wake").value = sleep.wakeTime || "";
  setSingleChoice("sleepQuality", sleep.quality || null);
  updateSleepTotal();

  document.getElementById("weight-kg").value = typeof data.weightKg === "number" ? data.weightKg : "";
  clearFieldError(document.getElementById("weight-kg"));
  document.getElementById("checkin-notes").value = data.notes || "";

  updateLiveHints();
}

/** Collect the fields for enabled categories. Returns null if invalid. */
function collectCheckin(settings) {
  const entry = {};
  const tracking = settings.tracking;

  entry.energy = getSingleChoice("energy");
  if (tracking.mood) entry.mood = getSingleChoice("mood");
  if (tracking.pain) {
    entry.pain = checkinState.painRecorded ? Number(document.getElementById("pain-level").value) : null;
    entry.painLocations = getMultiChoice("painLocations");
  }
  if (tracking.symptoms) entry.symptoms = getMultiChoice("symptoms");
  if (tracking.flow) entry.flow = getSingleChoice("flow");
  if (tracking.cravings) entry.cravings = getMultiChoice("cravings");

  if (tracking.sleep) {
    const bedtime = document.getElementById("sleep-bedtime").value;
    const wakeTime = document.getElementById("sleep-wake").value;
    const quality = getSingleChoice("sleepQuality");
    entry.sleep = bedtime || wakeTime || quality
      ? { bedtime: bedtime || null, wakeTime: wakeTime || null, hours: calculateSleepHours(bedtime, wakeTime), quality: quality }
      : null;
  }

  if (settings.trackWeight) {
    const weightInput = document.getElementById("weight-kg");
    const raw = weightInput.value.trim();
    if (raw === "") {
      entry.weightKg = null;
    } else {
      const weight = Number(raw);
      if (isNaN(weight) || weight < 20 || weight > 300) {
        setFieldError(weightInput, "Enter a weight between 20 and 300 kg, or leave it empty.");
        weightInput.focus();
        return null;
      }
      entry.weightKg = Math.round(weight * 10) / 10;
    }
  }

  entry.notes = document.getElementById("checkin-notes").value.trim();
  return entry;
}

/** True when the entry holds at least one real answer. */
function hasAnyAnswer(entry) {
  return Object.keys(entry).some(function (key) {
    const value = entry[key];
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined && value !== "";
  });
}

function saveCheckin() {
  const dateInput = document.getElementById("checkin-date");
  const date = dateInput.value;
  clearFieldError(dateInput);

  if (!isValidDateString(date)) {
    setFieldError(dateInput, "Please choose a valid date.");
    dateInput.focus();
    return;
  }
  if (date > todayString()) {
    setFieldError(dateInput, "Check-ins can't be in the future.");
    dateInput.focus();
    return;
  }

  const settings = getSettings();
  const entry = collectCheckin(settings);
  if (!entry) return;

  if (!hasAnyAnswer(entry) && !getDailyLog(date)) {
    showToast("Add at least one thing before saving 🌷", "warning");
    return;
  }

  saveDailyLog(date, entry);
  showToast(date === todayString() ? "Today's check-in is saved 🌷" : "Check-in for " + formatDisplayDate(date) + " saved.", "success");
  loadCheckin(date);
}

/* ---------------------------------------------------------
   PAGE SET-UP
   --------------------------------------------------------- */

function initCheckinPage() {
  const settings = getSettings();
  const dateInput = document.getElementById("checkin-date");

  Object.keys(SINGLE_CHOICE_GROUPS).forEach(function (name) { buildSingleChoiceGroup(name, SINGLE_CHOICE_GROUPS[name]); });
  Object.keys(MULTI_CHOICE_GROUPS).forEach(function (name) { buildMultiChoiceGroup(name, MULTI_CHOICE_GROUPS[name]); });

  // Show only the categories enabled in Settings.
  let anyHidden = false;
  document.querySelectorAll("[data-tracking]").forEach(function (section) {
    const enabled = settings.tracking[section.getAttribute("data-tracking")] !== false;
    section.hidden = !enabled;
    if (!enabled) anyHidden = true;
  });
  document.getElementById("section-body").hidden = !settings.trackWeight;
  document.getElementById("hidden-sections-note").hidden = !anyHidden;

  // Date: defaults to today (or ?date=YYYY-MM-DD) and can't be in the future.
  const today = todayString();
  const requested = new URLSearchParams(window.location.search).get("date");
  dateInput.max = today;
  dateInput.value = isValidDateString(requested) && requested <= today ? requested : today;
  dateInput.addEventListener("change", function () {
    clearFieldError(dateInput);
    if (!isValidDateString(dateInput.value)) return;
    if (dateInput.value > todayString()) {
      setFieldError(dateInput, "Check-ins can't be in the future.");
      return;
    }
    loadCheckin(dateInput.value);
  });

  // Pain slider
  const painSlider = document.getElementById("pain-level");
  painSlider.addEventListener("input", function () {
    setPainDisplay(Number(painSlider.value), true);
    updateLiveHints();
  });
  document.getElementById("pain-clear").addEventListener("click", function () {
    setPainDisplay(0, false);
    updateLiveHints();
    painSlider.focus();
  });

  // Sleep total updates as times change.
  document.getElementById("sleep-bedtime").addEventListener("input", updateSleepTotal);
  document.getElementById("sleep-wake").addEventListener("input", updateSleepTotal);

  // Cravings: "None" clears the others, and picking another clears "None".
  document.querySelector('[data-multi="cravings"]').addEventListener("change", function (event) {
    const changed = event.target;
    if (!changed.checked) return;
    document.querySelectorAll('[data-multi="cravings"] input').forEach(function (input) {
      if (changed.value === "none" && input.value !== "none") input.checked = false;
      if (changed.value !== "none" && input.value === "none") input.checked = false;
    });
  });

  document.getElementById("weight-kg").addEventListener("input", function () {
    clearFieldError(document.getElementById("weight-kg"));
  });

  document.getElementById("checkin-form").addEventListener("submit", function (event) {
    event.preventDefault();
    saveCheckin();
  });

  loadCheckin(dateInput.value);

  // Arriving from a dashboard quick chip (e.g. #section-pain).
  let target = null;
  try {
    target = window.location.hash ? document.querySelector(window.location.hash) : null;
  } catch (error) {
    target = null;   // ignore hashes that aren't valid selectors
  }
  if (target && !target.hidden) target.scrollIntoView({ block: "start" });
}

if (APP_PAGE_ALLOWED) initCheckinPage();
