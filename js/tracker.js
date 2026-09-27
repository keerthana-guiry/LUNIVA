/* =========================================================
   Luniva — tracker.js
   Period Tracker page: monthly calendar, per-day flow logging,
   starting periods, and the "Has your period ended?" flow.

   IMPORTANT (Section 14): Luniva never ends a period on its own.
   A period only ends when the user confirms an end date.
   Requires storage.js and app.js.
   ========================================================= */

const trackerState = {
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),   // 0 = January
  selectedDate: null,                 // date open in the day modal
  pendingStart: null,                 // new period waiting for the active one to end
  periodToDelete: null
};

// Bootstrap modal instances (created once the page loads).
let dayModal, startModal, endFirstModal, deleteModal;

/**
 * Hide one modal and run `next` once it has fully closed, so two
 * modals never fight over the backdrop and focus.
 */
function hideModalThen(modal, modalId, next) {
  document.getElementById(modalId).addEventListener("hidden.bs.modal", next, { once: true });
  modal.hide();
}

/* ---------------------------------------------------------
   PERIOD RULES
   --------------------------------------------------------- */

/** The date range a period covers; an active period runs up to today. */
function periodRange(period) {
  return { start: period.startDate, end: period.status === "active" ? todayString() : period.endDate };
}

/** Do two inclusive date ranges share at least one day? */
function rangesOverlap(a, b) {
  return a.start <= b.end && b.start <= a.end;
}

/**
 * End the active period on `endDate`.
 * Returns an error message, or null when it was saved.
 */
function endActivePeriod(endDate) {
  const active = getActivePeriod();
  if (!active) return "There's no active period to end.";
  if (!isValidDateString(endDate)) return "Please choose a valid date.";
  if (endDate < active.startDate) return "The end date can't be before the start date (" + formatDisplayDate(active.startDate) + ").";
  if (endDate > todayString()) return "The end date can't be in the future.";

  const periods = getPeriods().map(function (period) {
    if (period.id !== active.id) return period;
    return Object.assign({}, period, { endDate: endDate, status: "ended" });
  });
  savePeriods(periods);

  const duration = daysBetween(active.startDate, endDate) + 1;
  showToast("Period ended — " + pluralize(duration, "day") + " recorded. Take care 🌷", "success");
  return null;
}

/**
 * Check a new period before saving it.
 * `endDate` is null for a period that is still going.
 * `ignoreActive` skips the active period in the overlap check (used when
 * the active one is about to be ended before the new start).
 */
function validateNewPeriod(startDate, endDate, ignoreActive) {
  const today = todayString();
  if (!isValidDateString(startDate)) return { field: "start", message: "Please choose a start date." };
  if (startDate > today) return { field: "start", message: "The start date can't be in the future." };

  if (endDate !== null) {
    if (!isValidDateString(endDate)) return { field: "end", message: "Please choose an end date." };
    if (endDate < startDate) return { field: "end", message: "The end date must be on or after the start date." };
    if (endDate > today) return { field: "end", message: "The end date can't be in the future." };
  }

  const periods = getPeriods();
  const duplicate = periods.some(function (period) { return period.startDate === startDate; });
  if (duplicate) return { field: "start", message: "You already have a period starting on this date." };

  // A period that starts before a later recorded one must already have ended.
  const hasLaterPeriod = periods.some(function (period) { return period.startDate > startDate; });
  if (endDate === null && hasLaterPeriod) {
    return { field: "end", message: "You have a later period recorded, so please add when this one ended." };
  }

  const newRange = { start: startDate, end: endDate === null ? today : endDate };
  const clash = periods.find(function (period) {
    if (ignoreActive && period.status === "active") return false;
    return rangesOverlap(newRange, periodRange(period));
  });
  if (clash) {
    return {
      field: "start",
      message: "These dates overlap a period starting " + formatDisplayDate(clash.startDate) + "."
    };
  }
  return null;
}

