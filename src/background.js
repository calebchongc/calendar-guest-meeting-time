const eventsByTab = new Map();

function notifyTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message, () => void chrome.runtime.lastError);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  if (!message || tabId == null) return;

  if (message.type === "event-context") {
    if (message.open) {
      eventsByTab.set(tabId, {
        startMs: message.startMs,
        endMs: message.endMs,
        viewerTz: message.viewerTz,
        locale: message.locale || "en",
        guests: message.guests || [],
        eventId: message.eventId || null,
      });
    } else {
      eventsByTab.delete(tabId);
    }
    notifyTab(tabId, { type: "event-context-updated" });
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "resolve-meeting") {
    const context = eventsByTab.get(tabId);
    const email = String(message.email || "").toLowerCase();
    if (!context || !context.guests.includes(email)) {
      sendResponse({ ok: false });
      return;
    }
    sendResponse({
      ok: true,
      startMs: context.startMs,
      endMs: context.endMs,
      viewerTz: context.viewerTz,
      locale: context.locale,
    });
    return;
  }

  if (message.type === "set-card-height") {
    notifyTab(tabId, { type: "set-card-height", height: message.height });
    sendResponse({ ok: true });
  }
});
