/* =========================================================
   Luniva — companion.js
   "A little space for you": supportive messages chosen by how
   the user feels, plus jokes, questions, tiny challenges and
   motivation. No item is shown twice in a row.
   Requires storage.js and app.js.
   ========================================================= */

// Supportive messages for each feeling (at least 8 each).
const SUPPORT_MESSAGES = {
  stressed: [
    "Take a breath. You don't have to solve everything right now. One small step is enough. 🌷",
    "Stress is a sign you care. Put one thing down for a moment — it will still be there later.",
    "Try loosening your shoulders and unclenching your jaw. Your body deserves a little ease.",
    "You're allowed to do things slowly today. Slow is still moving.",
    "Make a list of just three things. Everything else can wait until tomorrow.",
    "Breathe in for four, hold for four, out for six. You're doing okay.",
    "You've handled hard days before. You'll handle this one too, one piece at a time.",
    "It's okay to ask for help or say no. Protecting your energy is wise. 🌿"
  ],
  scared: [
    "You're safe in this moment. Let's take one slow breath together. 🌙",
    "Fear can feel so big. You don't have to face it all at once.",
    "Name five things you can see around you. It can help you feel grounded.",
    "It's okay to feel scared. Reaching out to someone you trust can make it lighter.",
    "Place a hand on your chest and feel it rise and fall. You are here, and you are okay right now.",
    "Whatever you're facing, you don't have to face it alone.",
    "Be as gentle with yourself as you would be with a friend who felt this way.",
    "This feeling is real, and it will pass. Stay with your breath for a little while. 🌷"
  ],
  sad: [
    "It's okay to feel sad. Your feelings are valid, and you don't need to hide them. 💜",
    "Be soft with yourself today. You deserve the same kindness you give others.",
    "Sometimes a warm drink, a blanket and a quiet moment are exactly enough.",
    "Sadness comes in waves. This one will ease, even if slowly.",
    "You don't have to be okay right now. Just be here, and that's enough.",
    "Would talking to someone you trust help? You're never a burden for needing care.",
    "Let yourself rest. Healing isn't lazy — it's necessary. 🌙",
    "You matter, on the good days and on the heavy ones too."
  ],
  angry: [
    "Your anger makes sense. Let's give it somewhere safe to go. 🌿",
    "Try a few slow breaths or a short walk before you respond to anything.",
    "It's okay to feel angry. You're allowed to take space before you decide what to do.",
    "Squeeze your fists tight for five seconds, then let go. Notice the release.",
    "Write down what's bothering you, then close the notebook. You can come back to it later.",
    "Anger often protects something important to you. What might that be?",
    "Splash some cool water on your face — it can help your body calm down.",
    "You don't have to fix this feeling right now. Just let it cool a little. 🌷"
  ],
  overwhelmed: [
    "When everything feels like too much, focus only on the next five minutes. 🌙",
    "You don't have to carry it all at once. Put something down, just for now.",
    "Pick the smallest possible next step — even drinking a glass of water counts.",
    "It's okay to pause. The world can wait while you breathe.",
    "Try writing everything down. Getting it out of your head can make it feel smaller.",
    "You are one person, and you are doing enough. Really.",
    "Ask for help if you can. You deserve support, not just endurance.",
    "Breathe in slowly… and out even more slowly. You're still here, and that matters. 🌷"
  ],
  tired: [
    "Rest is not a reward — it's something you need. Let yourself slow down. 😴",
    "Maybe today is a 'do the minimum' day. That's completely okay.",
    "A short nap, a glass of water or a few quiet minutes can go a long way.",
    "Your body is asking for care. Listening to it is a kind thing to do.",
    "Put your phone down for five minutes and close your eyes. You've earned it.",
    "Tired days happen. They don't mean you're doing anything wrong.",
    "Try an early night tonight — tomorrow-you will be grateful. 🌙",
    "Go gently. Nobody expects you to run on empty."
  ],
  fine: [
    "Love that for you! Enjoy this steady moment. 🌷",
    "Fine is a lovely place to be. Maybe do one small nice thing for yourself today.",
    "Glad you're doing okay. Remember this feeling on harder days.",
    "A calm day is worth celebrating. What made today feel good?",
    "Keep being kind to yourself — it's clearly working. ✨",
    "Steady and fine? That's something to be grateful for.",
    "Why not share some of that good energy with someone you love today?",
    "Take a moment to notice what's going right. You deserve to enjoy it. 🌙"
  ]
};

