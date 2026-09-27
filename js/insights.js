/* =========================================================
   Luniva — insights.js
   Powers two read-only views of the user's own records:
     • insights.html — averages and patterns drawn as CSS bars
     • history.html  — every recorded day in a filterable table
   Insights describe recorded history only. They never diagnose.
   Requires storage.js and app.js.
   ========================================================= */

/* ---------------------------------------------------------
   SHARED HELPERS
   --------------------------------------------------------- */

/** Daily logs as a list of { date, log }, oldest first. */
function getLogEntries() {
  const logs = getDailyLogs();
  return Object.keys(logs)
    .filter(isValidDateString)
    .sort()
    .map(function (date) { return { date: date, log: logs[date] || {} }; });
}

/** The period that covers `dateString`, or null. */
function findPeriodForDate(dateString) {
  const today = todayString();
  return getPeriods().find(function (period) {
    const end = period.status === "active" ? today : period.endDate;
    return isValidDateString(end) && dateString >= period.startDate && dateString <= end;
  }) || null;
}

/** Count how often each value appears, e.g. { calm: 3, tired: 1 }. */
function countValues(values) {
  const counts = {};
  values.forEach(function (value) {
    if (value === null || value === undefined || value === "") return;
    counts[value] = (counts[value] || 0) + 1;
  });
  return counts;
}

/** Counts → bar items sorted by frequency, using an option list for labels. */
function countsToBars(counts, options) {
  return options
    .filter(function (option) { return counts[option.value]; })
    .map(function (option) {
      const count = counts[option.value];
      return {
        label: (option.emoji ? option.emoji + " " : "") + option.label,
        value: count,
        display: pluralize(count, "day")
      };
    })
    .sort(function (a, b) { return b.value - a.value; });
}

/**
 * Draw simple horizontal CSS bars. Each row is readable text for screen
 * readers ("Calm: 4 days"); the coloured bar itself is decorative.
 */
function renderBars(container, items, maxValue, colorClass) {
  const max = maxValue || Math.max.apply(null, items.map(function (item) { return item.value; }).concat([1]));
  container.innerHTML = '<ul class="bar-list">' + items.map(function (item) {
    const percent = Math.max(2, Math.round((item.value / max) * 100));
    return (
      "<li>" +
        '<span class="bar-label">' + escapeHtml(item.label) + "</span>" +
        '<span class="bar-track" aria-hidden="true"><span class="bar-fill ' + (colorClass || "") + '" style="--w:' + percent + '%"></span></span>' +
        '<span class="bar-value">' + escapeHtml(item.display) + "</span>" +
      "</li>"
    );
  }).join("") + "</ul>";

  // Grow the bars in on the next frame (skipped by reduced-motion CSS).
  requestAnimationFrame(function () {
    container.querySelectorAll(".bar-fill").forEach(function (bar) { bar.classList.add("is-grown"); });
  });
}

function emptyStateMarkup(message) {
  return '<p class="empty-state"><span class="empty-emoji" aria-hidden="true">🌙</span>' +
    escapeHtml(message || "Log a few days to see your patterns here 🌙") + "</p>";
}

/* ---------------------------------------------------------
   INSIGHTS PAGE
   --------------------------------------------------------- */

/** Fill one summary tile; `value` null shows the empty state. */
function setInsightTile(id, value, note) {
  const tile = document.getElementById(id);
  tile.querySelector(".stat-value").innerHTML = value === null ? '<span class="stat-empty">—</span>' : value;
  tile.querySelector(".stat-note").textContent = value === null ? "Log a few days to see this 🌙" : note;
}

/** Write a "Your recent records show…" sentence, or hide it. */
function setInsightText(id, text) {
  const element = document.getElementById(id);
  element.hidden = !text;
  element.textContent = text || "";
}

