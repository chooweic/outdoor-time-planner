import { overallAdvice, validThresholds, DEFAULT_PM25_THRESHOLDS } from './advice.js';
import { planDay, isRainy } from './plan.js';
import { getAir, MAX_STALE_MS } from './air.js';
import { sgDate, balance, addEntry, undoLast, loadEntries, saveEntries, DAILY_TARGET } from './log.js';

const $ = (id) => document.getElementById(id);
const TKEY = 'outdoor-planner:thresholds-v1';
const CACHE_KEY = 'outdoor-planner:air-cache-v2';
const T_KEYS = ['normalMax', 'elevatedMax', 'highMax'];
const LABEL = { go: 'Good to go', 'go-short': 'Go, but keep it short', 'stay-in': 'Stay in' };
const AGING_MS = 2 * 60 * 60 * 1000; // readings are hourly; 2 h old means the feed is behind

// localStorage can throw just by being touched (blocked site data, some private modes).
// Fall back to an in-memory stand-in so the app still runs, and say the log won't be kept.
function safeStorage() {
  try {
    const s = window.localStorage;
    s.setItem('outdoor-planner:probe', '1'); // a real write: reads can work while writes fail
    s.removeItem('outdoor-planner:probe');
    return { store: s, persistent: true };
  } catch {
    const m = new Map();
    return {
      persistent: false,
      store: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) },
    };
  }
}
const { store, persistent } = safeStorage();

const today = () => sgDate(); // recomputed each time: a tab left open past midnight must log to the new day
let entries = loadEntries(store, today());
let air = null;
let placesData = null;
let saveFailed = false;
let status = 'loading'; // loading | ready | error | old
let demo = false;

function browserCache() {
  return {
    async get() { try { return JSON.parse(store.getItem(CACHE_KEY)) ?? undefined; } catch { return undefined; } },
    async put(_k, v) { try { store.setItem(CACHE_KEY, JSON.stringify(v)); } catch { /* no caching, still works */ } },
  };
}

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Singapore' });

function loadThresholds() {
  try {
    const t = JSON.parse(store.getItem(TKEY));
    if (thresholdsOk(t)) return t;
  } catch { /* fall through to defaults */ }
  return { ...DEFAULT_PM25_THRESHOLDS };
}
// Whole numbers, increasing, and never looser than NEA's own edges.
function thresholdsOk(t) {
  return validThresholds(t, T_KEYS) && T_KEYS.every((k) => Number.isInteger(t[k]) && t[k] >= 1 && t[k] <= DEFAULT_PM25_THRESHOLDS[k]);
}

function banners(messages) {
  $('banners').replaceChildren(...messages.map((m) => el('div', m.text, 'banner' + (m.err ? ' err' : ''))));
}

function showNoAir(title, text, banner) {
  $('verdict').textContent = title;
  $('verdict').className = 'verdict ' + (status === 'loading' ? '' : 'stay-in');
  $('verdict-text').textContent = text;
  $('readings').textContent = '';
  $('plan').textContent = status === 'loading' ? 'Waiting for data…' : 'No plan without air data.';
  banners(banner ? [{ text: banner, err: true }] : []);
}

function renderLog() {
  const bal = balance(entries, today());
  $('balance-text').textContent = bal.targetMetToday
    ? `Today's goal is met. Last 7 days: ${bal.logged7} of ${bal.weeklyTarget} min` +
      (bal.shortfall7 > 0 ? ` (${bal.shortfall7} min behind: more outdoor time on other days will catch up).` : '.')
    : `Aim for ${bal.wantedToday} min outdoors today. Last 7 days: ${bal.logged7} of ${bal.weeklyTarget} min` +
      (bal.shortfall7 > 0 ? ` (${bal.shortfall7} min behind).` : '.');
  const max = Math.max(DAILY_TARGET, ...bal.days.map((d) => d.minutes));
  $('bars').replaceChildren(...bal.days.map((d) => {
    const b = el('div', null, 'bar');
    b.style.height = `${(d.minutes / max) * 100}%`;
    b.title = `${d.date}: ${d.minutes} min`;
    b.append(el('span', d.date.slice(8)));
    return b;
  }));
  return bal;
}

