// Ranks places for today. Pure function, no I/O.
import { overallAdvice } from './advice.js';

export const DEFAULTS = { maxTravelMinutes: 40, dailyTargetMinutes: 120, goShortCapMinutes: 45, minOutingMinutes: 30 };

// Rain check on the home region's forecast text for the periods you pass in.
export function isRainy(forecastPeriods = []) {
  return forecastPeriods.some((p) => /shower|rain|thunder/i.test(p.text ?? ''));
}

const rank = { go: 0, 'go-short': 1, 'stay-in': 2 };

/**
 * air: the /api/air response (uses air.regions).
 * owedMinutes: outdoor minutes still owed (from the log), or undefined for "just today's target".
 * Returns { level, sameAirEverywhere, rainy, wantedMinutes, tooFar, options[] }.
 */
export function planDay({ air, places, owedMinutes, vulnerable = true, thresholds = {}, options = {}, rainy = false, capGo = false }) {
  const o = { ...DEFAULTS, ...options };
  const wanted = Math.max(o.minOutingMinutes, Math.min(owedMinutes ?? o.dailyTargetMinutes, 240));

  const scored = places
    .filter((p) => p.outdoor !== false)
    .map((p) => {
      const r = air.regions?.[p.region];
      const adv = overallAdvice({
        pm25: r?.pm25OneHour, psi: r?.psi24Hour, vulnerable,
        pm25Thresholds: thresholds.pm25, psiThresholds: thresholds.psi,
      });
      // capGo: data may be out of date, so never offer a full "go"; at best "go short".
      const level = capGo && adv.level === 'go' ? 'go-short' : adv.level;
      return { place: p, level, now: adv.now, day: adv.day };
    });

  // Places we can't judge are never offered: no air reading for their region, or no usable travel time.
  const noData = scored.filter((s) => s.now.band === 'unknown' || s.day.band === 'unknown' || !Number.isFinite(s.place.travelMinutes))
    .map((s) => s.place.name);
  const judged = scored.filter((s) => !noData.includes(s.place.name));
  const tooFar = judged.filter((s) => s.place.travelMinutes > o.maxTravelMinutes).map((s) => s.place.name);
  const reachable = judged.filter((s) => s.place.travelMinutes <= o.maxTravelMinutes);

  const usable = reachable.filter((s) => s.level !== 'stay-in');
  const levels = new Set(reachable.map((s) => s.level + '|' + s.now.band + '|' + s.day.band));
  const sameAirEverywhere = reachable.length > 1 && levels.size === 1;

  const options_ = usable.map((s) => {
    const cap = s.level === 'go-short' ? o.goShortCapMinutes : Infinity;
    const minutes = Math.min(wanted, s.place.typicalMinutes, cap);
    const notes = [];
    if (s.level === 'go-short') notes.push(`Air is not at its best: keep it to about ${minutes} min and light activity.`);
    if (rainy && !s.place.sheltered) notes.push('Rain is forecast and this place has little cover.');
    if (rainy && s.place.sheltered) notes.push('Rain is forecast; this place has some cover.');
    return { place: s.place, level: s.level, minutes, notes, rainPenalty: rainy && !s.place.sheltered };
  });

  options_.sort((a, b) =>
    rank[a.level] - rank[b.level] ||
    Number(a.rainPenalty) - Number(b.rainPenalty) ||
    a.place.travelMinutes - b.place.travelMinutes);

  const best = options_[0]?.level ?? 'stay-in';
  return { level: best, sameAirEverywhere, rainy, wantedMinutes: wanted, tooFar, noData, options: options_ };
}
