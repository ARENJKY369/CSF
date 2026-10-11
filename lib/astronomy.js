import { getMoonIllumination, getMoonPosition, getMoonTimes, getTimes } from 'suncalc';

export const DEFAULT_LOCATION = {
  lat: 41.6645,
  lng: -77.8228,
  name: 'Cherry Springs State Park, Pennsylvania',
  zoom: 9,
};

// A deliberately lightweight urban-light model. It is a planning aid, not a
// substitute for a measured VIIRS/Bortle survey at the observing site.
export const LIGHT_HUBS = [
  { name: 'New York', lat: 40.7128, lng: -74.006, strength: 2.3, radius: 180 },
  { name: 'Los Angeles', lat: 34.0522, lng: -118.2437, strength: 2.4, radius: 185 },
  { name: 'Chicago', lat: 41.8781, lng: -87.6298, strength: 2.2, radius: 155 },
  { name: 'Tokyo', lat: 35.6762, lng: 139.6503, strength: 2.5, radius: 190 },
  { name: 'Delhi', lat: 28.6139, lng: 77.209, strength: 2.4, radius: 185 },
  { name: 'Beijing', lat: 39.9042, lng: 116.4074, strength: 2.3, radius: 175 },
  { name: 'London', lat: 51.5072, lng: -0.1276, strength: 2.1, radius: 150 },
  { name: 'Paris', lat: 48.8566, lng: 2.3522, strength: 1.9, radius: 140 },
  { name: 'São Paulo', lat: -23.5558, lng: -46.6396, strength: 2.2, radius: 165 },
  { name: 'Mexico City', lat: 19.4326, lng: -99.1332, strength: 2.2, radius: 165 },
  { name: 'Mumbai', lat: 19.076, lng: 72.8777, strength: 2.1, radius: 150 },
  { name: 'Shanghai', lat: 31.2304, lng: 121.4737, strength: 2.2, radius: 165 },
  { name: 'Seoul', lat: 37.5665, lng: 126.978, strength: 1.9, radius: 135 },
  { name: 'Moscow', lat: 55.7558, lng: 37.6173, strength: 2, radius: 145 },
  { name: 'Sydney', lat: -33.8688, lng: 151.2093, strength: 1.7, radius: 125 },
  { name: 'Toronto', lat: 43.6532, lng: -79.3832, strength: 1.8, radius: 130 },
  { name: 'Boston', lat: 42.3601, lng: -71.0589, strength: 1.6, radius: 120 },
  { name: 'Philadelphia', lat: 39.9526, lng: -75.1652, strength: 1.7, radius: 125 },
  { name: 'Washington', lat: 38.9072, lng: -77.0369, strength: 1.7, radius: 125 },
  { name: 'Pittsburgh', lat: 40.4406, lng: -79.9959, strength: 1.45, radius: 105 },
  { name: 'Atlanta', lat: 33.749, lng: -84.388, strength: 1.7, radius: 125 },
  { name: 'Houston', lat: 29.7604, lng: -95.3698, strength: 1.8, radius: 135 },
  { name: 'Dallas', lat: 32.7767, lng: -96.797, strength: 1.75, radius: 130 },
  { name: 'Denver', lat: 39.7392, lng: -104.9903, strength: 1.55, radius: 115 },
  { name: 'San Francisco', lat: 37.7749, lng: -122.4194, strength: 1.8, radius: 135 },
  { name: 'Seattle', lat: 47.6062, lng: -122.3321, strength: 1.55, radius: 115 },
  { name: 'Miami', lat: 25.7617, lng: -80.1918, strength: 1.65, radius: 120 },
  { name: 'Phoenix', lat: 33.4484, lng: -112.074, strength: 1.6, radius: 120 },
  { name: 'Las Vegas', lat: 36.1699, lng: -115.1398, strength: 1.55, radius: 115 },
  { name: 'Vancouver', lat: 49.2827, lng: -123.1207, strength: 1.35, radius: 100 },
  { name: 'Berlin', lat: 52.52, lng: 13.405, strength: 1.65, radius: 120 },
  { name: 'Madrid', lat: 40.4168, lng: -3.7038, strength: 1.5, radius: 110 },
  { name: 'Rome', lat: 41.9028, lng: 12.4964, strength: 1.45, radius: 105 },
  { name: 'Cairo', lat: 30.0444, lng: 31.2357, strength: 1.75, radius: 130 },
  { name: 'Johannesburg', lat: -26.2041, lng: 28.0473, strength: 1.4, radius: 105 },
  { name: 'Singapore', lat: 1.3521, lng: 103.8198, strength: 1.55, radius: 115 },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const radians = (degrees) => (degrees * Math.PI) / 180;
const degrees = (radiansValue) => (radiansValue * 180) / Math.PI;

export function distanceKm(lat1, lng1, lat2, lng2) {
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) *
      Math.cos(radians(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function estimateBortle(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 4;
  let effectiveDistance = Infinity;
  for (const hub of LIGHT_HUBS) {
    const distance = distanceKm(lat, lng, hub.lat, hub.lng);
    const adjusted = Math.max(0, distance - Math.log(hub.strength) * 18);
    effectiveDistance = Math.min(effectiveDistance, adjusted);
  }
  // The exponential falloff gives a city-centre class 9, suburban 5–7,
  // and genuinely remote locations a class 1–3 estimate.
  return clamp(Math.round(1 + 8 * Math.exp(-effectiveDistance / 105)), 1, 9);
}

export function calculateStargazingScore(weather, bortle) {
  if (!weather) return null;
  const rawValues = [
    weather.cloud_cover,
    weather.relative_humidity_2m,
    weather.visibility,
    weather.wind_speed_10m,
  ];
  if (rawValues.some((value) => value === null || value === undefined)) return null;
  const cloud = Number(weather.cloud_cover);
  const humidity = Number(weather.relative_humidity_2m);
  const visibilityKm = Number(weather.visibility) / 1000;
  const wind = Number(weather.wind_speed_10m);
  if (![cloud, humidity, visibilityKm, wind].every(Number.isFinite)) return null;

  // Clouds cost 0.6 points per percentage point through 60%, then accelerate
  // to a hard zero at total cloud cover. Humidity + wind together max at 20.
  const cloudPenalty = Math.min(100, cloud * 0.6 + Math.max(0, cloud - 60));
  const lightPenalty = clamp((bortle - 1) * 3.5, 0, 28);
  const humidityPenalty = clamp((humidity - 55) * 0.27, 0, 12);
  const windPenalty = clamp((wind - 8) * 0.4, 0, 8);
  const visibilityPenalty = clamp((10 - visibilityKm) * 2, 0, 20);
  return Math.round(
    clamp(
      100 -
        cloudPenalty -
        lightPenalty -
        humidityPenalty -
        windPenalty -
        visibilityPenalty,
      0,
      100,
    ),
  );
}

export function scoreLabel(score) {
  if (score === null || !Number.isFinite(score)) return 'AWAITING SKY DATA';
  if (score >= 82) return 'EXCELLENT';
  if (score >= 65) return 'GOOD';
  if (score >= 45) return 'FAIR';
  return 'POOR';
}

export function formatLocalTime(date, timeZone, options = {}) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      ...options,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      ...options,
    }).format(date);
  }
}

