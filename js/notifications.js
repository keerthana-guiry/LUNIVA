/* =========================================================
   Luniva — notifications.js
   Loaded on EVERY app page (after app.js).

   A static website can't send reminders while it is closed, so
   notifications are in-app only: on each page load we look at the
   dates and settings and create any notifications that are due —
   at most one per type per day. Disabled types are never created.

   It also powers the Notification Centre on notifications.html.
   Requires storage.js and app.js.
   ========================================================= */

// How each notification type looks and where it leads.
const NOTIFICATION_TYPES = {
  period: { icon: "🔔", title: "Period approaching", link: "tracker.html", linkText: "Open tracker" },
  pad: { icon: "👜", title: "Carry a pad", link: "tracker.html", linkText: "Open tracker" },
  checkin: { icon: "📝", title: "Daily check-in", link: "checkin.html", linkText: "Check in now" },
  sleep: { icon: "😴", title: "Sleep reminder", link: "checkin.html#section-sleep", linkText: "Log sleep" },
  motivation: { icon: "🌷", title: "Motivation", link: "companion.html", linkText: "More kind words" },
  companion: { icon: "🌙", title: "Companion message", link: "companion.html", linkText: "Open Companion" },
  periodEnded: { icon: "❓", title: "Has your period ended?", link: "tracker.html#period-end", linkText: "Update period" }
};

// Short daily messages. The Companion page has its own, longer lists.
const MOTIVATION_NOTES = [
  "You're doing better than you think. 🌷",
  "Rest is productive too. Be kind to yourself today.",
  "Small steps still move you forward.",
  "Your body is working hard — thank it with a little care today.",
  "You don't have to be perfect to be wonderful.",
  "Drink some water and take a deep breath. You've got this.",
  "Every day you show up for yourself counts.",
  "Softness is a strength. Go gently today."
];

const COMPANION_NOTES = [
  "Need a little distraction? The Companion has a joke waiting for you. 😂",
  "Here's a tiny challenge: stretch for 30 seconds. More in the Companion ✨",
  "Random question: what's a smell that makes you happy? 💭",
  "Feeling stuck? A small distraction can help — visit the Companion 🌙",
  "Your Companion has a new tiny challenge for you today ✨",
  "Take a mini break. The Companion is here when you need it 🌙",
  "Quick question: what's the best thing you ate this week? 💭",
  "Pause for five slow breaths — then come say hi in the Companion 🌷"
];

// Remove notifications older than this many days to keep storage small.
const NOTIFICATION_KEEP_DAYS = 90;
// "Period approaching" appears when the predicted start is this close.
const PERIOD_SOON_DAYS = 3;
// The sleep reminder appears from this hour (24h clock).
const SLEEP_REMINDER_HOUR = 21;

/**
 * Look at today's date and the user's settings and add any due
 * notifications. Safe to run on every page load.
 */
function generateDueNotifications() {
  const settings = getSettings();
  const enabled = settings.notifications;
  const today = todayString();
  const active = getActivePeriod();
  const daysUntil = getDaysUntilNextPeriod();

  tidyNotifications(today, active);

  // 🔔 Period approaching
  if (enabled.period && !active && daysUntil !== null && daysUntil >= 0 && daysUntil <= PERIOD_SOON_DAYS) {
    const when = daysUntil === 0 ? "today" : "in about " + pluralize(daysUntil, "day");
    addNotification("period",
      "Your period may start " + when + " (around " + formatDisplayDate(getNextPredictedStart(), { withWeekday: true }) + ").",
      today);
  }

  // 👜 Carry a pad
  if (enabled.pad && isPadReminderDue()) {
    addNotification("pad", "Your period may be approaching. You might want to carry a pad today.", today);
  }

  // 📝 Daily check-in (only if today hasn't been logged yet)
  if (enabled.checkin && !getDailyLog(today)) {
    addNotification("checkin", "How are you feeling today? Take a minute for your daily check-in.", today);
  }

  // 😴 Sleep reminder (evenings only)
  if (enabled.sleep && new Date().getHours() >= SLEEP_REMINDER_HOUR) {
    addNotification("sleep", "It's getting late. A calm wind-down can help you sleep well tonight. 😴", today);
  }

  // 🌷 Motivation and 🌙 Companion — one gentle note each per day
  if (enabled.motivation) addNotification("motivation", pickRandom(MOTIVATION_NOTES), today);
  if (enabled.companion) addNotification("companion", pickRandom(COMPANION_NOTES), today);

  // ❓ Follow-up for periods active more than 10 days (never closed automatically)
  if (isActivePeriodLong()) {
    addNotification("periodEnded",
      "Your period has been active for " + pluralize(daysBetween(active.startDate, today) + 1, "day") +
      ". Has it ended? Let Luniva know when you're sure.",
      today);
  }
}

