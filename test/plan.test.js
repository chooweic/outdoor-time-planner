import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planDay, isRainy } from '../public/js/plan.js';

const { places } = JSON.parse(readFileSync(new URL('../public/js/places.json', import.meta.url)));
const airWith = (pm) => ({
  regions: Object.fromEntries(Object.entries(pm).map(([r, v]) => [r, { pm25OneHour: v, psi24Hour: 40 }])),
});
const clear = { north: 10, east: 10, central: 10, west: 10, south: 10 };

test('clear air everywhere: plan is go, far places are excluded, ordered by travel', () => {
  const p = planDay({ air: airWith(clear), places });
  assert.equal(p.level, 'go');
  assert.equal(p.sameAirEverywhere, true);
  assert.ok(p.tooFar.includes('East Coast Park') && p.tooFar.includes('Jurong Lake Gardens'));
  const travel = p.options.map((o) => o.place.travelMinutes);
  assert.deepEqual(travel, [...travel].sort((a, b) => a - b));
  assert.ok(p.options.every((o) => o.place.travelMinutes <= 40));
});

test('bad air at home, better in the east: east place ranks first and "go elsewhere" shows', () => {
  const p = planDay({ air: airWith({ ...clear, north: 200 }), places });
  assert.equal(p.sameAirEverywhere, false);
  assert.equal(p.options[0].place.region === 'north', false);
  assert.ok(p.options.every((o) => o.place.region !== 'north'));
});

test('go-short air caps the outing length and adds a note', () => {
  const p = planDay({ air: airWith({ ...clear, north: 100, east: 100, central: 100 }), places });
  assert.equal(p.level, 'go-short');
  for (const o of p.options) {
    assert.ok(o.minutes <= 45);
    assert.ok(o.notes.some((n) => /light/.test(n)));
  }
});

test('stay-in everywhere: no options, level stay-in', () => {
  const p = planDay({ air: airWith({ north: 300, east: 300, central: 300, west: 300, south: 300 }), places });
  assert.equal(p.level, 'stay-in');
  assert.deepEqual(p.options, []);
});

test('owed minutes lengthen the outing, limited by the place', () => {
  const p = planDay({ air: airWith(clear), places, owedMinutes: 200 });
  assert.equal(p.wantedMinutes, 200);
  const wf = p.options.find((o) => o.place.id === 'punggol-waterway');
  assert.equal(wf.minutes, 90);
});

test('rain pushes unsheltered places below sheltered ones of the same level', () => {
  const p = planDay({ air: airWith(clear), places, rainy: true });
  const firstUnsheltered = p.options.findIndex((o) => !o.place.sheltered);
  const lastSheltered = p.options.map((o) => o.place.sheltered).lastIndexOf(true);
  assert.ok(lastSheltered < firstUnsheltered);
});

test('missing region data never yields "go"', () => {
  const p = planDay({ air: { regions: {} }, places });
  assert.ok(p.options.every((o) => o.level !== 'go'));
});

test('isRainy reads forecast text', () => {
  assert.equal(isRainy([{ text: 'Cloudy' }, { text: 'Thundery Showers' }]), true);
  assert.equal(isRainy([{ text: 'Partly Cloudy (Day)' }]), false);
  assert.equal(isRainy(), false);
});

test('works on the saved fixtures through shape()', async () => {
  const { shape } = await import('../public/js/air.js');
  const fx = (n) => JSON.parse(readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url))).data;
  const air = shape(fx('pm25'), fx('psi'), fx('twenty-four-hr-forecast'));
  const p = planDay({ air, places, rainy: isRainy(air.regions.north.forecast) });
  assert.equal(p.level, 'go');
  assert.equal(p.rainy, true);
  assert.equal(p.options[0].place.sheltered, true);
});

// --- fixes from code review ---
test('capGo: possibly stale data never gives a full "go"', () => {
  const p = planDay({ air: airWith(clear), places, capGo: true });
  assert.equal(p.level, 'go-short');
  assert.ok(p.options.every((o) => o.level === 'go-short' && o.minutes <= 45));
});

test('within the same level, nearer places rank first regardless of typical duration', () => {
  const p = planDay({ air: airWith(clear), places, owedMinutes: 90 });
  const travel = p.options.map((o) => o.place.travelMinutes);
  assert.deepEqual(travel, [...travel].sort((a, b) => a - b));
});

// --- fixes from second review ---
test('places with no air data are listed as noData, never offered', () => {
  const p = planDay({ air: { regions: { north: { pm25OneHour: 300, psi24Hour: 40 } } }, places });
  assert.equal(p.options.length, 0);
  assert.equal(p.level, 'stay-in');
  assert.ok(p.noData.length > 0);
});

test('a place whose region is missing is excluded even when other regions are fine', () => {
  const regions = { north: { pm25OneHour: 10, psi24Hour: 40 }, east: { pm25OneHour: 10, psi24Hour: 40 } };
  const p = planDay({ air: { regions }, places });
  assert.ok(p.noData.includes('Bishan-Ang Mo Kio Park'));
  assert.ok(p.options.every((o) => ['north', 'east'].includes(o.place.region)));
});

test('a place with no usable travel time is excluded and reported', () => {
  const odd = [{ ...places[0], id: 'x', name: 'Odd Park', travelMinutes: undefined }, places[1]];
  const p = planDay({ air: airWith(clear), places: odd });
  assert.ok(p.noData.includes('Odd Park'));
  assert.ok(p.options.every((o) => o.place.name !== 'Odd Park'));
});
