const fs = require('fs');
const path = require('path');

// ============================================================
// 2066 CROSS-PATTERN DRONE SCENARIO
// Drone corridors form a Christian cross centered on SMO.
// The vertical arm runs N-S and horizontal arm runs E-W,
// intersecting at the old Santa Monica Airport site.
// Base: 2029 (SMO closed) + cross-pattern drone corridors
// ============================================================

const inputPath = path.join(__dirname, 'viewer_data_2029.json');
const gridPath = path.join(__dirname, 'la_residential_basin_grid.json');
const outputPath = path.join(__dirname, 'viewer_data_2066.json');

console.log('Loading base data...');
const data = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
const grid = JSON.parse(fs.readFileSync(gridPath, 'utf-8'));
const origin = data.origin;

const toEnc = (lat, lon) => [
  Math.round((lat - origin.lat) * 10000),
  Math.round((lon - origin.lon) * 10000),
];

// LAX exclusion zone
const LAX = { lat: 33.9425, lon: -118.4081 };
const laxEnc = toEnc(LAX.lat, LAX.lon);
const LAX_EXCLUSION = 450;

function distEnc(latEnc, lonEnc, refEnc) {
  const dlat = latEnc - refEnc[0];
  const dlon = lonEnc - refEnc[1];
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

// Seeded pseudo-random
let seed = 2066;
function rand() {
  seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
  return seed / 0x7fffffff;
}

// ============================================================
// SMO — intersection of the cross
// ============================================================
const SMO = { lat: 34.0158, lon: -118.4513 };
const smoEnc = toEnc(SMO.lat, SMO.lon);

// ============================================================
// Cross hub definitions
// Hubs placed along N-S and E-W axes through SMO.
// Corridor flights between adjacent hubs create the cross
// density pattern visible on the map.
// ============================================================

const CROSS_HUBS = [
  // Vertical arm (N-S) — latitude varies, longitude = SMO
  { name: 'North-3 (Encino)',        lat: 34.155, lon: -118.4513 },
  { name: 'North-2 (Sherman Oaks)',  lat: 34.120, lon: -118.4513 },
  { name: 'North-1 (Brentwood)',     lat: 34.085, lon: -118.4513 },
  { name: 'North-0 (Sawtelle)',      lat: 34.050, lon: -118.4513 },
  { name: 'SMO Center',              lat: 34.0158, lon: -118.4513 },
  { name: 'South-1 (Mar Vista)',     lat: 33.985, lon: -118.4513 },
  { name: 'South-2 (Westchester)',   lat: 33.955, lon: -118.4513 },
  { name: 'South-3 (El Segundo)',    lat: 33.920, lon: -118.4513 },

  // Horizontal arm (E-W) — longitude varies, latitude = SMO
  { name: 'West-3 (Pacific Palisades)', lat: 34.0158, lon: -118.570 },
  { name: 'West-2 (Brentwood W)',       lat: 34.0158, lon: -118.535 },
  { name: 'West-1 (Westwood)',          lat: 34.0158, lon: -118.500 },
  // SMO Center already defined above
  { name: 'East-1 (Cheviot Hills)',     lat: 34.0158, lon: -118.405 },
  { name: 'East-2 (Mid-City)',          lat: 34.0158, lon: -118.360 },
  { name: 'East-3 (Koreatown)',         lat: 34.0158, lon: -118.310 },
  { name: 'East-4 (Westlake)',          lat: 34.0158, lon: -118.265 },
];

// Define the corridor connections (adjacent hubs along each arm)
// Each corridor is a pair [hubA_index, hubB_index] in CROSS_HUBS
const VERTICAL_ARM = [0, 1, 2, 3, 4, 5, 6, 7]; // N3→N2→N1→N0→SMO→S1→S2→S3
const HORIZONTAL_ARM = [8, 9, 10, 4, 11, 12, 13, 14]; // W3→W2→W1→SMO→E1→E2→E3→E4

function buildCorridors(armIndices) {
  const corridors = [];
  for (let i = 0; i < armIndices.length - 1; i++) {
    corridors.push([armIndices[i], armIndices[i + 1]]);
  }
  return corridors;
}

const allCorridors = [
  ...buildCorridors(VERTICAL_ARM),
  ...buildCorridors(HORIZONTAL_ARM),
];

console.log(`\nCross pattern: ${CROSS_HUBS.length} hubs, ${allCorridors.length} corridors`);
for (const hub of CROSS_HUBS) {
  console.log(`  ${hub.name}: lat=${hub.lat}, lon=${hub.lon}`);
}

// ============================================================
// Generate corridor flights between adjacent hubs
// These create the dense lines that form the cross shape.
// ============================================================
const DRONE_TYPE = 'WING';
const CORRIDOR_FLIGHTS_BASE = 180; // flights per corridor segment
// More flights near SMO center (intensity falls off toward tips)
const CENTER_BOOST = 2.5;

const allDroneFlights = [];

function generateCorridorFlight(startEnc, endEnc) {
  const numPts = 12 + Math.floor(rand() * 10);
  const points = [];

  // Slight perpendicular spread to give the corridor width
  const spreadLat = (rand() - 0.5) * 25;
  const spreadLon = (rand() - 0.5) * 25;

  const sLat = startEnc[0] + (rand() - 0.5) * 15 + spreadLat;
  const sLon = startEnc[1] + (rand() - 0.5) * 15 + spreadLon;
  const eLat = endEnc[0] + (rand() - 0.5) * 15 + spreadLat;
  const eLon = endEnc[1] + (rand() - 0.5) * 15 + spreadLon;

  for (let i = 0; i < numPts; i++) {
    const t = i / (numPts - 1);
    const jitter = (rand() - 0.5) * 8;
    const bellCurve = 1 - Math.abs(2 * t - 1);
    const lat = Math.round(sLat + (eLat - sLat) * t + jitter * bellCurve);
    const lon = Math.round(sLon + (eLon - sLon) * t + jitter * bellCurve);

    if (distEnc(lat, lon, laxEnc) < LAX_EXCLUSION) continue;
    points.push(lat, lon);
  }
  return points;
}

// Also generate "local delivery" flights radiating from each hub
function generateLocalFlight(hubEnc, radius) {
  const angle = rand() * Math.PI * 2;
  const dist = radius * (0.3 + rand() * 0.7);
  const targetEnc = [
    hubEnc[0] + Math.round(Math.cos(angle) * dist),
    hubEnc[1] + Math.round(Math.sin(angle) * dist),
  ];

  const numPts = 8 + Math.floor(rand() * 6);
  const points = [];

  for (let i = 0; i < numPts; i++) {
    const t = i / (numPts - 1);
    const jitter = (rand() - 0.5) * 10;
    const bellCurve = 1 - Math.abs(2 * t - 1);
    const lat = Math.round(hubEnc[0] + (targetEnc[0] - hubEnc[0]) * t + jitter * bellCurve);
    const lon = Math.round(hubEnc[1] + (targetEnc[1] - hubEnc[1]) * t + jitter * bellCurve);

    if (distEnc(lat, lon, laxEnc) < LAX_EXCLUSION) continue;
    points.push(lat, lon);
  }
  return points;
}

// Generate corridor flights
for (const [ai, bi] of allCorridors) {
  const hubA = CROSS_HUBS[ai];
  const hubB = CROSS_HUBS[bi];
  const aEnc = toEnc(hubA.lat, hubA.lon);
  const bEnc = toEnc(hubB.lat, hubB.lon);

  // Corridors closer to SMO get more traffic
  const distA = Math.abs(hubA.lat - SMO.lat) + Math.abs(hubA.lon - SMO.lon);
  const distB = Math.abs(hubB.lat - SMO.lat) + Math.abs(hubB.lon - SMO.lon);
  const avgDist = (distA + distB) / 2;
  const maxDist = 0.15;
  const centerFactor = 1 + (CENTER_BOOST - 1) * Math.max(0, 1 - avgDist / maxDist);
  const numFlights = Math.round(CORRIDOR_FLIGHTS_BASE * centerFactor);

  let count = 0;
  for (let f = 0; f < numFlights; f++) {
    // Alternate direction
    const outbound = rand() > 0.5;
    const pts = outbound
      ? generateCorridorFlight(aEnc, bEnc)
      : generateCorridorFlight(bEnc, aEnc);

    if (pts.length >= 4) {
      allDroneFlights.push({ t: DRONE_TYPE, p: pts });
      count++;
    }
  }

  console.log(`  Corridor ${hubA.name} ↔ ${hubB.name}: ${count} flights (factor ${centerFactor.toFixed(1)}x)`);
}

// Generate local delivery flights from each hub (gives the cross a slight glow at nodes)
const LOCAL_FLIGHTS_PER_HUB = 60;
const LOCAL_RADIUS = 120; // encoded units

for (const hub of CROSS_HUBS) {
  const hubEnc = toEnc(hub.lat, hub.lon);
  let count = 0;

  for (let f = 0; f < LOCAL_FLIGHTS_PER_HUB; f++) {
    const pts = generateLocalFlight(hubEnc, LOCAL_RADIUS);
    if (pts.length >= 4) {
      allDroneFlights.push({ t: DRONE_TYPE, p: pts });
      count++;
    }
  }
  console.log(`  ${hub.name} local: ${count} flights`);
}

// Also keep the 2038-era hub traffic (existing drone network continues)
const existingHubs = grid.hubs;
const DENSITY_MULT = [0.6, 1.0, 1.5];
const MAX_DELIVERY_RADIUS = 0.06;
const FLIGHTS_PER_HUB_WEIGHT = 3; // slightly reduced — some traffic shifted to cross corridors

console.log(`\nExisting 2038 hub network (${existingHubs.length} hubs, reduced intensity):`);

for (let hi = 0; hi < existingHubs.length; hi++) {
  const hub = existingHubs[hi];
  const hubEnc = toEnc(hub.lat, hub.lon);

  const targets = [];
  let totalWeight = 0;

  for (const cell of grid.cells) {
    const dlat = cell.lat - hub.lat;
    const dlon = cell.lon - hub.lon;
    const dist = Math.sqrt(dlat * dlat + dlon * dlon);

    if (dist > MAX_DELIVERY_RADIUS) continue;

    const cellEnc = toEnc(cell.lat, cell.lon);
    if (distEnc(cellEnc[0], cellEnc[1], laxEnc) < LAX_EXCLUSION) continue;

    const distDecay = 1 - (dist / MAX_DELIVERY_RADIUS) * 0.4;
    const w = cell.i * DENSITY_MULT[cell.d] * distDecay;
    if (w < 0.03) continue;

    targets.push({ enc: cellEnc, w });
    totalWeight += w;
  }

  const totalFlights = Math.round(hub.weight * FLIGHTS_PER_HUB_WEIGHT);
  const flightsPerTarget = targets.map(t =>
    Math.max(1, Math.round(t.w / totalWeight * totalFlights))
  );

  let hubFlights = 0;
  for (let ti = 0; ti < targets.length; ti++) {
    const target = targets[ti];
    const n = flightsPerTarget[ti];

    for (let f = 0; f < n; f++) {
      const numPts = 10 + Math.floor(rand() * 8);
      const outbound = rand() > 0.5;
      const sEnc = outbound ? hubEnc : target.enc;
      const eEnc = outbound ? target.enc : hubEnc;

      const points = [];
      for (let i = 0; i < numPts; i++) {
        const t = i / (numPts - 1);
        const jitter = (rand() - 0.5) * 10;
        const bellCurve = 1 - Math.abs(2 * t - 1);
        const lat = Math.round(sEnc[0] + (eEnc[0] - sEnc[0]) * t + jitter * bellCurve + (rand() - 0.5) * 20);
        const lon = Math.round(sEnc[1] + (eEnc[1] - sEnc[1]) * t + jitter * bellCurve + (rand() - 0.5) * 20);

        if (distEnc(lat, lon, laxEnc) < LAX_EXCLUSION) continue;
        points.push(lat, lon);
      }

      if (points.length >= 4) {
        allDroneFlights.push({ t: DRONE_TYPE, p: points });
      }
      hubFlights++;
    }
  }

  console.log(`  Hub ${hi + 1}: ${targets.length} targets, ${hubFlights} deliveries`);
}

console.log(`\nTotal drone flights: ${allDroneFlights.length}`);

// ============================================================
// Reduce manned traffic — by 2066, GA is heavily restricted
// across the entire basin (drone corridors everywhere).
// ============================================================
const GA_REGEX = /^(C1[0-9]{2}|C2[0-9]{2}|P28[A-Z]|PA[0-9]{2}|BE[0-9]{2}|SR2[0-9]|DA[0-9]{2}|M20[A-Z]|PA32|PA34|AA5|RV[0-9]|SLG[0-9]|G2CA|TOBA|VENT|TRIN|LNCE|LGEZ|PC12|TBM[0-9]|E55P|CRUZ|CC11|S22T|P28R|P32R|C82R|BE36|BE58|C340|C414|P46T|SR20|SR22)/;
const HELI_REGEX = /^(R22|R44|R66|EC[0-9]{2}|AS[0-9]{2}|B06|B407|B412|B429|S76|A109|S92|BK17|H500|MD52|H60|UH60|AH64|EXPL|S300|B505)/;

// Cross corridor exclusion — wider than 2038's hub zones
const CROSS_EXCLUSION_WIDTH = 200; // encoded units perpendicular to corridor

function isNearCrossArm(latEnc, lonEnc) {
  // Check distance from vertical arm (constant longitude = SMO lon)
  const dLonV = Math.abs(lonEnc - smoEnc[1]);
  const inVertRange = latEnc >= toEnc(33.90, -118.45)[0] && latEnc <= toEnc(34.16, -118.45)[0];
  if (dLonV < CROSS_EXCLUSION_WIDTH && inVertRange) return true;

  // Check distance from horizontal arm (constant latitude = SMO lat)
  const dLatH = Math.abs(latEnc - smoEnc[0]);
  const inHorizRange = lonEnc >= toEnc(34.01, -118.58)[1] && lonEnc <= toEnc(34.01, -118.26)[1];
  if (dLatH < CROSS_EXCLUSION_WIDTH && inHorizRange) return true;

  // Also check existing 2038 hub zones
  for (const hub of existingHubs) {
    const hEnc = toEnc(hub.lat, hub.lon);
    if (distEnc(latEnc, lonEnc, hEnc) < 300) return true;
  }

  return false;
}

const filteredBase = [];
let mannedRemoved = 0;
let mannedStrippedPts = 0;
let mannedKept = 0;

for (const flight of data.flights) {
  const type = flight.t || '';
  const isLowAltitude = GA_REGEX.test(type) || HELI_REGEX.test(type) || type === '' || type === 'UNKNOWN';

  if (!isLowAltitude) {
    filteredBase.push(flight);
    mannedKept++;
    continue;
  }

  // By 2066, 70% of GA/heli flights are removed entirely (electric transition + restrictions)
  if (rand() < 0.70) {
    mannedRemoved++;
    continue;
  }

  const newP = [];
  for (let i = 0; i < flight.p.length; i += 2) {
    if (isNearCrossArm(flight.p[i], flight.p[i + 1])) {
      mannedStrippedPts++;
      continue;
    }
    newP.push(flight.p[i], flight.p[i + 1]);
  }

  if (newP.length >= 4) {
    filteredBase.push({ t: flight.t, p: newP });
    mannedKept++;
  } else {
    mannedRemoved++;
  }
}

console.log(`\nManned traffic reduction (2066):`);
console.log(`  Flights kept:      ${mannedKept}`);
console.log(`  Flights removed:   ${mannedRemoved}`);
console.log(`  Points stripped:   ${mannedStrippedPts}`);

const allFlights = [...filteredBase, ...allDroneFlights];

// Amplify LAX commercial traffic (+40% from 2029 baseline)
const { amplifyLAX } = require('./amplify_lax');
const laxExtra = amplifyLAX(allFlights, origin, 0.40, 2066);
allFlights.push(...laxExtra.flights);

// Rebuild type stats
const typeStats = {};
for (const flight of allFlights) {
  const t = flight.t || 'UNKNOWN';
  if (!typeStats[t]) typeStats[t] = { count: 0, flights: 0 };
  typeStats[t].count += flight.p.length / 2;
  typeStats[t].flights++;
}

const categories = {
  commercial: /^(A3[0-9]{2}|B7[0-9]{2}|B73[0-9]|B38M|B39M|A20N|A21N|A19N|E[0-9]{3}|CRJ[0-9]|MD[0-9]{2}|DC[0-9]{2}|B78X|A359)/,
  ga: /^(C1[0-9]{2}|C2[0-9]{2}|P28[A-Z]|PA[0-9]{2}|BE[0-9]{2}|SR2[0-9]|DA[0-9]{2}|M20[A-Z]|PA32|PA34|AA5|RV[0-9]|GLID|SLG2|G2CA|TOBA|VENT|TRIN|LNCE|LGEZ)/,
  helicopter: /^(R22|R44|R66|EC[0-9]{2}|AS[0-9]{2}|B06|B407|B412|B429|S76|A109|S92|BK17|H500|MD52|H60|UH60|AH64|EXPL|S300|B505)/,
  drone: /^(WING|DRONE)/,
  military: /^(C17|C130|C5M|KC[0-9]{2}|F15|F16|F18|F22|F35|B1|B2|B52|V22|P8|E[236])/,
};

for (const [type, stats] of Object.entries(typeStats)) {
  stats.category = 'other';
  for (const [cat, regex] of Object.entries(categories)) {
    if (regex.test(type)) {
      stats.category = cat;
      break;
    }
  }
}

const output = {
  origin: data.origin,
  bounds: data.bounds,
  types: typeStats,
  flights: allFlights,
  scenario: '2066_cross',
};

const json = JSON.stringify(output);
fs.writeFileSync(outputPath, json);
console.log(`\nSummary:`);
console.log(`  Base (2029) flights: ${data.flights.length}`);
console.log(`  Drone flights:      ${allDroneFlights.length}`);
console.log(`  Total flights:      ${allFlights.length}`);
console.log(`\nWrote ${outputPath} (${(json.length / 1024 / 1024).toFixed(1)} MB)`);
