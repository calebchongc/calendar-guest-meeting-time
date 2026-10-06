const AWX = globalThis.AWX;

let lastHeight = 0;
let renderTimer = 0;

function extensionAlive() {
  try {
    return !!(chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function sendMessage(message, callback) {
  if (!extensionAlive()) return false;
  try {
    chrome.runtime.sendMessage(message, (response) => {
      let invalidated = false;
      try {
        invalidated = !!chrome.runtime.lastError;
      } catch (e) {
        invalidated = true;
      }
      if (callback) callback(invalidated ? null : response);
    });
    return true;
  } catch (e) {
    return false;
  }
}

function readZones() {
  try {
    const raw = document.documentElement.getAttribute("data-awx-zones");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function localTimeText() {
  const labeled = [...document.querySelectorAll("[aria-label]")].find((node) => {
    if (node.closest("#awx-meeting-time")) return false;
    return AWX.hasLocalTime(node.getAttribute("aria-label") || "");
  });
  if (labeled) return labeled.getAttribute("aria-label") || "";
  const body = document.body ? document.body.innerText : "";
  const line = body.split(/\n/).find((entry) => AWX.hasLocalTime(entry));
  return line ? line.trim() : "";
}

function guestEmail() {
  const node = document.querySelector("[data-email]");
  const fromAttr = node ? (node.getAttribute("data-email") || "").trim().toLowerCase() : "";
  if (fromAttr) return fromAttr;
  const link = document.querySelector('a[aria-label^="Email "]');
  const match = String((link && link.getAttribute("aria-label")) || "").match(
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
  );
  return match ? match[0].toLowerCase() : "";
}

function removeRow() {
  const row = document.getElementById("awx-meeting-time");
  if (row) row.remove();
  lastHeight = 0;
}

function placeRow(label) {
  const host = document.querySelector("[data-enable-local-time-in-hovercard]");
  const link = document.querySelector('a[aria-label="Open detailed view"]');
  const anchor = host || link;
  if (!anchor || !anchor.parentElement) return false;

  let row = document.getElementById("awx-meeting-time");
  if (!row) {
    const labelSpan =
      host &&
      [...host.querySelectorAll("[aria-label], span")].find((node) =>
        AWX.hasLocalTime(node.getAttribute("aria-label") || node.textContent || "")
      );
    const source = labelSpan && labelSpan.parentElement;
    if (source && source !== host) {
      row = source.cloneNode(true);
      row.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
      for (const node of [row, ...row.querySelectorAll("*")]) {
        if (AWX.hasLocalTime(node.getAttribute("aria-label") || "")) {
          node.removeAttribute("aria-label");
        }
        for (const attr of [...node.attributes]) {
          if (
            attr.name.startsWith("js") ||
            attr.name === "jslog" ||
            attr.name.startsWith("data-tooltip") ||
            attr.name === "aria-describedby" ||
            attr.name === "tabindex"
          ) {
            node.removeAttribute(attr.name);
          }
        }
      }
    } else {
      row = document.createElement("div");
      row.style.cssText =
        "margin:4px 16px 8px;font:400 14px/20px Roboto,Arial,sans-serif;color:#1f1f1f;";
      row.append(document.createElement("span"));
    }
    row.id = "awx-meeting-time";
    row.setAttribute("data-meeting-time", "1");
  }

  const textNode =
    row.querySelector("span") ||
    row.appendChild(document.createElement("span"));
  const text = "Meeting time \u2013 " + label;
  if (textNode.textContent !== text) textNode.textContent = text;
  textNode.removeAttribute("aria-label");
  row.setAttribute("aria-label", text);

  if (host) {
    if (row.previousElementSibling !== host) host.insertAdjacentElement("afterend", row);
  } else if (row.nextElementSibling !== link) {
    link.insertAdjacentElement("beforebegin", row);
  }
  return true;
}

function requestHeight() {
  const row = document.getElementById("awx-meeting-time");
  const link = document.querySelector('a[aria-label="Open detailed view"]');
  const bottoms = [];
  if (row) bottoms.push(row.getBoundingClientRect().bottom);
  if (link) bottoms.push(link.getBoundingClientRect().bottom);
  if (!bottoms.length) return;
  const needed = Math.ceil(Math.max.apply(null, bottoms) + 16);
  const client = document.documentElement.clientHeight;
  if (needed <= client + 1 && Math.abs(needed - lastHeight) < 2) return;
  lastHeight = needed;
  sendMessage({ type: "set-card-height", height: needed });
}

function render() {
  const email = guestEmail();
  const localTime = localTimeText();
  if (!email || !AWX.hasLocalTime(localTime)) {
    removeRow();
    return;
  }
  const zones = readZones();
  sendMessage({ type: "resolve-meeting", email }, (response) => {
    const currentLocal = localTimeText();
    if (!response || !response.ok || guestEmail() !== email || !AWX.hasLocalTime(currentLocal)) {
      removeRow();
      return;
    }
    const choice = AWX.chooseGuestZone(zones, response.viewerTz, currentLocal);
    if (!choice) {
      removeRow();
      return;
    }
    let label;
    try {
      label = choice.timeZone
        ? AWX.formatRange(
            response.startMs,
            response.endMs,
            choice.timeZone,
            response.locale,
            response.viewerTz
          )
        : AWX.formatOffsetRange(
            response.startMs,
            response.endMs,
            choice.offsetMinutes,
            response.locale,
            response.viewerTz
          );
    } catch (e) {
      removeRow();
      return;
    }
    if (placeRow(label)) requestHeight();
  });
}

function schedule() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 60);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "event-context-updated") schedule();
});

document.documentElement.addEventListener("awx-zones", schedule);
new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["data-email", "data-awx-zones"],
});
const poll = setInterval(() => {
  if (!extensionAlive()) {
    clearInterval(poll);
    return;
  }
  schedule();
}, 400);
schedule();