/** Save a new period (already validated). */
function addPeriod(startDate, endDate) {
  const periods = getPeriods();
  periods.push({
    id: generateId(),
    startDate: startDate,
    endDate: endDate,
    status: endDate === null ? "active" : "ended"
  });
  savePeriods(periods);
  showToast(endDate === null ? "Period started. Luniva will ask you when it ends." : "Past period saved.", "success");
}

/* ---------------------------------------------------------
   MY PERIOD CARD + "HAS YOUR PERIOD ENDED?" CARD
   --------------------------------------------------------- */

function renderMyPeriod() {
  const active = getActivePeriod();
  const latest = getLatestPeriod();
  const nextStart = getNextPredictedStart();
  const today = todayString();

  const startText = active ? active.startDate : latest ? latest.startDate : null;
  document.getElementById("my-period-start").textContent = startText ? formatDisplayDate(startText) : "No period logged yet";

  const statusElement = document.getElementById("my-period-status");
  if (active) {
    const periodDay = daysBetween(active.startDate, today) + 1;
    statusElement.innerHTML = '<span class="status-dot status-active" aria-hidden="true"></span>Period Active · Day ' + periodDay;
  } else {
    statusElement.innerHTML = '<span class="status-dot" aria-hidden="true"></span>No active period';
  }

  document.getElementById("my-period-next").textContent = nextStart ? formatDisplayDate(nextStart, { withWeekday: true }) : "—";
  document.getElementById("late-note").hidden = !isPeriodLate();
}

function renderPeriodEndCard() {
  const active = getActivePeriod();
  const card = document.getElementById("period-end");
  card.hidden = !active;
  if (!active) return;

  const periodDay = daysBetween(active.startDate, todayString()) + 1;
  document.getElementById("period-end-intro").textContent =
    "Your period started " + formatDisplayDate(active.startDate, { withWeekday: true }) +
    " (day " + periodDay + "). Luniva keeps it active until you confirm it has ended.";

  const isLong = isActivePeriodLong();
  document.getElementById("long-period-note").hidden = !isLong;
  card.classList.toggle("is-attention", isLong);

  const endInput = document.getElementById("end-earlier-date");
  endInput.min = active.startDate;
  endInput.max = todayString();
}

function hideEndEarlierForm() {
  document.getElementById("end-earlier-form").hidden = true;
  document.querySelector('[data-end-choice="earlier"]').setAttribute("aria-expanded", "false");
  clearFieldError(document.getElementById("end-earlier-date"));
}

function handleEndChoice(choice) {
  const today = todayString();

  if (choice === "today") {
    const error = endActivePeriod(today);
    if (error) showToast(error, "warning");
    renderTrackerPage();
    return;
  }

  if (choice === "earlier") {
    const form = document.getElementById("end-earlier-form");
    const input = document.getElementById("end-earlier-date");
    form.hidden = false;
    document.querySelector('[data-end-choice="earlier"]').setAttribute("aria-expanded", "true");
    if (!input.value) input.value = addDays(today, -1) >= input.min ? addDays(today, -1) : input.min;
    input.focus();
    return;
  }

  if (choice === "still") {
    hideEndEarlierForm();
    showToast("Okay — your period stays active. Be gentle with yourself today 🌷", "info");
    return;
  }

  if (choice === "unsure") {
    hideEndEarlierForm();
    const created = addNotification(
      "periodEnded",
      "Has your period ended? Let Luniva know in the Period Tracker when you're sure.",
      addDays(today, 1)
    );
    showToast(created
      ? "No problem. Your period stays active and we'll ask again tomorrow."
      : "Your period stays active. A reminder is already set for tomorrow.", "info");
  }
}

/* ---------------------------------------------------------
   CALENDAR
   --------------------------------------------------------- */

const FLOW_LEVELS = { none: 0, spotting: 1, light: 2, medium: 3, heavy: 4, veryHeavy: 5 };

