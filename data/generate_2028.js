const fs = require('fs');
const path = require('path');

// ============================================================
// 2028 SMO PEAK TRAFFIC SCENARIO
// Santa Monica Airport announced closure in 2029.
// All based aircraft are ferrying out to new home airports.
// Pattern traffic surges as pilots do final flights.
// Result: SMO traffic at an all-time high.
// ============================================================

const inputPath = path.join(__dirname, 'viewer_data.json');
const outputPath = path.join(__dirname, 'viewer_data_2028.json');

console.log('Loading viewer_data.json...');
const data = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
const origin = data.origin; // { lat: 33.45, lon: -119.45 }

const toEnc = (lat, lon) => [
  Math.round((lat - origin.lat) * 10000),
  Math.round((lon - origin.lon) * 10000),
];

// Airport coordinates
const SMO = { lat: 34.0158, lon: -118.4513 };
const smoEnc = toEnc(SMO.lat, SMO.lon);

// Other airports — for classification
const OTHER_AIRPORTS = [
  { name: 'LAX', lat: 33.9425, lon: -118.4081 },
  { name: 'VNY', lat: 34.2098, lon: -118.4900 },
  { name: 'HHR', lat: 33.9228, lon: -118.3350 },
  { name: 'BUR', lat: 34.2005, lon: -118.3585 },
  { name: 'LGB', lat: 33.8177, lon: -118.1516 },
  { name: 'TOA', lat: 33.8034, lon: -118.3396 },
  { name: 'WHP', lat: 34.2593, lon: -118.4134 },
  { name: 'CNO', lat: 34.0956, lon: -117.6368 },
  { name: 'POC', lat: 34.0917, lon: -117.7817 },
  { name: 'CCB', lat: 34.1186, lon: -117.6876 },
  { name: 'EMT', lat: 34.0861, lon: -118.0347 },
  { name: 'SNA', lat: 33.6757, lon: -117.8682 },
  { name: 'FUL', lat: 33.8720, lon: -117.9793 },
  { name: 'CMA', lat: 34.2137, lon: -119.0943 },
].map(a => ({ ...a, enc: toEnc(a.lat, a.lon) }));

// Ferry destination airports — where SMO planes are relocating to
const FERRY_TARGETS = [
  { name: 'VNY', lat: 34.2098, lon: -118.4900, share: 0.30 },
  { name: 'HHR', lat: 33.9228, lon: -118.3350, share: 0.20 },
  { name: 'TOA', lat: 33.8034, lon: -118.3396, share: 0.15 },
  { name: 'WHP', lat: 34.2593, lon: -118.4134, share: 0.10 },
  { name: 'CNO', lat: 34.0956, lon: -117.6368, share: 0.08 },
  { name: 'FUL', lat: 33.8720, lon: -117.9793, share: 0.07 },
  { name: 'CMA', lat: 34.2137, lon: -119.0943, share: 0.05 },
  { name: 'EMT', lat: 34.0861, lon: -118.0347, share: 0.05 },
].map(t => ({ ...t, enc: toEnc(t.lat, t.lon) }));

