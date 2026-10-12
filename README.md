# Clear Skies Forecaster

A responsive, browser-first astronomy dashboard built with Next.js App Router. It combines Open-Meteo current conditions, SunCalc twilight/moon calculations, an approximate city-proximity Bortle model, and a dynamically loaded React-Leaflet map with an in-map Google-Maps-style layer switcher (satellite / dark / terrain plus sky-glow and live-cloud overlays) and a high-accuracy "locate me" control.

## Run locally

Requirements: Node.js 20.9+ and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. For a production build, run `npm run build` and then `npm start`.

## Map box: layer switcher + locate

The dark-sky map carries its own floating controls, and every one of them stays strictly inside the map border (they are real Leaflet controls, so they stack with Leaflet's zoom/scale/attribution chrome and never leak clicks into the map):

- **Layers** (top-right) — a Google-Maps-style dark-glass popover: radio thumbnails for the map type, toggle switches for the overlays, and a footer naming the provider actually drawing tiles. Escape, a map click, or any pan/zoom closes it.
- **Locate me** (bottom-right, under the zoom buttons) — re-triggers a high-accuracy geolocation fix on every click (`maximumAge: 0`, so a stale fix is never reused), then `flyTo`s the map to street level (z15 for a ±250 m fix, z14 for a coarser one), drops a pulsing cyan radar pin with its GPS accuracy circle, and immediately re-fires the Open-Meteo fetch so the stargazing score recalculates for where you actually are. Failures (permission blocked, timeout, unsupported browser) are reported in a small chip next to the button and mirrored into the Observing site card.

### Map types

| Map type | Tiles | Keyless fallback chain |
| --- | --- | --- |
| **Satellite View** (default) | `https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}` — Google satellite/hybrid raster (labels baked in) | Esri World Dark Gray → OpenStreetMap |
| **Dark Mode** | Esri World Dark Gray, Base + Reference label layers (`server.arcgisonline.com`) | OpenStreetMap |
| **Terrain View** | `https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png` — OpenTopoMap (OSM data + SRTM relief, CC-BY-SA) | OpenStreetMap → Esri World Dark Gray |

Picking a map type swaps only the `<TileLayer>` children: the Leaflet map instance, the current view, both overlays and the observing pin coordinates are all preserved — no remount, no lost pin. Every source is anonymous: no API key, no `key=`/`appid=` parameter, therefore no "API KEY REQUIRED" watermark. `npm run test:layers` asserts that for every registered layer.

Google satellite and OpenTopoMap are light-use, interactive endpoints — attribution is rendered on the map; don't script or mirror them in bulk. Esri's anonymous basemap endpoints carry the same expectation, and OSM the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) (low-volume, non-commercial).

The map type shown on first load is configurable:

```bash
NEXT_PUBLIC_TILE_PROVIDER=satellite   # satellite (default) | dark | terrain
                                      # legacy esri | carto | osm still work and mean "dark"
```

### Overlays

- **Light pollution / sky-glow heatmap** — the simulated city-proximity canvas layer, shared with the toolbar GLOW button (both stay in sync). It is a labelled model, not a VIIRS raster.
- **Live clouds** — NASA EOSDIS **GIBS** geostationary Band 13 "Clean Infrared" tiles: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`. Keyless, transparent PNG, a new frame roughly every 10 minutes. The map asks GIBS for its `default` (newest ingested) time instead of guessing a timestamp, and re-requests tiles every 10 minutes while the overlay is on. The disk whose sub-satellite point is nearest your longitude is used: GOES-East (Americas/Atlantic), GOES-West (east Pacific) or Himawari (Asia-Pacific).

  Coverage is stated, not hidden: GIBS serves no Meteosat layer, so a site over Europe/Africa can sit outside every disk. The popover then says "no IR disk covers this longitude" rather than drawing an invisible overlay, and a limb view (70–81° from the sub-satellite point) is flagged as stretched. Cloud tiles fail invisibly (transparent error tile); after 5 failures in 20 s the overlay switches itself off and reports it.

### Fallbacks, verification, and the optional CARTO key

Since late August 2026 CARTO stamps every *keyless* request to `basemaps.cartocdn.com` with an "API KEY REQUIRED — carto.com/basemaps/apikey" watermark (the tiles still return HTTP 200), so keyless CARTO is not used anywhere. If you want the original CARTO Dark Matter look at the head of the **Dark Mode** chain, request a free key (5M tile requests/month, no approval queue) at <https://carto.com/basemaps/apikey>, then in `.env.local`:

```bash
NEXT_PUBLIC_CARTO_API_KEY=your_key_here   # never commit a real key
# optionally force the app to open on Dark Mode:
# NEXT_PUBLIC_TILE_PROVIDER=dark          # or legacy: carto
```

Restart `npm run dev` (or re-run `npm run build`) — `NEXT_PUBLIC_*` values are inlined at build time. If the key is missing or the provider fails at runtime, the map falls back to the keyless chain automatically. See `.env.example` for the full documentation.

**Runtime tile verification:** an HTTP 200 tile can still be a watermark/placeholder image, so on every provider activation the map probes two distant land tiles (Central Europe and Japan at z6), compares their pixels, and rejects providers that serve identical, blank, or watermark-stamped imagery; repeated tile-request errors (5 within 20 s) also advance the chain. Each provider is tried exactly once and every map type's chain is finite — no endless retries — and the pin, click-to-select, search/geolocation recentering, zoom controls, overlays and the in-map widgets keep working even if every basemap fails. Note that the pixel probe needs CORS to read tile bytes back: providers that withhold `Access-Control-Allow-Origin` (Google satellite does) come back *inconclusive* and are kept, with tile-error monitoring as the guard instead. Diagnostics are logged to the browser console under the `[basemap]`, `[clouds]` and `[locate]` prefixes. The probe heuristics and the layer/cloud registries have unit tests: `npm test` (or `npm run test:probe` / `npm run test:layers`).

## First use

- Allow location access for your observing site. If permission is declined, Cherry Springs State Park, Pennsylvania is used as the starting point.
- Use the place search or click anywhere on the map to move the observing pin.
- Inside the map box: **Layers** (top-right) switches map type and overlays, **Locate me** (bottom-right) re-runs a high-accuracy fix, flies to street level and re-scores the site. Both stay inside the map border and work even if every basemap provider fails.
- Open-Meteo, OpenStreetMap Nominatim, NASA GIBS and all three map types are public, keyless services. Search is debounced; use the app respectfully and avoid automated/high-volume querying.
- Weather conditions refresh on selection, every 15 minutes, or from the refresh button. The browser needs an internet connection. Geolocation requires a secure context (HTTPS, or localhost).
- The map's sky-glow overlay is a clearly labeled **simulated** city-proximity visualization, not a live VIIRS raster or a verified site-level Bortle survey. Choose a Rural / Suburban / Urban override to tune the score when local knowledge is better than the estimate.
- The **live clouds** overlay is real NASA GIBS infrared imagery, but it is a ~2 km geostationary product refreshed every ~10 minutes and only covers the GOES-East / GOES-West / Himawari disks — it shows cloud-top temperature, not observing-grade transparency, and it can be empty over Europe/Africa.

Twilight and moonrise times are calculated locally from the selected coordinates. Jupiter and Saturn use a compact, low-precision orbital approximation; the target list is a planning aid, not an astrometric ephemeris. Always confirm critical observing decisions with a dedicated planetarium/almanac and local safety guidance.