function renderCalendar() {
  const year = trackerState.viewYear;
  const month = trackerState.viewMonth;
  const today = todayString();
  const logs = getDailyLogs();
  const predicted = getPredictedDays().filter(function (day) { return day >= today; });

  document.getElementById("calendar-title").textContent = MONTH_NAMES[month] + " " + year;

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];

  // Empty cells before the 1st so days line up with weekday columns.
  for (let i = 0; i < firstWeekday; i++) cells.push('<span class="calendar-empty" aria-hidden="true"></span>');

  for (let day = 1; day <= daysInMonth; day++) {
    const dateString = year + "-" + padNumber(month + 1) + "-" + padNumber(day);
    const isPeriod = isPeriodDay(dateString);
    const isPredicted = !isPeriod && predicted.indexOf(dateString) !== -1;
    const isToday = dateString === today;
    const flow = logs[dateString] && logs[dateString].flow;
    const flowLevel = flow ? FLOW_LEVELS[flow] : undefined;

    const classes = ["calendar-day"];
    const labelParts = [day + " " + MONTH_NAMES[month] + " " + year];
    if (isPeriod) { classes.push("is-period"); labelParts.push("period day"); }
    if (isPredicted) { classes.push("is-predicted"); labelParts.push("predicted period"); }
    if (isToday) { classes.push("is-today"); labelParts.push("today"); }
    if (dateString > today) classes.push("is-future");
    if (flow) labelParts.push("flow " + findOption(FLOW_OPTIONS, flow).label);

    let flowMarkup = "";
    if (flowLevel !== undefined) {
      const dots = Math.max(1, Math.ceil(flowLevel / 2));   // 1–3 small dots
      flowMarkup = '<span class="flow-dots' + (flowLevel === 0 ? " is-none" : "") + '" aria-hidden="true">' +
        new Array(dots + 1).join("<i></i>") + "</span>";
    }

    cells.push(
      '<button type="button" class="' + classes.join(" ") + '" data-date="' + dateString + '"' +
      (isToday ? ' aria-current="date"' : "") + ' aria-label="' + labelParts.join(", ") + '">' +
      '<span class="day-number">' + day + "</span>" + flowMarkup +
      "</button>"
    );
  }

  document.getElementById("calendar-days").innerHTML = cells.join("");
}

function changeMonth(step) {
  const date = new Date(trackerState.viewYear, trackerState.viewMonth + step, 1);
  trackerState.viewYear = date.getFullYear();
  trackerState.viewMonth = date.getMonth();
  renderCalendar();
}

/* ---------------------------------------------------------
   DAY MODAL (flow logging + shortcuts)
   --------------------------------------------------------- */

function buildFlowOptions() {
  document.getElementById("flow-options").innerHTML = FLOW_OPTIONS.map(function (option) {
    return (
      '<div class="chip"><input type="radio" name="day-flow" id="day-flow-' + option.value + '" value="' + option.value + '">' +
      '<label for="day-flow-' + option.value + '"><span aria-hidden="true">' + option.emoji + "</span> " + option.label + "</label></div>"
    );
  }).join("");
}

function updateFlowNotes() {
  const selected = document.querySelector('input[name="day-flow"]:checked');
  const value = selected ? selected.value : null;
  document.getElementById("flow-heavy-note").hidden = value !== "veryHeavy";
  document.getElementById("flow-none-note").hidden = !(value === "none" && getActivePeriod());
}

