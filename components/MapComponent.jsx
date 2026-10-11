'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  MapContainer,
  Marker,
  Popup,
  ScaleControl,
  TileLayer,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { LIGHT_HUBS } from '../lib/astronomy';
import { buildProviderChain } from '../lib/tileProviders';
import { probeTileProvider } from '../lib/tileProbeRunner';

// Matches .leaflet-container's background so failed tiles degrade to dark
// squares instead of broken-image icons. Purely local — no external request.
const ERROR_TILE_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256'%3E%3Crect width='256' height='256' fill='%230a1116'/%3E%3C/svg%3E";

// Advance to the next provider after this many tile request failures…
const TILE_ERROR_THRESHOLD = 5;
// …counted within this sliding window, so a one-off network blip doesn't
// downgrade the basemap.
const TILE_ERROR_WINDOW_MS = 20000;

function MapClickHandler({ onLocationSelect }) {
  useMapEvents({
    click(event) {
      onLocationSelect({
        lat: Number(event.latlng.lat.toFixed(6)),
        lng: Number(event.latlng.lng.toFixed(6)),
      });
    },
  });
  return null;
}

function MapRecenter({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (!Number.isFinite(center?.[0]) || !Number.isFinite(center?.[1])) return;
    map.setView(center, zoom, { animate: true, duration: 0.7 });
  }, [map, center?.[0], center?.[1], zoom]);
  return null;
}

/**
 * Verifies the ACTIVE provider's tiles by pixel content, once per activation.
 * A provider can answer HTTP 200 with an "API KEY REQUIRED" watermark image
 * (keyless CARTO has done exactly this since Aug 2026), so status codes are
 * not enough — see lib/tileProbe.js for the heuristics. Inconclusive results
 * (offline, CORS-blocked canvas) keep the provider; hard failures are handled
 * by the tileerror counter instead. The probe never throws into React.
 */
function BasemapProbe({ provider, onProviderFail }) {
  useEffect(() => {
    let cancelled = false;
    probeTileProvider(provider)
      .then((result) => {
        if (cancelled) return;
        if (result.status === 'fail') {
          onProviderFail(provider.id, result.reason, result.detail);
        } else {
          console.info(
            `[basemap] tile probe for "${provider.name}": ${result.status}${result.detail ? ` — ${result.detail}` : ''}`,
          );
        }
      })
      .catch((error) => {
        console.warn(`[basemap] tile probe for "${provider.name}" errored (ignored):`, error);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, onProviderFail]);
  return null;
}

function LightPollutionCanvasLayer({ enabled }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled) return undefined;

    const SimulatedGlowLayer = L.GridLayer.extend({
      createTile(coords) {
        const canvas = L.DomUtil.create('canvas', 'leaflet-tile sky-glow-canvas');
        const tileSize = this.getTileSize();
        canvas.width = tileSize.x;
        canvas.height = tileSize.y;
        canvas.setAttribute('aria-hidden', 'true');
        const context = canvas.getContext('2d');
        if (!context) return canvas;

        const tileOrigin = L.point(coords.x * tileSize.x, coords.y * tileSize.y);
        const tileCenter = map.unproject(
          L.point(tileOrigin.x + tileSize.x / 2, tileOrigin.y + tileSize.y / 2),
          coords.z,
        );
        const kmPerPixel =
          (40075.017 * Math.max(0.06, Math.cos((tileCenter.lat * Math.PI) / 180))) /
          (256 * 2 ** coords.z);

        // Each hub emits a soft, semi-transparent radial falloff. The layer is
        // intentionally local and simulated; no third-party heatmap tiles or
        // private API credentials are required.
        for (const hub of LIGHT_HUBS) {
          const worldPoint = map.project([hub.lat, hub.lng], coords.z);
          const x = worldPoint.x - tileOrigin.x;
          const y = worldPoint.y - tileOrigin.y;
          const radius = Math.max(18, Math.min(410, hub.radius / kmPerPixel));
          if (
            x + radius <= 0 ||
            y + radius <= 0 ||
            x - radius >= tileSize.x ||
            y - radius >= tileSize.y
          ) {
            continue;
          }

          const strength = Math.min(1, 0.63 + hub.strength * 0.16);
          const glow = context.createRadialGradient(x, y, 0, x, y, radius);
          glow.addColorStop(0, `rgba(241, 77, 68, ${0.35 * strength})`);
          glow.addColorStop(0.18, `rgba(255, 143, 72, ${0.27 * strength})`);
          glow.addColorStop(0.48, `rgba(238, 194, 95, ${0.16 * strength})`);
          glow.addColorStop(0.78, `rgba(105, 197, 129, ${0.085 * strength})`);
          glow.addColorStop(1, 'rgba(92, 196, 133, 0)');
          context.fillStyle = glow;
          context.fillRect(
            Math.max(0, x - radius),
            Math.max(0, y - radius),
            Math.min(tileSize.x, x + radius) - Math.max(0, x - radius),
            Math.min(tileSize.y, y + radius) - Math.max(0, y - radius),
          );
        }
        return canvas;
      },
    });

    const layer = new SimulatedGlowLayer({
      pane: 'tilePane',
      opacity: 0.82,
      updateWhenIdle: true,
      keepBuffer: 2,
      zIndex: 220,
    });
    layer.addTo(map);
    return () => {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    };
  }, [enabled, map]);
  return null;
}