// Feelings that get supportive messages only — no jokes or challenges.
const SUPPORT_ONLY_FEELINGS = ["scared", "sad", "overwhelmed"];

// Feelings that also get the breathing exercise.
const BREATHING_FEELINGS = ["stressed", "scared", "overwhelmed", "angry"];

const JOKES = [
  "Why did the moon skip dinner? Because it was already full. 🌕",
  "What do you call a sleeping dinosaur? A dino-snore! 🦖",
  "Why don't eggs tell jokes? They'd crack each other up. 🥚",
  "What did the ocean say to the beach? Nothing, it just waved. 🌊",
  "Why did the scarecrow win an award? He was outstanding in his field. 🌾",
  "What do you call cheese that isn't yours? Nacho cheese! 🧀",
  "Why did the cookie go to the doctor? It was feeling crummy. 🍪",
  "What do you call a bear with no teeth? A gummy bear! 🐻",
  "Why can't you trust stairs? They're always up to something. 🪜",
  "What did one plate say to the other? Dinner's on me! 🍽️"
];

const RANDOM_QUESTIONS = [
  "If you could have any animal as a best friend, which would you choose? 🐾",
  "What's a small thing that always makes you smile?",
  "If you could live inside any movie for a day, which one would it be? 🎬",
  "What's your ultimate comfort food?",
  "Which song would be the soundtrack of your life right now? 🎵",
  "If you could learn one new skill instantly, what would it be?",
  "What's the most beautiful place you've ever seen?",
  "Tea, coffee, or hot chocolate — and why? ☕",
  "What's something you're looking forward to this month?",
  "If your cat or dog could talk, what would they complain about? 😄"
];

const TINY_CHALLENGES = [
  "Drink some water 💧",
  "Stretch for 30 seconds 🙆",
  "Take five slow breaths 🌬️",
  "Listen to your favorite song 🎧",
  "Write one kind thing about yourself ✍️",
  "Step outside or open a window for fresh air 🌿",
  "Tidy one tiny spot — just one drawer or shelf",
  "Send a sweet message to someone you love 💌",
  "Roll your shoulders back five times",
  "Look out of a window and find three different colours 🎨"
];

const MOTIVATIONS = [
  "You are allowed to take up space and ask for what you need. 🌷",
  "Progress, not perfection. Every small step counts.",
  "You've survived 100% of your hardest days so far. That's strength.",
  "Your worth isn't measured by how productive you are today.",
  "Be proud of how far you've come, not just how far you have to go.",
  "You're growing, even when it doesn't feel like it. 🌱",
  "Today, choose kindness — especially towards yourself.",
  "You are capable of amazing things, one gentle step at a time. ✨",
  "Rest when you need to. You're a person, not a machine."
];

const DISTRACTIONS = {
  joke: { list: JOKES, label: "😂 Here's a joke" },
  question: { list: RANDOM_QUESTIONS, label: "💭 Random question" },
  challenge: { list: TINY_CHALLENGES, label: "✨ Tiny challenge" },
  motivate: { list: MOTIVATIONS, label: "🌷 For you" }
};

// Remembers the last item shown in each list so it isn't repeated.
const lastShown = {};

/** Pick a new item from a named list, never the same one twice in a row. */
function nextItem(listName, list) {
  const item = pickRandom(list, lastShown[listName]);
  lastShown[listName] = item;
  return item;
}

