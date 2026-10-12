# Clear Skies Forecaster

A responsive, browser-first astronomy dashboard built with Next.js App Router. It combines Open-Meteo current conditions, SunCalc twilight/moon calculations, an approximate city-proximity Bortle model, and a dynamically loaded React-Leaflet map.

## Run locally

Requirements: Node.js 20.9+ and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. For a production build, run `npm run build` and then `npm start`.

## Map basemap

The dark-sky map needs **no API key or account** in its default configuration. Since late August 2026 CARTO stamps every *keyless* request to `basemaps.cartocdn.com` with an “API KEY REQUIRED — carto.com/basemaps/apikey” watermark (the tiles still return HTTP 200), so the app no longer uses keyless CARTO. The provider chain, in order:

1. **Esri World Dark Gray** (default) — anonymous raster tiles (`server.arcgisonline.com`, Base + Reference label layers). Dark, neutral, ideal behind the simulated sky-glow overlay. Full detail is cached through zoom 16; beyond that Leaflet upscales instead of requesting missing tiles. Attribution shown on the map: *“Basemap by Esri — Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community.”* Esri’s anonymous basemap endpoints are intended for light, interactive use with attribution — don’t bulk-scrape or mirror them.
2. **OpenStreetMap standard tiles** — keyless last-resort fallback so the map can still draw real geography if Esri ever fails. It is a light-styled basemap and subject to the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) (low-volume, non-commercial use; this app debounces nothing here, so don’t script against it).

**Optional — original CARTO Dark Matter look:** request a free key (5M tile requests/month, no approval queue) at <https://carto.com/basemaps/apikey>, then in `.env.local`:

```bash
NEXT_PUBLIC_CARTO_API_KEY=your_key_here   # never commit a real key
# optionally force it to the head of the chain:
# NEXT_PUBLIC_TILE_PROVIDER=carto         # esri (default) | carto | osm
```

Restart `npm run dev` (or re-run `npm run build`) — `NEXT_PUBLIC_*` values are inlined at build time. If the key is missing or the provider fails at runtime, the map falls back to the keyless chain automatically. See `.env.example` for the full documentation.

**Runtime tile verification:** an HTTP 200 tile can still be a watermark/placeholder image, so on every provider activation the map probes two distant land tiles (Central Europe and Japan at z6), compares their pixels, and rejects providers that serve identical, blank, or watermark-stamped imagery; repeated tile-request errors (5 within 20 s) also advance the chain. Each provider is tried exactly once and the fallback chain is finite — no endless retries — and the pin, click-to-select, search/geolocation recentering, zoom controls and glow overlay keep working even if every basemap fails. Diagnostics are logged to the browser console under the `[basemap]` prefix. The detection heuristics have unit tests: `npm run test:probe`.

## First use

- Allow location access for your observing site. If permission is declined, Cherry Springs State Park, Pennsylvania is used as the starting point.
- Use the place search or click anywhere on the map to move the observing pin.
- Open-Meteo, OpenStreetMap Nominatim and the default map basemap are public, keyless services. Search is debounced; use the app respectfully and avoid automated/high-volume querying.
- Weather conditions refresh on selection, every 15 minutes, or from the refresh button. The browser needs an internet connection. Geolocation requires a secure context (HTTPS, or localhost).
- The map's sky-glow overlay is a clearly labeled **simulated** city-proximity visualization, not a live VIIRS raster or a verified site-level Bortle survey. Choose a Rural / Suburban / Urban override to tune the score when local knowledge is better than the estimate.

Twilight and moonrise times are calculated locally from the selected coordinates. Jupiter and Saturn use a compact, low-precision orbital approximation; the target list is a planning aid, not an astrometric ephemeris. Always confirm critical observing decisions with a dedicated planetarium/almanac and local safety guidance.
