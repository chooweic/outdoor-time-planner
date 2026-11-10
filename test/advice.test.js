import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  pm25Band, psiBand, nowAdvice, dayAdvice, overallAdvice, validThresholds,
  DEFAULT_PM25_THRESHOLDS, DEFAULT_PSI_THRESHOLDS,
} from '../public/js/advice.js';

test('PM2.5 band edges: 55/56, 150/151, 250/251', () => {
  const cases = [[0, 'normal'], [55, 'normal'], [56, 'elevated'], [150, 'elevated'],
    [151, 'high'], [250, 'high'], [251, 'very-high'], [900, 'very-high']];
  for (const [v, b] of cases) assert.equal(pm25Band(v), b, `pm25 ${v}`);
});

test('PSI band edges: 50/51, 100/101, 200/201, 300/301', () => {
  const cases = [[0, 'good'], [50, 'good'], [51, 'moderate'], [100, 'moderate'],
    [101, 'unhealthy'], [200, 'unhealthy'], [201, 'very-unhealthy'], [300, 'very-unhealthy'],
    [301, 'hazardous']];
  for (const [v, b] of cases) assert.equal(psiBand(v), b, `psi ${v}`);
});

test('bad input gives unknown, never a confident "go"', () => {
  for (const bad of [undefined, null, NaN, -1, '12', Infinity]) {
    assert.equal(pm25Band(bad), 'unknown');
    assert.equal(psiBand(bad), 'unknown');
    assert.notEqual(nowAdvice(bad).level, 'go');
    assert.notEqual(dayAdvice(bad).level, 'go');
  }
});

test('children (vulnerable by default): elevated -> go-short, high -> stay-in', () => {
  assert.equal(nowAdvice(55).level, 'go');
  assert.equal(nowAdvice(56).level, 'go-short');
  assert.equal(nowAdvice(151).level, 'stay-in');
  assert.equal(nowAdvice(251).level, 'stay-in');
});

test('non-vulnerable setting is more permissive at High only', () => {
  assert.equal(nowAdvice(151, { vulnerable: false }).level, 'go-short');
  assert.equal(nowAdvice(251, { vulnerable: false }).level, 'stay-in');
});

test('24-hour PSI advice follows NEA bands', () => {
  assert.equal(dayAdvice(100).level, 'go');
  assert.equal(dayAdvice(101).level, 'go-short');
  assert.equal(dayAdvice(201).level, 'stay-in');
  assert.equal(dayAdvice(301).level, 'stay-in');
});

test('overall advice takes the stricter of now and day', () => {
  assert.equal(overallAdvice({ pm25: 10, psi: 150 }).level, 'go-short');
  assert.equal(overallAdvice({ pm25: 200, psi: 40 }).level, 'stay-in');
  assert.equal(overallAdvice({ pm25: 10, psi: 40 }).level, 'go');
});

test('custom thresholds change the bands', () => {
  const t = { normalMax: 30, elevatedMax: 100, highMax: 200 };
  assert.equal(pm25Band(31, t), 'elevated');
  assert.equal(nowAdvice(31, { thresholds: t }).level, 'go-short');
});

test('threshold validation: increasing numbers only', () => {
  const k = ['normalMax', 'elevatedMax', 'highMax'];
  assert.ok(validThresholds(DEFAULT_PM25_THRESHOLDS, k));
  assert.ok(!validThresholds({ normalMax: 60, elevatedMax: 50, highMax: 200 }, k));
  assert.ok(!validThresholds({ normalMax: 'a', elevatedMax: 50, highMax: 200 }, k));
  assert.ok(!validThresholds(undefined, k));
  assert.ok(validThresholds(DEFAULT_PSI_THRESHOLDS, ['goodMax', 'moderateMax', 'unhealthyMax', 'veryUnhealthyMax']));
});

test('works on the real saved fixtures (north, today)', () => {
  const fx = (n) => JSON.parse(readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url)));
  const pm = fx('pm25').data.items[0].readings.pm25_one_hourly.north;
  const psi = fx('psi').data.items[0].readings.psi_twenty_four_hourly.north;
  assert.equal(overallAdvice({ pm25: pm, psi }).level, 'go');
});
