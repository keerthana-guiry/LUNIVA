/* =========================================================
   Luniva — guide.js
   "Getting started" page: device tabs (opens on the visitor's
   own device) and the "Share this guide" button.
   Requires storage.js and app.js.
   ========================================================= */

function guessGuideDevice() {
  if (isIOSDevice()) return "iphone";
  return /android/i.test(navigator.userAgent) ? "android" : "computer";
}

function selectGuideTab(name, moveFocus) {
  document.querySelectorAll("[data-guide-tab]").forEach(function (tab) {
    const selected = tab.getAttribute("data-guide-tab") === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && moveFocus) tab.focus();
  });
  document.querySelectorAll("[data-guide-panel]").forEach(function (panel) {
    panel.hidden = panel.getAttribute("data-guide-panel") !== name;
  });
}

function initGuideTabs() {
  const tabs = Array.from(document.querySelectorAll("[data-guide-tab]"));
  tabs.forEach(function (tab, index) {
    tab.addEventListener("click", function () { selectGuideTab(tab.getAttribute("data-guide-tab"), false); });
    // Arrow keys move between tabs (standard tab-list behaviour).
    tab.addEventListener("keydown", function (event) {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = tabs[(index + step + tabs.length) % tabs.length];
      selectGuideTab(next.getAttribute("data-guide-tab"), true);
    });
  });
  selectGuideTab(guessGuideDevice(), false);
}

function initGuideShare() {
  const button = document.getElementById("guide-share");
  const url = new URL("guide.html", window.location.href).href;
  const text = "Luniva — a private period & wellbeing tracker. Here's how to set it up in 5 minutes:";
  button.addEventListener("click", function () {
    if (navigator.share) {
      navigator.share({ title: "Getting started with Luniva", text: text, url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        showToast("Link copied — paste it into a message 💜", "success");
      }, function () {
        showToast("Copy this link: " + url, "info");
      });
      return;
    }
    showToast("Copy this link: " + url, "info");
  });
}

initGuideTabs();
initGuideShare();