function openDayModal(dateString) {
  trackerState.selectedDate = dateString;
  const today = todayString();
  const isFuture = dateString > today;
  const log = getDailyLog(dateString) || {};
  const active = getActivePeriod();

  document.getElementById("day-modal-title").textContent = formatDisplayDate(dateString, { withWeekday: true }) + " " + dateString.slice(0, 4);

  // Status line
  let status;
  if (isPeriodDay(dateString)) status = "🩸 Period day";
  else if (getPredictedDays().indexOf(dateString) !== -1 && dateString >= today) status = "🌙 Predicted period day";
  else status = "No period recorded";
  if (dateString === today) status += " · ⭐ Today";
  document.getElementById("day-status").textContent = status;

  // Flow form (only for today or earlier)
  const flowForm = document.getElementById("flow-form");
  flowForm.hidden = isFuture;
  document.getElementById("future-note").hidden = !isFuture;
  document.querySelectorAll('input[name="day-flow"]').forEach(function (input) {
    input.checked = input.value === log.flow;
  });
  document.getElementById("clear-flow").hidden = !log.flow;
  updateFlowNotes();

  // Shortcut buttons
  const actions = [];
  if (!isFuture && active && dateString >= active.startDate) {
    actions.push('<button type="button" class="btn btn-outline-luniva w-100" data-day-action="end">' +
      '<span aria-hidden="true">✅</span> My period ended on this day</button>');
  }
  if (!isFuture && !isPeriodDay(dateString)) {
    actions.push('<button type="button" class="btn btn-outline-luniva w-100" data-day-action="start">' +
      '<span aria-hidden="true">🩸</span> Period started on this day</button>');
  }
  const actionsElement = document.getElementById("day-actions");
  actionsElement.innerHTML = actions.join("");
  actionsElement.hidden = !actions.length;

  dayModal.show();
}

/* ---------------------------------------------------------
   START A PERIOD
   --------------------------------------------------------- */

function openStartModal(prefillDate) {
  const today = todayString();
  const startInput = document.getElementById("start-date");
  const endInput = document.getElementById("start-end-date");
  const hasEnded = document.getElementById("start-has-ended");

  hideFormAlert(document.getElementById("start-alert"));
  [startInput, endInput].forEach(clearFieldError);
  startInput.max = today;
  endInput.max = today;
  startInput.value = prefillDate || today;
  endInput.value = "";
  hasEnded.checked = false;
  document.getElementById("start-end-wrap").hidden = true;

  // Remind the user that an active period will need an end date first.
  const active = getActivePeriod();
  if (active) {
    showFormAlert(document.getElementById("start-alert"),
      "Your current period (started " + formatDisplayDate(active.startDate) + ") is still active. " +
      "If this is a new period, you'll be asked when the current one ended first.");
    document.getElementById("start-alert").classList.add("alert-inline-info");
  }

  startModal.show();
}

/**
 * Handle the start form. If a period is active and the new one starts
 * after it, ask for the active period's end date first (Section 14).
 */
function submitStartForm() {
  const startInput = document.getElementById("start-date");
  const endInput = document.getElementById("start-end-date");
  const hasEnded = document.getElementById("start-has-ended").checked;
  [startInput, endInput].forEach(clearFieldError);

  const startDate = startInput.value;
  const endDate = hasEnded ? endInput.value : null;
  const active = getActivePeriod();
  const needsEndFirst = active && isValidDateString(startDate) && startDate > active.startDate;

  const problem = validateNewPeriod(startDate, endDate, needsEndFirst);
  if (problem) {
    const input = problem.field === "end" ? endInput : startInput;
    if (problem.field === "end" && !hasEnded) {
      document.getElementById("start-has-ended").checked = true;
      document.getElementById("start-end-wrap").hidden = false;
    }
    setFieldError(input, problem.message);
    input.focus();
    return;
  }

  if (needsEndFirst) {
    // Save the new period for later and confirm the active one's end date first.
    trackerState.pendingStart = { startDate: startDate, endDate: endDate };
    hideModalThen(startModal, "start-modal", function () { openEndFirstModal(active, startDate); });
    return;
  }

  addPeriod(startDate, endDate);
  startModal.hide();
  renderTrackerPage();
}

function openEndFirstModal(active, newStartDate) {
  const input = document.getElementById("end-first-date");
  const latestAllowed = addDays(newStartDate, -1) < todayString() ? addDays(newStartDate, -1) : todayString();
  clearFieldError(input);
  input.min = active.startDate;
  input.max = latestAllowed;
  input.value = latestAllowed;
  document.getElementById("end-first-intro").textContent =
    "Your current period started " + formatDisplayDate(active.startDate, { withWeekday: true }) +
    ". Before starting a new one on " + formatDisplayDate(newStartDate, { withWeekday: true }) +
    ", please confirm when it ended.";
  endFirstModal.show();
}

