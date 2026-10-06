const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const context = { console, Intl, atob, Date, Number, String, JSON };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../src/logic.js"), "utf8"),
  context
);
const AWX = context.AWX;

const EVENT_ID = "311erqtjg3bikk6p2akjuj8ptg";
const START = Date.parse("2026-10-01T10:00:00Z");
const END = Date.parse("2026-10-01T10:30:00Z");

test("decodes the calendar dialog event id", () => {
  const raw = Buffer.from(
    EVENT_ID + " caleb.chong@airwallex.com",
    "utf8"
  ).toString("base64");
  assert.equal(AWX.decodeEventId(raw), EVENT_ID);
  assert.equal(AWX.decodeEventId(EVENT_ID), EVENT_ID);
});

test("reads the event instant after the id and ignores an earlier pair", () => {
  const script = [
    '[null,[1111111111111],"UTC"],[null,[1111111119999],"UTC"]',
    `["${EVENT_ID}",0,1790778241000,"Naver"]`,
    `[null,[${START}],"Europe/Amsterdam"],[null,[${END}],"Europe/Amsterdam"]`,
  ].join("");
  assert.equal(
    JSON.stringify(AWX.parseInitialData(script, EVENT_ID)),
    JSON.stringify([
      {
        startMs: START,
        endMs: END,
        eventTz: "Europe/Amsterdam",
      },
    ])
  );
});

test("does not treat a recurring instance id as this event", () => {
  const script = `["${EVENT_ID}_20261001T100000Z"] [null,[1111111111111],"UTC"],[null,[1111111119999],"UTC"]`;
  assert.equal(JSON.stringify(AWX.parseInitialData(script, EVENT_ID)), "[]");
});

test("reads an escaped initialdata pair", () => {
  const script = `["${EVENT_ID}"] [null,[${START}],\\"Europe/Amsterdam\\"],[null,[${END}],\\"Europe/Amsterdam\\"]`;
  assert.equal(AWX.parseInitialData(script, EVENT_ID)[0].startMs, START);
});

test("skips all-day spans", () => {
  const script = `["${EVENT_ID}"] [null,[${START}],"UTC"],[null,[${START + 86400000}],"UTC"]`;
  assert.equal(JSON.stringify(AWX.parseInitialData(script, EVENT_ID)), "[]");
});

test("prefers the dialog clock when initial data disagrees", () => {
  const dialog = { startMs: START, endMs: END };
  const pairs = [{ startMs: 1111111111111, endMs: 1111111119999, eventTz: "UTC" }];
  assert.equal(AWX.chooseTimes(pairs, dialog).startMs, START);
  assert.equal(AWX.chooseTimes([{ startMs: START, endMs: END }], dialog).startMs, START);
});

test("infers the next year for a January date in a late-December week", () => {
  assert.equal(
    AWX.inferYear(0, 2, "Calendar - Week of December 28, 2026"),
    2027
  );
});

test("keeps the dated when-line and skips a clock with no date", () => {
  const lines = AWX.whenLines(
    [
      "Billing x Tax [Weekly]",
      "Thursday, October 8\u22c55:30 \u2013 6:00pm",
      "Weekly on Thursday",
    ].join("\n")
  );
  assert.equal(JSON.stringify(lines), JSON.stringify(["Thursday, October 8\u22c55:30 \u2013 6:00pm"]));
  assert.equal(AWX.parseDialogWhen("5:30 \u2013 6:00pm", null, "Asia/Singapore"), null);
});

test("parses a split date and clock from the dialog", () => {
  const lines = AWX.whenLines("Thursday, October 8\n5:30 \u2013 6:00pm");
  const parsed = AWX.parseDialogWhen(
    lines[0],
    null,
    "Asia/Singapore",
    "Airwallex - Calendar - Week of October 4, 2026"
  );
  assert.equal(parsed.startMs, Date.parse("2026-10-08T09:30:00Z"));
  assert.equal(parsed.endMs, Date.parse("2026-10-08T10:00:00Z"));
});

test("parses the live dialog line in Singapore time", () => {
  const parsed = AWX.parseDialogWhen(
    "Thursday, October 1\u22c56:00 \u2013 6:30pm",
    2026,
    "Asia/Singapore"
  );
  assert.equal(parsed.startMs, START);
  assert.equal(parsed.endMs, END);
});

test("flips a start meridiem that would land after the end", () => {
  const parsed = AWX.parseDialogWhen(
    "October 1 11:00 \u2013 1:00pm",
    2026,
    "Asia/Singapore"
  );
  assert.equal(parsed.startMs, Date.parse("2026-10-01T03:00:00Z"));
  assert.equal(parsed.endMs, Date.parse("2026-10-01T05:00:00Z"));
});

