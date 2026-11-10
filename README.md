# Outdoor Time Planner

A small static web app for a parent in Punggol, Singapore. It reads NEA air-quality data, turns it into "go / go short / stay in" advice for children, suggests places for today, and tracks outdoor minutes against a rolling 7-day target (the HPB guide says at least 2 hours a day, for myopia prevention).

This is a personal learning project. It is a planning aid, not medical advice, and not an official NEA, HPB or government service.

## How it works
- The browser calls the data.gov.sg real-time APIs (`pm25`, `psi`, `twenty-four-hr-forecast`) directly. No API key is used, so none is exposed. Answers are cached for 15 minutes in `localStorage`.
- The outdoor log and thresholds are stored only in your browser (`localStorage`). Nothing is sent anywhere.
- Preview the haze view with fake readings: add `?demo=haze` to the address.

## Run and test
```
npm install
npm test                 # unit tests (node --test)
node dev-server.js 8788  # static server for ./public
```
`src/worker.js` is an optional Cloudflare Worker version that keeps an API key server-side.

## Data
Air and forecast data: NEA via [data.gov.sg](https://data.gov.sg), used under the [Singapore Open Data Licence v1.0](https://data.gov.sg/open-data-licence). Provided "as is" with no warranty.

Places in `public/js/places.json` and their travel times are estimates for illustration. Edit them to match your own routes.
