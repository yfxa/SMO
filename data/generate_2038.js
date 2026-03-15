const fs = require('fs');
const path = require('path');

// ============================================================
// 2038 MULTI-HUB DRONE SCENARIO
// Multiple drone hubs across the LA Basin, placed at centroids
// of residential density clusters (from real ZIMAS zoning data).
// Base: 2029 (SMO closed) + drone traffic from all hubs
// ============================================================

const inputPath = path.join(__dirname, 'viewer_data_2029.json');
const gridPath = path.join(__dirname, 'la_residential_basin_grid.json');
const outputPath = path.join(__dirname, 'viewer_data_2038.json');

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
const LAX_EXCLUSION = 450; // encoded units (~2.7 NM)

function distEnc(latEnc, lonEnc, refEnc) {
  const dlat = latEnc - refEnc[0];
  const dlon = lonEnc - refEnc[1];
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

// Seeded pseudo-random
let seed = 77;
function rand() {
  seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
  return seed / 0x7fffffff;
}

// ============================================================
// Hub definitions from k-means clustering on zoning data
// ============================================================
const hubs = grid.hubs;
console.log(`\n${hubs.length} drone hubs:`);

// Give hubs names based on approximate neighborhood
const HUB_NAMES = [
  'Mid-City',        // 34.0017, -118.297
  'East Hollywood',  // 34.0864, -118.2914
  'West LA',         // 34.0084, -118.4333 (near old SMO)
  'Highland Park',   // 34.0936, -118.2068
  'Miracle Mile',    // 34.0533, -118.3536
  'South LA',        // 33.9402, -118.2737
  'Sherman Oaks',    // 34.127,  -118.4067
  'Brentwood',       // 34.0716, -118.5127
];

for (let i = 0; i < hubs.length; i++) {
  const h = hubs[i];
  const name = HUB_NAMES[i] || `Hub ${i + 1}`;
  console.log(`  ${name}: lat=${h.lat}, lon=${h.lon} (${h.cells} cells, weight=${h.weight})`);
}

// ============================================================
// Build delivery targets for each hub from the basin grid
// Each hub serves cells within its delivery radius
// ============================================================
const DENSITY_MULT = [0.6, 1.0, 1.5]; // SF=0.6, mixed=1.0, MF=1.5
const MAX_DELIVERY_RADIUS = 0.06; // ~6.7km per hub
const FLIGHTS_PER_HUB_WEIGHT = 5; // flights per unit of cluster weight
const DRONE_TYPE = 'WING';

const allDroneFlights = [];

for (let hi = 0; hi < hubs.length; hi++) {
  const hub = hubs[hi];
  const hubEnc = toEnc(hub.lat, hub.lon);
  const hubName = HUB_NAMES[hi] || `Hub ${hi + 1}`;

  // Find eligible delivery cells for this hub
  const targets = [];
  let totalWeight = 0;

  for (const cell of grid.cells) {
    const dlat = cell.lat - hub.lat;
    const dlon = cell.lon - hub.lon;
    const dist = Math.sqrt(dlat * dlat + dlon * dlon);

    if (dist > MAX_DELIVERY_RADIUS) continue;

    // Check LAX exclusion
    const cellEnc = toEnc(cell.lat, cell.lon);
    if (distEnc(cellEnc[0], cellEnc[1], laxEnc) < LAX_EXCLUSION) continue;

    // Weight by density type and distance decay
    const distDecay = 1 - (dist / MAX_DELIVERY_RADIUS) * 0.4;
    const w = cell.i * DENSITY_MULT[cell.d] * distDecay;
    if (w < 0.03) continue;

    targets.push({
      enc: cellEnc,
      w: w,
      d: cell.d,
    });
    totalWeight += w;
  }

  // Scale flights by hub weight (bigger residential area = more deliveries)
  const totalFlights = Math.round(hub.weight * FLIGHTS_PER_HUB_WEIGHT);

  // Distribute flights proportional to cell weight
  const flightsPerTarget = targets.map(t =>
    Math.max(1, Math.round(t.w / totalWeight * totalFlights))
  );

  let hubFlights = 0;

  for (let ti = 0; ti < targets.length; ti++) {
    const target = targets[ti];
    const n = flightsPerTarget[ti];

    for (let f = 0; f < n; f++) {
      // Outbound: hub → target
      const outPts = generateFlight(hubEnc, target.enc, true);
      if (outPts.length >= 4) {
        allDroneFlights.push({ t: DRONE_TYPE, p: outPts });
      }

      // Return flight (80% come back)
      if (rand() > 0.20) {
        const retPts = generateFlight(hubEnc, target.enc, false);
        if (retPts.length >= 4) {
          allDroneFlights.push({ t: DRONE_TYPE, p: retPts });
        }
      }
      hubFlights++;
    }
  }

  console.log(`  ${hubName}: ${targets.length} target cells, ${hubFlights} deliveries, ${allDroneFlights.length} total drone flights so far`);
}

function generateFlight(hubEnc, targetEnc, outbound) {
  const numPts = 10 + Math.floor(rand() * 8);

  let startLat, startLon, endLat, endLon;
  if (outbound) {
    startLat = hubEnc[0] + (rand() - 0.5) * 20;
    startLon = hubEnc[1] + (rand() - 0.5) * 20;
    endLat = targetEnc[0] + (rand() - 0.5) * 30;
    endLon = targetEnc[1] + (rand() - 0.5) * 30;
  } else {
    startLat = targetEnc[0] + (rand() - 0.5) * 30;
    startLon = targetEnc[1] + (rand() - 0.5) * 30;
    endLat = hubEnc[0] + (rand() - 0.5) * 20;
    endLon = hubEnc[1] + (rand() - 0.5) * 20;
  }

  const points = [];
  for (let i = 0; i < numPts; i++) {
    const t = i / (numPts - 1);
    const jitter = (rand() - 0.5) * 10;
    const bellCurve = 1 - Math.abs(2 * t - 1);
    const lat = Math.round(startLat + (endLat - startLat) * t + jitter * bellCurve);
    const lon = Math.round(startLon + (endLon - startLon) * t + jitter * bellCurve);

    // Skip points in LAX zone
    if (distEnc(lat, lon, laxEnc) < LAX_EXCLUSION) continue;

    points.push(lat, lon);
  }
  return points;
}

console.log(`\nTotal drone flights: ${allDroneFlights.length}`);

// ============================================================
// Reduce manned traffic in drone hub zones
// By 2038, drone delivery corridors are restricted airspace.
// GA and helicopter flights are rerouted away from hub zones.
// Commercial traffic (high altitude) mostly unaffected.
// ============================================================

const GA_REGEX = /^(C1[0-9]{2}|C2[0-9]{2}|P28[A-Z]|PA[0-9]{2}|BE[0-9]{2}|SR2[0-9]|DA[0-9]{2}|M20[A-Z]|PA32|PA34|AA5|RV[0-9]|SLG[0-9]|G2CA|TOBA|VENT|TRIN|LNCE|LGEZ|PC12|TBM[0-9]|E55P|CRUZ|CC11|S22T|P28R|P32R|C82R|BE36|BE58|C340|C414|P46T|SR20|SR22)/;
const HELI_REGEX = /^(R22|R44|R66|EC[0-9]{2}|AS[0-9]{2}|B06|B407|B412|B429|S76|A109|S92|BK17|H500|MD52|H60|UH60|AH64|EXPL|S300|B505)/;

// Hub exclusion radius for manned low-altitude traffic
const HUB_EXCLUSION = 300; // encoded units (~3km around each hub)

// Pre-compute hub encoded positions
const hubEncs = hubs.map(h => toEnc(h.lat, h.lon));

function isNearAnyHub(latEnc, lonEnc) {
  for (const hEnc of hubEncs) {
    if (distEnc(latEnc, lonEnc, hEnc) < HUB_EXCLUSION) return true;
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
    // Commercial/military — keep as-is (fly above drone zones)
    filteredBase.push(flight);
    mannedKept++;
    continue;
  }

  // GA/helicopter — strip points inside drone hub zones
  const newP = [];
  for (let i = 0; i < flight.p.length; i += 2) {
    if (isNearAnyHub(flight.p[i], flight.p[i + 1])) {
      mannedStrippedPts++;
      continue;
    }
    newP.push(flight.p[i], flight.p[i + 1]);
  }

  // Keep flight only if enough points remain
  if (newP.length >= 4) {
    filteredBase.push({ t: flight.t, p: newP });
    mannedKept++;
  } else {
    mannedRemoved++;
  }
}

console.log(`\nManned traffic reduction near drone hubs:`);
console.log(`  Flights kept:      ${mannedKept}`);
console.log(`  Flights removed:   ${mannedRemoved} (entirely inside hub zones)`);
console.log(`  Points stripped:   ${mannedStrippedPts}`);

const allFlights = [...filteredBase, ...allDroneFlights];

// Amplify LAX commercial traffic (+17% on top of 2029's +8%, ~25% total from 2026)
const { amplifyLAX } = require('./amplify_lax');
const laxExtra = amplifyLAX(allFlights, origin, 0.17, 2038);
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
  scenario: '2038_multi_hub',
};

const json = JSON.stringify(output);
fs.writeFileSync(outputPath, json);
console.log(`\nSummary:`);
console.log(`  Base (2029) flights: ${data.flights.length}`);
console.log(`  Drone flights:      ${allDroneFlights.length}`);
console.log(`  Total flights:      ${allFlights.length}`);
console.log(`\nWrote ${outputPath} (${(json.length / 1024 / 1024).toFixed(1)} MB)`);
