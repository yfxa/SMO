const fs = require('fs');
const path = require('path');

// ============================================================
// 2029 KSMO CLOSED SCENARIO
// Santa Monica Airport runway is shut down.
// - NO ground operations at SMO
// - NO pattern traffic (traffic patterns, touch-and-go, etc.)
// - Overflights at altitude ARE preserved (commercial transit)
// - SMO-based flights redistributed to VNY, HHR, TOA, WHP
// ============================================================

const inputPath = path.join(__dirname, 'viewer_data.json');
const outputPath = path.join(__dirname, 'viewer_data_2029.json');

console.log('Loading viewer_data.json...');
const data = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
const origin = data.origin; // { lat: 33.45, lon: -119.45 }

const toEnc = (lat, lon) => [
  Math.round((lat - origin.lat) * 10000),
  Math.round((lon - origin.lon) * 10000),
];

// Airport coordinates (encoded)
const SMO = { lat: 34.0158, lon: -118.4513 };
const smoEnc = toEnc(SMO.lat, SMO.lon);

// Other airports — if a flight has points near these, it's NOT an SMO flight
const OTHER_AIRPORTS = [
  { name: 'LAX', lat: 33.9425, lon: -118.4081 },
  { name: 'VNY', lat: 34.2098, lon: -118.4900 },
  { name: 'HHR', lat: 33.9228, lon: -118.3350 },
  { name: 'BUR', lat: 34.2005, lon: -118.3585 },
  { name: 'LGB', lat: 33.8177, lon: -118.1516 },
  { name: 'TOA', lat: 33.8034, lon: -118.3396 },
  { name: 'WHP', lat: 34.2593, lon: -118.4134 },
].map(a => ({ ...a, enc: toEnc(a.lat, a.lon) }));

// Redistribution targets
const TARGETS = {
  VNY: { lat: 34.2098, lon: -118.4900, share: 0.40 },
  HHR: { lat: 33.9228, lon: -118.3350, share: 0.25 },
  TOA: { lat: 33.8034, lon: -118.3396, share: 0.20 },
  WHP: { lat: 34.2593, lon: -118.4134, share: 0.15 },
};

function dist(latEnc, lonEnc, refEnc) {
  const dlat = latEnc - refEnc[0];
  const dlon = lonEnc - refEnc[1];
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

// Tight ground zone for SMO: ~500m
const SMO_GROUND = 50;  // 0.005 deg
// Pattern zone around SMO: ~3km
const SMO_PATTERN = 300; // 0.03 deg
// Other airport ground zone: ~1km
const OTHER_GROUND = 100; // 0.01 deg

// GA types that would operate from SMO
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

    // Check if near any other airport
    for (const apt of OTHER_AIRPORTS) {
      if (dist(lat, lon, apt.enc) < OTHER_GROUND) {
        nearOtherAirport++;
        break;
      }
    }
  }

  // If flight has ground points at another airport, it's NOT an SMO flight
  // (even if it passes through SMO airspace)
  if (nearOtherAirport >= 3) return 'transit';

  // Must be a GA/helicopter type to be SMO-based (no commercial jets at SMO)
  const isGA = GA_TYPES.test(type) || type === '' || type === 'UNKNOWN';

  // Has ground operations at SMO
  if (nearSmoGround >= 2 && isGA) return 'smo_based';

  // GA flight with majority of track in SMO pattern zone
  if (isGA && inSmoPattern / totalPts > 0.5 && totalPts >= 3) return 'smo_pattern';

  return 'transit';
}

console.log('Analyzing flights...');
const smoBasedFlights = [];
const smoPatternFlights = [];
const transitFlights = [];

for (const flight of data.flights) {
  const cls = classifyFlight(flight);
  if (cls === 'smo_based') smoBasedFlights.push(flight);
  else if (cls === 'smo_pattern') smoPatternFlights.push(flight);
  else transitFlights.push(flight);
}

console.log(`  SMO ground-based: ${smoBasedFlights.length}`);
console.log(`  SMO pattern only: ${smoPatternFlights.length}`);
console.log(`  Transit/other:    ${transitFlights.length}`);

// Log types of SMO flights
const smoTypes = {};
for (const f of [...smoBasedFlights, ...smoPatternFlights]) {
  smoTypes[f.t || 'UNKNOWN'] = (smoTypes[f.t || 'UNKNOWN'] || 0) + 1;
}
console.log('\n  SMO flight types:');
const sortedTypes = Object.entries(smoTypes).sort((a, b) => b[1] - a[1]);
for (const [t, c] of sortedTypes.slice(0, 15)) {
  console.log(`    ${t}: ${c}`);
}

// Strip ALL points near SMO from transit flights
// With runway closed, airspace around SMO would be restricted
const SMO_EXCLUSION = 500; // ~5km exclusion zone — completely blank out SMO
let strippedPoints = 0;
const cleanedTransit = transitFlights.map(flight => {
  const newP = [];
  for (let i = 0; i < flight.p.length; i += 2) {
    if (dist(flight.p[i], flight.p[i + 1], smoEnc) < SMO_EXCLUSION) {
      strippedPoints++;
      continue;
    }
    newP.push(flight.p[i], flight.p[i + 1]);
  }
  return { t: flight.t, p: newP };
}).filter(f => f.p.length >= 4);

console.log(`\n  Stripped ${strippedPoints} SMO ground points from transit flights`);

// Redistribute SMO flights
const smoFlights = [...smoBasedFlights, ...smoPatternFlights];
const redistributed = [];
const targetKeys = Object.keys(TARGETS);
const cumShares = [];
let cumSum = 0;
for (const key of targetKeys) {
  cumSum += TARGETS[key].share;
  cumShares.push(cumSum);
}

const counts = {};
for (let fi = 0; fi < smoFlights.length; fi++) {
  const flight = smoFlights[fi];

  const r = (fi * 7 + 3) % 100 / 100;
  let targetKey = targetKeys[targetKeys.length - 1];
  for (let j = 0; j < cumShares.length; j++) {
    if (r < cumShares[j]) {
      targetKey = targetKeys[j];
      break;
    }
  }
  counts[targetKey] = (counts[targetKey] || 0) + 1;

  const target = TARGETS[targetKey];
  const targetEnc = toEnc(target.lat, target.lon);
  const dLat = targetEnc[0] - smoEnc[0];
  const dLon = targetEnc[1] - smoEnc[1];

  const newP = new Array(flight.p.length);
  for (let i = 0; i < flight.p.length; i += 2) {
    newP[i] = flight.p[i] + dLat;
    newP[i + 1] = flight.p[i + 1] + dLon;
  }
  redistributed.push({ t: flight.t, p: newP });
}

console.log(`\n  Redistributed ${smoFlights.length} flights:`);
for (const [k, v] of Object.entries(counts)) {
  console.log(`    ${k}: ${v} flights`);
}

// Build output
const allFlights = [...cleanedTransit, ...redistributed];

// Amplify LAX commercial traffic (+8% by 2029)
const { amplifyLAX } = require('./amplify_lax');
const laxExtra = amplifyLAX(allFlights, origin, 0.08, 2029);
allFlights.push(...laxExtra.flights);

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
  scenario: '2029_ksmo_closed',
};

const json = JSON.stringify(output);
fs.writeFileSync(outputPath, json);
console.log(`\nWrote ${outputPath} (${(json.length / 1024 / 1024).toFixed(1)} MB)`);
