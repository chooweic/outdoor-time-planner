import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sgDate, addDays, addEntry, undoLast, minutesOn, balance, loadEntries, saveEntries } from '../public/js/log.js';

const T = '2026-11-10';

test('sgDate uses Singapore time (UTC 17:00 is already tomorrow in SG)', () => {
  assert.equal(sgDate(new Date('2026-11-10T17:00:00Z')), '2026-11-11');
  assert.equal(sgDate(new Date('2026-11-10T15:59:00Z')), '2026-11-10');
});

test('addDays crosses month and year', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('empty log: a new user starts with a clean slate (just the daily target)', () => {
  const b = balance([], T);
  assert.equal(b.wantedToday, 120);
  assert.equal(b.weeklyTarget, 120);
  assert.equal(b.logged7, 0);
  assert.equal(b.days.length, 7);
});

test('days before the first entry are not owed', () => {
  const b = balance([{ date: addDays(T, -2), minutes: 60 }], T); // 3 days counted: -2, -1, today
  assert.equal(b.weeklyTarget, 360);
  assert.equal(b.wantedToday, 240); // 300 needed, capped at 240 for one day
});

test('on track: 120/day for 6 days -> aim for the daily 120 today', () => {
  let e = [];
  for (let i = 1; i <= 6; i++) e = addEntry(e, addDays(T, -i), 120);
  const b = balance(e, T);
  assert.equal(b.wantedToday, 120);
  assert.equal(b.shortfall7, 840 - 720);
});

test('ahead of target never lowers today below the daily target', () => {
  let e = [];
  for (let i = 1; i <= 6; i++) e = addEntry(e, addDays(T, -i), 200);
  assert.equal(balance(e, T).wantedToday, 120);
});

test('behind: missed days add make-up to today, capped at 240', () => {
  let e = addEntry([], addDays(T, -1), 60);
  e = addEntry(e, addDays(T, -2), 60);
  e = addEntry(e, addDays(T, -3), 120);
  e = addEntry(e, addDays(T, -4), 120);
  e = addEntry(e, addDays(T, -5), 120);
  e = addEntry(e, addDays(T, -6), 120);
  // previous6 = 600, weekly 840 -> needed 240
  assert.equal(balance(e, T).wantedToday, 240);
  const e2 = addEntry(e, addDays(T, -1), 60); // 660 -> needed 180
  assert.equal(balance(e2, T).wantedToday, 180);
});

test("today's logged minutes reduce what is left; target met gives 0", () => {
  let e = addEntry([], T, 90);
  assert.equal(balance(e, T).wantedToday, 120 - 90); // first day: only today counts
  const full = [];
  for (let i = 1; i <= 6; i++) full.push({ date: addDays(T, -i), minutes: 120 });
  const b = balance(addEntry(full, T, 120), T);
  assert.equal(b.wantedToday, 0);
  assert.equal(b.targetMetToday, true);
});

test('entries older than the window do not count', () => {
  const b = balance([{ date: addDays(T, -7), minutes: 500 }], T);
  assert.equal(b.logged7, 0);
});

test('addEntry rejects bad input; undoLast removes the latest', () => {
  assert.deepEqual(addEntry([], 'bad', 30), []);
  assert.deepEqual(addEntry([], T, -5), []);
  assert.deepEqual(addEntry([], T, 9999), []);
  assert.deepEqual(addEntry([], T, NaN), []);
  const e = addEntry(addEntry([], T, 30), T, 60);
  assert.equal(minutesOn(undoLast(e, T), T), 30);
});

test('undoLast only removes entries from today, never earlier days', () => {
  const y = addEntry([], addDays(T, -1), 45);
  assert.deepEqual(undoLast(y, T), y);
  const mixed = addEntry(addEntry(y, T, 30), addDays(T, -1), 15); // latest array element is yesterday's
  const out = undoLast(mixed, T);
  assert.equal(minutesOn(out, T), 0);
  assert.equal(minutesOn(out, addDays(T, -1)), 60);
});

test('storage: corrupt data gives an empty log; throwing storage does not crash', () => {
  assert.deepEqual(loadEntries({ getItem: () => '{not json' }, T), []);
  assert.deepEqual(loadEntries({ getItem: () => '"x"' }, T), []);
  assert.deepEqual(loadEntries({ getItem: () => { throw new Error('blocked'); } }, T), []);
  assert.equal(saveEntries({ setItem: () => { throw new Error('full'); } }, []), false);
  const mem = new Map();
  const s = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(saveEntries(s, [{ date: T, minutes: 45 }]), true);
  assert.deepEqual(loadEntries(s, T), [{ date: T, minutes: 45 }]);
});

test('loadEntries drops invalid and very old entries', () => {
  const s = { getItem: () => JSON.stringify([{ date: T, minutes: 30 }, { date: '2025-01-01', minutes: 30 }, { date: T, minutes: 'x' }]) };
  assert.deepEqual(loadEntries(s, T), [{ date: T, minutes: 30 }]);
});

test('goal met today does not hide a remaining weekly shortfall', () => {
  const e = [{ date: addDays(T, -6), minutes: 10 }, { date: T, minutes: 240 }]; // 7 days counted, far behind
  const b = balance(e, T);
  assert.equal(b.targetMetToday, true);
  assert.ok(b.shortfall7 > 0);
});
