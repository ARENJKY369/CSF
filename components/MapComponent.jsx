'use client';

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Circle,
  MapContainer,
  Marker,
  Popup,
  ScaleControl,
  TileLayer,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import {
  Activity,
  Check,
  Cloud,
  Crosshair,
  Layers,
  LoaderCircle,
  MoonStar,
  Mountain,
  Satellite as SatelliteIcon,
  X,
} from 'lucide-react';
import { LIGHT_HUBS } from '../lib/astronomy';
import { CLOUD_REFRESH_MS, buildCloudOverlay } from '../lib/cloudOverlay';
import {
  BASEMAPS,
  buildBasemapChain,
  buildProviderChain,
  getBasemap,
  resolveDefaultBasemapId,
} from '../lib/tileProviders';
import { probeTileProvider } from '../lib/tileProbeRunner';

// Matches .leaflet-container's background so failed tiles degrade to dark
// squares instead of broken-image icons. Purely local — no external request.
const ERROR_TILE_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256'%3E%3Crect width='256' height='256' fill='%230a1116'/%3E%3C/svg%3E";

// 1x1 transparent GIF. Overlays (clouds) must fail invisibly: a dark square
// veil over the basemap would look like a storm front.
const TRANSPARENT_TILE_URL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Advance to the next provider after this many tile request failures…
const TILE_ERROR_THRESHOLD = 5;
// …counted within this sliding window, so a one-off network blip doesn't
// downgrade the basemap.
const TILE_ERROR_WINDOW_MS = 20000;
// Same tolerance for the optional cloud overlay, which degrades to "off".
const CLOUD_TILE_ERROR_THRESHOLD = 5;

// "Locate me" flies to street level: 15 with a GPS-grade fix, 14 when the
// reported accuracy is coarse (a tight zoom would overstate the precision).
const LOCATE_ZOOM_PRECISE = 15;
const LOCATE_ZOOM_COARSE = 14;
const LOCATE_PRECISE_ACCURACY_M = 250;
const LOCATE_FLY_DURATION = 1.4;

const BASEMAP_ICONS = {
  satellite: SatelliteIcon,
  dark: MoonStar,
  terrain: Mountain,
};

// Hoisted so the accuracy circle isn't re-styled on every parent render.
const ACCURACY_CIRCLE_OPTIONS = {
  color: '#5cdaeb',
  weight: 1,
  opacity: 0.4,
  fillColor: '#5cdaeb',
  fillOpacity: 0.07,
};

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

/**
 * Keeps the Leaflet view in sync with the observing pin.
 *
 * `flightRef` guards the one case where a programmatic move is already
 * underway: a "Locate me" flyTo(). The parent turns the fix into a location
 * prop in the same tick, and a second setView() would cancel Leaflet's smooth
 * flight, so a matching in-flight target is honoured instead of re-issued.
 */
