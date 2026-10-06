# Guest meeting time

Chrome extension that adds the open Google Calendar event's time to a guest's profile card, in that guest's timezone.

The card already shows a clock for that person: "Local time", "Within working hours", or "Outside working hours". It does not show when the meeting you have open falls for them. This extension adds a second line under that clock and leaves the existing line in place.

A 6:00–6:30pm meeting on a Singapore calendar is `Meeting time – Thu, 12:00 PM – 12:30 PM` for a guest in Amsterdam. The weekday stays when the meeting is on the same day for both of you. A different day for the guest includes the date.

## Install

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked** and select this folder.
4. Open Google Calendar, open an event, then open a guest's card.

After reloading the extension, reload the Calendar tab. A script left over from the previous copy cannot talk to the new one, and it used to throw `Extension context invalidated` while it kept polling.

## When the line stays hidden

The row is drawn only when the open event and the card on screen can be joined.

- No Calendar event dialog is open, so a card in Gmail or Docs is left alone.
- The card has no clock and no GMT offset. There is nothing to convert into, and a previous guest's meeting time is removed.
- The event is all-day.
- The guest is a room or other calendar resource.

"Within working hours" and "Outside working hours" count as a timezone when the line includes a clock and a GMT offset. A status with neither, such as an out-of-office note, does not.

## How the two pages meet

The card is a Contacts hovercard (`contacts.google.com/widget/hovercard`), loaded in a cross-origin iframe. Calendar cannot read it, and the card never receives the meeting. The extension joins them in the background.

On `calendar.google.com`, a content script reads the open dialog. Guest emails come from `data-email`. Your timezone comes from Calendar's own setting, `#xTimezone`, rather than the laptop timezone. The start and end come from `script#initialdata` when that timestamp agrees with the dialog. Otherwise they are parsed from the dialog text. The date and the clock are often separate elements, so those lines are joined before parsing. All-day spans are dropped.

On the hovercard, a main-world script records the timezone id the widget passes to `Intl.DateTimeFormat` while it formats the guest's clock. The rendered card only keeps a short offset such as `GMT+2`. That offset is wrong across a daylight-saving change, and the event's own timezone is not the guest's. The recorded id is used when it matches the offset on the card. A stale id from an earlier guest is ignored. If no id matches, the GMT offset on the current card is used.

The background script keeps one open event per Calendar tab. The card gets a meeting time only when its email is on that event. The hovercard iframe is clipped to the height it asked for, so Calendar grows the frame to fit the new row.

## Limits

The dialog parser expects English month names. A calendar in another language will not produce a meeting time from the dialog text. Google changes this markup often. The stabler anchors are `data-email`, the dialog's date-and-time text, `#xTimezone`, and the `Intl.DateTimeFormat` hook.

## Develop

```bash
node --test test/logic.test.js
```

The tests cover event-id decoding, initial-data parsing, dialog time parsing, guest timezone choice, and formatting. They do not drive Calendar.