/**
 * Housekeeping:
 *  - drop very old notifications
 *  - drop unread "Has your period ended?" follow-ups once no period is active
 *  - mark today's check-in reminder read once today has been logged
 */
function tidyNotifications(today, active) {
  const oldestKept = addDays(today, -NOTIFICATION_KEEP_DAYS);
  const loggedToday = !!getDailyLog(today);
  const original = getNotifications();

  const tidied = original
    .filter(function (item) { return item.date >= oldestKept; })
    .filter(function (item) { return !(item.type === "periodEnded" && !item.read && !active); })
    .map(function (item) {
      if (item.type === "checkin" && item.date === today && loggedToday && !item.read) {
        return Object.assign({}, item, { read: true });
      }
      return item;
    });

  if (JSON.stringify(tidied) !== JSON.stringify(original)) {
    saveData(STORAGE_KEYS.notifications, tidied);
  }
}

/** Notifications that are due (date ≤ today), newest first. */
function getDueNotifications() {
  const today = todayString();
  return getNotifications()
    .filter(function (item) { return item.date <= today; })
    .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
}

function setNotificationsRead(ids) {
  const updated = getNotifications().map(function (item) {
    return ids.indexOf(item.id) !== -1 ? Object.assign({}, item, { read: true }) : item;
  });
  saveData(STORAGE_KEYS.notifications, updated);
}

/* ---------------------------------------------------------
   NOTIFICATION CENTRE (notifications.html)
   --------------------------------------------------------- */

function renderNotificationCentre() {
  const list = document.getElementById("notification-list");
  const due = getDueNotifications();
  const unread = due.filter(function (item) { return !item.read; }).length;
  const today = todayString();

  document.getElementById("unread-summary").textContent = unread
    ? "You have " + pluralize(unread, "unread notification") + "."
    : "You're all caught up 🌙";
  document.getElementById("mark-all-read").disabled = unread === 0;

  if (!due.length) {
    list.innerHTML =
      '<li class="empty-state"><span class="empty-emoji" aria-hidden="true">🔔</span>' +
      "No notifications yet. Reminders you turn on in Settings will appear here.</li>";
    return;
  }

  let lastGroup = null;
  list.innerHTML = due.map(function (item) {
    const type = NOTIFICATION_TYPES[item.type] || { icon: "🔔", title: "Reminder", link: "dashboard.html", linkText: "Open" };
    const group = item.date === today ? "Today" : item.date === addDays(today, -1) ? "Yesterday" : "Earlier";
    let heading = "";
    if (group !== lastGroup) {
      heading = '<li class="notification-group" aria-hidden="true">' + group + "</li>";
      lastGroup = group;
    }
    return heading +
      '<li class="notification-item' + (item.read ? "" : " is-unread") + '">' +
        '<span class="notification-icon" aria-hidden="true">' + type.icon + "</span>" +
        '<div class="notification-body">' +
          '<div class="notification-top">' +
            "<strong>" + escapeHtml(type.title) + "</strong>" +
            (item.read ? "" : '<span class="unread-dot"><span class="visually-hidden">Unread</span></span>') +
          "</div>" +
          "<p>" + escapeHtml(item.message) + "</p>" +
          '<div class="notification-actions">' +
            '<span class="notification-date">' + formatDisplayDate(item.date, { withWeekday: true }) + "</span>" +
            '<a class="notification-link" href="' + type.link + '" data-open-id="' + escapeHtml(item.id) + '">' + escapeHtml(type.linkText) + "</a>" +
            (item.read ? "" : '<button type="button" class="btn btn-ghost btn-sm" data-read-id="' + escapeHtml(item.id) + '">Mark as read</button>') +
          "</div>" +
        "</div>" +
      "</li>";
  }).join("");
}

function initNotificationCentre() {
  const list = document.getElementById("notification-list");

  list.addEventListener("click", function (event) {
    const readButton = event.target.closest("[data-read-id]");
    if (readButton) {
      setNotificationsRead([readButton.getAttribute("data-read-id")]);
      renderNotificationCentre();
      refreshNavBadges();
      return;
    }
    // Opening a notification's link also marks it as read.
    const openLink = event.target.closest("[data-open-id]");
    if (openLink) setNotificationsRead([openLink.getAttribute("data-open-id")]);
  });

  document.getElementById("mark-all-read").addEventListener("click", function () {
    setNotificationsRead(getDueNotifications().map(function (item) { return item.id; }));
    renderNotificationCentre();
    refreshNavBadges();
    showToast("All notifications marked as read.", "success");
  });

  renderNotificationCentre();
}

/* ---------------------------------------------------------
   START-UP
   --------------------------------------------------------- */

if (IS_APP_PAGE && APP_PAGE_ALLOWED) {
  generateDueNotifications();
  refreshNavBadges();   // the badge was drawn before new notifications existed
  if (document.getElementById("notification-list")) initNotificationCentre();
}
