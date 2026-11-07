/* ==========================================================================
   shifts.js
   ----------------------------------------------------------------------
   Staff attendance ("Work Shift") data helpers, shared by:
     - profile.js  -> the Staff clock-in / clock-out toggle and live timer
     - users.js    -> the Admin's "Shift History" modal

   One record per shift, stored in Store under the `shifts` key:
     { id: 'SHF-0001', username, name, clockIn: ISO string, clockOut: ISO string | null }
   A shift with clockOut === null is "Ongoing". A person can only have one
   ongoing shift at a time. Elapsed time is always computed from the saved
   clockIn timestamp, so the timer survives page reloads, navigating to other
   pages, and logging out/in without drifting.

   v2: shifts live in MongoDB (collection `shifts`). clockIn()/clockOut() call the API and return Promises;
   reads come from the in-memory copy loaded at page start.
   ========================================================================== */
const Shifts = (function () {
  const KEY = 'shifts';

  function all() { return Store.get(KEY, []); }
  function upsert(rec) {                       // keep the in-memory copy in step with what the server returned
    const list = all().filter(function (s) { return s.id !== rec.id; });
    list.unshift(rec);
    Store.set(KEY, list);
  }

  /* The person's ongoing shift, or null. */
  function active(username) {
    return all().find(function (s) { return s.username === username && !s.clockOut; }) || null;
  }

  /* Start a shift (async — the server stores it). Idempotent: if one is already ongoing the server returns it
     unchanged, so a double-click or a second open tab can never create overlapping shifts. */
  async function clockIn() {
    const rec = await Api.post('/users/shifts/clock-in');
    upsert(rec);
    return rec;
  }

  /* End the ongoing shift (marks it Completed). Resolves with the finished record. */
  async function clockOut() {
    const rec = await Api.post('/users/shifts/clock-out');
    upsert(rec);
    return rec;
  }

  /* All of a person's shifts, newest first. */
  function forUser(username) {
    return all()
      .filter(function (s) { return s.username === username; })
      .sort(function (a, b) { return a.clockIn < b.clockIn ? 1 : -1; });
  }

  /* Their most recent finished shift, or null. */
  function lastCompleted(username) {
    return forUser(username).find(function (s) { return !!s.clockOut; }) || null;
  }

  /* Milliseconds worked. For an ongoing shift this runs up to `nowMs` (default: right now). */
  function durationMs(rec, nowMs) {
    const end = rec.clockOut ? new Date(rec.clockOut).getTime() : (nowMs || Date.now());
    return Math.max(0, end - new Date(rec.clockIn).getTime());
  }

  /* 20820000 -> { hours: 5, mins: 47, secs: 0 } */
  function split(ms) {
    const total = Math.floor(Math.max(0, ms) / 1000);
    return { hours: Math.floor(total / 3600), mins: Math.floor((total % 3600) / 60), secs: total % 60 };
  }

  /* "05 hrs 47 mins" (padded: the live card) or "5 hrs 47 mins" (unpadded: table cells) */
  function formatDuration(ms, padded) {
    const t = split(ms);
    const h = padded ? Utils.pad(t.hours, 2) : String(t.hours);
    const m = padded ? Utils.pad(t.mins, 2) : String(t.mins);
    return h + ' hrs ' + m + ' mins';
  }

  /* Fixed en-US so the clock always reads "08:30 AM" regardless of the device's locale. */
  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
  function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  /* "Oct 15, 2026 - 08:30 AM" */
  function formatStamp(iso) { return formatDate(iso) + ' - ' + formatTime(iso); }

  return {
    all: all, active: active, clockIn: clockIn, clockOut: clockOut,
    forUser: forUser, lastCompleted: lastCompleted,
    durationMs: durationMs, split: split, formatDuration: formatDuration,
    formatTime: formatTime, formatDate: formatDate, formatStamp: formatStamp
  };
})();