/** Update a message card with a gentle fade. */
function showMessage(cardId, label, text) {
  const card = document.getElementById(cardId);
  card.hidden = false;
  card.classList.remove("is-fresh");
  void card.offsetWidth;   // restart the CSS animation
  card.classList.add("is-fresh");
  card.querySelector(".message-label").textContent = label;
  card.querySelector(".message-text").textContent = text;
}

let currentFeeling = null;

function selectFeeling(feeling) {
  currentFeeling = feeling;
  document.querySelectorAll("[data-emotion]").forEach(function (button) {
    button.setAttribute("aria-pressed", String(button.getAttribute("data-emotion") === feeling));
  });

  const label = document.querySelector('[data-emotion="' + feeling + '"]').textContent.trim();
  showMessage("support-card", "For when you feel " + label.toLowerCase(), nextItem("support-" + feeling, SUPPORT_MESSAGES[feeling]));
  document.getElementById("another-message").hidden = false;

  // Scared, Sad and Overwhelmed get comfort only — no jokes or challenges.
  const supportOnly = SUPPORT_ONLY_FEELINGS.indexOf(feeling) !== -1;
  document.getElementById("distract-section").hidden = supportOnly;
  document.getElementById("support-only-note").hidden = !supportOnly;

  const showBreathing = BREATHING_FEELINGS.indexOf(feeling) !== -1;
  document.getElementById("breathing-section").hidden = !showBreathing;
  if (!showBreathing && breathingTimer) stopBreathing();
}

/* ---------------------------------------------------------
   BREATHING EXERCISE (4 seconds in, 4 seconds out)
   --------------------------------------------------------- */

let breathingTimer = null;

function stopBreathing() {
  clearInterval(breathingTimer);
  breathingTimer = null;
  const circle = document.getElementById("breathing-circle");
  circle.classList.remove("is-running", "is-inhale");
  document.getElementById("breathing-text").textContent = "Ready when you are";
  const button = document.getElementById("breathing-toggle");
  button.innerHTML = '<i class="bi bi-play-fill" aria-hidden="true"></i> Breathe with me';
  button.setAttribute("aria-pressed", "false");
}

function startBreathing() {
  const circle = document.getElementById("breathing-circle");
  const text = document.getElementById("breathing-text");
  const button = document.getElementById("breathing-toggle");
  let breaths = 0;
  let inhale = true;

  function step() {
    // Five full breaths, then stop gently.
    if (breaths >= 5) {
      stopBreathing();
      text.textContent = "Well done. Notice how you feel. 🌷";
      return;
    }
    circle.classList.toggle("is-inhale", inhale);
    text.textContent = inhale ? "Breathe in…" : "Breathe out…";
    if (!inhale) breaths++;
    inhale = !inhale;
  }

  circle.classList.add("is-running");
  button.innerHTML = '<i class="bi bi-stop-fill" aria-hidden="true"></i> Stop';
  button.setAttribute("aria-pressed", "true");
  step();
  breathingTimer = setInterval(step, 4000);
}

/* ---------------------------------------------------------
   PAGE SET-UP
   --------------------------------------------------------- */

function initCompanionPage() {
  document.querySelectorAll("[data-emotion]").forEach(function (button) {
    button.addEventListener("click", function () { selectFeeling(button.getAttribute("data-emotion")); });
  });

  document.getElementById("another-message").addEventListener("click", function () {
    if (currentFeeling) selectFeeling(currentFeeling);
  });

  document.querySelectorAll("[data-distract]").forEach(function (button) {
    button.addEventListener("click", function () {
      const kind = button.getAttribute("data-distract");
      const distraction = DISTRACTIONS[kind];
      showMessage("distract-card", distraction.label, nextItem(kind, distraction.list));
    });
  });

  document.getElementById("breathing-toggle").addEventListener("click", function () {
    if (breathingTimer) stopBreathing();
    else startBreathing();
  });
}

if (APP_PAGE_ALLOWED) initCompanionPage();
