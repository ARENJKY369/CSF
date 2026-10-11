'use client';

import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Check,
  Cloud,
  Compass,
  Crosshair,
  Droplets,
  Eye,
  Info,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Moon,
  MoonStar,
  Navigation,
  Orbit,
  RefreshCw,
  Search,
  Satellite,
  Sparkles,
  Star,
  Sun,
  Sunrise,
  Telescope,
  Wind,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  calculateStargazingScore,
  DEFAULT_LOCATION,
  estimateBortle,
  formatElapsed,
  formatLocalTime,
  getNightPlan,
  getObservationalTargets,
  scoreLabel,
} from '../lib/astronomy';

const DarkMap = dynamic(() => import('../components/MapComponent'), { ssr: false });

const FALLBACK_TIME_ZONE = 'America/New_York';
const LIGHT_PRESETS = {
  auto: null,
  rural: 2,
  suburban: 5,
  urban: 8,
};
const PRESET_LABELS = {
  auto: 'Auto estimate',
  rural: 'Rural · Bortle 2',
  suburban: 'Suburban · Bortle 5',
  urban: 'Urban · Bortle 8',
};

function safeTimeZoneName(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value || 'LOCAL';
  } catch {
    return 'LOCAL';
  }
}

function formatLocalDate(date, timeZone) {
  if (!date) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(date);
  }
}

function formatClock(date, timeZone, includeSeconds = false) {
  if (!date) return '––:––';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      ...(includeSeconds ? { second: '2-digit' } : {}),
      hour12: false,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      ...(includeSeconds ? { second: '2-digit' } : {}),
      hour12: false,
    }).format(date);
  }
}

function scoreTierClass(score) {
  if (score === null) return '';
  if (score >= 65) return 'tier-good';
  if (score >= 45) return 'tier-fair';
  return 'tier-poor';
}

function targetStateClass(status) {
  if (!status) return '';
  const normalized = status.toLowerCase();
  if (normalized.includes('optimal')) return 'is-optimal';
  if (normalized.includes('visible')) return 'is-visible';
  if (normalized.includes('excellent')) return 'is-excellent';
  if (normalized.includes('fair')) return 'is-fair';
  if (normalized.includes('rising')) return 'is-rising';
  if (normalized.includes('marginal')) return 'is-marginal';
  if (normalized.includes('low altitude') || normalized.includes('setting')) return 'is-low';
  if (normalized.includes('weather limited')) return 'is-limited';
  if (normalized.includes('city glow')) return 'is-city';
  if (normalized.includes('below horizon')) return 'is-below';
  if (normalized.includes('pending') || normalized.includes('calculating')) return 'is-waiting';
  return '';
}

function metricDisplay(value, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  return digits ? value.toFixed(digits) : String(Math.round(value));
}

function formatTargetAltitude(altitude) {
  if (!Number.isFinite(altitude)) return 'ALT —';
  return `ALT ${altitude >= 0 ? '+' : ''}${Math.round(altitude)}°`;
}

function getSearchName(result) {
  const parts = (result.display_name || '').split(',').map((part) => part.trim());
  return parts.slice(0, Math.min(parts.length, 3)).join(', ') || 'Pinned location';
}