function submitEndFirstForm() {
  const input = document.getElementById("end-first-date");
  const pending = trackerState.pendingStart;
  clearFieldError(input);
  if (!pending) {
    endFirstModal.hide();
    return;
  }

  const endDate = input.value;
  if (isValidDateString(endDate) && endDate >= pending.startDate) {
    setFieldError(input, "It must end before the new period starts (" + formatDisplayDate(pending.startDate) + ").");
    input.focus();
    return;
  }
  const error = endActivePeriod(endDate);
  if (error) {
    setFieldError(input, error);
    input.focus();
    return;
  }

  // Now the active period is closed, re-check and save the new one.
  const problem = validateNewPeriod(pending.startDate, pending.endDate, false);
  trackerState.pendingStart = null;
  endFirstModal.hide();
  if (problem) {
    showToast(problem.message, "warning");
  } else {
    addPeriod(pending.startDate, pending.endDate);
  }
  renderTrackerPage();
}

/* ---------------------------------------------------------
   RECORDED PERIODS LIST
   --------------------------------------------------------- */

function renderPeriodList() {
  const list = document.getElementById("period-list");
  const periods = getPeriods().slice().reverse();   // newest first

  if (!periods.length) {
    list.innerHTML = '<li class="empty-state"><span class="empty-emoji" aria-hidden="true">🌙</span>No periods recorded yet. Tap “Log a period” to add one.</li>';
    return;
  }

  list.innerHTML = periods.map(function (period) {
    const isActive = period.status === "active";
    const duration = getPeriodDuration(period);
    const title = isActive
      ? formatDisplayDate(period.startDate) + " – ongoing"
      : formatDisplayDate(period.startDate) + " – " + formatDisplayDate(period.endDate);
    const meta = isActive
      ? "Active · day " + (daysBetween(period.startDate, todayString()) + 1)
      : pluralize(duration, "day");
    return (
      '<li class="period-item">' +
        '<span class="period-item-icon' + (isActive ? " is-active" : "") + '" aria-hidden="true">🩸</span>' +
        '<div class="flex-grow-1"><strong>' + title + "</strong>" +
        '<span class="period-item-meta">' + meta + "</span></div>" +
        '<button type="button" class="icon-button" data-delete-period="' + escapeHtml(period.id) + '" ' +
        'aria-label="Remove period starting ' + formatDisplayDate(period.startDate) + '">' +
        '<i class="bi bi-trash3" aria-hidden="true"></i></button>' +
      "</li>"
    );
  }).join("");
}

function confirmDeletePeriod(periodId) {
  const period = getPeriods().find(function (item) { return item.id === periodId; });
  if (!period) return;
  trackerState.periodToDelete = periodId;
  document.getElementById("delete-modal-text").textContent =
    "The period starting " + formatDisplayDate(period.startDate) +
    " will be removed. Your daily logs (flow, pain, mood…) are kept.";
  deleteModal.show();
}

/* ---------------------------------------------------------
   PAGE SET-UP
   --------------------------------------------------------- */

function renderTrackerPage() {
  renderMyPeriod();
  renderPeriodEndCard();
  renderCalendar();
  renderPeriodList();
}