function dist(latEnc, lonEnc, refEnc) {
  const dlat = latEnc - refEnc[0];
  const dlon = lonEnc - refEnc[1];
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

const SMO_GROUND = 50;
const SMO_PATTERN = 300;
const OTHER_GROUND = 100;

const GA_TYPES = /^(C1[0-9]{2}|C2[0-9]{2}|P28[A-Z]|PA[0-9]{2}|BE[0-9]{2}|SR2[0-9]|DA[0-9]{2}|M20[A-Z]|PA32|PA34|AA5|RV[0-9]|SLG[0-9]|G2CA|TOBA|VENT|TRIN|LNCE|LGEZ|PC12|TBM[0-9]|E55P|CRUZ|CC11|S22T|P28R|P32R|C82R|BE36|BE58|C340|C414|P46T|SR20|SR22|R22|R44|R66|EC[0-9]{2}|AS[0-9]{2}|B06|B407|S300|B505)/;

function classifyFlight(flight) {
  const type = flight.t || '';
  let nearSmoGround = 0;
  let inSmoPattern = 0;
  let nearOtherAirport = 0;
  let totalPts = flight.p.length / 2;

  for (let i = 0; i < flight.p.length; i += 2) {
    const lat = flight.p[i], lon = flight.p[i + 1];
    if (dist(lat, lon, smoEnc) < SMO_GROUND) nearSmoGround++;
    if (dist(lat, lon, smoEnc) < SMO_PATTERN) inSmoPattern++;
    for (const apt of OTHER_AIRPORTS) {
      if (dist(lat, lon, apt.enc) < OTHER_GROUND) {
        nearOtherAirport++;
        break;
      }
    }
  }

  if (nearOtherAirport >= 3) return 'transit';
  const isGA = GA_TYPES.test(type) || type === '' || type === 'UNKNOWN';
  if (nearSmoGround >= 2 && isGA) return 'smo_based';
  if (isGA && inSmoPattern / totalPts > 0.5 && totalPts >= 3) return 'smo_pattern';
  return 'transit';
}

console.log('Classifying flights...');
const smoBasedFlights = [];
const smoPatternFlights = [];
const transitFlights = [];

for (const flight of data.flights) {
  const cls = classifyFlight(flight);
  if (cls === 'smo_based') smoBasedFlights.push(flight);
  else if (cls === 'smo_pattern') smoPatternFlights.push(flight);
  else transitFlights.push(flight);
}

const smoFlights = [...smoBasedFlights, ...smoPatternFlights];
console.log(`  SMO ground-based: ${smoBasedFlights.length}`);
console.log(`  SMO pattern only: ${smoPatternFlights.length}`);
console.log(`  Transit/other:    ${transitFlights.length}`);
console.log(`  Total SMO:        ${smoFlights.length}`);

// ============================================================
// Malibu practice area detection
// Malibu is west of SMO along the coast, roughly lon < -118.6
// Flight school training flights go out over this area
// ============================================================
const MALIBU_LON_THRESHOLD = toEnc(34.0, -118.60)[1]; // encoded lon for -118.60
const MALIBU_KEEP_RATIO = 0.30; // keep only 30% of Malibu training flights (schools closing)

function isMalibuTrainingFlight(flight) {
  // Must be GA type
  const type = flight.t || '';
  const isGA = GA_TYPES.test(type) || type === '' || type === 'UNKNOWN';
  if (!isGA) return false;

  // Check if significant portion of track is in Malibu area (west of threshold)
  let malibuPts = 0;
  let totalPts = flight.p.length / 2;
  for (let i = 0; i < flight.p.length; i += 2) {
    if (flight.p[i + 1] < MALIBU_LON_THRESHOLD) malibuPts++;
  }
  // If >30% of points are in Malibu area, it's likely a training flight
  return malibuPts / totalPts > 0.3 && malibuPts >= 3;
}

// Simple seeded random
let seed = 42;
function rand() {
  seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
  return seed / 0x7fffffff;
}

// ============================================================
// STEP 1: Keep existing flights, but thin out Malibu training flights
// Flight schools are winding down as airport closure approaches
// ============================================================
const allFlights = [];
let malibuRemoved = 0;
let malibuKept = 0;

for (const flight of data.flights) {
  if (isMalibuTrainingFlight(flight)) {
    if (rand() < MALIBU_KEEP_RATIO) {
      allFlights.push(flight);
      malibuKept++;
    } else {
      malibuRemoved++;
    }
  } else {
    allFlights.push(flight);
  }
}

console.log(`\n  Malibu training flights: ${malibuKept + malibuRemoved} total`);
console.log(`    Kept:    ${malibuKept} (${Math.round(MALIBU_KEEP_RATIO * 100)}%)`);
console.log(`    Removed: ${malibuRemoved} (flight schools closing)`);

// ============================================================
// STEP 2: Duplicate NON-Malibu SMO flights (more ferry/departure activity)
// Pilots doing farewell flights, last-chance pattern work, etc.
// But NOT training flights — schools are shutting down
// ============================================================
const EXTRA_LOCAL_MULTIPLIER = 2;
let localAdded = 0;

for (let copy = 0; copy < EXTRA_LOCAL_MULTIPLIER; copy++) {
  for (const flight of smoFlights) {
    // Skip Malibu training flights — don't duplicate them
    if (isMalibuTrainingFlight(flight)) continue;

    const jitterLat = Math.round((rand() - 0.5) * 40);
    const jitterLon = Math.round((rand() - 0.5) * 40);
    const shiftPts = Math.floor(rand() * 3);

    const newP = [];
    const startIdx = shiftPts * 2;
    for (let i = startIdx; i < flight.p.length; i += 2) {
      newP.push(flight.p[i] + jitterLat);
      newP.push(flight.p[i + 1] + jitterLon);
    }
    for (let i = 0; i < startIdx && i < flight.p.length; i += 2) {
      newP.push(flight.p[i] + jitterLat);
      newP.push(flight.p[i + 1] + jitterLon);
    }

    if (newP.length >= 4) {
      allFlights.push({ t: flight.t, p: newP });
      localAdded++;
    }
  }
}

console.log(`\n  Added ${localAdded} extra local SMO flights (${EXTRA_LOCAL_MULTIPLIER}x duplication)`);

// ============================================================
// STEP 3: Generate ferry flights from SMO to relocation airports
// These are one-way flights: depart SMO, fly to destination
// Generate ~150 ferry flights throughout the day
// ============================================================
const FERRY_COUNT = 150;
let ferryAdded = 0;

// Build cumulative shares for target selection
const cumShares = [];
let cumSum = 0;
for (const target of FERRY_TARGETS) {
  cumSum += target.share;
  cumShares.push(cumSum);
}

// Common GA types at SMO
const SMO_GA_TYPES = ['C172', 'C182', 'P28A', 'SR22', 'BE36', 'PA28', 'DA40', 'C210', 'PA32', 'C152', 'SR20', 'BE58', 'C340', 'PA34', 'DA42'];

for (let i = 0; i < FERRY_COUNT; i++) {
  // Pick a target airport
  const r = rand();
  let target = FERRY_TARGETS[FERRY_TARGETS.length - 1];
  for (let j = 0; j < cumShares.length; j++) {
    if (r < cumShares[j]) {
      target = FERRY_TARGETS[j];
      break;
    }
  }

  // Pick a random GA type
  const type = SMO_GA_TYPES[Math.floor(rand() * SMO_GA_TYPES.length)];

  // Generate flight path: SMO → target with some realistic curvature
  const dLat = target.enc[0] - smoEnc[0];
  const dLon = target.enc[1] - smoEnc[1];
  const flightDist = Math.sqrt(dLat * dLat + dLon * dLon);

  // Number of points proportional to distance
  const numPts = Math.max(10, Math.min(30, Math.round(flightDist / 15)));

  // Slight curve bias (left or right of direct line)
  const curveBias = (rand() - 0.5) * 0.3;

  const points = [];
  for (let p = 0; p < numPts; p++) {
    const t = p / (numPts - 1);

    // Add curve using perpendicular offset
    const perpLat = -dLon / flightDist; // perpendicular direction
    const perpLon = dLat / flightDist;
    const curveAmount = curveBias * flightDist * Math.sin(t * Math.PI);

    // Slight random jitter
    const jitLat = (rand() - 0.5) * 8;
    const jitLon = (rand() - 0.5) * 8;

    const lat = smoEnc[0] + dLat * t + perpLat * curveAmount + jitLat;
    const lon = smoEnc[1] + dLon * t + perpLon * curveAmount + jitLon;

    points.push(Math.round(lat), Math.round(lon));
  }

  allFlights.push({ t: type, p: points });
  ferryAdded++;
}

console.log(`  Added ${ferryAdded} ferry flights from SMO to relocation airports`);

// ============================================================
// STEP 4: Add return ferries (empty legs coming back for more planes)
// About 40% of ferries generate a return trip
// ============================================================
const RETURN_RATIO = 0.4;
const returnCount = Math.round(FERRY_COUNT * RETURN_RATIO);
let returnAdded = 0;

for (let i = 0; i < returnCount; i++) {
  // Pick a source airport (reverse of ferry)
  const r = rand();
  let source = FERRY_TARGETS[FERRY_TARGETS.length - 1];
  for (let j = 0; j < cumShares.length; j++) {
    if (r < cumShares[j]) {
      source = FERRY_TARGETS[j];
      break;
    }
  }

  const type = SMO_GA_TYPES[Math.floor(rand() * SMO_GA_TYPES.length)];

  // source → SMO
  const dLat = smoEnc[0] - source.enc[0];
  const dLon = smoEnc[1] - source.enc[1];
  const flightDist = Math.sqrt(dLat * dLat + dLon * dLon);
  const numPts = Math.max(10, Math.min(30, Math.round(flightDist / 15)));
  const curveBias = (rand() - 0.5) * 0.3;

  const points = [];
  for (let p = 0; p < numPts; p++) {
    const t = p / (numPts - 1);
    const perpLat = -dLon / flightDist;
    const perpLon = dLat / flightDist;
    const curveAmount = curveBias * flightDist * Math.sin(t * Math.PI);
    const jitLat = (rand() - 0.5) * 8;
    const jitLon = (rand() - 0.5) * 8;

    const lat = source.enc[0] + dLat * t + perpLat * curveAmount + jitLat;
    const lon = source.enc[1] + dLon * t + perpLon * curveAmount + jitLon;
    points.push(Math.round(lat), Math.round(lon));
  }

  allFlights.push({ t: type, p: points });
  returnAdded++;
}

console.log(`  Added ${returnAdded} return ferry flights to SMO`);

// ============================================================
// STEP 5: Amplify LAX commercial traffic (+5% by 2028)
// ============================================================
const { amplifyLAX } = require('./amplify_lax');
const laxExtra = amplifyLAX(allFlights, origin, 0.05, 9999);
allFlights.push(...laxExtra.flights);

// ============================================================
// Build output
// ============================================================
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
  scenario: '2028_smo_peak',
};

const json = JSON.stringify(output);
fs.writeFileSync(outputPath, json);

console.log(`\nSummary:`);
console.log(`  Original flights:     ${data.flights.length}`);
console.log(`  Extra local SMO:      ${localAdded}`);
console.log(`  Ferry flights out:    ${ferryAdded}`);
console.log(`  Return ferries in:    ${returnAdded}`);
console.log(`  Total flights:        ${allFlights.length}`);
console.log(`\nWrote ${outputPath} (${(json.length / 1024 / 1024).toFixed(1)} MB)`);