function MapRecenter({ center, zoom, flightRef }) {
  const map = useMap();
  useEffect(() => {
    if (!Number.isFinite(center?.[0]) || !Number.isFinite(center?.[1])) return;
    const flight = flightRef?.current;
    if (
      flight &&
      flight.until > Date.now() &&
      Math.abs(flight.lat - center[0]) < 1e-5 &&
      Math.abs(flight.lng - center[1]) < 1e-5
    ) {
      flightRef.current = null;
      return;
    }
    map.setView(center, zoom, { animate: true, duration: 0.7 });
  }, [map, center?.[0], center?.[1], zoom, flightRef]);
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

/**
 * "Live clouds": NASA GIBS geostationary Band 13 infrared tiles — keyless,
 * transparent PNG, refreshed every ~10 minutes (see lib/cloudOverlay.js for
 * the source, coverage caveats and why the `default` time keyword is used).
 *
 * Drawn imperatively (like the glow layer) so the sector URL can be swapped
 * when the pin crosses a satellite's disk and so the newest frame can be
 * re-requested on a timer. Tile failures stay invisible (transparent error
 * tile) and, if they pile up, the overlay reports back and switches itself off
 * rather than leaving a half-broken veil on the map.
 */
function CloudOverlayLayer({ enabled, feed, onFeedError }) {
  const map = useMap();
  const feedErrorRef = useRef(onFeedError);
  useEffect(() => {
    feedErrorRef.current = onFeedError;
  });

  useEffect(() => {
    if (!enabled || feed.coverage === 'none') return undefined;

    const layer = L.tileLayer(feed.url, {
      pane: 'tilePane',
      // Above the simulated glow (220): real cloud sits above ground-level
      // light pollution, and the veil still lets the glow read through.
      zIndex: 240,
      opacity: 0.62,
      tileSize: 256,
      // Band 13 IR is a ~2 km product published at GoogleMapsCompatible_Level6;
      // Leaflet upscales beyond z6 instead of requesting tiles that don't exist.
      maxNativeZoom: 6,
      maxZoom: 18,
      attribution: feed.attribution,
      errorTileUrl: TRANSPARENT_TILE_URL,
      interactive: false,
      updateWhenIdle: true,
      keepBuffer: 1,
    });

    let errors = 0;
    let windowStart = Date.now();
    layer.on('tileerror', () => {
      const now = Date.now();
      if (now - windowStart > TILE_ERROR_WINDOW_MS) {
        errors = 0;
        windowStart = now;
      }
      errors += 1;
      if (errors === CLOUD_TILE_ERROR_THRESHOLD) {
        feedErrorRef.current?.(
          `${errors} cloud tiles failed within ${Math.round((now - windowStart) / 1000)}s`,
        );
      }
    });

    layer.addTo(map);
    const refresh = window.setInterval(() => {
      if (map.hasLayer(layer)) layer.redraw();
    }, CLOUD_REFRESH_MS);

    return () => {
      window.clearInterval(refresh);
      layer.off();
      if (map.hasLayer(layer)) map.removeLayer(layer);
    };
  }, [enabled, feed.url, feed.coverage, feed.attribution, map]);
  return null;
}

/**
 * Pulsing cyan radar pin at the device's exact fix, plus the GPS accuracy
 * circle. Purely informational: it never intercepts clicks (the map below it
 * still pins observing sites) and it never moves the observing pin itself.
 */
function UserFixMarker({ fix }) {
  const radarIcon = useMemo(
    () =>
      L.divIcon({
        className: 'user-radar-marker',
        html:
          '<span class="radar-ring"></span>' +
          '<span class="radar-ring is-delayed"></span>' +
          '<span class="radar-core"></span>',
        iconSize: [52, 52],
        iconAnchor: [26, 26],
      }),
    [],
  );
  if (!fix) return null;
  const position = [fix.lat, fix.lng];
  const showAccuracy =
    Number.isFinite(fix.accuracy) && fix.accuracy > 0 && fix.accuracy <= 20000;
  return (
    <>
      {showAccuracy && (
        <Circle
          center={position}
          radius={fix.accuracy}
          interactive={false}
          pathOptions={ACCURACY_CIRCLE_OPTIONS}
        />
      )}
      <Marker
        position={position}
        icon={radarIcon}
        interactive={false}
        keyboard={false}
        zIndexOffset={-200}
        alt="Your current location"
        title="Your current location"
      />
    </>
  );
}

/**
 * Listens for Leaflet's geolocation results and turns them into app state.
 * `map.locate()` itself is fired by the Locate button (see LocateButton).
 */
function LocateController({ onFix, onError, flightRef }) {
  const map = useMap();
  const handlersRef = useRef({ onFix, onError });
  useEffect(() => {
    handlersRef.current = { onFix, onError };
  });

  const handlers = useMemo(
    () => ({
      locationfound(event) {
        const { latitude, longitude, accuracy } = event;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        const zoom = Math.min(
          map.getMaxZoom(),
          Math.max(
            map.getMinZoom(),
            Number.isFinite(accuracy) && accuracy <= LOCATE_PRECISE_ACCURACY_M
              ? LOCATE_ZOOM_PRECISE
              : LOCATE_ZOOM_COARSE,
          ),
        );
        // map.locate({ setView: true }) has already started a coarse recentre;
        // flyTo() stops that animation and takes over, so the user sees ONE
        // smooth street-level flight instead of a jump followed by a pan.
        if (flightRef) {
          flightRef.current = {
            lat: latitude,
            lng: longitude,
            until: Date.now() + LOCATE_FLY_DURATION * 1000 + 500,
          };
        }
        map.flyTo([latitude, longitude], zoom, {
          duration: LOCATE_FLY_DURATION,
          easeLinearity: 0.25,
        });
        handlersRef.current.onFix?.({
          lat: Number(latitude.toFixed(6)),
          lng: Number(longitude.toFixed(6)),
          accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
          timestamp: Number.isFinite(event.timestamp) ? event.timestamp : Date.now(),
        });
      },
      locationerror(event) {
        handlersRef.current.onError?.(event);
      },
    }),
    [map, flightRef],
  );

  useMapEvents(handlers);
  return null;
}

/** Reports the map box height so popovers can never outgrow the container. */
function MapSizeTracker({ onHeightChange }) {
  const map = useMap();
  useEffect(() => {
    const report = () => onHeightChange(map.getSize().y);
    report();
    map.on('resize', report);
    return () => {
      map.off('resize', report);
    };
  }, [map, onHeightChange]);
  return null;
}

/** Closes the layer popover when the user goes back to the map itself. */
function PopoverCloser({ active, onClose }) {
  const handlers = useMemo(
    () => ({
      click: () => {
        if (active) onClose();
      },
      movestart: () => {
        if (active) onClose();
      },
      zoomstart: () => {
        if (active) onClose();
      },
    }),
    [active, onClose],
  );
  useMapEvents(handlers);
  return null;
}

/**
 * Hosts arbitrary React UI inside a real Leaflet control, so the widget lives
 * in Leaflet's own control layer: guaranteed to stay within the map box,
 * correctly stacked against the zoom/scale/attribution controls, and isolated
 * from map interaction (clicks don't become map clicks, wheel doesn't zoom).
 */
function MapControlWidget({ position, className, children }) {
  const map = useMap();
  const [container, setContainer] = useState(null);

  // Layout effect (not passive): Leaflet inserts bottom-corner controls at the
  // TOP of their corner container, so add order decides the visual stack. Being
  // added before react-leaflet's ZoomControl/ScaleControl (which use passive
  // effects) is what places this widget directly below the zoom buttons.
  useLayoutEffect(() => {
    const WidgetControl = L.Control.extend({
      onAdd() {
        const element = L.DomUtil.create('div', `map-widget ${className}`.trim());
        L.DomEvent.disableClickPropagation(element);
        L.DomEvent.disableScrollPropagation(element);
        return element;
      },
    });
    const control = new WidgetControl({ position });
    control.addTo(map);
    setContainer(control.getContainer());
    return () => {
      map.removeControl(control);
    };
  }, [map, position, className]);

  return container ? createPortal(children, container) : null;
}

function LayerSwitch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      className="layer-switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={() => onChange(!checked)}
    >
      <span className="layer-switch-knob" aria-hidden="true" />
    </button>
  );
}

