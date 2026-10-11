/* =========================================================
   Luniva — feedback.js
   "Send feedback" page. Messages are saved to the Supabase
   table luniva_feedback, which the website can only write to;
   they're read in the Supabase dashboard.
   Requires the Supabase library, config.js, storage.js, app.js.
   ========================================================= */

const FEEDBACK_MIN_LENGTH = 3;
const FEEDBACK_MAX_LENGTH = 2000;

/** Where the person came from, e.g. "dashboard" (page name only, never data). */
function getFeedbackSourcePage() {
  const from = new URLSearchParams(window.location.search).get("from") || "";
  return /^[a-z-]{1,40}$/.test(from) ? from : "direct";
}

/** A short device description, e.g. "Android · Chrome". No identifiers. */
function describeDevice() {
  const ua = navigator.userAgent;
  const os = /android/i.test(ua) ? "Android" : /iphone|ipad|ipod/i.test(ua) ? "iOS" :
    /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "macOS" : /linux/i.test(ua) ? "Linux" : "Other";
  const browser = /edg\//i.test(ua) ? "Edge" : /samsungbrowser/i.test(ua) ? "Samsung Internet" :
    /chrome|crios/i.test(ua) ? "Chrome" : /firefox|fxios/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "Other";
  const size = window.innerWidth < 576 ? "phone" : window.innerWidth < 992 ? "tablet" : "desktop";
  return os + " · " + browser + " · " + size;
}

function setFieldMessage(id, message) {
  document.getElementById(id).textContent = message || "";
}

function initFeedbackPage() {
  const form = document.getElementById("feedback-form");
  const messageInput = document.getElementById("feedback-message");
  const emailInput = document.getElementById("feedback-email");
  const contactOk = document.getElementById("feedback-contact-ok");
  const emailWrap = document.getElementById("feedback-email-wrap");
  const count = document.getElementById("feedback-count");
  const alertBox = document.getElementById("feedback-alert");
  const submit = document.getElementById("feedback-submit");
  const user = getUser();
  const loggedIn = !!(user && hasAuthSession());

  // "Back" returns to the app for signed-in people, the home page otherwise.
  const backHref = loggedIn ? "dashboard.html" : "index.html";
  document.getElementById("feedback-back").href = backHref;
  document.getElementById("thanks-continue").href = backHref;

  if (user && user.email) emailInput.value = user.email;

  messageInput.addEventListener("input", function () {
    count.textContent = messageInput.value.length + " / " + FEEDBACK_MAX_LENGTH;
    clearFieldError(messageInput);
  });
  emailInput.addEventListener("input", function () { clearFieldError(emailInput); });
  contactOk.addEventListener("change", function () {
    emailWrap.hidden = !contactOk.checked;
    if (contactOk.checked) emailInput.focus();
  });
  form.addEventListener("change", function (event) {
    if (event.target.name === "rating") setFieldMessage("feedback-rating-error", "");
    if (event.target.name === "category") setFieldMessage("feedback-category-error", "");
  });

  if (!getAuthClient()) {
    showFormAlert(alertBox, "Feedback can't be sent right now. Please try again later.");
    submit.disabled = true;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    hideFormAlert(alertBox);

    const rating = form.querySelector('input[name="rating"]:checked');
    const category = form.querySelector('input[name="category"]:checked');
    const message = messageInput.value.trim();
    const wantsReply = contactOk.checked;
    const email = emailInput.value.trim();
    let firstInvalid = null;

    if (!rating) {
      setFieldMessage("feedback-rating-error", "Please choose how you feel.");
      firstInvalid = firstInvalid || document.getElementById("rating-1");
    }
    if (!category) {
      setFieldMessage("feedback-category-error", "Please choose what it's about.");
      firstInvalid = firstInvalid || document.getElementById("cat-bug");
    }
    if (message.length < FEEDBACK_MIN_LENGTH) {
      setFieldError(messageInput, "Please write a few words.");
      firstInvalid = firstInvalid || messageInput;
    }
    if (wantsReply && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setFieldError(emailInput, "Please enter a valid email so we can reply.");
      firstInvalid = firstInvalid || emailInput;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    // Bots fill the hidden field: pretend it worked and send nothing.
    if (document.getElementById("feedback-website").value) {
      showThanks();
      return;
    }

    if (!navigator.onLine) {
      showFormAlert(alertBox, "You're offline. Please connect to the internet and try again.");
      return;
    }

    setBusy(submit, true, "Sending…");
    getAuthClient().from("luniva_feedback").insert({
      rating: Number(rating.value),
      category: category.value,
      message: message.slice(0, FEEDBACK_MAX_LENGTH),
      contact_email: wantsReply ? email : null,
      page: getFeedbackSourcePage(),
      device: describeDevice(),
      app_installed: typeof isInstalledApp === "function" ? isInstalledApp() : false
    }).then(function (result) {
      setBusy(submit, false);
      if (result.error) throw result.error;
      showThanks();
    }).catch(function (error) {
      setBusy(submit, false);
      console.warn("Luniva feedback:", error);
      showFormAlert(alertBox, "Sorry — your feedback couldn't be sent. Please try again in a moment.");
    });
  });

  function showThanks() {
    document.getElementById("feedback-panel").hidden = true;
    document.getElementById("feedback-thanks").hidden = false;
    document.getElementById("thanks-title").focus();
  }

  document.getElementById("thanks-again").addEventListener("click", function () {
    form.reset();
    if (user && user.email) emailInput.value = user.email;
    emailWrap.hidden = true;
    count.textContent = "0 / " + FEEDBACK_MAX_LENGTH;
    document.getElementById("feedback-thanks").hidden = true;
    document.getElementById("feedback-panel").hidden = false;
    document.getElementById("feedback-title").focus();
  });
}

initFeedbackPage();
