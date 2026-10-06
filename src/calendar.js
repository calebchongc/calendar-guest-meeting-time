const AWX = globalThis.AWX;

let lastSignature = "";
let lastSentAt = 0;
let dialogWasOpen = false;

function extensionAlive() {
  try {
    return !!(chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function whenTexts(dialog) {
  return AWX.whenLines(dialog.innerText || "");
}

function readEvent() {
  const dialog = document.getElementById("xDetDlg");
  if (!dialog) return { open: false };

  const viewerTz = (document.getElementById("xTimezone") || {}).textContent || "";
  const locale = ((document.getElementById("xUserLocale") || {}).textContent || "en").trim();
  if (!viewerTz.trim()) return { open: true, pending: true };

  const guests = [
    ...new Set(
      [...dialog.querySelectorAll("[data-email]")]
        .map((node) => (node.getAttribute("data-email") || "").trim().toLowerCase())
        .filter((email) => email && !email.endsWith("@resource.calendar.google.com"))
    ),
  ];
  if (!guests.length) return { open: true, pending: true };

  const jslogId = ((dialog.getAttribute("jslog") || "").match(/"([a-z0-9]{20,32})"/) ||
    [])[1];
  const eventId = AWX.decodeEventId(dialog.getAttribute("data-eventid")) || jslogId || null;

  const scriptText = (document.getElementById("initialdata") || {}).textContent || "";
  const pairs = AWX.parseInitialData(scriptText, eventId);
  let dialogTimes = null;
  for (const text of whenTexts(dialog)) {
    dialogTimes = AWX.parseDialogWhen(text, null, viewerTz.trim(), document.title);
    if (dialogTimes) break;
  }
  const times = AWX.chooseTimes(pairs, dialogTimes);
  if (!times) return { open: true, pending: true };

  return {
    open: true,
    eventId,
    startMs: times.startMs,
    endMs: times.endMs,
    viewerTz: viewerTz.trim(),
    locale,
    guests,
  };
}

function sendContext(event) {
  if (!extensionAlive()) return;
  try {
    chrome.runtime.sendMessage(Object.assign({ type: "event-context" }, event), () => {
      try {
        void chrome.runtime.lastError;
      } catch (e) {
        /* extension was reloaded */
      }
    });
  } catch (e) {
    /* extension was reloaded */
  }
}

function publish(force) {
  const event = readEvent();
  if (event.pending) return;
  if (!event.open) {
    if (lastSignature !== "closed") {
      lastSignature = "closed";
      lastSentAt = Date.now();
      sendContext({ open: false });
    }
    return;
  }
  const signature = JSON.stringify(event);
  const now = Date.now();
  if (!force && signature === lastSignature && now - lastSentAt < 15000) return;
  lastSignature = signature;
  lastSentAt = now;
  sendContext(event);
}

function setCardHeight(height) {
  const frame = [...document.querySelectorAll("iframe")].find((node) =>
    (node.src || "").includes("/widget/hovercard/")
  );
  if (!frame || !height) return;
  const px = Math.round(height) + "px";
  frame.style.height = px;
  frame.style.maxHeight = "none";
  if (frame.parentElement) {
    frame.parentElement.style.height = px;
    frame.parentElement.style.maxHeight = "none";
  }
}

function resetCardHeight() {
  const frame = [...document.querySelectorAll("iframe")].find((node) =>
    (node.src || "").includes("/widget/hovercard/")
  );
  if (!frame) return;
  frame.style.height = "";
  frame.style.maxHeight = "";
  if (frame.parentElement) {
    frame.parentElement.style.height = "";
    frame.parentElement.style.maxHeight = "";
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "set-card-height") setCardHeight(message.height);
});

const poll = setInterval(() => {
  if (!extensionAlive()) {
    clearInterval(poll);
    return;
  }
  const open = !!document.getElementById("xDetDlg");
  if (dialogWasOpen && !open) resetCardHeight();
  dialogWasOpen = open;
  publish(false);
}, 400);
publish(true);