function Header({
  now,
  timeZone,
  nightVision,
  onToggleNightVision,
  weatherStatus,
  onRefresh,
  refreshing,
}) {
  const statusText =
    weatherStatus === 'ready'
      ? 'LIVE CONDITIONS'
      : weatherStatus === 'refreshing'
        ? 'UPDATING CONDITIONS'
        : weatherStatus === 'error'
          ? 'FEED UNAVAILABLE'
          : 'CONNECTING TO SKY';
  return (
    <header className="app-header">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <Satellite />
        </div>
        <div className="brand-name">
          CLEAR SKIES <span>FORECASTER</span>
        </div>
        <span className="brand-divider" />
        <span className="brand-station">FIELD STATION 01</span>
      </div>
      <div className="header-right">
        <div className={`header-status ${weatherStatus === 'error' ? 'is-error' : ''}`}>
          <span className="live-dot" />
          <span>{statusText}</span>
        </div>
        <button
          className="refresh-button"
          type="button"
          onClick={onRefresh}
          title="Refresh current conditions"
          aria-label="Refresh current conditions"
          disabled={refreshing}
        >
          <RefreshCw className={refreshing ? 'spinner' : ''} />
        </button>
        <div className="header-clock" aria-label={`Local time ${formatClock(now, timeZone)}`}>
          <span className="clock-label">LOCAL SKY TIME · {safeTimeZoneName(timeZone)}</span>
          <span className="clock-time">{formatClock(now, timeZone)}</span>
        </div>
        <button
          className={`red-mode-button ${nightVision ? 'is-active' : ''}`}
          type="button"
          onClick={onToggleNightVision}
          aria-pressed={nightVision}
          title="Switch to low-glare red-light colors"
        >
          <MoonStar aria-hidden="true" />
          <span className="red-mode-text">RED-LIGHT MODE</span>
          <span className="mode-dot" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function SearchPanel({
  value,
  onValueChange,
  results,
  searching,
  searchMessage,
  onSelectResult,
  onUseMyLocation,
  locating,
}) {
  const [focused, setFocused] = useState(false);
  const searchRef = useRef(null);
  const showDropdown = focused && (value.trim().length >= 2 || searching || results.length > 0);

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      setFocused(false);
      searchRef.current?.blur();
    }
    if (event.key === 'Enter' && results.length > 0) {
      event.preventDefault();
      onSelectResult(results[0]);
      setFocused(false);
    }
  };

  return (
    <div className="hero-actions">
      <div className="search-wrap">
        <label className="search-box" htmlFor="location-search">
          <Search aria-hidden="true" />
          <input
            id="location-search"
            ref={searchRef}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => window.setTimeout(() => setFocused(false), 150)}
            onKeyDown={onKeyDown}
            type="search"
            autoComplete="off"
            placeholder="Search a place, park or dark-sky site"
            aria-label="Search for an observing location"
            aria-controls="location-search-results"
            aria-expanded={showDropdown}
          />
          <span className="search-shortcut">⌘ K</span>
        </label>
        <AnimatePresence>
          {showDropdown && (
            <motion.div
              id="location-search-results"
              className="search-dropdown"
              role="listbox"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
            >
              <div className="search-subtitle">OPENSTREETMAP PLACE SEARCH</div>
              {searching ? (
                <div className="search-loading">
                  <LoaderCircle />
                  Looking up places…
                </div>
              ) : results.length ? (
                results.map((result, index) => (
                  <button
                    className="search-result-button"
                    type="button"
                    role="option"
                    aria-selected="false"
                    key={`${result.place_id || index}-${result.lat}-${result.lon}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onSelectResult(result);
                      setFocused(false);
                      searchRef.current?.blur();
                    }}
                  >
                    <MapPin aria-hidden="true" />
                    <span style={{ minWidth: 0 }}>
                      <span className="search-result-name">{result.display_name}</span>
                      <span className="search-result-coords">
                        {Number(result.lat).toFixed(4)}°, {Number(result.lon).toFixed(4)}°
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="search-empty">
                  {searchMessage || (value.trim().length >= 2 ? 'Waiting to search…' : 'Type at least two characters to find a place.')}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <button
        className="search-action"
        type="button"
        onClick={onUseMyLocation}
        disabled={locating}
        title="Use this device's location"
      >
        {locating ? <LoaderCircle className="spinner" /> : <LocateFixed />}
        <span>Use my location</span>
      </button>
    </div>
  );
}

function WeatherMetrics({ weather, status }) {
  const cloud = weather ? weather.cloud_cover : null;
  const visibility = weather ? weather.visibility / 1000 : null;
  const humidity = weather ? weather.relative_humidity_2m : null;
  const wind = weather ? weather.wind_speed_10m : null;
  const cells = [
    { label: 'Cloud cover', icon: Cloud, value: cloud, unit: '%', note: cloud !== null && cloud <= 15 ? 'Excellent transparency' : 'Sky obstruction' },
    { label: 'Visibility', icon: Eye, value: visibility, digits: 1, unit: 'km', note: '10 km baseline ideal' },
    { label: 'Humidity', icon: Droplets, value: humidity, unit: '%', note: 'Moisture load' },
    { label: 'Wind', icon: Wind, value: wind, digits: 1, unit: 'km/h', note: 'Telescope stability' },
  ];
  return (
    <div className="metrics-grid" aria-label="Current weather indicators">
      {cells.map(({ label, icon: Icon, value, digits = 0, unit, note }) => (
        <div className="metric-cell" key={label}>
          <div className="metric-label"><Icon aria-hidden="true" /> {label}</div>
          <div className="metric-number">
            {status === 'loading' && !weather ? <span className="skeleton" style={{ width: 36, height: 17 }} /> : metricDisplay(value, digits)}
            <span className="metric-unit">{unit}</span>
          </div>
          <div className="metric-note">{weather ? note : status === 'error' ? 'No current reading' : 'Awaiting model'}</div>
        </div>
      ))}
    </div>
  );
}

function ScoreCard({ score, weather, weatherStatus, weatherError }) {
  const band = scoreLabel(score);
  const statusText = weatherStatus === 'error'
    ? 'OFFLINE'
    : weatherStatus === 'ready'
      ? 'LIVE'
      : weatherStatus === 'refreshing' && weather
        ? 'UPDATING'
        : 'SYNC';
  const loadingStatus = (weatherStatus === 'loading' || weatherStatus === 'refreshing') && !weather;
  let limitingFactor = 'Waiting for feed';
  if (score !== null && weather) {
    const candidates = [
      { label: 'Cloud cover', penalty: Math.min(100, weather.cloud_cover * 0.6 + Math.max(0, weather.cloud_cover - 60)) },
      { label: 'Urban sky glow', penalty: Math.max(0, (weather.bortle - 1) * 3.5) },
      { label: 'Humidity + wind', penalty: Math.max(0, (weather.relative_humidity_2m - 55) * 0.27) + Math.max(0, (weather.wind_speed_10m - 8) * 0.4) },
      { label: 'Visibility', penalty: Math.max(0, (10 - weather.visibility / 1000) * 2) },
    ];
    limitingFactor = candidates.sort((a, b) => b.penalty - a.penalty)[0]?.label || 'Clear-sky potential';
  }
  const circumference = 251.33;
  const offset = score === null ? circumference : circumference * (1 - score / 100);
  return (
    <section className="panel score-panel" aria-labelledby="score-title">
      <div className="card-heading">
        <div>
          <div className="card-title" id="score-title">
            <Sparkles aria-hidden="true" />
            Stargazing score
          </div>
          <span className="card-kicker">LIVE · WEATHER + DARKNESS MODEL</span>
        </div>
        <span className={`status-live ${weatherStatus === 'error' ? 'status-error' : loadingStatus ? 'status-loading' : ''}`}>
          <span className="live-dot" />
          {statusText}
        </span>
      </div>

      <div className="gauge-wrap" aria-label={score !== null ? `Stargazing score ${score} out of 100` : 'Waiting for current weather data'}>
        <span className="gauge-glow" />
        <svg className="gauge-svg" viewBox="0 0 100 100" aria-hidden="true">
          <circle className="gauge-track" cx="50" cy="50" r="40" />
          <circle
            className="gauge-progress"
            cx="50"
            cy="50"
            r="40"
            style={{ strokeDashoffset: offset }}
          />
          <path className="gauge-tick" d="M50 5v4M95 50h-4M50 95v-4M5 50h4" />
        </svg>
        <div className="gauge-center">
          <span className={`score-number ${score === null ? 'is-empty' : ''}`}>{score === null ? '—' : score}</span>
          <span className="score-out-of">{score === null ? 'NO DATA' : 'OF 100'}</span>
          <span className={`score-grade ${scoreTierClass(score)}`}>{band}</span>
        </div>
      </div>
      <p className="score-caption">A SITE-SPECIFIC OBSERVING WINDOW</p>

      <div className="score-summary">
        <span>Primary limiting factor</span>
        <strong>{limitingFactor}</strong>
      </div>

      <WeatherMetrics weather={weather} status={weatherStatus} />
      <div className="score-formula">CLOUDS × 0.6 · BORTLE WEIGHTED · MOISTURE / WIND CAPPED AT 20</div>
      {weatherError && (
        <div className="weather-warning" role="status">
          <AlertCircle aria-hidden="true" />
          <span>{weatherError}</span>
        </div>
      )}
    </section>
  );
}

function DarknessBrief({ plan, timeZone }) {
  const hasDarkWindow = Boolean(plan?.astronomicalDusk && plan?.astronomicalDawn && !plan.noDarkness);
  return (
    <section className="panel darkness-brief" aria-labelledby="darkness-brief-title">
      <div className="card-heading">
        <div>
          <div className="card-title" id="darkness-brief-title"><MoonStar aria-hidden="true" /> True-dark window</div>
          <span className="card-kicker">SUN BELOW −18° · LOCAL HORIZON</span>
        </div>
        <span className="darkness-live-mark"><span className="live-dot" />{plan?.activeNight ? 'NOW' : 'TONIGHT'}</span>
      </div>
      {hasDarkWindow ? (
        <>
          <div className="darkness-duration-row">
            <strong>{formatElapsed(plan.darkHours)}</strong>
            <span>of astronomical<br />darkness</span>
          </div>
          <div className="darkness-interval">
            <div><span>STARTS</span><strong>{formatLocalTime(plan.astronomicalDusk, timeZone)}</strong></div>
            <span className="darkness-separator">→</span>
            <div><span>ENDS</span><strong>{formatLocalTime(plan.astronomicalDawn, timeZone)}</strong></div>
          </div>
          <p className="darkness-footnote">The deepest-sky interval, between nautical twilight and dawn.</p>
        </>
      ) : plan ? (
        <div className="darkness-unavailable">Astronomical twilight persists at this latitude tonight.</div>
      ) : (
        <div className="darkness-unavailable">Solar events are aligning to the selected site…</div>
      )}
    </section>
  );
}

function LightPollutionCard({ bortle, preset, onPresetChange }) {
  return (
    <section className="panel light-panel" aria-labelledby="light-title">
      <div className="card-heading">
        <div>
          <div className="card-title" id="light-title"><Orbit aria-hidden="true" /> Sky brightness</div>
          <span className="card-kicker">BORTLE ESTIMATE · 1 IS DARKEST</span>
        </div>
        <span className="card-kicker" style={{ marginTop: 0 }}>MODEL</span>
      </div>
      <div className="light-row">
        <div className="light-class">
          <strong>{bortle}</strong>
          <span>/ 9</span>
        </div>
        <div className="light-source">
          {preset === 'auto' ? 'City-proximity model' : `${PRESET_LABELS[preset]} override`}
        </div>
      </div>
      <div className="bortle-scale" aria-label={`Estimated Bortle class ${bortle} of 9`}>
        {Array.from({ length: 9 }, (_, index) => (
          <span className={`bortle-segment ${index + 1 <= bortle ? 'is-active' : ''}`} key={index} />
        ))}
      </div>
      <div className="bortle-labels"><span>PRISTINE</span><span>SUBURBAN</span><span>URBAN</span></div>
      <div className="preset-row">
        <label htmlFor="light-preset">Site profile</label>
        <select
          id="light-preset"
          className="preset-select"
          value={preset}
          onChange={(event) => onPresetChange(event.target.value)}
          aria-label="Choose a light pollution preset"
        >
          {Object.entries(PRESET_LABELS).map(([value, label]) => (
            <option value={value} key={value}>{label}</option>
          ))}
        </select>
      </div>
    </section>
  );
}

function LocationCard({ location, geoStatus, locating }) {
  const isCherrySprings =
    Math.abs(location.lat - DEFAULT_LOCATION.lat) < 0.0001 &&
    Math.abs(location.lng - DEFAULT_LOCATION.lng) < 0.0001;
  const help =
    geoStatus === 'located'
      ? 'Device location is active'
      : geoStatus === 'available'
        ? 'Device location available · manual site selected'
        : geoStatus === 'denied'
          ? isCherrySprings
            ? 'Location permission denied · using Cherry Springs'
            : 'Manual site is active · device location not granted'
          : geoStatus === 'unsupported'
            ? 'Geolocation unavailable · search or pin the map'
            : isCherrySprings
              ? 'Cherry Springs is the safe starting point'
              : 'Manual observing pin is active';
  return (
    <section className="panel location-panel" aria-labelledby="location-title">
      <div className="card-heading">
        <div>
          <div className="card-title" id="location-title"><Crosshair aria-hidden="true" /> Observing site</div>
          <span className="card-kicker">PINNED COORDINATES</span>
        </div>
        {geoStatus === 'located' ? <Check size={14} color="var(--green)" aria-label="Location active" /> : <Navigation size={13} color="var(--muted)" aria-hidden="true" />}
      </div>
      <div className="location-name" title={location.name}>{location.name}</div>
      <div className="coord-label">
        <MapPin aria-hidden="true" />
        LAT {location.lat.toFixed(4)}° &nbsp;/&nbsp; LNG {location.lng.toFixed(4)}°
      </div>
      <div className="metric-note" style={{ marginTop: 8, lineHeight: 1.4 }}>{locating ? 'Requesting device coordinates…' : help}</div>
    </section>
  );
}

function MapPanel({ location, onLocationSelect, showHeatmap, onToggleHeatmap, weatherStatus }) {
  return (
    <section className="panel map-panel" aria-labelledby="map-panel-title">
      <div className="map-toolbar">
        <div className="map-toolbar-title">
          <div className="map-title-row" id="map-panel-title"><Compass aria-hidden="true" /> DARK-SKY FIELD MAP</div>
          <div className="map-caption">Click the map to move your observing pin</div>
        </div>
        <div className="map-toolbar-actions">
          <span className="map-status"><span className="live-dot" />{weatherStatus === 'ready' || weatherStatus === 'refreshing' ? 'LIVE MODEL' : 'SITE MODEL'}</span>
          <button
            type="button"
            className="map-layer-toggle"
            onClick={onToggleHeatmap}
            aria-pressed={showHeatmap}
            title="Toggle the simulated light-pollution overlay"
          >
            <Activity aria-hidden="true" />
            GLOW {showHeatmap ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
      <div className="map-stage">
        <DarkMap
          latitude={location.lat}
          longitude={location.lng}
          zoom={location.zoom || 9}
          locationName={location.name}
          onLocationSelect={onLocationSelect}
          showHeatmap={showHeatmap}
        />
        <div className="map-overlay-top">
          <span className="map-pin-caption"><MapPin aria-hidden="true" /> OBSERVING PIN</span>
          <span className="map-pin-caption">{location.lat.toFixed(3)}° / {location.lng.toFixed(3)}°</span>
        </div>
        <div className="map-legend" aria-label="Light pollution legend">
          <span className="map-legend-title">SIMULATED SKY GLOW</span>
          <span className="map-key"><i className="map-key-dot" /> Dark / rural</span>
          <span className="map-key"><i className="map-key-dot amber" /> Suburban fringe</span>
          <span className="map-key"><i className="map-key-dot red" /> Urban core</span>
        </div>
        <span className="map-attribution-note">CITY-PROXIMITY MODEL · NOT VIIRS DATA</span>
      </div>
      <div className="map-footer">
        <div className="map-footer-left"><Sparkles aria-hidden="true" /> Pan to scout a horizon; click to forecast.</div>
        <div className="map-footer-right"><MapPin aria-hidden="true" /> SELECTED SITE</div>
      </div>
    </section>
  );
}

function buildTimeline(plan, now, timeZone) {
  if (!plan?.sunset || !plan?.sunrise || plan.sunrise <= plan.sunset) return [];
  const span = plan.sunrise.getTime() - plan.sunset.getTime();
  const events = [
    { key: 'sunset', label: 'Sunset', time: plan.sunset, align: 'align-start', prominent: false },
    { key: 'civil', label: 'Civil', time: plan.civilDusk, prominent: false },
    { key: 'nautical', label: 'Nautical', time: plan.nauticalDusk, prominent: false },
    { key: 'dark', label: 'True dark', time: plan.astronomicalDusk, prominent: true },
    ...(plan.moonEvent ? [{ key: 'moon', label: plan.moonEventType, time: plan.moonEvent, moon: true }] : []),
    { key: 'dawn', label: 'Astro dawn', time: plan.astronomicalDawn, prominent: true },
    { key: 'sunrise', label: 'Sunrise', time: plan.sunrise, align: 'align-end', prominent: false },
  ];
  return events
    .filter((event) => event.time && event.time >= plan.sunset && event.time <= plan.sunrise)
    .map((event) => ({
      ...event,
      position: Math.max(0, Math.min(100, ((event.time.getTime() - plan.sunset.getTime()) / span) * 100)),
      clock: formatLocalTime(event.time, timeZone),
    }));
}

function AstroWindowsCard({ plan, now, timeZone }) {
  const timeline = useMemo(() => buildTimeline(plan, now, timeZone), [plan, now, timeZone]);
  const darkDuration = plan?.darkHours ? formatElapsed(plan.darkHours) : '—';
  const darkWindow = plan?.astronomicalDusk && plan?.astronomicalDawn
    ? `${formatLocalTime(plan.astronomicalDusk, timeZone)} — ${formatLocalTime(plan.astronomicalDawn, timeZone)}`
    : 'Astronomical dusk unavailable';
  return (
    <section className="panel astro-panel" aria-labelledby="astro-title">
      <div className="astro-heading">
        <div className="astro-heading-group">
          <div className="card-title" id="astro-title"><Sunrise aria-hidden="true" /> Tonight’s astro windows</div>
          <span className="card-kicker">SUN · MOON · CIVIL / NAUTICAL / ASTRONOMICAL</span>
        </div>
        <span className="astro-date">{formatLocalDate(now, timeZone)}</span>
      </div>

      {!plan ? (
        <div className="astro-empty">
          <Sun aria-hidden="true" />
          <strong>Calculating local twilight</strong>
          <span>Solar and lunar events will align to this site’s horizon.</span>
        </div>
      ) : (
        <>
          <div className="astro-summary">
            <div className="dark-duration">
              <div className="dark-duration-label">Absolute darkness · Sun below −18°</div>
              <div className="dark-duration-value">{darkDuration}</div>
              <div className="dark-duration-detail">{darkWindow}</div>
            </div>
            <div className="moon-summary">
              <span className="moon-orb"><Moon aria-hidden="true" /></span>
              <span style={{ minWidth: 0 }}>
                <span className="moon-phase-name">{plan.moonPhase}</span>
                <span className="moon-phase-illumination">{plan.moonIllumination}% illuminated</span>
              </span>
            </div>
          </div>
          {plan.noDarkness ? (
            <div className="astro-empty" style={{ paddingBottom: 15 }}>
              <MoonStar aria-hidden="true" />
              <strong>No full astronomical night</strong>
              <span>At this latitude the Sun stays above the −18° threshold tonight. Civil and nautical twilight still frame the observing window.</span>
            </div>
          ) : (
            <>
              <div className="astro-timeline" role="img" aria-label={`Sunset ${formatLocalTime(plan.sunset, timeZone)}, astronomical dusk ${formatLocalTime(plan.astronomicalDusk, timeZone)}, astronomical dawn ${formatLocalTime(plan.astronomicalDawn, timeZone)}, sunrise ${formatLocalTime(plan.sunrise, timeZone)}`}>
                <div className="astro-track">
                  {timeline.map((event) => {
                    let alignment = event.align || '';
                    if (!alignment && event.position < 4) alignment = 'align-start';
                    if (!alignment && event.position > 96) alignment = 'align-end';
                    const visibleLabel = ['sunset', 'dark', 'moon', 'dawn', 'sunrise'].includes(event.key);
                    return (
                      <span
                        className={`timeline-tick-wrap ${alignment}`}
                        style={{ left: `${event.position}%` }}
                        key={event.key}
                        title={`${event.label} · ${event.clock}`}
                      >
                        <i className={`timeline-tick ${event.prominent ? 'is-dark' : ''} ${event.moon ? 'is-moon' : ''}`} />
                        {visibleLabel && (
                          <span className={`timeline-marker-label ${alignment}`}>{event.label}</span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="timeline-clock-row">
                <div className="timeline-clock-cell"><span>Sunset</span><strong>{formatLocalTime(plan.sunset, timeZone)}</strong></div>
                <div className="timeline-clock-cell"><span>Civil dusk</span><strong>{formatLocalTime(plan.civilDusk, timeZone)}</strong></div>
                <div className="timeline-clock-cell"><span>Nautical dusk</span><strong>{formatLocalTime(plan.nauticalDusk, timeZone)}</strong></div>
                <div className="timeline-clock-cell"><span>Astronomical dusk</span><strong>{formatLocalTime(plan.astronomicalDusk, timeZone)}</strong></div>
                <div className="timeline-clock-cell" title={plan.moonNote || ''}><span>{plan.moonNote || plan.moonEventType || 'Moonrise / set'}</span><strong>{plan.moonEvent ? formatLocalTime(plan.moonEvent, timeZone) : '—'}</strong></div>
                <div className="timeline-clock-cell"><span>Astronomical dawn</span><strong>{formatLocalTime(plan.astronomicalDawn, timeZone)}</strong></div>
                <div className="timeline-clock-cell"><span>Sunrise</span><strong>{formatLocalTime(plan.sunrise, timeZone)}</strong></div>
              </div>
            </>
          )}
          <div className="astro-note">
            <Info aria-hidden="true" />
            <span>
              {plan.activeNight ? <><strong>Night in progress.</strong> Times mark the current dark window.</> : <><strong>Next night’s sequence.</strong> Twilight durations shift with season and latitude.</>}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function TargetIcon({ target }) {
  if (target.id === 'moon') return <Moon aria-hidden="true" />;
  if (target.id === 'jupiter' || target.id === 'saturn') return <Orbit aria-hidden="true" />;
  if (target.id === 'm42') return <Sparkles aria-hidden="true" />;
  if (target.id === 'm45') return <Star aria-hidden="true" />;
  return <Telescope aria-hidden="true" />;
}

function ObservationalTargets({ targets, score, weatherStatus }) {
  return (
    <section className="panel targets-panel" aria-labelledby="targets-title">
      <div className="card-heading">
        <div>
          <div className="card-title" id="targets-title"><Telescope aria-hidden="true" /> Observational targets</div>
          <span className="card-kicker">ALTITUDE + CURRENT SKY QUALITY</span>
        </div>
        <span className="target-count">{targets.length || 5} TRACKED</span>
      </div>
      <div className="target-list">
        {(targets.length ? targets : Array.from({ length: 6 }, (_, index) => ({
          id: `pending-${index}`,
          name: ['Andromeda Galaxy', 'Orion Nebula', 'Pleiades', 'Jupiter', 'Saturn', 'Moon'][index],
          catalog: 'calculating local altitude',
          altitude: null,
          status: 'CALCULATING',
        }))).map((target) => (
          <div className="observation-row" key={target.id}>
            <div className="target-main">
              <span className={`target-symbol ${target.id === 'moon' ? 'is-moon' : target.id === 'jupiter' || target.id === 'saturn' ? 'is-planet' : ''}`}>
                <TargetIcon target={target} />
              </span>
              <div className="target-copy">
                <div className="target-title">{target.name}</div>
                <div className="target-catalog">{target.catalog}</div>
              </div>
            </div>
            <div className="target-right">
              <span className={`target-state ${targetStateClass(target.status)}`}>{target.status}</span>
              <span className={`target-altitude ${Number.isFinite(target.altitude) && target.altitude > 0 ? 'is-above' : ''}`}>
                {formatTargetAltitude(target.altitude)}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="targets-footer">
        <Orbit aria-hidden="true" />
        <span>
          {weatherStatus === 'error' && score !== null
            ? 'Showing the last available weather snapshot; planet positions use an approximate local ephemeris.'
            : score === null
              ? 'Sky ratings appear when the weather feed connects. Planet positions use an approximate local ephemeris.'
              : 'Positions use local sidereal time; deep-sky contrast is reduced by moonlight and city glow.'}
        </span>
      </div>
    </section>
  );
}

function FeedNote({ weatherStatus, lastUpdated, timeZone }) {
  let copy;
  if (weatherStatus === 'error') {
    copy = 'The live weather feed is unavailable. Twilight and target geometry still calculate locally; use Refresh when your connection returns.';
  } else if (!lastUpdated) {
    copy = 'Allow location access for your horizon. No permission? The dashboard starts at Cherry Springs and remains searchable.';
  } else {
    copy = `Conditions from Open-Meteo · updated ${formatClock(lastUpdated, timeZone)} local. Weather refreshes every 15 minutes.`;
  }
  return (
    <div className="feed-note">
      <Info aria-hidden="true" />
      <span><strong>Field note.</strong> {copy}</span>
    </div>
  );
}

export default function Dashboard() {
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [clock, setClock] = useState(null);
  const [timezone, setTimezone] = useState(FALLBACK_TIME_ZONE);
  const [weather, setWeather] = useState(null);
  const [weatherStatus, setWeatherStatus] = useState('loading');
  const [weatherError, setWeatherError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [nightVision, setNightVision] = useState(false);
  const [preset, setPreset] = useState('auto');
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [geoStatus, setGeoStatus] = useState('requesting');
  const [locating, setLocating] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');
  const manualLocationRef = useRef(false);
  const initialGeoRequestRef = useRef(false);

  useEffect(() => {
    const updateClock = () => setClock(new Date());
    updateClock();
    const timer = window.setInterval(updateClock, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const setChosenLocation = useCallback((nextLocation) => {
    manualLocationRef.current = true;
    setLocation({
      ...nextLocation,
      lat: Number(nextLocation.lat),
      lng: Number(nextLocation.lng),
      zoom: nextLocation.zoom || 11,
    });
    setWeatherError('');
    setSearchResults([]);
    setGeoStatus((current) => current === 'located' ? 'available' : current);
  }, []);

  const requestGeolocation = useCallback((initial = false) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoStatus('unsupported');
      setLocating(false);
      return;
    }
    setLocating(true);
    if (!initial) setGeoStatus('requesting');
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocating(false);
          setGeoStatus('located');
          if (initial && manualLocationRef.current) return;
          setLocation({
            lat: Number(position.coords.latitude.toFixed(6)),
            lng: Number(position.coords.longitude.toFixed(6)),
            name: 'Current device location',
            zoom: 11,
          });
          if (!initial) manualLocationRef.current = false;
        },
        (error) => {
          setLocating(false);
          setGeoStatus(error?.code === 1 ? 'denied' : 'unavailable');
        },
        { enableHighAccuracy: true, timeout: 9000, maximumAge: 300000 },
      );
    } catch {
      setLocating(false);
      setGeoStatus('unavailable');
    }
  }, []);

  useEffect(() => {
    if (initialGeoRequestRef.current) return undefined;
    initialGeoRequestRef.current = true;
    requestGeolocation(true);
    return undefined;
  }, [requestGeolocation]);

  useEffect(() => {
    const trimmed = searchText.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearching(false);
      setSearchMessage('Type at least two characters to find a place.');
      return undefined;
    }
    const controller = new AbortController();
    const debounce = window.setTimeout(async () => {
      setSearching(true);
      setSearchMessage('');
      try {
        const params = new URLSearchParams({
          q: trimmed,
          format: 'json',
          limit: '5',
          addressdetails: '1',
          'accept-language': 'en',
        });
        const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`Place search returned ${response.status}`);
        const results = await response.json();
        if (!Array.isArray(results)) throw new Error('Unexpected place search response');
        setSearchResults(results);
        setSearchMessage(results.length ? '' : 'No matching places. Try a town, park or landmark.');
      } catch (error) {
        if (error.name !== 'AbortError') {
          setSearchResults([]);
          setSearchMessage('Place lookup is temporarily unavailable. You can still pin the map.');
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 1100);
    return () => {
      window.clearTimeout(debounce);
      controller.abort();
    };
  }, [searchText]);

  useEffect(() => {
    let cancelled = false;
    let requestController = null;
    const loadConditions = async () => {
      requestController?.abort();
      const controller = new AbortController();
      requestController = controller;
      const signal = controller.signal;
      setWeatherStatus((previous) => previous === 'ready' || previous === 'refreshing' ? 'refreshing' : 'loading');
      setWeatherError('');
      const timeout = window.setTimeout(() => controller.abort(), 14000);
      try {
        const query = new URLSearchParams({
          latitude: String(location.lat),
          longitude: String(location.lng),
          current: 'cloud_cover,relative_humidity_2m,visibility,wind_speed_10m',
          hourly: 'cloud_cover,visibility',
          timezone: 'auto',
        });
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query.toString()}`, {
          signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`Forecast service responded ${response.status}`);
        const payload = await response.json();
        const current = payload?.current;
        const required = ['cloud_cover', 'relative_humidity_2m', 'visibility', 'wind_speed_10m'];
        if (
          !current ||
          required.some((key) => current[key] === null || current[key] === undefined || !Number.isFinite(Number(current[key])))
        ) {
          throw new Error('Forecast service returned incomplete current conditions');
        }
        if (cancelled) return;
        const fetchedAt = new Date();
        setWeather({
          ...current,
          hourly: payload.hourly || null,
          timezone: payload.timezone || 'UTC',
          fetchedAt,
          fetchedFor: { lat: location.lat, lng: location.lng },
        });
        setTimezone(payload.timezone || 'UTC');
        setWeatherStatus('ready');
        setWeatherError('');
      } catch (error) {
        if (cancelled || error?.name === 'AbortError') {
          if (!cancelled && signal.aborted) {
            setWeatherStatus('error');
            setWeatherError('The forecast timed out. Check your connection, then refresh.');
          }
        } else {
          setWeatherStatus('error');
          setWeatherError('Live conditions could not load. Twilight and map tools remain available.');
        }
      } finally {
        window.clearTimeout(timeout);
      }
    };

    loadConditions();
    const refreshInterval = window.setInterval(loadConditions, 15 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
      requestController?.abort();
    };
  }, [location.lat, location.lng, refreshToken]);

  const activeWeather = weather &&
    Math.abs(weather.fetchedFor.lat - location.lat) < 0.00001 &&
    Math.abs(weather.fetchedFor.lng - location.lng) < 0.00001
      ? weather
      : null;
  const estimatedBortle = useMemo(
    () => estimateBortle(location.lat, location.lng),
    [location.lat, location.lng],
  );
  const bortle = LIGHT_PRESETS[preset] ?? estimatedBortle;
  const score = useMemo(
    () => calculateStargazingScore(activeWeather, bortle),
    [activeWeather, bortle],
  );
  const nightPlan = useMemo(
    () => clock ? getNightPlan(location.lat, location.lng, clock, timezone) : null,
    [clock, location.lat, location.lng, timezone],
  );
  const targets = useMemo(
    () => clock ? getObservationalTargets(location.lat, location.lng, clock, score, bortle) : [],
    [clock, location.lat, location.lng, score, bortle],
  );
  const weatherStatusForLocation = activeWeather
    ? weatherStatus === 'error'
      ? 'error'
      : weatherStatus === 'refreshing' || weatherStatus === 'loading'
        ? 'refreshing'
        : 'ready'
    : weatherStatus;

  const chooseSearchResult = useCallback((result) => {
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    setChosenLocation({ lat, lng, name: getSearchName(result), zoom: 11 });
    setSearchText('');
  }, [setChosenLocation]);

  const chooseMapLocation = useCallback(({ lat, lng }) => {
    setChosenLocation({ lat, lng, name: 'Pinned observing site', zoom: 10 });
    setSearchText('');
  }, [setChosenLocation]);

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);

  const handleSearchChange = useCallback((value) => {
    setSearchText(value);
    setSearchResults([]);
    setSearching(false);
    setSearchMessage('');
  }, []);

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.getElementById('location-search')?.focus();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  return (
    <div className="app-shell" data-theme={nightVision ? 'night-vision' : 'default'}>
      <Header
        now={clock}
        timeZone={timezone}
        nightVision={nightVision}
        onToggleNightVision={() => setNightVision((current) => !current)}
        weatherStatus={weatherStatusForLocation}
        onRefresh={refresh}
        refreshing={weatherStatusForLocation === 'refreshing' || weatherStatusForLocation === 'loading'}
      />
      <motion.main
        className="dashboard-main"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        <section className="hero-row" aria-label="Search for an observing location">
          <div className="hero-copy">
            <p className="hero-eyebrow">FIELD GUIDE / NIGHT PLANNING SYSTEM</p>
            <h1 className="hero-title">Find your <em>clear window.</em></h1>
            <p className="hero-subtitle">A better read on darkness, weather and what’s worth pointing at.</p>
          </div>
          <SearchPanel
            value={searchText}
            onValueChange={handleSearchChange}
            results={searchResults}
            searching={searching}
            searchMessage={searchMessage}
            onSelectResult={chooseSearchResult}
            onUseMyLocation={() => requestGeolocation(false)}
            locating={locating}
          />
        </section>

        <div className="dashboard-grid">
          <aside className="left-rail" aria-label="Current site conditions">
            <ScoreCard
              score={score}
              weather={activeWeather ? { ...activeWeather, bortle } : null}
              weatherStatus={weatherStatusForLocation}
              weatherError={weatherStatusForLocation === 'error' ? weatherError : ''}
            />
            <DarknessBrief plan={nightPlan} timeZone={timezone} />
            <LightPollutionCard
              bortle={bortle}
              preset={preset}
              onPresetChange={setPreset}
            />
            <LocationCard location={location} geoStatus={geoStatus} locating={locating} />
          </aside>

          <section className="center-rail" aria-label="Map and astronomical schedule">
            <MapPanel
              location={location}
              onLocationSelect={chooseMapLocation}
              showHeatmap={showHeatmap}
              onToggleHeatmap={() => setShowHeatmap((value) => !value)}
              weatherStatus={weatherStatusForLocation}
            />
            <AstroWindowsCard plan={nightPlan} now={clock} timeZone={timezone} />
          </section>

          <aside className="right-rail" aria-label="Observing targets and data details">
            <ObservationalTargets targets={targets} score={score} weatherStatus={weatherStatusForLocation} />
            <FeedNote weatherStatus={weatherStatusForLocation} lastUpdated={activeWeather?.fetchedAt || null} timeZone={timezone} />
          </aside>
        </div>

        <footer className="app-footer">
          <div className="footer-source"><Satellite aria-hidden="true" /> OPEN-METEO CONDITIONS <span>·</span> SUNCalc TWILIGHT <span>·</span> CARTO / OSM MAP <span>·</span> NOMINATIM SEARCH</div>
          <div className="footer-right">
            <span>LIGHT GLOW IS A PROXIMITY ESTIMATE</span>
            <a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">DATA SOURCES <ArrowUpRight aria-hidden="true" size={10} /></a>
          </div>
        </footer>
      </motion.main>
    </div>
  );
}
