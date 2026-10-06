(function () {
  if (window.__awxGuestZoneHook) return;
  window.__awxGuestZoneHook = true;

  const entries = [];
  const Orig = Intl.DateTimeFormat;

  function publish() {
    document.documentElement.setAttribute(
      "data-awx-zones",
      JSON.stringify(entries.slice(-30))
    );
    document.documentElement.dispatchEvent(new Event("awx-zones"));
  }

  function Wrapped(locales, options) {
    const formatter = new Orig(locales, options);
    try {
      if (options && options.timeZone && options.timeZoneName === "short") {
        entries.push({ tz: options.timeZone, t: Date.now() });
        if (entries.length > 40) entries.splice(0, entries.length - 30);
        publish();
      }
    } catch (e) {
      /* recording must not break the card */
    }
    return formatter;
  }

  Wrapped.prototype = Orig.prototype;
  Wrapped.supportedLocalesOf = Orig.supportedLocalesOf.bind(Orig);
  Intl.DateTimeFormat = Wrapped;
})();
