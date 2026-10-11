'use client';

import { useEffect, useMemo } from 'react';
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

const DARK_TILE_URL =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

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
        <TileLayer
          attribution={TILE_ATTRIBUTION}
          url={DARK_TILE_URL}
          subdomains="abcd"
          maxZoom={20}
          tileSize={256}
        />
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