function renderCycleInsights(periods) {
  const cyclesBox = document.getElementById("cycle-bars");
  const durationsBox = document.getElementById("duration-bars");

  // Cycle lengths: gap between each pair of consecutive start dates.
  const cycles = [];
  for (let i = 1; i < periods.length; i++) {
    cycles.push({
      label: "From " + formatDisplayDate(periods[i - 1].startDate).slice(0, -5),
      value: daysBetween(periods[i - 1].startDate, periods[i].startDate)
    });
  }
  const recentCycles = cycles.slice(-6);
  if (recentCycles.length) {
    renderBars(cyclesBox, recentCycles.map(function (cycle) {
      return { label: cycle.label, value: cycle.value, display: pluralize(cycle.value, "day") };
    }), null, "fill-lavender");
    const lengths = cycles.map(function (cycle) { return cycle.value; });
    const shortest = Math.min.apply(null, lengths);
    const longest = Math.max.apply(null, lengths);
    setInsightText("cycle-text", cycles.length > 1
      ? "Your recent records show cycles between " + shortest + " and " + longest + " days."
      : "Your records show one full cycle of " + pluralize(shortest, "day") + " so far.");
  } else {
    cyclesBox.innerHTML = emptyStateMarkup("Log at least two period start dates to see your cycle lengths 🌙");
    setInsightText("cycle-text", "");
  }

  // Period durations: ended periods only (End − Start + 1).
  const durations = periods
    .filter(function (period) { return getPeriodDuration(period) !== null; })
    .map(function (period) {
      return { label: formatDisplayDate(period.startDate).slice(0, -5), value: getPeriodDuration(period) };
    })
    .slice(-6);
  if (durations.length) {
    renderBars(durationsBox, durations.map(function (item) {
      return { label: item.label, value: item.value, display: pluralize(item.value, "day") };
    }), null, "fill-rose");
  } else {
    durationsBox.innerHTML = emptyStateMarkup("Confirm when a period ends to see how long your periods last 🌙");
  }
}

function renderPainInsights(entries) {
  const box = document.getElementById("pain-bars");
  const withPain = entries.filter(function (entry) { return typeof entry.log.pain === "number"; });
  if (!withPain.length) {
    box.innerHTML = emptyStateMarkup();
    setInsightText("pain-text", "");
    return;
  }

  const periodPain = withPain.filter(function (entry) { return isPeriodDay(entry.date); }).map(function (entry) { return entry.log.pain; });
  const otherPain = withPain.filter(function (entry) { return !isPeriodDay(entry.date); }).map(function (entry) { return entry.log.pain; });
  const items = [];
  if (periodPain.length) items.push({ label: "🩸 Period days", value: roundOne(average(periodPain)), display: roundOne(average(periodPain)) + " / 10" });
  if (otherPain.length) items.push({ label: "🌿 Other days", value: roundOne(average(otherPain)), display: roundOne(average(otherPain)) + " / 10" });
  renderBars(box, items, 10, "fill-rose");

  // Most common pain locations
  const locations = [];
  withPain.forEach(function (entry) { (entry.log.painLocations || []).forEach(function (spot) { locations.push(spot); }); });
  const topLocation = countsToBars(countValues(locations), PAIN_LOCATIONS)[0];

  let text = "";
  if (periodPain.length && otherPain.length) {
    const difference = roundOne(average(periodPain) - average(otherPain));
    text = difference > 0
      ? "Your recent records show higher pain on period days (about " + difference + " points more)."
      : "Your recent records show similar or lower pain on period days compared with other days.";
  }
  if (topLocation) {
    const place = topLocation.label.toLowerCase();
    text += text
      ? " Pain is most often logged in the " + place + "."
      : "Your recent records show pain most often in the " + place + ".";
  }
  setInsightText("pain-text", text);
}

function renderFlowInsights(entries) {
  const box = document.getElementById("flow-bars");
  const counts = countValues(entries.map(function (entry) { return entry.log.flow; }));
  const bars = FLOW_OPTIONS
    .filter(function (option) { return counts[option.value]; })
    .map(function (option) {
      return { label: option.emoji + " " + option.label, value: counts[option.value], display: pluralize(counts[option.value], "day") };
    });
  if (!bars.length) {
    box.innerHTML = emptyStateMarkup();
    return;
  }
  renderBars(box, bars, null, "fill-rose");
}

/** Most common flow excluding "None", or null. */
function getTypicalFlow(entries) {
  const counts = countValues(entries.map(function (entry) { return entry.log.flow === "none" ? null : entry.log.flow; }));
  const top = countsToBars(counts, FLOW_OPTIONS)[0];
  return top ? top.label : null;
}