export function formatElapsed(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '—';
  const totalMinutes = Math.round(milliseconds / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function getCalendarParts(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(date);
    return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  } catch {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
  }
}

function validDate(value) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function collectSunEvents(lat, lng, now, timeZone) {
  const { year, month, day } = getCalendarParts(now, timeZone);
  const base = Date.UTC(year, month - 1, day, 12);
  const records = [];
  for (let offset = -3; offset <= 4; offset += 1) {
    const date = new Date(base + offset * 86400000);
    const times = getTimes(date, lat, lng);
    records.push({
      sunset: times.sunset,
      civilDusk: times.dusk,
      nauticalDusk: times.nauticalDusk,
      astronomicalDusk: times.night,
      astronomicalDawn: times.nightEnd,
      nauticalDawn: times.nauticalDawn,
      civilDawn: times.dawn,
      sunrise: times.sunrise,
    });
  }
  return records;
}

function phaseName(phase) {
  if (phase < 0.035 || phase > 0.965) return 'New moon';
  if (phase < 0.215) return 'Waxing crescent';
  if (phase < 0.285) return 'First quarter';
  if (phase < 0.465) return 'Waxing gibbous';
  if (phase < 0.535) return 'Full moon';
  if (phase < 0.715) return 'Waning gibbous';
  if (phase < 0.785) return 'Last quarter';
  return 'Waning crescent';
}

export function getNightPlan(lat, lng, now, timeZone = 'UTC') {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !validDate(now)) return null;
  const records = collectSunEvents(lat, lng, now, timeZone);
  const sunsets = records
    .map((record) => record.sunset)
    .filter(validDate)
    .sort((a, b) => a - b);
  const sunrises = records
    .map((record) => record.sunrise)
    .filter(validDate)
    .sort((a, b) => a - b);
  const latestSunset = sunsets.filter((event) => event <= now).at(-1) || null;
  const latestSunrise = sunrises.filter((event) => event <= now).at(-1) || null;
  const activeNight = latestSunset && (!latestSunrise || latestSunset > latestSunrise);
  const sunset = activeNight
    ? latestSunset
    : sunsets.find((event) => event > now) || null;

  const allEvents = Object.fromEntries(
    [
      'civilDusk',
      'nauticalDusk',
      'astronomicalDusk',
      'astronomicalDawn',
      'nauticalDawn',
      'civilDawn',
      'sunrise',
    ].map((key) => [
      key,
      records
        .map((record) => record[key])
        .filter(validDate)
        .sort((a, b) => a - b),
    ]),
  );
  const firstAfter = (events, threshold) =>
    events.find((event) => event.getTime() > threshold.getTime()) || null;

  const civilDusk = sunset ? firstAfter(allEvents.civilDusk, sunset) : null;
  const nauticalDusk = sunset
    ? firstAfter(allEvents.nauticalDusk, sunset)
    : null;
  const astronomicalDusk = sunset
    ? firstAfter(allEvents.astronomicalDusk, sunset)
    : null;
  const astronomicalDawn = astronomicalDusk
    ? firstAfter(allEvents.astronomicalDawn, astronomicalDusk)
    : null;
  const nauticalDawn = astronomicalDawn
    ? firstAfter(allEvents.nauticalDawn, astronomicalDawn)
    : null;
  const civilDawn = astronomicalDawn
    ? firstAfter(allEvents.civilDawn, astronomicalDawn)
    : null;
  const sunrise = sunset ? firstAfter(allEvents.sunrise, sunset) : null;

  const illumination = getMoonIllumination(now);
  const moonPhase = phaseName(illumination.phase);
  let moonEvent = null;
  let moonEventType = '';
  let moonNote = '';
  if (sunset && sunrise) {
    const { year, month, day } = getCalendarParts(sunset, timeZone);
    const base = Date.UTC(year, month - 1, day, 12);
    const moonTimes = [];
    for (let offset = -1; offset <= 2; offset += 1) {
      const result = getMoonTimes(
        new Date(base + offset * 86400000),
        lat,
        lng,
      );
      if (validDate(result.rise)) moonTimes.push({ type: 'rise', time: result.rise });
      if (validDate(result.set)) moonTimes.push({ type: 'set', time: result.set });
    }
    moonTimes.sort((a, b) => a.time - b.time);
    const nightMoonEvent = moonTimes.find(
      (event) => event.time > sunset && event.time < sunrise,
    );
    if (nightMoonEvent) {
      moonEvent = nightMoonEvent.time;
      moonEventType = nightMoonEvent.type === 'rise' ? 'Moonrise' : 'Moonset';
    } else {
      const altitudeAtDusk = getMoonPosition(sunset, lat, lng).altitude;
      if (altitudeAtDusk > 0) moonNote = 'Above horizon at dusk';
      else moonNote = 'No moonrise during darkness';
    }
  }

  const darkHours =
    astronomicalDusk && astronomicalDawn && astronomicalDawn > astronomicalDusk
      ? astronomicalDawn.getTime() - astronomicalDusk.getTime()
      : 0;
  const noDarkness = !astronomicalDusk || !astronomicalDawn || darkHours <= 0;

  return {
    sunset,
    civilDusk,
    nauticalDusk,
    astronomicalDusk,
    astronomicalDawn,
    nauticalDawn,
    civilDawn,
    sunrise,
    moonEvent,
    moonEventType,
    moonNote,
    moonPhase,
    moonIllumination: Math.round(illumination.fraction * 100),
    darkHours,
    activeNight,
    noDarkness,
  };
}