function initTrackerPage() {
  dayModal = new bootstrap.Modal(document.getElementById("day-modal"));
  startModal = new bootstrap.Modal(document.getElementById("start-modal"));
  endFirstModal = new bootstrap.Modal(document.getElementById("end-first-modal"));
  deleteModal = new bootstrap.Modal(document.getElementById("delete-modal"));

  buildFlowOptions();

  // Calendar navigation
  document.getElementById("prev-month").addEventListener("click", function () { changeMonth(-1); });
  document.getElementById("next-month").addEventListener("click", function () { changeMonth(1); });
  document.getElementById("today-month").addEventListener("click", function () {
    trackerState.viewYear = new Date().getFullYear();
    trackerState.viewMonth = new Date().getMonth();
    renderCalendar();
  });
  document.getElementById("calendar-days").addEventListener("click", function (event) {
    const dayButton = event.target.closest("[data-date]");
    if (dayButton) openDayModal(dayButton.getAttribute("data-date"));
  });

  // Day modal
  document.getElementById("flow-options").addEventListener("change", updateFlowNotes);
  document.getElementById("flow-form").addEventListener("submit", function (event) {
    event.preventDefault();
    const selected = document.querySelector('input[name="day-flow"]:checked');
    if (!selected) {
      showToast("Choose a flow option first.", "warning");
      return;
    }
    // Flow is saved to the shared daily log. "None" never ends a period.
    saveDailyLog(trackerState.selectedDate, { flow: selected.value });
    dayModal.hide();
    showToast("Flow saved for " + formatDisplayDate(trackerState.selectedDate, { withWeekday: true }) + ".", "success");
    renderCalendar();
  });
  document.getElementById("clear-flow").addEventListener("click", function () {
    saveDailyLog(trackerState.selectedDate, { flow: null });
    dayModal.hide();
    showToast("Flow cleared.", "info");
    renderCalendar();
  });
  document.getElementById("day-actions").addEventListener("click", function (event) {
    const button = event.target.closest("[data-day-action]");
    if (!button) return;
    const date = trackerState.selectedDate;
    if (button.getAttribute("data-day-action") === "end") {
      dayModal.hide();
      const error = endActivePeriod(date);
      if (error) showToast(error, "warning");
      renderTrackerPage();
    } else {
      hideModalThen(dayModal, "day-modal", function () { openStartModal(date); });
    }
  });

  // Start / end-first forms
  document.getElementById("log-period-button").addEventListener("click", function () { openStartModal(); });
  document.getElementById("start-has-ended").addEventListener("change", function (event) {
    document.getElementById("start-end-wrap").hidden = !event.target.checked;
    if (event.target.checked) document.getElementById("start-end-date").focus();
  });
  document.getElementById("start-form").addEventListener("submit", function (event) {
    event.preventDefault();
    submitStartForm();
  });
  document.getElementById("end-first-form").addEventListener("submit", function (event) {
    event.preventDefault();
    submitEndFirstForm();
  });
  document.getElementById("end-first-modal").addEventListener("hidden.bs.modal", function () {
    trackerState.pendingStart = null;
  });
  clearErrorOnInput([
    document.getElementById("start-date"),
    document.getElementById("start-end-date"),
    document.getElementById("end-first-date"),
    document.getElementById("end-earlier-date")
  ]);

  // "Has your period ended?" choices
  document.querySelectorAll("[data-end-choice]").forEach(function (button) {
    button.addEventListener("click", function () { handleEndChoice(button.getAttribute("data-end-choice")); });
  });
  document.getElementById("end-earlier-form").addEventListener("submit", function (event) {
    event.preventDefault();
    const input = document.getElementById("end-earlier-date");
    const error = endActivePeriod(input.value);
    if (error) {
      setFieldError(input, error);
      input.focus();
      return;
    }
    hideEndEarlierForm();
    input.value = "";
    renderTrackerPage();
  });
  document.getElementById("end-earlier-cancel").addEventListener("click", hideEndEarlierForm);

  // Delete a period
  document.getElementById("period-list").addEventListener("click", function (event) {
    const button = event.target.closest("[data-delete-period]");
    if (button) confirmDeletePeriod(button.getAttribute("data-delete-period"));
  });
  document.getElementById("delete-confirm").addEventListener("click", function () {
    const remaining = getPeriods().filter(function (period) { return period.id !== trackerState.periodToDelete; });
    savePeriods(remaining);
    trackerState.periodToDelete = null;
    deleteModal.hide();
    showToast("Period removed.", "info");
    renderTrackerPage();
  });

  renderTrackerPage();

  // Arriving from the dashboard's "Has your period ended?" banner.
  if (window.location.hash === "#period-end" && getActivePeriod()) {
    document.getElementById("period-end").scrollIntoView({ block: "start" });
  }
}

if (APP_PAGE_ALLOWED) initTrackerPage();
