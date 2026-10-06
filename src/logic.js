(function (root) {
  const MONTHS = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
  };

  function decodeEventId(raw) {
    if (!raw) return null;
    const text = String(raw).trim();
    try {
      const decoded = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
      const id = decoded.split(/[\s\u0000]/)[0];
      const printable = /^[\x20-\x7e]+$/.test(decoded);
      if (
        id &&
        printable &&
        decoded.length > id.length &&
        /^[A-Za-z0-9_-]{8,}$/.test(id)
      ) {
        return id;
      }
    } catch (e) {
      /* attribute is not base64 */
    }
    return /^[A-Za-z0-9_-]{8,}$/.test(text) ? text : null;
  }

  function isIdChar(char) {
    return /[A-Za-z0-9_-]/.test(char || "");
  }

  function findBoundedId(scriptText, eventId) {
    let from = 0;
    while (from < scriptText.length) {
      const at = scriptText.indexOf(eventId, from);
      if (at < 0) return -1;
      const before = at > 0 ? scriptText[at - 1] : "";
      const after = scriptText[at + eventId.length] || "";
      if (!isIdChar(before) && !isIdChar(after)) return at;
      from = at + eventId.length;
    }
    return -1;
  }

  function readTimePair(match) {
    const startMs = Number(match[1]);
    const endMs = Number(match[3]);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return null;
    }
    if (endMs - startMs >= 24 * 60 * 60 * 1000) return null;
    return { startMs, endMs, eventTz: match[2] };
  }

  function parseInitialData(scriptText, eventId) {
    if (!scriptText || !eventId) return [];
    const at = findBoundedId(scriptText, eventId);
    if (at < 0) return [];
    const windowText = scriptText.slice(at, at + 100000);
    const re =
      /\[null,\[(\d{13})\],\\?"([^"\\]+)\\?"\],\[null,\[(\d{13})\],\\?"([^"\\]+)\\?"\]/g;
    const pairs = [];
    let match;
    while ((match = re.exec(windowText)) && pairs.length < 4) {
      const pair = readTimePair(match);
      if (pair) pairs.push(pair);
    }
    return pairs;
  }

  function chooseTimes(pairs, dialogTimes) {
    if (dialogTimes && pairs && pairs.length) {
      const close = pairs.find(
        (pair) => Math.abs(pair.startMs - dialogTimes.startMs) < 2 * 60 * 1000
      );
      return close || dialogTimes;
    }
    if (pairs && pairs.length) return pairs[0];
    return dialogTimes || null;
  }

  function yearFromTitle(title) {
    const match = String(title || "").match(/\b(20\d{2})\b/);
    return match ? Number(match[1]) : null;
  }

  function parseWeekOf(title) {
    const match = String(title || "").match(
      /Week of ([A-Za-z]+)\s+(\d{1,2}),\s*(20\d{2})/i
    );
    if (!match || MONTHS[match[1].toLowerCase()] == null) return null;
    return {
      month: MONTHS[match[1].toLowerCase()],
      day: Number(match[2]),
      year: Number(match[3]),
    };
  }

  function inferYear(month, day, title, nowMs) {
    const week = parseWeekOf(title);
    if (week) {
      const weekStart = Date.UTC(week.year, week.month, week.day);
      for (const year of [week.year - 1, week.year, week.year + 1]) {
        const delta = Date.UTC(year, month, day) - weekStart;
        if (delta >= -36e5 && delta < 8 * 864e5) return year;
      }
    }
    const now = nowMs == null ? Date.now() : nowMs;
    let bestYear = new Date(now).getUTCFullYear();
    let bestDelta = Infinity;
    for (const year of [bestYear - 1, bestYear, bestYear + 1]) {
      const delta = Math.abs(Date.UTC(year, month, day) - now);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestYear = year;
      }
    }
    return bestYear;
  }

  function meridiem(token) {
    if (!token) return null;
    return /^a/i.test(token) ? "am" : "pm";
  }

  function to24(hour, mer) {
    if (!mer) return hour;
    let h = hour % 12;
    if (mer === "pm") h += 12;
    return h;
  }

  function resolveHours(startHour, endHour, startMer, endMer) {
    if (!startMer && !endMer) return [startHour, endHour];
    const shared = startMer || endMer;
    let start = to24(startHour, startMer || shared);
    let end = to24(endHour, endMer || shared);
    if (!startMer && start > end) start = to24(startHour, shared === "pm" ? "am" : "pm");
    if (!endMer && end < start) end = to24(endHour, shared === "pm" ? "am" : "pm");
    return [start, end];
  }

  function tzOffset(ms, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(ms));
    const map = {};
    for (const part of parts) map[part.type] = part.value;
    const asUtc = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour) % 24,
      Number(map.minute),
      Number(map.second)
    );
    return asUtc - ms;
  }

  function zonedToUtc(year, month, day, hour, minute, timeZone) {
    const utc = Date.UTC(year, month, day, hour, minute);
    const offset = tzOffset(utc, timeZone);
    let ms = utc - offset;
    const corrected = tzOffset(ms, timeZone);
    if (corrected !== offset) ms = utc - corrected;
    return ms;
  }

  function whenLines(text) {
    const raw = String(text || "")
      .split(/\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const lines = [];
    for (let i = 0; i < raw.length; i++) {
      const line = raw[i];
      const timed = /\d{1,2}:\d{2}/.test(line) && /[A-Za-z]/.test(line);
      if (timed && line.length >= 8 && line.length <= 120) {
        lines.push(line);
        continue;
      }
      const next = raw[i + 1] || "";
      if (
        /^[A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2}\b/.test(line) &&
        /^\d{1,2}:\d{2}/.test(next)
      ) {
        lines.push(line + " " + next);
      }
    }
    return lines;
  }

  function parseDialogWhen(text, yearHint, timeZone, title, nowMs) {
    if (!text || !timeZone) return null;
    const normalized = String(text).replace(/\u22c5|\u00b7/g, " ").replace(/\s+/g, " ").trim();
    const match = normalized.match(
      /(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2})(?:,\s*(20\d{2}))?\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*[\u2013\u2014-]\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i
    );
    if (!match) return null;
    const month = MONTHS[match[1].toLowerCase()];
    if (month == null) return null;
    const day = Number(match[2]);
    const year = match[3]
      ? Number(match[3])
      : yearHint || inferYear(month, day, title, nowMs);
    if (!year) return null;
    const startMinute = match[5] ? Number(match[5]) : 0;
    const endMinute = match[8] ? Number(match[8]) : 0;
    const [startHour, endHour] = resolveHours(
      Number(match[4]),
      Number(match[7]),
      meridiem(match[6]),
      meridiem(match[9])
    );
    if (
      ![startHour, endHour, startMinute, endMinute].every(Number.isFinite) ||
      startHour > 23 ||
      endHour > 23 ||
      startMinute > 59 ||
      endMinute > 59
    ) {
      return null;
    }
    const startMs = zonedToUtc(year, month, day, startHour, startMinute, timeZone);
    let endMs = zonedToUtc(year, month, day, endHour, endMinute, timeZone);
    if (endMs <= startMs) {
      endMs = zonedToUtc(year, month, day + 1, endHour, endMinute, timeZone);
    }
    if (endMs - startMs >= 24 * 60 * 60 * 1000) return null;
    return { startMs, endMs };
  }

  function latestBurst(entries) {
    if (!entries.length) return [];
    const burst = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      if (burst.length && entries[i + 1].t - entries[i].t > 250) break;
      burst.push(entries[i]);
    }
    return burst.reverse();
  }

  function pickGuestZone(entries, viewerTz) {
    if (!entries || !entries.length || !viewerTz) return null;
    const burst = latestBurst(entries);
    const others = burst.filter((entry) => entry.tz && entry.tz !== viewerTz);
    if (others.length) return others[others.length - 1].tz;
    if (burst.some((entry) => entry.tz === viewerTz)) return viewerTz;
    return null;
  }

  function dayKey(ms, timeZone, locale) {
    return new Intl.DateTimeFormat(locale || "en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  }

  function zoneForOffset(offsetMinutes) {
    if (!Number.isFinite(offsetMinutes) || offsetMinutes % 60 !== 0) return null;
    const hours = offsetMinutes / 60;
    if (hours === 0) return "UTC";
    if (Math.abs(hours) > 14) return null;
    return "Etc/GMT" + (hours > 0 ? "-" : "+") + Math.abs(hours);
  }

  function parseGmtOffset(text) {
    const match = String(text || "").match(/GMT\s*([+-])\s*(\d{1,2})(?::(\d{2}))?/i);
    if (!match) return null;
    const sign = match[1] === "-" ? -1 : 1;
    return sign * (Number(match[2]) * 60 + (match[3] ? Number(match[3]) : 0));
  }

  function hasLocalTime(text) {
    const line = String(text || "");
    if (!/\d{1,2}:\d{2}/.test(line)) return false;
    if (/GMT\s*[+-]\s*\d/i.test(line)) return true;
    return /local time/i.test(line);
  }

  function offsetMatches(timeZone, offsetMinutes, nowMs) {
    if (!timeZone || !Number.isFinite(offsetMinutes)) return false;
    const delta = Math.round(tzOffset(nowMs == null ? Date.now() : nowMs, timeZone) / 60000);
    return delta === offsetMinutes;
  }

  function chooseGuestZone(entries, viewerTz, localText, nowMs) {
    if (!hasLocalTime(localText)) return null;
    const offset = parseGmtOffset(localText);
    const picked = pickGuestZone(entries, viewerTz);
    if (picked && (offset == null || offsetMatches(picked, offset, nowMs))) {
      return { timeZone: picked };
    }
    if (offset == null) return null;
    return { offsetMinutes: offset };
  }

  function formatRange(startMs, endMs, timeZone, locale, viewerTz, viewerMs) {
    const loc = locale || "en";
    const start = new Date(startMs);
    const end = new Date(endMs);
    const timeFmt = new Intl.DateTimeFormat(loc, {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    });
    const viewerInstant = viewerMs == null ? startMs : viewerMs;
    const sameViewerDay =
      !viewerTz ||
      dayKey(startMs, timeZone, loc) === dayKey(viewerInstant, viewerTz, loc);
    const sameGuestDay = dayKey(startMs, timeZone, loc) === dayKey(endMs, timeZone, loc);
    const dayFmt = new Intl.DateTimeFormat(loc, {
      timeZone,
      weekday: "short",
      month: sameViewerDay ? undefined : "short",
      day: sameViewerDay ? undefined : "numeric",
    });
    const startClock = timeFmt.format(start);
    const endClock = timeFmt.format(end);
    if (!sameGuestDay) {
      return (
        dayFmt.format(start) +
        ", " +
        startClock +
        " \u2013 " +
        dayFmt.format(end) +
        ", " +
        endClock
      );
    }
    return dayFmt.format(start) + ", " + startClock + " \u2013 " + endClock;
  }

  function formatOffsetRange(startMs, endMs, offsetMinutes, locale, viewerTz) {
    const zone = zoneForOffset(offsetMinutes);
    if (zone) return formatRange(startMs, endMs, zone, locale, viewerTz);
    const shift = offsetMinutes * 60000;
    return formatRange(startMs + shift, endMs + shift, "UTC", locale, viewerTz, startMs);
  }

  root.AWX = {
    decodeEventId,
    parseInitialData,
    chooseTimes,
    yearFromTitle,
    inferYear,
    whenLines,
    parseDialogWhen,
    pickGuestZone,
    parseGmtOffset,
    hasLocalTime,
    chooseGuestZone,
    formatRange,
    formatOffsetRange,
    zonedToUtc,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