function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

const PLANET_ELEMENTS = {
  earth: {
    a: [1.00000261, 0.00000562],
    e: [0.01671123, -0.00004392],
    i: [-0.00001531, -0.01294668],
    L: [100.46457166, 35999.37244981],
    perihelion: [102.93768193, 0.32327364],
    node: [0, 0],
  },
  jupiter: {
    a: [5.202887, -0.00011607],
    e: [0.04838624, -0.00013253],
    i: [1.30439695, -0.00183714],
    L: [34.39644051, 3034.74612775],
    perihelion: [14.72847983, 0.21252668],
    node: [100.47390909, 0.20469106],
  },
  saturn: {
    a: [9.53667594, -0.0012506],
    e: [0.05386179, -0.00050991],
    i: [2.48599187, 0.00193609],
    L: [49.95424423, 1222.49362201],
    perihelion: [92.59887831, -0.41897216],
    node: [113.66242448, -0.28867794],
  },
};

function orbitalValue(pair, centuries) {
  return pair[0] + pair[1] * centuries;
}

function heliocentricPosition(elements, centuries) {
  const a = orbitalValue(elements.a, centuries);
  const e = orbitalValue(elements.e, centuries);
  const inclination = radians(orbitalValue(elements.i, centuries));
  const longitude = orbitalValue(elements.L, centuries);
  const perihelion = orbitalValue(elements.perihelion, centuries);
  const node = orbitalValue(elements.node, centuries);
  const meanAnomaly = radians(longitude - perihelion);
  let eccentricAnomaly = meanAnomaly + e * Math.sin(meanAnomaly);
  for (let iteration = 0; iteration < 5; iteration += 1) {
    eccentricAnomaly -=
      (eccentricAnomaly - e * Math.sin(eccentricAnomaly) - meanAnomaly) /
      (1 - e * Math.cos(eccentricAnomaly));
  }
  const xOrbital = a * (Math.cos(eccentricAnomaly) - e);
  const yOrbital = a * Math.sqrt(1 - e * e) * Math.sin(eccentricAnomaly);
  const argument = radians(perihelion - node);
  const cosNode = Math.cos(radians(node));
  const sinNode = Math.sin(radians(node));
  const cosArgument = Math.cos(argument);
  const sinArgument = Math.sin(argument);
  const cosInclination = Math.cos(inclination);
  const sinInclination = Math.sin(inclination);
  return {
    x:
      (cosNode * cosArgument - sinNode * sinArgument * cosInclination) *
        xOrbital +
      (-cosNode * sinArgument - sinNode * cosArgument * cosInclination) *
        yOrbital,
    y:
      (sinNode * cosArgument + cosNode * sinArgument * cosInclination) *
        xOrbital +
      (-sinNode * sinArgument + cosNode * cosArgument * cosInclination) *
        yOrbital,
    z:
      sinArgument * sinInclination * xOrbital +
      cosArgument * sinInclination * yOrbital,
  };
}