test("picks the guest zone from the latest formatter burst", () => {
  const yuxiang = [
    { tz: "Europe/Amsterdam", t: 1000 },
    { tz: "Europe/Amsterdam", t: 1001 },
    { tz: "Asia/Singapore", t: 1002 },
  ];
  assert.equal(AWX.pickGuestZone(yuxiang, "Asia/Singapore"), "Europe/Amsterdam");

  const ezgi = yuxiang.concat([
    { tz: "Europe/London", t: 5000 },
    { tz: "Europe/London", t: 5001 },
    { tz: "Asia/Singapore", t: 5002 },
  ]);
  assert.equal(AWX.pickGuestZone(ezgi, "Asia/Singapore"), "Europe/London");

  const self = ezgi.concat([
    { tz: "Asia/Singapore", t: 9000 },
    { tz: "Asia/Singapore", t: 9001 },
  ]);
  assert.equal(AWX.pickGuestZone(self, "Asia/Singapore"), "Asia/Singapore");
});

test("formats the meeting in the guest zone", () => {
  assert.equal(
    AWX.formatRange(START, END, "Europe/Amsterdam", "en-US", "Asia/Singapore"),
    "Thu, 12:00 PM \u2013 12:30 PM"
  );
  const laStart = Date.parse("2026-10-01T20:00:00Z");
  const laEnd = Date.parse("2026-10-01T20:30:00Z");
  assert.match(
    AWX.formatRange(laStart, laEnd, "America/Los_Angeles", "en-US", "Asia/Singapore"),
    /Oct 1/
  );
});

test("reads a timezone from working-hours status lines", () => {
  const now = Date.parse("2026-10-05T15:31:00Z");
  assert.equal(AWX.hasLocalTime("Outside working hours - 5:31 PM GMT+2"), true);
  assert.equal(AWX.hasLocalTime("Within working hours - 4:32 PM GMT+1"), true);
  assert.equal(
    JSON.stringify(
      AWX.chooseGuestZone(
        [{ tz: "Australia/Melbourne", t: 1000 }],
        "Asia/Singapore",
        "Outside working hours - 5:31 PM GMT+2",
        now
      )
    ),
    JSON.stringify({ offsetMinutes: 2 * 60 })
  );
  assert.equal(
    AWX.chooseGuestZone(
      [{ tz: "Europe/London", t: 1000 }, { tz: "Asia/Singapore", t: 1001 }],
      "Asia/Singapore",
      "Within working hours - 4:32 PM GMT+1",
      now
    ).timeZone,
    "Europe/London"
  );
});

test("hides the meeting time when this card has no local time", () => {
  const stale = [{ tz: "Australia/Melbourne", t: 1000 }];
  const now = Date.parse("2026-10-08T02:00:00Z");
  assert.equal(AWX.hasLocalTime("Out of office - back on Thu, Oct 8"), false);
  assert.equal(
    AWX.chooseGuestZone(stale, "Asia/Singapore", "Out of office - back on Thu, Oct 8", now),
    null
  );
  assert.equal(JSON.stringify(AWX.chooseGuestZone(stale, "Asia/Singapore", "", now)), "null");
});

test("ignores a stale zone that disagrees with the card offset", () => {
  const now = Date.parse("2026-10-08T02:00:00Z");
  const staleLondon = [
    { tz: "Europe/London", t: 1000 },
    { tz: "Asia/Singapore", t: 1001 },
  ];
  assert.equal(
    JSON.stringify(
      AWX.chooseGuestZone(
        staleLondon,
        "Asia/Singapore",
        "Local time - 12:28 PM GMT+11",
        now
      )
    ),
    JSON.stringify({ offsetMinutes: 11 * 60 })
  );
  assert.equal(
    AWX.chooseGuestZone(
      [{ tz: "Australia/Melbourne", t: 1000 }, { tz: "Asia/Singapore", t: 1001 }],
      "Asia/Singapore",
      "Local time - 12:28 PM GMT+11",
      now
    ).timeZone,
    "Australia/Melbourne"
  );
});

test("formats from the card's GMT offset when no zone id was captured", () => {
  const start = Date.parse("2026-10-08T09:30:00Z");
  const end = Date.parse("2026-10-08T10:00:00Z");
  assert.equal(AWX.parseGmtOffset("Local time - 1:42 AM GMT+11"), 11 * 60);
  assert.equal(
    AWX.formatOffsetRange(start, end, 11 * 60, "en-US", "Asia/Singapore"),
    "Thu, 8:30 PM \u2013 9:00 PM"
  );
  assert.equal(AWX.parseGmtOffset("Local time - 9:12 AM GMT+5:30"), 5 * 60 + 30);
  assert.equal(
    AWX.formatOffsetRange(start, end, 5 * 60 + 30, "en-US", "Asia/Singapore"),
    "Thu, 3:00 PM \u2013 3:30 PM"
  );
});