/**
 * Google-Maps-style layer picker: radio thumbnails for the basemap ("map type")
 * plus toggle switches for overlays. Swapping a map type only changes which
 * <TileLayer> children Leaflet renders — the map instance, view, overlays and
 * the observing pin are untouched, so no coordinates are lost.
 */
function LayerSwitcher({
  open,
  onOpenChange,
  basemapId,
  onBasemapChange,
  provider,
  providerDegraded,
  showHeatmap,
  onToggleHeatmap,
  cloudsEnabled,
  onCloudsToggle,
  cloudFeed,
  cloudError,
  mapHeight,
}) {
  const buttonRef = useRef(null);
  const groupRef = useRef(null);

  const closeAndRestore = useCallback(() => {
    onOpenChange(false);
    buttonRef.current?.focus();
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAndRestore();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, closeAndRestore]);

  const onKeyDown = (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const options = Array.from(groupRef.current?.querySelectorAll('[role="radio"]') ?? []);
    if (options.length === 0) return;
    const current = options.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : options.length - 1;
    const next = (current + delta) % options.length;
    options[next].focus();
    onBasemapChange(BASEMAPS[next].id);
  };

  const cloudHint = cloudError
    ? 'FEED UNREACHABLE'
    : cloudFeed.coverage === 'none'
      ? 'NO IR DISK OVER THIS SITE'
      : `${cloudFeed.satellite.shortName} IR · ~10 MIN`;
  const cloudNote = cloudError || (cloudFeed.coverage === 'live' ? '' : cloudFeed.note);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`map-widget-button${open ? ' is-open' : ''}`}
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? 'map-layer-menu' : undefined}
        title="Map layers and overlays"
      >
        <Layers aria-hidden="true" />
        <span className="map-widget-text">LAYERS</span>
      </button>
      {open && (
        <div
          className="layer-popover"
          id="map-layer-menu"
          role="dialog"
          aria-label="Map layers"
          style={mapHeight ? { maxHeight: Math.max(190, mapHeight - 84) } : undefined}
        >
          <div className="layer-popover-head">
            <span className="layer-popover-heading">MAP LAYERS</span>
            <button
              type="button"
              className="layer-popover-close"
              onClick={closeAndRestore}
              aria-label="Close layer menu"
              title="Close"
            >
              <X aria-hidden="true" />
            </button>
          </div>

          <div className="layer-section-title">MAP TYPE</div>
          <div className="layer-thumbs" role="radiogroup" aria-label="Map type" ref={groupRef} onKeyDown={onKeyDown}>
            {BASEMAPS.map((basemap) => {
              const Icon = BASEMAP_ICONS[basemap.id] || SatelliteIcon;
              const selected = basemap.id === basemapId;
              return (
                <button
                  type="button"
                  key={basemap.id}
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  className={`layer-thumb${selected ? ' is-selected' : ''}`}
                  onClick={() => onBasemapChange(basemap.id)}
                  title={`${basemap.label} — ${basemap.hint}`}
                >
                  <span className="layer-thumb-art" data-basemap={basemap.id}>
                    <Icon aria-hidden="true" />
                    {selected && (
                      <span className="layer-thumb-check" aria-hidden="true">
                        <Check />
                      </span>
                    )}
                  </span>
                  <span className="layer-thumb-label">{basemap.label}</span>
                </button>
              );
            })}
          </div>

          <div className="layer-section-title">OVERLAYS</div>
          <div className="layer-row">
            <span className="layer-row-icon" aria-hidden="true">
              <Activity />
            </span>
            <span className="layer-row-copy">
              <span className="layer-row-title">Light pollution</span>
              <span className="layer-row-hint">SIMULATED SKY-GLOW HEATMAP</span>
            </span>
            <LayerSwitch
              checked={Boolean(showHeatmap)}
              onChange={onToggleHeatmap}
              label="Toggle the simulated light-pollution overlay"
            />
          </div>
          <div className="layer-row">
            <span className="layer-row-icon" aria-hidden="true">
              <Cloud />
            </span>
            <span className="layer-row-copy">
              <span className="layer-row-title">Live clouds</span>
              <span className="layer-row-hint">{cloudHint}</span>
            </span>
            <LayerSwitch
              checked={cloudsEnabled && !cloudError}
              onChange={onCloudsToggle}
              label="Toggle the live infrared cloud overlay"
            />
          </div>

          {cloudNote && (
            <p className={`layer-note${cloudError ? ' is-warn' : ''}`} role="status">
              {cloudNote}
            </p>
          )}

          <div className="layer-popover-foot">
            <span className={`layer-foot-dot${providerDegraded ? ' is-warn' : ''}`} aria-hidden="true" />
            <span className="layer-foot-text">
              {(provider.shortName || provider.name).toUpperCase()}
              {providerDegraded ? ' · FALLBACK' : provider.requiresKey ? ' · YOUR KEY' : ' · KEYLESS'}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

/** Floating "Locate me" target button, bottom-right inside the map box. */
function LocateButton({ locating, hasFix, message, isError, onLocate }) {
  const map = useMap();
  const handleClick = useCallback(() => {
    if (locating) return;
    // High-accuracy, street-level, recentring locate — re-triggered on every
    // click so a stale fix is always replaced by a fresh one (maximumAge: 0).
    map.locate({
      setView: true,
      maxZoom: LOCATE_ZOOM_PRECISE,
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0,
    });
    onLocate();
  }, [map, locating, onLocate]);

  return (
    <>
      {message && (
        <div className={`locate-toast${isError ? ' is-error' : ''}`} role="status">
          {isError ? <X aria-hidden="true" /> : <Crosshair aria-hidden="true" />}
          <span>{message}</span>
        </div>
      )}
      <button
        type="button"
        className={`map-widget-button map-locate-button${hasFix ? ' is-locked' : ''}${locating ? ' is-busy' : ''}`}
        onClick={handleClick}
        disabled={locating}
        aria-busy={locating}
        aria-label={locating ? 'Locating your position' : 'Locate me and recenter the map'}
        title={locating ? 'Acquiring high-accuracy fix…' : 'Locate me (high accuracy)'}
      >
        {locating ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Crosshair aria-hidden="true" />}
      </button>
    </>
  );
}

export default function MapComponent({
  latitude,
  longitude,
  zoom = 9,
  locationName,
  onLocationSelect,
  onUserLocate,
  onLocateError,
  onLocatingChange,
  showHeatmap = true,
  onToggleHeatmap = () => {},
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

  // ── Map type (user-selectable) + keyless provider chain ─────────────────
  // `activeTileLayer` lives in state: picking a map type swaps only the
  // <TileLayer> children, so the Leaflet map instance, the current view and
  // the observing pin coordinates are all preserved.
  const envChain = useMemo(() => buildProviderChain(), []);
  const [basemapId, setBasemapId] = useState(() => resolveDefaultBasemapId());
  const basemap = useMemo(() => getBasemap(basemapId), [basemapId]);
  const providers = useMemo(
    () => buildBasemapChain(basemapId, envChain.chain),
    [basemapId, envChain],
  );
  const [providerIndex, setProviderIndex] = useState(0);
  const providerIndexRef = useRef(0);
  const failedProvidersRef = useRef(new Set());
  const tileErrorBucketsRef = useRef({});
  const warningsLoggedRef = useRef(false);
  const loggedChainRef = useRef(null);

  // ── Widget + overlay state ──────────────────────────────────────────────
  const [layersOpen, setLayersOpen] = useState(false);
  const [mapHeight, setMapHeight] = useState(0);
  const [cloudsEnabled, setCloudsEnabled] = useState(false);
  const [cloudError, setCloudError] = useState('');
  const [userFix, setUserFix] = useState(null);
  const [locateStatus, setLocateStatus] = useState('idle'); // idle|locating|found|error
  const [locateMessage, setLocateMessage] = useState('');
  const locateFlightRef = useRef(null);

  const cloudFeed = useMemo(() => buildCloudOverlay(longitude), [longitude]);
  const cloudSatelliteId = cloudFeed.satellite.id;

  useEffect(() => {
    if (warningsLoggedRef.current) return;
    warningsLoggedRef.current = true;
    for (const warning of envChain.warnings) console.warn(`[basemap] ${warning}`);
  }, [envChain]);

  useEffect(() => {
    if (loggedChainRef.current === providers) return;
    loggedChainRef.current = providers;
    console.info(
      `[basemap] map type "${basemap.label}" → chain: ${providers.map((provider) => provider.name).join(' → ')}`,
    );
  }, [providers, basemap]);

  // A new chain starts at its first not-yet-failed provider (failures are
  // remembered per provider id, so a dead source is never retried).
  useEffect(() => {
    let index = 0;
    while (index < providers.length - 1 && failedProvidersRef.current.has(providers[index].id)) {
      index += 1;
    }
    providerIndexRef.current = index;
    setProviderIndex(index);
  }, [providers]);

  const activeProvider =
    providers[Math.min(providerIndex, providers.length - 1)] ?? providers[providers.length - 1];
  const providerDegraded = providerIndex > 0;

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

  const handleBasemapChange = useCallback((nextId) => {
    const next = getBasemap(nextId);
    // Re-selecting the current map type is a no-op: no tile churn, no probe.
    setBasemapId((current) => (current === next.id ? current : next.id));
  }, []);

  const closeLayers = useCallback(() => setLayersOpen(false), []);

  const handleCloudsToggle = useCallback(() => {
    setCloudError('');
    setCloudsEnabled((value) => !value);
  }, []);

  const handleCloudFeedError = useCallback((detail) => {
    console.warn(`[clouds] live cloud overlay disabled (${detail}).`);
    setCloudError('Live cloud tiles are unreachable right now.');
  }, []);

  useEffect(() => {
    setCloudError('');
  }, [cloudSatelliteId]);

  // ── Locate me ───────────────────────────────────────────────────────────
  const handleLocateRequest = useCallback(() => {
    setLocateStatus('locating');
    setLocateMessage('');
    onLocatingChange?.(true);
  }, [onLocatingChange]);

  const handleLocateFix = useCallback(
    (fix) => {
      setUserFix(fix);
      setLocateStatus('found');
      setLocateMessage(
        Number.isFinite(fix.accuracy) && fix.accuracy > 0
          ? `Fix locked · ±${fix.accuracy} m`
          : 'Fix locked',
      );
      onLocatingChange?.(false);
      // Hands the coordinates to the dashboard, which re-fires the Open-Meteo
      // fetch and recalculates the stargazing score for the new site.
      onUserLocate?.(fix);
    },
    [onLocatingChange, onUserLocate],
  );

  const handleLocateFailure = useCallback(
    (event) => {
      const code = event?.code;
      const message =
        code === 1
          ? 'Location permission blocked'
          : code === 2
            ? 'Position unavailable'
            : code === 3
              ? 'Fix timed out — try again'
              : event?.message || 'Geolocation unavailable here';
      console.warn(`[locate] geolocation failed (code ${code ?? 'n/a'}): ${message}`);
      setLocateStatus('error');
      setLocateMessage(message);
      onLocatingChange?.(false);
      onLocateError?.(code);
    },
    [onLocatingChange, onLocateError],
  );

  // Transient status chips fade on their own so the map box stays clean.
  useEffect(() => {
    if (!locateMessage) return undefined;
    const timer = window.setTimeout(
      () => setLocateMessage(''),
      locateStatus === 'error' ? 7000 : 4200,
    );
    return () => window.clearTimeout(timer);
  }, [locateMessage, locateStatus]);

  useEffect(() => {
    if (locateStatus !== 'error') return undefined;
    const timer = window.setTimeout(
      () => setLocateStatus(userFix ? 'found' : 'idle'),
      7000,
    );
    return () => window.clearTimeout(timer);
  }, [locateStatus, userFix]);

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
        <CloudOverlayLayer
          enabled={cloudsEnabled && !cloudError}
          feed={cloudFeed}
          onFeedError={handleCloudFeedError}
        />
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
        <UserFixMarker fix={userFix} />
        <MapClickHandler onLocationSelect={onLocationSelect} />
        <MapRecenter center={center} zoom={zoom} flightRef={locateFlightRef} />
        <LocateController
          onFix={handleLocateFix}
          onError={handleLocateFailure}
          flightRef={locateFlightRef}
        />
        <MapSizeTracker onHeightChange={setMapHeight} />
        <PopoverCloser active={layersOpen} onClose={closeLayers} />

        {/* Everything below is a Leaflet control, so it stays strictly inside
            the map box border and stacks with Leaflet's own controls. */}
        <MapControlWidget position="bottomright" className="map-locate-widget">
          <LocateButton
            locating={locateStatus === 'locating'}
            hasFix={Boolean(userFix)}
            message={locateMessage}
            isError={locateStatus === 'error'}
            onLocate={handleLocateRequest}
          />
        </MapControlWidget>
        <ZoomControl position="bottomright" />
        <ScaleControl position="bottomright" imperial={false} maxWidth={100} />
        <MapControlWidget position="topright" className="map-layers-widget">
          <LayerSwitcher
            open={layersOpen}
            onOpenChange={setLayersOpen}
            basemapId={basemapId}
            onBasemapChange={handleBasemapChange}
            provider={activeProvider}
            providerDegraded={providerDegraded}
            showHeatmap={showHeatmap}
            onToggleHeatmap={onToggleHeatmap}
            cloudsEnabled={cloudsEnabled}
            onCloudsToggle={handleCloudsToggle}
            cloudFeed={cloudFeed}
            cloudError={cloudError}
            mapHeight={mapHeight}
          />
        </MapControlWidget>
      </MapContainer>
    </div>
  );
}