function planetEquatorial(name, date) {
  const centuries = (julianDay(date) - 2451545) / 36525;
  const earth = heliocentricPosition(PLANET_ELEMENTS.earth, centuries);
  const planet = heliocentricPosition(PLANET_ELEMENTS[name], centuries);
  const x = planet.x - earth.x;
  const y = planet.y - earth.y;
  const z = planet.z - earth.z;
  const longitude = Math.atan2(y, x);
  const latitude = Math.atan2(z, Math.hypot(x, y));
  const obliquity = radians(23.439291 - 0.0130042 * centuries);
  const rightAscension = Math.atan2(
    Math.sin(longitude) * Math.cos(obliquity) -
      Math.tan(latitude) * Math.sin(obliquity),
    Math.cos(longitude),
  );
  const declination = Math.asin(
    Math.sin(latitude) * Math.cos(obliquity) +
      Math.cos(latitude) * Math.sin(obliquity) * Math.sin(longitude),
  );
  return {
    rightAscensionHours: ((degrees(rightAscension) / 15 + 24) % 24),
    declinationDegrees: degrees(declination),
  };
}

function altitudeDegrees(raHours, decDegrees, lat, lng, date) {
  const jd = julianDay(date);
  const centuries = (jd - 2451545) / 36525;
  const gmst =
    ((280.46061837 +
      360.98564736629 * (jd - 2451545) +
      0.000387933 * centuries * centuries -
      (centuries * centuries * centuries) / 38710000) %
      360 +
      360) %
    360;
  const hourAngle = radians((((gmst + lng - raHours * 15 + 540) % 360) + 360) % 360 - 180);
  const latitude = radians(lat);
  const declination = radians(decDegrees);
  return degrees(
    Math.asin(
      clamp(
        Math.sin(latitude) * Math.sin(declination) +
          Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle),
        -1,
        1,
      ),
    ),
  );
}