export default function MapComponent({
  latitude,
  longitude,
  zoom = 9,
  locationName,
  onLocationSelect,
  showHeatmap = true,
}) {
  const center = useMemo(() => [latitude, longitude], [latitude, longitude]);
  const markerIcon = useMemo(
    () =>
      L.divIcon({
        className: 'clear-sky-marker',
        html: '<span class="marker-core"></span>',
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      }),
    [],
  );

  // ── Basemap provider chain (keyless by default; see lib/tileProviders.js) ──
  const { chain: providers, warnings } = useMemo(() => buildProviderChain(), []);
  const [providerIndex, setProviderIndex] = useState(0);
  const providerIndexRef = useRef(0);
  const failedProvidersRef = useRef(new Set());
  const tileErrorBucketsRef = useRef({});
  const warningsLoggedRef = useRef(false);

  useEffect(() => {
    if (warningsLoggedRef.current) return;
    warningsLoggedRef.current = true;
    for (const warning of warnings) console.warn(`[basemap] ${warning}`);
    console.info(
      `[basemap] provider chain: ${providers.map((provider) => provider.name).join(' → ')}`,
    );
  }, [providers, warnings]);

  const activeProvider = providers[Math.min(providerIndex, providers.length - 1)];

  /**
   * Marks a provider as failed and steps ONCE to the next in the chain.
   * Monotonic and idempotent: stale events from removed layers are ignored,
   * a provider is never retried, and the chain end is final — the map stays
   * interactive (pin, click, controls, glow) even without basemap tiles.
   */
  const handleProviderFail = useCallback(
    (providerId, reason, detail = '') => {
      if (failedProvidersRef.current.has(providerId)) return;
      const index = providerIndexRef.current;
      const current = providers[index];
      if (!current || current.id !== providerId) return;
      failedProvidersRef.current.add(providerId);
      const next = providers[index + 1];
      if (next) {
        console.warn(
          `[basemap] "${current.name}" failed (${reason}); switching to "${next.name}". ${detail}`.trimEnd(),
        );
        providerIndexRef.current = index + 1;
        setProviderIndex(index + 1);
      } else {
        console.warn(
          `[basemap] "${current.name}" failed (${reason}) and no fallback providers remain; the map stays interactive without basemap tiles. ${detail}`.trimEnd(),
        );
      }
    },
    [providers],
  );

  const handleTileError = useCallback(
    (providerId) => {
      if (failedProvidersRef.current.has(providerId)) return;
      const now = Date.now();
      let bucket = tileErrorBucketsRef.current[providerId];
      if (!bucket || now - bucket.windowStart > TILE_ERROR_WINDOW_MS) {
        bucket = { count: 0, windowStart: now };
        tileErrorBucketsRef.current[providerId] = bucket;
      }
      bucket.count += 1;
      if (bucket.count >= TILE_ERROR_THRESHOLD) {
        handleProviderFail(
          providerId,
          `${bucket.count} tile requests failed within ${Math.round((now - bucket.windowStart) / 1000)}s`,
        );
      }
    },
    [handleProviderFail],
  );

  return (
    <div className="dark-map" aria-label="Interactive dark-sky map">
      <MapContainer
        center={center}
        zoom={zoom}
        minZoom={3}
        maxZoom={18}
        scrollWheelZoom
        zoomControl={false}
        preferCanvas
        worldCopyJump
      >
        {activeProvider.layers.map((layer, index) => {
          const { url, attribution, ...layerOptions } = layer;
          return (
            <TileLayer
              key={`${activeProvider.id}-${index}`}
              url={url}
              attribution={attribution}
              errorTileUrl={ERROR_TILE_URL}
              eventHandlers={{ tileerror: () => handleTileError(activeProvider.id) }}
              {...layerOptions}
            />
          );
        })}
        <BasemapProbe provider={activeProvider} onProviderFail={handleProviderFail} />
        <LightPollutionCanvasLayer enabled={showHeatmap} />
        <Marker position={center} icon={markerIcon} keyboard title="Selected observing site">
          <Popup>
            <div className="map-popup">
              <strong>{locationName || 'Observing site'}</strong>
              <span>
                {latitude.toFixed(4)}°, {longitude.toFixed(4)}°
              </span>
            </div>
          </Popup>
        </Marker>
        <MapClickHandler onLocationSelect={onLocationSelect} />
        <MapRecenter center={center} zoom={zoom} />
        <ZoomControl position="bottomright" />
        <ScaleControl position="bottomright" imperial={false} maxWidth={100} />
      </MapContainer>
    </div>
  );
}
