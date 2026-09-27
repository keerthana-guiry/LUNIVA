/* =========================================================
   Luniva — app.js
   Shared logic for every page:
     1. Date helpers (local dates only — never toISOString)
     2. Small utilities (ids, escaping, formatting)
     3. Settings, periods and daily-log helpers
     4. Cycle calculations (Section 26B)
     5. Toast messages
     6. Route guard + navigation rendering
   Requires storage.js to be loaded first.
   ========================================================= */

/* ---------------------------------------------------------
   1. DATE HELPERS
   All dates are stored as local "YYYY-MM-DD" strings.
   --------------------------------------------------------- */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Add a leading zero to single-digit numbers: 7 → "07". */
function padNumber(number) {
  return number < 10 ? "0" + number : String(number);
}

/** Turn a Date object into a local "YYYY-MM-DD" string. */
function toDateString(date) {
  return date.getFullYear() + "-" + padNumber(date.getMonth() + 1) + "-" + padNumber(date.getDate());
}

/** Today as "YYYY-MM-DD" in the user's own time zone. */
function todayString() {
  return toDateString(new Date());
}

/** "YYYY-MM-DD" → Date at local midnight. Returns null for invalid input. */
function parseDate(dateString) {
  if (!isValidDateString(dateString)) return null;
  const parts = dateString.split("-");
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

/** Checks that a string looks like a real calendar date "YYYY-MM-DD". */
function isValidDateString(dateString) {
  if (typeof dateString !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false;
  const parts = dateString.split("-").map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return date.getFullYear() === parts[0] && date.getMonth() === parts[1] - 1 && date.getDate() === parts[2];
}

/**
 * Whole days from date a to date b (b − a). Accepts strings or Dates.
 * Math.round absorbs the 1-hour shift on daylight-saving days.
 */
function daysBetween(a, b) {
  const start = typeof a === "string" ? parseDate(a) : new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const end = typeof b === "string" ? parseDate(b) : new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((end - start) / MS_PER_DAY);
}

/** "YYYY-MM-DD" + n days → "YYYY-MM-DD" (n may be negative). */
function addDays(dateString, n) {
  const date = parseDate(dateString);
  date.setDate(date.getDate() + n);
  return toDateString(date);
}

/** "2026-09-15" → "15 Sep 2026" (or "Mon, 15 Sep" with weekday option). */
function formatDisplayDate(dateString, options) {
  const date = parseDate(dateString);
  if (!date) return "—";
  const settings = options || {};
  const shortMonth = MONTH_NAMES[date.getMonth()].slice(0, 3);
  if (settings.withWeekday) {
    return WEEKDAY_SHORT[date.getDay()] + ", " + date.getDate() + " " + shortMonth;
  }
  return date.getDate() + " " + shortMonth + " " + date.getFullYear();
}

/* ---------------------------------------------------------
   2. SMALL UTILITIES
   --------------------------------------------------------- */

/** A short unique id for periods and notifications. */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Escape user-entered text before putting it into innerHTML. */
function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Round to one decimal place and drop a trailing ".0": 4.25 → 4.3, 28.0 → 28. */
function roundOne(number) {
  return Math.round(number * 10) / 10;
}

/** Mean of a list of numbers, or null for an empty list. */
function average(numbers) {
  if (!numbers.length) return null;
  const total = numbers.reduce(function (sum, value) { return sum + value; }, 0);
  return total / numbers.length;
}

/** Pick a random item from an array, avoiding `previousItem` when possible. */
function pickRandom(items, previousItem) {
  if (!items.length) return null;
  if (items.length === 1) return items[0];
  let choice = previousItem;
  while (choice === previousItem) {
    choice = items[Math.floor(Math.random() * items.length)];
  }
  return choice;
}

/** Plural helper: pluralize(1, "day") → "1 day", pluralize(3, "day") → "3 days". */
function pluralize(count, word) {
  return count + " " + word + (count === 1 ? "" : "s");
}

/** Current page file name, e.g. "dashboard.html". */
function getCurrentPage() {
  const file = window.location.pathname.split("/").pop();
  return file || "index.html";
}

/** Time-based greeting for the dashboard. */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** First letter of the user's name for the avatar. */
function getInitial(name) {
  const trimmed = String(name || "").trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "L";
}

/* ---------------------------------------------------------
   3. SETTINGS, USER, PERIODS AND DAILY LOGS
   --------------------------------------------------------- */

// Used whenever a setting has not been saved yet.
const DEFAULT_SETTINGS = {
  cycleLength: 28,
  periodLength: 5,
  padReminderDays: 2,
  trackWeight: false,
  tracking: { pain: true, flow: true, sleep: true, mood: true, cravings: true, symptoms: true },
  notifications: { period: true, pad: true, checkin: true, sleep: false, motivation: true, companion: true }
};

// Allowed ranges from onboarding (Section 11).
const CYCLE_LENGTH_MIN = 20;
const CYCLE_LENGTH_MAX = 45;
const PERIOD_LENGTH_MIN = 2;
const PERIOD_LENGTH_MAX = 10;

// A period active longer than this triggers the "Has your period ended?" prompt again.
const LONG_PERIOD_DAYS = 10;

function getUser() {
  return getData(STORAGE_KEYS.user);
}

/** Settings merged over the defaults, so missing fields never break a page. */
function getSettings() {
  const saved = getData(STORAGE_KEYS.settings) || {};
  return {
    cycleLength: Number(saved.cycleLength) || DEFAULT_SETTINGS.cycleLength,
    periodLength: Number(saved.periodLength) || DEFAULT_SETTINGS.periodLength,
    padReminderDays: Number(saved.padReminderDays) || DEFAULT_SETTINGS.padReminderDays,
    trackWeight: saved.trackWeight === true,
    tracking: Object.assign({}, DEFAULT_SETTINGS.tracking, saved.tracking || {}),
    notifications: Object.assign({}, DEFAULT_SETTINGS.notifications, saved.notifications || {})
  };
}

/** All periods, sorted oldest → newest by start date. Ignores malformed entries. */
function getPeriods() {
  const periods = getData(STORAGE_KEYS.periods);
  if (!Array.isArray(periods)) return [];
  return periods
    .filter(function (period) { return period && isValidDateString(period.startDate); })
    .sort(function (a, b) { return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0; });
}

function savePeriods(periods) {
  saveData(STORAGE_KEYS.periods, periods);
}

/** The period that is still open (status "active"), or null. */
function getActivePeriod() {
  const periods = getPeriods();
  for (let i = periods.length - 1; i >= 0; i--) {
    if (periods[i].status === "active") return periods[i];
  }
  return null;
}

/** The period with the most recent start date, or null. */
function getLatestPeriod() {
  const periods = getPeriods();
  return periods.length ? periods[periods.length - 1] : null;
}

/** Length of an ENDED period: End − Start + 1. Returns null for active periods. */
function getPeriodDuration(period) {
  if (!period || period.status !== "ended" || !isValidDateString(period.endDate)) return null;
  return daysBetween(period.startDate, period.endDate) + 1;
}

/** Whole daily-log object: { "YYYY-MM-DD": {...} }. */
function getDailyLogs() {
  const logs = getData(STORAGE_KEYS.dailyLogs);
  return logs && typeof logs === "object" && !Array.isArray(logs) ? logs : {};
}

/** One day's log, or null. */
function getDailyLog(dateString) {
  return getDailyLogs()[dateString] || null;
}

/**
 * Merge fields into one day's log. This is the single write path for
 * flow, pain, mood, sleep and cravings — every page uses it.
 */
function saveDailyLog(dateString, partialLog) {
  const logs = getDailyLogs();
  logs[dateString] = Object.assign({}, logs[dateString] || {}, partialLog);
  saveData(STORAGE_KEYS.dailyLogs, logs);
  return logs[dateString];
}

/**
 * Is this date inside a recorded period?
 * An active period counts from its start date up to today.
 */
function isPeriodDay(dateString) {
  const today = todayString();
  return getPeriods().some(function (period) {
    const end = period.status === "active" ? today : period.endDate;
    return isValidDateString(end) && dateString >= period.startDate && dateString <= end;
  });
}

/* ---------------------------------------------------------
   4. CYCLE CALCULATIONS (Section 26B)
   Every number shown in the app comes from these functions.
   --------------------------------------------------------- */

/**
 * Average cycle length = mean gap between consecutive start dates.
 * Returns { value, fromHistory } — fromHistory is false when we fell
 * back to settings.cycleLength because there are fewer than 2 periods.
 */
function getAverageCycleLength() {
  const periods = getPeriods();
  if (periods.length < 2) {
    return { value: getSettings().cycleLength, fromHistory: false };
  }
  const gaps = [];
  for (let i = 1; i < periods.length; i++) {
    gaps.push(daysBetween(periods[i - 1].startDate, periods[i].startDate));
  }
  return { value: roundOne(average(gaps)), fromHistory: true };
}

/**
 * Average period length = mean of (End − Start + 1) for ENDED periods only.
 * Falls back to settings.periodLength when no period has ended yet.
 */
function getAveragePeriodLength() {
  const durations = getPeriods()
    .map(getPeriodDuration)
    .filter(function (days) { return days !== null; });
  if (!durations.length) {
    return { value: getSettings().periodLength, fromHistory: false };
  }
  return { value: roundOne(average(durations)), fromHistory: true };
}

/** Cycle day = days since the latest start + 1, or null if nothing is logged. */
function getCycleDay() {
  const latest = getLatestPeriod();
  if (!latest) return null;
  return daysBetween(latest.startDate, todayString()) + 1;
}

/** Next predicted start = latest start + average cycle length (rounded to a whole day). */
function getNextPredictedStart() {
  const latest = getLatestPeriod();
  if (!latest) return null;
  return addDays(latest.startDate, Math.round(getAverageCycleLength().value));
}

/** Predicted days: next start through (average period length − 1) days after it. */
function getPredictedDays() {
  const start = getNextPredictedStart();
  if (!start) return [];
  const length = Math.max(1, Math.round(getAveragePeriodLength().value));
  const days = [];
  for (let i = 0; i < length; i++) days.push(addDays(start, i));
  return days;
}

/** Days from today until the next predicted start (negative if it has passed). */
function getDaysUntilNextPeriod() {
  const next = getNextPredictedStart();
  return next ? daysBetween(todayString(), next) : null;
}

/** True when the cycle has run past its usual length and no period is active. */
function isPeriodLate() {
  const cycleDay = getCycleDay();
  if (cycleDay === null || getActivePeriod()) return false;
  return cycleDay > getAverageCycleLength().value;
}

/**
 * True when today is within `padReminderDays` days before the predicted start
 * (including the predicted day itself), and no period is currently active.
 */
function isPadReminderDue() {
  if (getActivePeriod()) return false;
  const daysUntil = getDaysUntilNextPeriod();
  if (daysUntil === null) return false;
  return daysUntil >= 0 && daysUntil <= getSettings().padReminderDays;
}

/** True when the active period has lasted more than LONG_PERIOD_DAYS days. */
function isActivePeriodLong() {
  const active = getActivePeriod();
  if (!active) return false;
  return daysBetween(active.startDate, todayString()) + 1 > LONG_PERIOD_DAYS;
}

/** Mean of all logged pain values (0–10), or null if none are logged. */
function getAveragePain() {
  const logs = getDailyLogs();
  const values = Object.keys(logs)
    .map(function (date) { return logs[date].pain; })
    .filter(function (pain) { return typeof pain === "number" && !isNaN(pain); });
  return values.length ? roundOne(average(values)) : null;
}

/** Mean of all logged sleep hours, or null if none are logged. */
function getAverageSleep() {
  const logs = getDailyLogs();
  const values = Object.keys(logs)
    .map(function (date) { return logs[date].sleep && logs[date].sleep.hours; })
    .filter(function (hours) { return typeof hours === "number" && !isNaN(hours) && hours > 0; });
  return values.length ? roundOne(average(values)) : null;
}

/* ---------------------------------------------------------
   5. TOAST MESSAGES
   --------------------------------------------------------- */

/**
 * Show a small message in the corner that fades away.
 * type: "success" | "info" | "warning"
 */
function showToast(message, type) {
  let container = document.getElementById("toast-stack");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-stack";
    container.className = "toast-stack";
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-atomic", "true");
    document.body.appendChild(container);
  }

  const icons = { success: "bi-check-circle-fill", info: "bi-moon-stars-fill", warning: "bi-exclamation-circle-fill" };
  const toastType = icons[type] ? type : "success";

  const toast = document.createElement("div");
  toast.className = "luniva-toast luniva-toast-" + toastType;
  toast.setAttribute("role", "status");
  toast.innerHTML =
    '<i class="bi ' + icons[toastType] + '" aria-hidden="true"></i>' +
    '<span>' + escapeHtml(message) + '</span>' +
    '<button type="button" class="toast-close" aria-label="Dismiss message"><i class="bi bi-x" aria-hidden="true"></i></button>';
  container.appendChild(toast);

  function removeToast() {
    toast.classList.add("is-leaving");
    setTimeout(function () { toast.remove(); }, 250);
  }
  toast.querySelector(".toast-close").addEventListener("click", removeToast);
  setTimeout(removeToast, 3800);
}

/* ---------------------------------------------------------
   6. BRAND, ROUTE GUARD AND NAVIGATION
   --------------------------------------------------------- */

/** The Luniva mark: a crescent moon resting inside a soft circle. */
function getLogoSvg(size) {
  const px = size || 32;
  return (
    '<svg class="luniva-mark" width="' + px + '" height="' + px + '" viewBox="0 0 48 48" aria-hidden="true" focusable="false">' +
      '<circle cx="24" cy="24" r="22" fill="var(--lv-lavender-100)" stroke="var(--lv-lavender-300)" stroke-width="1.5"/>' +
      '<path d="M29.5 12.5a12 12 0 1 0 6 21.2A10 10 0 0 1 29.5 12.5Z" fill="var(--lv-rose-500)"/>' +
      '<circle cx="33" cy="17" r="2" fill="var(--lv-lavender-500)"/>' +
    '</svg>'
  );
}

/**
 * Route guard for app pages:
 *   no user              → login.html
 *   onboarding not done  → onboarding.html
 * Returns true when the page may render.
 */
function guardAppPage() {
  const user = getUser();
  if (!user) {
    window.location.replace("login.html");
    return false;
  }
  if (!user.onboardingComplete) {
    window.location.replace("onboarding.html");
    return false;
  }
  return true;
}

/** Number of unread in-app notifications (for the bell badge). */
function getUnreadCount() {
  const notifications = getData(STORAGE_KEYS.notifications);
  if (!Array.isArray(notifications)) return 0;
  return notifications.filter(function (item) { return item && !item.read; }).length;
}

// Desktop sidebar links (Section 25).
const SIDEBAR_LINKS = [
  { href: "dashboard.html", label: "Home", icon: "bi-house-heart" },
  { href: "tracker.html", label: "Period Tracker", icon: "bi-calendar-heart" },
  { href: "checkin.html", label: "Daily Check-in", icon: "bi-journal-check" },
  { href: "insights.html", label: "Insights", icon: "bi-bar-chart-line" },
  { href: "history.html", label: "History", icon: "bi-clock-history" },
  { href: "companion.html", label: "Companion", icon: "bi-moon-stars" },
  { href: "notifications.html", label: "Notifications", icon: "bi-bell" },
  { href: "settings.html", label: "Settings", icon: "bi-gear" }
];

// Mobile bottom bar links (Section 25).
const BOTTOM_LINKS = [
  { href: "dashboard.html", label: "Home", icon: "bi-house-heart" },
  { href: "tracker.html", label: "Calendar", icon: "bi-calendar-heart" },
  { href: "checkin.html", label: "Check-in", icon: "bi-journal-check" },
  { href: "insights.html", label: "Insights", icon: "bi-bar-chart-line" },
  { href: "companion.html", label: "Companion", icon: "bi-moon-stars" }
];

/** Small red count bubble, or an empty string when there is nothing unread. */
function badgeMarkup(count, extraClass) {
  if (!count) return "";
  const label = count > 9 ? "9+" : String(count);
  return '<span class="nav-badge ' + (extraClass || "") + '" aria-hidden="true">' + label + "</span>";
}

/** Build and insert the sidebar, mobile header and bottom bar into #app-nav. */
function renderAppNav() {
  const mount = document.getElementById("app-nav");
  if (!mount) return;

  const currentPage = getCurrentPage();
  const user = getUser() || {};
  const unread = getUnreadCount();
  const unreadLabel = unread ? " (" + unread + " unread)" : "";

  function linkState(href) {
    return href === currentPage ? ' class="is-active" aria-current="page"' : "";
  }

  const sidebarItems = SIDEBAR_LINKS.map(function (link) {
    const isBell = link.href === "notifications.html";
    return (
      "<li><a href=\"" + link.href + "\"" + linkState(link.href) +
      (isBell ? ' aria-label="Notifications' + unreadLabel + '"' : "") + ">" +
      '<i class="bi ' + link.icon + '" aria-hidden="true"></i>' +
      "<span>" + link.label + "</span>" +
      (isBell ? badgeMarkup(unread, "ms-auto") : "") +
      "</a></li>"
    );
  }).join("");

  const bottomItems = BOTTOM_LINKS.map(function (link) {
    return (
      "<li><a href=\"" + link.href + "\"" + linkState(link.href) + ">" +
      '<i class="bi ' + link.icon + '" aria-hidden="true"></i>' +
      "<span>" + link.label + "</span></a></li>"
    );
  }).join("");

  mount.innerHTML =
    // ---- Desktop sidebar (≥ 992px) ----
    '<aside class="app-sidebar" aria-label="Main navigation">' +
      '<a class="brand-link" href="dashboard.html">' + getLogoSvg(36) + '<span class="brand-name">Luniva</span></a>' +
      '<nav><ul class="sidebar-links">' + sidebarItems + "</ul></nav>" +
      '<div class="sidebar-footer">' +
        '<div class="sidebar-user"><span class="avatar" aria-hidden="true">' + escapeHtml(getInitial(user.name)) + "</span>" +
        '<span class="sidebar-user-name">' + escapeHtml(user.name || "Friend") + "</span></div>" +
        '<a class="sidebar-logout" href="login.html?logout=1"><i class="bi bi-box-arrow-right" aria-hidden="true"></i><span>Log out</span></a>' +
      "</div>" +
    "</aside>" +

    // ---- Mobile top header ----
    '<header class="app-topbar">' +
      '<a class="brand-link" href="dashboard.html">' + getLogoSvg(30) + '<span class="brand-name">Luniva</span></a>' +
      '<div class="topbar-actions">' +
        '<a class="icon-button" href="notifications.html" aria-label="Notifications' + unreadLabel + '">' +
          '<i class="bi bi-bell" aria-hidden="true"></i>' + badgeMarkup(unread, "badge-float") +
        "</a>" +
        '<div class="dropdown">' +
          '<button class="avatar-button" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Account menu">' +
            '<span class="avatar" aria-hidden="true">' + escapeHtml(getInitial(user.name)) + "</span>" +
          "</button>" +
          '<ul class="dropdown-menu dropdown-menu-end luniva-dropdown">' +
            '<li><a class="dropdown-item" href="history.html"><i class="bi bi-clock-history" aria-hidden="true"></i> History</a></li>' +
            '<li><a class="dropdown-item" href="settings.html"><i class="bi bi-gear" aria-hidden="true"></i> Settings</a></li>' +
            '<li><hr class="dropdown-divider"></li>' +
            '<li><a class="dropdown-item" href="login.html?logout=1"><i class="bi bi-box-arrow-right" aria-hidden="true"></i> Log out</a></li>' +
          "</ul>" +
        "</div>" +
      "</div>" +
    "</header>" +

    // ---- Mobile bottom bar ----
    '<nav class="app-bottombar" aria-label="Quick navigation"><ul>' + bottomItems + "</ul></nav>";

  document.body.classList.add("has-app-nav");
}

/** Refresh just the unread badges (called after notifications change). */
function refreshNavBadges() {
  if (document.getElementById("app-nav")) renderAppNav();
}

/** Add the medical disclaimer footer to the bottom of app pages. */
function renderAppFooter() {
  const main = document.querySelector(".app-main");
  if (!main || main.querySelector(".app-footer")) return;
  const footer = document.createElement("footer");
  footer.className = "app-footer";
  footer.innerHTML =
    "<p>Luniva helps you record and understand your personal patterns. " +
    "It does not provide medical diagnosis or replace professional medical advice.</p>";
  main.appendChild(footer);
}

/* ---------------------------------------------------------
   PAGE START-UP
   Pages with <div id="app-nav"> are "app pages": they are
   guarded and get the shared navigation.
   --------------------------------------------------------- */

// Run the guard immediately (scripts load at the end of <body>) so
// a logged-out visitor never sees app content flash on screen.
const IS_APP_PAGE = !!document.getElementById("app-nav");
const APP_PAGE_ALLOWED = IS_APP_PAGE ? guardAppPage() : true;

if (IS_APP_PAGE && APP_PAGE_ALLOWED) {
  renderAppNav();
  renderAppFooter();
}

/**
 * Small touches for the public pages (landing, sign up, log in):
 * header shadow on scroll, reveal-on-scroll, footer year, and an
 * "Open Luniva" shortcut for someone who has already signed up.
 */
function initPublicPage() {
  const header = document.querySelector(".site-header");
  if (header) {
    const onScroll = function () { header.classList.toggle("is-scrolled", window.scrollY > 8); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  const revealItems = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    document.documentElement.classList.add("reveal-ready");
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealItems.forEach(function (item) { observer.observe(item); });
  } else {
    revealItems.forEach(function (item) { item.classList.add("is-visible"); });
  }

  document.querySelectorAll("[data-current-year]").forEach(function (element) {
    element.textContent = new Date().getFullYear();
  });

  // Returning user: point "Get Started" at the app instead of sign-up.
  const user = getUser();
  if (user && user.onboardingComplete) {
    document.querySelectorAll("[data-returning-link]").forEach(function (link) {
      link.href = "dashboard.html";
      link.textContent = link.getAttribute("data-returning-link");
    });
  }

  // Close the mobile menu after tapping an in-page link.
  document.querySelectorAll(".site-header .navbar-collapse a[href^='#']").forEach(function (link) {
    link.addEventListener("click", function () {
      const menu = document.querySelector(".site-header .navbar-collapse.show");
      if (menu && window.bootstrap) window.bootstrap.Collapse.getOrCreateInstance(menu).hide();
    });
  });
}

if (!IS_APP_PAGE) initPublicPage();