function targetStatus(altitude, nextAltitude, score, bortle, deepSky) {
  if (altitude < -3) {
    return nextAltitude > altitude + 0.2 ? 'RISING · BELOW HORIZON' : 'BELOW HORIZON';
  }
  if (score === null) return 'WEATHER DATA PENDING';
  if (score < 38) return 'WEATHER LIMITED';
  if (altitude < 15) return nextAltitude < altitude - 0.2 ? 'LOW · SETTING' : 'LOW ALTITUDE';
  if (deepSky && bortle >= 7) return 'CITY GLOW';
  if (score >= 82 && altitude >= 35 && (!deepSky || bortle <= 4)) return 'OPTIMAL';
  if (score >= 68 && altitude >= 25) return 'EXCELLENT';
  if (score >= 45 && altitude >= 12) return 'FAIR';
  return 'MARGINAL';
}

export function getObservationalTargets(lat, lng, date, score, bortle) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !validDate(date)) return [];
  const fixedTargets = [
    { id: 'm31', name: 'Andromeda Galaxy', catalog: 'M31 · spiral galaxy', ra: 0.712, dec: 41.269, deepSky: true },
    { id: 'm42', name: 'Orion Nebula', catalog: 'M42 · emission nebula', ra: 5.588, dec: -5.391, deepSky: true },
    { id: 'm45', name: 'Pleiades', catalog: 'M45 · open cluster', ra: 3.79, dec: 24.117, deepSky: true },
  ];
  const planetaryTargets = ['jupiter', 'saturn'].map((planet) => {
    const equatorial = planetEquatorial(planet, date);
    return {
      id: planet,
      name: planet[0].toUpperCase() + planet.slice(1),
      catalog: 'planet · low-precision ephemeris',
      ...equatorial,
      ra: equatorial.rightAscensionHours,
      dec: equatorial.declinationDegrees,
      deepSky: false,
    };
  });

  const targets = [...fixedTargets, ...planetaryTargets].map((target) => {
    const altitude = altitudeDegrees(target.ra, target.dec, lat, lng, date);
    const nextAltitude = altitudeDegrees(
      target.ra,
      target.dec,
      lat,
      lng,
      new Date(date.getTime() + 60 * 60 * 1000),
    );
    return {
      ...target,
      altitude,
      status: targetStatus(altitude, nextAltitude, score, bortle, target.deepSky),
    };
  });

  const moonPosition = getMoonPosition(date, lat, lng);
  const moonAltitude = moonPosition.altitude;
  const moonNextAltitude = getMoonPosition(
    new Date(date.getTime() + 60 * 60 * 1000),
    lat,
    lng,
  ).altitude;
  const moonStatus =
    moonAltitude > 0
      ? 'VISIBLE'
      : moonNextAltitude > moonAltitude + 0.2
        ? 'RISING · BELOW HORIZON'
        : 'BELOW HORIZON';
  targets.push({
    id: 'moon',
    name: 'Moon',
    catalog: 'natural satellite · affects contrast',
    altitude: moonAltitude,
    status: moonStatus,
    deepSky: false,
  });
  return targets;
}