function renderAir(bal) {
  const msgs = [];
  if (demo) msgs.push({ text: 'Demo: these haze readings are made up. Remove ?demo=haze from the address for real data.', err: true });

  // How far can we trust the readings? Stale copy, an old reading, an unreadable or future timestamp: all cap "go".
  // Judge the data by its oldest reading: both the 1-hour PM2.5 and the 24-hour PSI feed the advice.
  const ages = [air.pm25Timestamp, air.psiTimestamp].map((t) => Date.now() - new Date(t).getTime());
  const unreadable = ages.some((a) => !Number.isFinite(a));
  const ageMs = Math.max(...ages);
  const oldest = ages[0] >= ages[1] ? air.pm25Timestamp : air.psiTimestamp;
  if (unreadable || ageMs > MAX_STALE_MS) {
    status = 'old';
    return showNoAir('Air data too old', 'The newest reading is too old to rely on. Check haze.gov.sg before heading out.', 'Air data is out of date.');
  }
  const doubtful = air.stale || ageMs > AGING_MS || Math.min(...ages) < -5 * 60 * 1000;
  if (air.stale) msgs.push({ text: `Couldn't refresh the data just now. Showing readings fetched at ${hhmm(air.fetchedAt)}.` });
  if (ageMs > AGING_MS) msgs.push({ text: `The newest readings are from ${hhmm(oldest)}, older than expected.` });
  if (Math.min(...ages) < -5 * 60 * 1000) msgs.push({ text: "This device's clock looks wrong, so the reading's age can't be checked." });
  if (doubtful) msgs.push({ text: 'Data may be out of date, so the advice is capped at "keep it short". Check haze.gov.sg.' });
  banners(msgs);

  const th = loadThresholds();
  const home = air.regions[air.region];
  const adv = overallAdvice({ pm25: home.pm25OneHour, psi: home.psi24Hour, pm25Thresholds: th });
  const level = doubtful && adv.level === 'go' ? 'go-short' : adv.level;
  $('verdict').textContent = LABEL[level];
  $('verdict').className = `verdict ${level}`;
  $('verdict-text').textContent = `${doubtful ? 'Data may be out of date. ' : ''}${adv.now.text} ${adv.day.text}`;
  $('readings').textContent =
    `Punggol (${air.region} region): 1-hour PM2.5 ${home.pm25OneHour} µg/m³ at ${hhmm(air.pm25Timestamp)}, 24-hour PSI ${home.psi24Hour} at ${hhmm(air.psiTimestamp)}.`;

  const rainy = isRainy(home.forecast);
  const plan = planDay({
    air, places: placesData.places, owedMinutes: bal.targetMetToday ? undefined : bal.wantedToday,
    thresholds: { pm25: th }, rainy, capGo: doubtful,
  });

  // Bad air at home but a reachable place is fine: say so in the headline, not just in the list.
  if (adv.level === 'stay-in' && plan.options.length) {
    $('verdict').textContent = 'Not around Punggol: air is better elsewhere';
    $('verdict').className = 'verdict go-short';
  }

  const kids = [];
  if (bal.targetMetToday) kids.push(el('p', 'Target already met today. Extra time is a bonus.', 'muted'));
  if (plan.options.length === 0) {
    kids.push(el('p', 'No suitable outdoor place right now. Stay in and make the time up on a clearer day.'));
  } else {
    if (plan.sameAirEverywhere) kids.push(el('p', 'The air is about the same everywhere you can reach, so these are ordered by travel time.', 'muted'));
    if (rainy) kids.push(el('p', 'Rain is forecast for your area today. Places with cover come first.', 'muted'));
    const list = el('ol');
    for (const o of plan.options) {
      const li = el('li');
      li.append(el('strong', o.place.name), document.createTextNode(` · about ${o.minutes} min there · ${o.place.travelMinutes} min travel`));
      for (const n of o.notes) li.append(el('div', n, 'muted'));
      list.append(li);
    }
    kids.push(list);
  }
  if (plan.tooFar.length) kids.push(el('p', `Too far (over 40 min): ${plan.tooFar.join(', ')}.`, 'muted'));
  if (plan.noData.length) kids.push(el('p', `No air reading for: ${plan.noData.join(', ')}.`, 'muted'));
  $('plan').replaceChildren(...kids);
}

