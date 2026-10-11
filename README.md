# Clear Skies Forecaster

A responsive, browser-first astronomy dashboard built with Next.js App Router. It combines Open-Meteo current conditions, SunCalc twilight/moon calculations, an approximate city-proximity Bortle model, and a dynamically loaded React-Leaflet map.

## Run locally

Requirements: Node.js 20.9+ and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. For a production build, run `npm run build` and then `npm start`.

## First use

- Allow location access for your observing site. If permission is declined, Cherry Springs State Park, Pennsylvania is used as the starting point.
- Use the place search or click anywhere on the map to move the observing pin.
- Open-Meteo and OpenStreetMap Nominatim are public, keyless services. Search is debounced; use the app respectfully and avoid automated/high-volume querying.
- Weather conditions refresh on selection, every 15 minutes, or from the refresh button. The browser needs an internet connection. Geolocation requires a secure context (HTTPS, or localhost).
- The map's sky-glow overlay is a clearly labeled **simulated** city-proximity visualization, not a live VIIRS raster or a verified site-level Bortle survey. Choose a Rural / Suburban / Urban override to tune the score when local knowledge is better than the estimate.

Twilight and moonrise times are calculated locally from the selected coordinates. Jupiter and Saturn use a compact, low-precision orbital approximation; the target list is a planning aid, not an astrometric ephemeris. Always confirm critical observing decisions with a dedicated planetarium/almanac and local safety guidance.
