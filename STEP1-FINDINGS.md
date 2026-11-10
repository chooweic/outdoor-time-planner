# Step 1 findings: API exploration (2026-11-10)

Fixtures saved in `fixtures/`: `pm25.json`, `psi.json`, `twenty-four-hr-forecast.json`. `two-hr-forecast.json` holds a 429 error (see rate limits below), so re-fetch it if needed.

## Endpoints (base `https://api-open.data.gov.sg/v2/real-time/api`)
| Use | Path | Key fields | Update |
|---|---|---|---|
| "Now" air | `/pm25` | `data.items[0].readings.pm25_one_hourly.north` (µg/m3) | hourly |
| "Tomorrow" air | `/psi` | `readings.psi_twenty_four_hourly.north` (PSI); also `pm25_twenty_four_hourly` and others | hourly |
| Rain/weather outlook | `/twenty-four-hr-forecast` | `data.records[0].periods[].regions.north.text` for 3 time periods, plus `general.forecast` | several times a day |

Today's sample (14:00 SGT): north 1-hour PM2.5 = 6, 24-hour PSI north = 35 (Good), forecast: thundery showers midday to 6pm, cloudy overnight, partly cloudy 6am to midday.

## Answers to the open questions
- **Does PSI give finer location than 5 regions?** No. Same five regions (north/south/east/west/central) with label points only. "Go elsewhere" can only compare these regions.
- **Is a key needed?** All three endpoints answered without one. Limits per 10-second window: no key 6, dev key 12, prod key 30. I hit this: 4 calls fired back to back, and the fourth (`two-hr-forecast`) returned 429, because earlier calls in the same window counted. The Worker must cache.
- **Getting a key:** log in at data.gov.sg with an email OTP, "Create API Key", choose Developer (testing) or Production, describe your use. The key is shown only once, so store it immediately. Send it as the `x-api-key` header, and never put it in client-side code.
- **Licence (Singapore Open Data Licence 1.0):** free use, commercial or not, including a public app. **Conditions:**
  - Show a conspicuous notice naming the source datasets, with a link to the licence.
  - Don't imply official status or endorsement.
  - The data is "as is", with no accuracy or availability warranty.
  - You indemnify the agency against third-party claims from your app.
  - The NEA dataset pages themselves weren't checked for a different licence. Check before any public release.

## Decisions for step 2
- Worker caches `pm25`, `psi` and `twenty-four-hr-forecast` for 15 minutes each, and serves one combined `/api/air` response.
- Add the licence attribution to the page footer and a "not an official NEA service" line.
- Get a Developer key before step 2 testing. I can't do it for you (it needs your email OTP, and the key must be stored by you).
- Fixtures are ready for the step 3 tests, but they only contain low readings. Add hand-made high values for the band edges.