function render() {
  let bal;
  try { bal = renderLog(); } catch { /* the air panel below still renders */ }
  try {
    if (status === 'loading') showNoAir('Loading air data…', '', null);
    else if (status === 'error') showNoAir('Air data unavailable', 'No air data and nothing recent saved. Check haze.gov.sg before heading out. Logging still works.', 'Could not load air data. Try again in a few minutes.');
    else renderAir(bal ?? balance(entries, today())); // 'ready' or 'old'; renderAir sets 'old' itself
  } catch {
    status = 'error';
    showNoAir('Air data unavailable', 'Something went wrong reading the air data. Check haze.gov.sg before heading out.', 'Could not read the air data.');
  }
  $('save-warn').hidden = persistent && !saveFailed;
  $('retry').hidden = !(status === 'error' || status === 'old');
}

function mutate(fn) {
  // Pick up changes made in another tab first, but only while saving works: after a failed save the
  // in-memory list is the truth, and re-reading storage would drop the taps that did not save.
  if (!saveFailed) entries = loadEntries(store, today());
  entries = fn(entries);
  saveFailed = !saveEntries(store, entries);
  render();
}
document.querySelectorAll('button[data-min]').forEach((b) =>
  b.addEventListener('click', () => mutate((e) => addEntry(e, today(), Number(b.dataset.min)))));
$('undo').addEventListener('click', () => mutate((e) => undoLast(e, today())));
window.addEventListener('storage', () => { if (!saveFailed) entries = loadEntries(store, today()); render(); });

function fillThresholds() {
  const t = loadThresholds();
  $('t1').value = t.normalMax; $('t2').value = t.elevatedMax; $('t3').value = t.highMax;
}
$('t-save').addEventListener('click', () => {
  const raw = [$('t1').value, $('t2').value, $('t3').value];
  const t = { normalMax: Number(raw[0]), elevatedMax: Number(raw[1]), highMax: Number(raw[2]) };
  if (raw.some((v) => v.trim() === '') || !thresholdsOk(t)) {
    $('t-msg').textContent = `Not saved: use whole numbers that increase left to right, no higher than the NEA values (${DEFAULT_PM25_THRESHOLDS.normalMax}, ${DEFAULT_PM25_THRESHOLDS.elevatedMax}, ${DEFAULT_PM25_THRESHOLDS.highMax}).`;
    return;
  }
  try { store.setItem(TKEY, JSON.stringify(t)); $('t-msg').textContent = persistent ? 'Saved.' : 'Applied for this visit only: your browser blocks saving.'; }
  catch { $('t-msg').textContent = 'Your browser blocked saving.'; }
  render();
});
$('t-reset').addEventListener('click', () => {
  try { store.removeItem(TKEY); } catch { /* ignore */ }
  fillThresholds(); $('t-msg').textContent = 'Back to NEA defaults.'; render();
});

// With a timeout that also covers the body, so a stalled connection cannot leave us on "Loading…".
async function fetchPlaces() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch('js/places.json', { signal: ctl.signal });
    if (!r.ok) throw new Error('places');
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

let loadingNow = false;
async function load() {
  if (loadingNow) return;
  loadingNow = true;
  try {
    const [a, p] = await Promise.all([
      // Static site: the browser calls data.gov.sg directly (no API key is used, so none is exposed)
      // and caches the answer for 15 minutes in localStorage, so a reload never hits the rate limit.
      getAir({ fetchFn: (u, o) => fetch(u, o), cache: browserCache() }),
      // The place list is fetched once; a later failed refresh must not throw away good air data.
      placesData ?? fetchPlaces(),
    ]);
    air = a; placesData = p;
    if (new URLSearchParams(location.search).get('demo') === 'haze') {
      // Preview only: fake high readings for north, so you can see the haze view.
      air = JSON.parse(JSON.stringify(air));
      air.regions.north.pm25OneHour = 180; air.regions.north.psi24Hour = 120; air.regions.east.pm25OneHour = 40;
      demo = true;
    }
    status = 'ready';
  } catch {
    air = null; status = 'error';
  }
  loadingNow = false;
  render();
}

fillThresholds();
render(); // shows "Loading…" and the log, which works without air data
load();
$('retry').addEventListener('click', () => { status = 'loading'; render(); load(); });
// A tab can stay open for hours: re-check the data's age every minute, and refetch when the tab
// comes back to the front (getAir only calls the network once its 15-minute cache has expired).
setInterval(() => { if (status !== 'loading') { load(); render(); } }, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && status !== 'loading') { load(); render(); } });