function renderSleepInsights(entries) {
  const box = document.getElementById("sleep-bars");
  const qualityBox = document.getElementById("sleep-quality-bars");
  const nights = entries.filter(function (entry) {
    return entry.log.sleep && typeof entry.log.sleep.hours === "number" && entry.log.sleep.hours > 0;
  });

  if (nights.length) {
    renderBars(box, nights.slice(-7).map(function (entry) {
      return { label: formatDisplayDate(entry.date, { withWeekday: true }), value: entry.log.sleep.hours, display: formatHours(entry.log.sleep.hours) };
    }), 12, "fill-lavender");
  } else {
    box.innerHTML = emptyStateMarkup();
  }

  const quality = countsToBars(countValues(entries.map(function (entry) {
    return entry.log.sleep ? entry.log.sleep.quality : null;
  })), SLEEP_QUALITY_OPTIONS);
  if (quality.length) {
    renderBars(qualityBox, quality, null, "fill-lavender");
    qualityBox.insertAdjacentHTML("afterbegin", '<p class="bar-subtitle">Sleep quality</p>');
  } else {
    qualityBox.innerHTML = "";
  }
  setInsightText("sleep-text", quality.length
    ? "Your recent records show your sleep most often feels " + quality[0].label.replace(/^\S+\s/, "").toLowerCase() + "."
    : "");
}

function renderPatternInsights(entries) {
  // Mood
  const moods = countsToBars(countValues(entries.map(function (entry) { return entry.log.mood; })), MOOD_OPTIONS);
  const moodBox = document.getElementById("mood-bars");
  if (moods.length) {
    renderBars(moodBox, moods, null, "fill-lavender");
    setInsightText("mood-text", "Your recent records show " + moods[0].label.replace(/^\S+\s/, "") + " as your most logged mood.");
  } else {
    moodBox.innerHTML = emptyStateMarkup();
    setInsightText("mood-text", "");
  }

  // Energy
  const energy = countsToBars(countValues(entries.map(function (entry) { return entry.log.energy; })), ENERGY_OPTIONS);
  const energyBox = document.getElementById("energy-bars");
  if (energy.length) renderBars(energyBox, energy, null, "fill-cream");
  else energyBox.innerHTML = emptyStateMarkup();

  // Cravings ("None" isn't a craving)
  const cravingValues = [];
  entries.forEach(function (entry) {
    (entry.log.cravings || []).forEach(function (craving) { if (craving !== "none") cravingValues.push(craving); });
  });
  const cravings = countsToBars(countValues(cravingValues), CRAVING_OPTIONS);
  const cravingBox = document.getElementById("craving-bars");
  if (cravings.length) {
    renderBars(cravingBox, cravings, null, "fill-rose");
    setInsightText("craving-text", "Your recent records show " + cravings[0].label.replace(/^\S+\s/, "").toLowerCase() + " cravings most often.");
  } else {
    cravingBox.innerHTML = emptyStateMarkup();
    setInsightText("craving-text", "");
  }

  // Symptoms
  const symptomValues = [];
  entries.forEach(function (entry) { (entry.log.symptoms || []).forEach(function (symptom) { symptomValues.push(symptom); }); });
  const symptoms = countsToBars(countValues(symptomValues), SYMPTOM_OPTIONS).slice(0, 6);
  const symptomBox = document.getElementById("symptom-bars");
  if (symptoms.length) renderBars(symptomBox, symptoms, null, "fill-lavender");
  else symptomBox.innerHTML = emptyStateMarkup();
}

