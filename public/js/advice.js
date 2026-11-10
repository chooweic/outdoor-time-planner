// Turns air readings into go / go-short / stay-in advice. Pure functions, no I/O.
// Band edges come from NEA (haze.gov.sg 1-hour PM2.5 guide; NEA FAQ Q8 for 24-hour PSI).
// This is a planning aid, not medical advice.

// Upper edge (inclusive) of each 1-hour PM2.5 band, in µg/m3. Editable by the user.
export const DEFAULT_PM25_THRESHOLDS = { normalMax: 55, elevatedMax: 150, highMax: 250 };
// Upper edge (inclusive) of each 24-hour PSI band.
export const DEFAULT_PSI_THRESHOLDS = { goodMax: 50, moderateMax: 100, unhealthyMax: 200, veryUnhealthyMax: 300 };

export const LEVELS = ['go', 'go-short', 'stay-in']; // ordered best to worst
const worse = (a, b) => (LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;

export function pm25Band(value, t = DEFAULT_PM25_THRESHOLDS) {
  if (!isNum(value)) return 'unknown';
  if (value <= t.normalMax) return 'normal';
  if (value <= t.elevatedMax) return 'elevated';
  if (value <= t.highMax) return 'high';
  return 'very-high';
}

export function psiBand(value, t = DEFAULT_PSI_THRESHOLDS) {
  if (!isNum(value)) return 'unknown';
  if (value <= t.goodMax) return 'good';
  if (value <= t.moderateMax) return 'moderate';
  if (value <= t.unhealthyMax) return 'unhealthy';
  if (value <= t.veryUnhealthyMax) return 'very-unhealthy';
  return 'hazardous';
}

// vulnerable defaults to true: NEA calls children more sensitive, and the child-specific
// 1-hour table could not be read, so we take the cautious reading.
const PM25_ADVICE = {
  vulnerable: {
    normal: ['go', 'Air is normal. Normal outdoor activity.'],
    elevated: ['go-short', 'Air is elevated. Keep it light and short; avoid strenuous play.'],
    high: ['stay-in', 'Air is high. Avoid outdoor activity for the next hour.'],
    'very-high': ['stay-in', 'Air is very high. Stay indoors.'],
  },
  healthy: {
    normal: ['go', 'Air is normal. Normal outdoor activity.'],
    elevated: ['go-short', 'Air is elevated. Reduce strenuous outdoor activity for the next hour.'],
    high: ['go-short', 'Air is high. Avoid strenuous outdoor activity for the next hour.'],
    'very-high': ['stay-in', 'Air is very high. Minimise outdoor activity.'],
  },
};

export function nowAdvice(pm25, { vulnerable = true, thresholds } = {}) {
  const band = pm25Band(pm25, thresholds);
  if (band === 'unknown') {
    return { band, level: 'go-short', text: 'No reading available. Check haze.gov.sg before heading out.' };
  }
  const [level, text] = PM25_ADVICE[vulnerable ? 'vulnerable' : 'healthy'][band];
  return { band, level, text };
}

// Next-day planning uses the 24-hour PSI (NEA FAQ Q8, advice for children).
const PSI_ADVICE = {
  good: ['go', 'PSI is good.'],
  moderate: ['go', 'PSI is moderate. Normal activities.'],
  unhealthy: ['go-short', 'PSI is unhealthy. Minimise prolonged or strenuous outdoor exertion.'],
  'very-unhealthy': ['stay-in', 'PSI is very unhealthy. Minimise outdoor activity.'],
  hazardous: ['stay-in', 'PSI is hazardous. Avoid outdoor activity.'],
};

export function dayAdvice(psi, { thresholds } = {}) {
  const band = psiBand(psi, thresholds);
  if (band === 'unknown') {
    return { band, level: 'go-short', text: 'No PSI available. Check haze.gov.sg.' };
  }
  const [level, text] = PSI_ADVICE[band];
  return { band, level, text };
}

// Combine "right now" and "today/tomorrow". The stricter one wins.
export function overallAdvice({ pm25, psi, vulnerable = true, pm25Thresholds, psiThresholds } = {}) {
  const now = nowAdvice(pm25, { vulnerable, thresholds: pm25Thresholds });
  const day = dayAdvice(psi, { thresholds: psiThresholds });
  return { level: worse(now.level, day.level), now, day };
}

// Validate user-edited thresholds: numbers, strictly increasing.
export function validThresholds(t, keys) {
  const vals = keys.map((k) => t?.[k]);
  return vals.every(isNum) && vals.every((v, i) => i === 0 || v > vals[i - 1]);
}
