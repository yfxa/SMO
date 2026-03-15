const fs = require('fs');
const path = require('path');

// ============================================================
// 2033 DRONE HUB SCENARIO — using real ZIMAS zoning grid
// Drones fly from SMO hub to residential cells proportional
// to actual parcel density from LA City Planning data
// ============================================================

const inputPath = path.join(__dirname, 'viewer_data_2029.json');
const gridPath = path.join(__dirname, 'la_residential_grid.json');
const outputPath = path.join(__dirname, 'viewer_data_2033.json');

console.log('Loading base data...');
const data = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
const grid = JSON.parse(fs.readFileSync(gridPath, 'utf-8'));
const origin = data.origin;

const toEnc = (lat, lon) => [
  Math.round((lat - origin.lat) * 10000),
  Math.round((lon - origin.lon) * 10000),
];

// SMO hub center
const SMO = { lat: 34.0158, lon: -118.4513 };
const smoEnc = toEnc(SMO.lat, SMO.lon);

// LAX exclusion zone
const LAX = { lat: 33.9425, lon: -118.4081 };
const laxEnc = toEnc(LAX.lat, LAX.lon);
const LAX_EXCLUSION = 450;

function distTo(latEnc, lonEnc, refEnc) {
  const dlat = latEnc - refEnc[0];
  const dlon = lonEnc - refEnc[1];
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

// Seeded pseudo-random
let seed = 42;
function rand() {
  seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
  return seed / 0x7fffffff;
}

// Build delivery targets from real zoning grid cells
// Each cell becomes a potential delivery destination
// Weight = intensity * density_multiplier
console.log(`\nBuilding delivery targets from ${grid.cells.length} zoning cells...`);

const DENSITY_MULT = [0.6, 1.0, 1.5]; // SF=0.6, mixed=1.0, MF=1.5
const MAX_DIST_FROM_SMO = 0.08; // ~8.9km max delivery radius

const targets = [];
let totalWeight = 0;

for (const cell of grid.cells) {
  // Distance from SMO
  const dlat = cell.lat - SMO.lat;
  const dlon = cell.lon - SMO.lon;
  const dist = Math.sqrt(dlat * dlat + dlon * dlon);

  if (dist > MAX_DIST_FROM_SMO) continue;

  // Check LAX exclusion
  const cellEnc = toEnc(cell.lat, cell.lon);
  if (distTo(cellEnc[0], cellEnc[1], laxEnc) < LAX_EXCLUSION) continue;

  // Weight: parcel intensity * density type multiplier * distance decay
  const distDecay = 1 - (dist / MAX_DIST_FROM_SMO) * 0.4; // closer = more flights
  const w = cell.i * DENSITY_MULT[cell.d] * distDecay;

  if (w < 0.05) continue;

  targets.push({
    lat: cell.lat,
    lon: cell.lon,
    enc: cellEnc,
    w: w,
    d: cell.d,
  });
  totalWeight += w;
}

console.log(`  Eligible delivery cells: ${targets.length}`);
console.log(`  Total weight: ${totalWeight.toFixed(1)}`);
console.log(`  By type: SF=${targets.filter(t=>t.d===0).length}, Mixed=${targets.filter(t=>t.d===1).length}, MF=${targets.filter(t=>t.d===2).length}`);

// Generate drone flights
// Total flights proportional to weight, normalized to target count
const TOTAL_FLIGHTS = 1200; // total outbound flights
const DRONE_TYPE = 'WING';
const droneFlights = [];

// For each target, calculate how many flights it gets
const flightsPerTarget = targets.map(t => Math.max(1, Math.round(t.w / totalWeight * TOTAL_FLIGHTS)));
const actualTotal = flightsPerTarget.reduce((a, b) => a + b, 0);
console.log(`\n  Planned flights: ${actualTotal} across ${targets.length} cells`);

function generateFlight(target, outbound) {
  const numPts = 12 + Math.floor(rand() * 8);

  let startLat, startLon, endLat, endLon;
  if (outbound) {
    // SMO → target
    startLat = smoEnc[0] + (rand() - 0.5) * 25;
    startLon = smoEnc[1] + (rand() - 0.5) * 25;
    endLat = target.enc[0] + (rand() - 0.5) * 40;
    endLon = target.enc[1] + (rand() - 0.5) * 40;
  } else {
    // target → SMO
    startLat = target.enc[0] + (rand() - 0.5) * 40;
    startLon = target.enc[1] + (rand() - 0.5) * 40;
    endLat = smoEnc[0] + (rand() - 0.5) * 25;
    endLon = smoEnc[1] + (rand() - 0.5) * 25;
  }

  const points = [];
  for (let i = 0; i < numPts; i++) {
    const t = i / (numPts - 1);
    // Slight lateral jitter for realistic spread
    const jitter = (rand() - 0.5) * 12;
    const bellCurve = 1 - Math.abs(2 * t - 1); // max jitter at midpoint
    const lat = Math.round(startLat + (endLat - startLat) * t + jitter * bellCurve);
    const lon = Math.round(startLon + (endLon - startLon) * t + jitter * bellCurve);

    // Skip points in LAX zone
    if (distTo(lat, lon, laxEnc) < LAX_EXCLUSION) continue;

    points.push(lat, lon);
  }
  return points;
}

let generated = 0;
for (let ti = 0; ti < targets.length; ti++) {
  const target = targets[ti];
  const n = flightsPerTarget[ti];

  for (let f = 0; f < n; f++) {
    // Outbound
    const outPts = generateFlight(target, true);
    if (outPts.length >= 4) {
      droneFlights.push({ t: DRONE_TYPE, p: outPts });
    }

    // Return flight (85% come back)
    if (rand() > 0.15) {
      const retPts = generateFlight(target, false);
      if (retPts.length >= 4) {
        droneFlights.push({ t: DRONE_TYPE, p: retPts });
      }
    }
    generated++;
  }
}

console.log(`  Generated ${droneFlights.length} drone flights (${generated} deliveries + returns)`);

// Combine with 2029 base traffic
const allFlights = [...data.flights, ...droneFlights];

// Amplify LAX commercial traffic (+7% on top of 2029's +8%, ~15% total from 2026)
const { amplifyLAX } = require('./amplify_lax');
const laxExtra = amplifyLAX(allFlights, origin, 0.07, 2033);
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
  scenario: '2033_drone_hub',
};

const json = JSON.stringify(output);
fs.writeFileSync(outputPath, json);
console.log(`\nTotal flights: ${allFlights.length}`);
console.log(`Wrote ${outputPath} (${(json.length / 1024 / 1024).toFixed(1)} MB)`);