function initInsightsPage() {
  const periods = getPeriods();
  const entries = getLogEntries();
  const endedCount = periods.filter(function (period) { return period.status === "ended"; }).length;

  document.getElementById("insights-basis").textContent =
    "Based on your own records: " + pluralize(entries.length, "check-in") + " and " + pluralize(periods.length, "period") +
    " (" + endedCount + " with a confirmed end date).";

  // Summary tiles (Section 26B)
  const cycle = getAverageCycleLength();
  const period = getAveragePeriodLength();
  setInsightTile("tile-cycle", cycle.fromHistory ? roundOne(cycle.value) + ' <span class="stat-unit">days</span>' : null, "Mean gap between start dates");
  setInsightTile("tile-period", period.fromHistory ? roundOne(period.value) + ' <span class="stat-unit">days</span>' : null, "Ended periods only");
  const pain = getAveragePain();
  setInsightTile("tile-pain", pain === null ? null : pain + ' <span class="stat-unit">/ 10</span>', "Across all check-ins");
  const typicalFlow = getTypicalFlow(entries);
  setInsightTile("tile-flow", typicalFlow === null ? null : escapeHtml(typicalFlow), "Most logged flow");
  const sleep = getAverageSleep();
  setInsightTile("tile-sleep", sleep === null ? null : escapeHtml(formatHours(sleep)), "Per logged night");

  renderCycleInsights(periods);
  renderPainInsights(entries);
  renderFlowInsights(entries);
  renderSleepInsights(entries);
  renderPatternInsights(entries);
}

/* ---------------------------------------------------------
   HISTORY PAGE
   --------------------------------------------------------- */

/** Every date with a log or inside a recorded period, newest first. */
function getHistoryRecords() {
  const logs = getDailyLogs();
  const dates = {};
  Object.keys(logs).filter(isValidDateString).forEach(function (date) { dates[date] = true; });

  const today = todayString();
  getPeriods().forEach(function (period) {
    const end = period.status === "active" ? today : period.endDate;
    if (!isValidDateString(end)) return;
    for (let date = period.startDate; date <= end; date = addDays(date, 1)) dates[date] = true;
  });

  return Object.keys(dates).sort().reverse().map(function (date) {
    const period = findPeriodForDate(date);
    return {
      date: date,
      log: logs[date] || {},
      periodDay: period ? daysBetween(period.startDate, date) + 1 : null
    };
  });
}

function describeRecord(record) {
  const log = record.log;
  const sleep = log.sleep || {};
  const cravings = (log.cravings || []).map(function (value) { return optionText(CRAVING_OPTIONS, value); }).filter(Boolean);
  return {
    period: record.periodDay ? "🩸 Period · day " + record.periodDay : "—",
    flow: optionText(FLOW_OPTIONS, log.flow) || "—",
    pain: typeof log.pain === "number" ? log.pain + "/10" : "—",
    mood: optionText(MOOD_OPTIONS, log.mood) || "—",
    sleep: typeof sleep.hours === "number" ? formatHours(sleep.hours) + (sleep.quality ? " · " + findOption(SLEEP_QUALITY_OPTIONS, sleep.quality).label : "")
      : sleep.quality ? findOption(SLEEP_QUALITY_OPTIONS, sleep.quality).label : "—",
    cravings: cravings.length ? cravings.join(", ") : "—",
    notes: log.notes || ""
  };
}

function painMatches(pain, filter) {
  if (filter === "any") return true;
  if (typeof pain !== "number") return false;
  if (filter === "low") return pain <= 3;
  if (filter === "medium") return pain >= 4 && pain <= 6;
  return pain >= 7;
}

