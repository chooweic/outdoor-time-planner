// Outdoor-minutes log and rolling 7-day balance. Pure functions plus a guarded storage adapter.

export const DAILY_TARGET = 120; // minutes; HealthHub (HPB): "at least 2 hours every day"
export const WINDOW_DAYS = 7;
const KEY = 'outdoor-planner:log-v1'; // namespaced: github.io pages of one user share localStorage

// "YYYY-MM-DD" in Singapore time, so a late-night log lands on the right day.
export function sgDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const okEntry = (e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number.isFinite(e.minutes) && e.minutes > 0 && e.minutes <= 600;

export function addEntry(entries, date, minutes) {
  if (!okEntry({ date, minutes })) return entries;
  return [...entries, { date, minutes }];
}

// Removes the most recent entry logged today. Never touches earlier days.
export function undoLast(entries, today) {
  const i = entries.map((e) => e.date).lastIndexOf(today);
  return i < 0 ? entries : [...entries.slice(0, i), ...entries.slice(i + 1)];
}

export function minutesOn(entries, date) {
  return entries.filter((e) => e.date === date).reduce((s, e) => s + e.minutes, 0);
}

/**
 * Rolling 7-day balance, today included.
 * previous6: minutes logged on the 6 days before today.
 * todayLogged: minutes already logged today.
 * wantedToday: what to aim for today = max(daily target, minutes needed to reach the 7-day total), minus today's log. Never below 0.
 * Being ahead never reduces today below the daily target: the habit is daily, make-up only adds.
 */
export function balance(entries, today, dailyTarget = DAILY_TARGET) {
  // Days before the first logged entry are not "owed": a new user starts with a clean slate.
  const first = entries.map((e) => e.date).filter((d) => d <= today).sort()[0];
  let daysCounted = 1;
  if (first) {
    while (daysCounted < WINDOW_DAYS && addDays(today, -daysCounted) >= first) daysCounted++;
  }
  let previous6 = 0;
  for (let i = 1; i < WINDOW_DAYS; i++) previous6 += minutesOn(entries, addDays(today, -i));
  const todayLogged = minutesOn(entries, today);
  const weeklyTarget = dailyTarget * daysCounted;
  const neededToday = Math.max(dailyTarget, weeklyTarget - previous6);
  const wantedToday = Math.max(0, Math.min(neededToday, 240) - todayLogged);
  const days = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    days.push({ date: d, minutes: minutesOn(entries, d) });
  }
  return {
    previous6, todayLogged, weeklyTarget,
    logged7: previous6 + todayLogged,
    shortfall7: Math.max(0, weeklyTarget - (previous6 + todayLogged)),
    wantedToday,
    // The daily goal only. Make-up owed from earlier days may remain (see shortfall7).
    targetMetToday: todayLogged >= dailyTarget,
    days,
  };
}

// Storage: never throws; a bad or missing blob becomes an empty log. Keeps the last 60 days only.
export function loadEntries(storage, today) {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? '[]');
    const floor = addDays(today, -60);
    return Array.isArray(raw) ? raw.filter((e) => okEntry(e) && e.date >= floor) : [];
  } catch {
    return [];
  }
}

export function saveEntries(storage, entries) {
  try {
    storage.setItem(KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false; // private mode or storage full: the page tells the user the log is not saved
  }
}