function renderHistory(allRecords) {
  const month = document.getElementById("filter-month").value;
  const periodOnly = document.getElementById("filter-period").checked;
  const painFilter = document.getElementById("filter-pain").value;
  const moodFilter = document.getElementById("filter-mood").value;
  const symptomFilter = document.getElementById("filter-symptom").value;

  const records = allRecords.filter(function (record) {
    if (month !== "all" && record.date.slice(0, 7) !== month) return false;
    if (periodOnly && !record.periodDay) return false;
    if (!painMatches(record.log.pain, painFilter)) return false;
    if (moodFilter !== "all" && record.log.mood !== moodFilter) return false;
    if (symptomFilter !== "all" && (record.log.symptoms || []).indexOf(symptomFilter) === -1) return false;
    return true;
  });

  document.getElementById("history-count").textContent = allRecords.length
    ? "Showing " + pluralize(records.length, "record") + " of " + allRecords.length + "."
    : "";

  const tableBody = document.getElementById("history-table-body");
  const cardList = document.getElementById("history-cards");
  const emptyBox = document.getElementById("history-empty");
  const tableWrap = document.getElementById("history-table-wrap");

  if (!records.length) {
    tableBody.innerHTML = "";
    cardList.innerHTML = "";
    tableWrap.hidden = true;
    emptyBox.hidden = false;
    emptyBox.innerHTML = emptyStateMarkup(allRecords.length
      ? "No records match these filters."
      : "Log a few days to see your history here 🌙");
    return;
  }
  tableWrap.hidden = false;
  emptyBox.hidden = true;

  // Wide screens: a table
  tableBody.innerHTML = records.map(function (record) {
    const view = describeRecord(record);
    return (
      "<tr" + (record.periodDay ? ' class="is-period-row"' : "") + ">" +
        '<th scope="row"><a href="checkin.html?date=' + record.date + '" aria-label="Edit check-in for ' + formatDisplayDate(record.date) + '">' +
        formatDisplayDate(record.date, { withWeekday: true }) + " " + record.date.slice(0, 4) + "</a></th>" +
        "<td>" + view.period + "</td>" +
        "<td>" + escapeHtml(view.flow) + "</td>" +
        "<td>" + view.pain + "</td>" +
        "<td>" + escapeHtml(view.mood) + "</td>" +
        "<td>" + escapeHtml(view.sleep) + "</td>" +
        "<td>" + escapeHtml(view.cravings) + "</td>" +
        '<td class="notes-cell">' + (view.notes ? escapeHtml(view.notes) : "—") + "</td>" +
      "</tr>"
    );
  }).join("");

  // Phones: one card per day (no horizontal scrolling)
  cardList.innerHTML = records.map(function (record) {
    const view = describeRecord(record);
    return (
      '<li class="history-card' + (record.periodDay ? " is-period" : "") + '">' +
        '<div class="history-card-head">' +
          "<strong>" + formatDisplayDate(record.date, { withWeekday: true }) + " " + record.date.slice(0, 4) + "</strong>" +
          '<a class="btn btn-ghost btn-sm" href="checkin.html?date=' + record.date + '">Edit</a>' +
        "</div>" +
        '<dl class="history-card-grid">' +
          "<div><dt>Period</dt><dd>" + view.period + "</dd></div>" +
          "<div><dt>Flow</dt><dd>" + escapeHtml(view.flow) + "</dd></div>" +
          "<div><dt>Pain</dt><dd>" + view.pain + "</dd></div>" +
          "<div><dt>Mood</dt><dd>" + escapeHtml(view.mood) + "</dd></div>" +
          "<div><dt>Sleep</dt><dd>" + escapeHtml(view.sleep) + "</dd></div>" +
          "<div><dt>Cravings</dt><dd>" + escapeHtml(view.cravings) + "</dd></div>" +
        "</dl>" +
        (view.notes ? '<p class="history-note">' + escapeHtml(view.notes) + "</p>" : "") +
      "</li>"
    );
  }).join("");
}

function fillSelect(select, options) {
  options.forEach(function (option) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    select.appendChild(element);
  });
}

function initHistoryPage() {
  const records = getHistoryRecords();

  // Month filter: only months that actually have records.
  const months = [];
  records.forEach(function (record) {
    const key = record.date.slice(0, 7);
    if (months.indexOf(key) === -1) months.push(key);
  });
  fillSelect(document.getElementById("filter-month"), months.map(function (key) {
    return { value: key, label: MONTH_NAMES[Number(key.slice(5, 7)) - 1] + " " + key.slice(0, 4) };
  }));
  fillSelect(document.getElementById("filter-mood"), MOOD_OPTIONS.map(function (option) {
    return { value: option.value, label: option.emoji + " " + option.label };
  }));
  fillSelect(document.getElementById("filter-symptom"), SYMPTOM_OPTIONS);

  const form = document.getElementById("history-filters");
  form.addEventListener("change", function () { renderHistory(records); });
  form.addEventListener("reset", function () {
    // Let the browser reset the fields first, then re-render.
    setTimeout(function () { renderHistory(records); }, 0);
  });

  renderHistory(records);
}

/* ---------------------------------------------------------
   START-UP
   --------------------------------------------------------- */

if (APP_PAGE_ALLOWED) {
  if (document.getElementById("insights-page")) initInsightsPage();
  if (document.getElementById("history-page")) initHistoryPage();
}
