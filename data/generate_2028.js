const fs = require('fs');
const path = require('path');

// ============================================================
// 2028 SMO PEAK TRAFFIC + LA OLYMPICS SCENARIO
// Santa Monica Airport announced closure in 2029.
// All based aircraft are ferrying out to new home airports.
// Pattern traffic surges as pilots do final flights.
// PLUS: 2028 LA Olympics drives massive helicopter/security
// traffic, TFRs over venues restrict GA, LAX surges with
// international visitors.
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
// STEP 5: LA OLYMPICS — Temporary Flight Restrictions (TFRs)
// FAA issues TFRs over major Olympic venues during the games.
// GA flights are stripped of points inside TFR zones.
// ============================================================
const OLYMPIC_VENUES = [
  { name: 'SoFi Stadium',       lat: 33.9535, lon: -118.3392, radius: 180 }, // Opening/closing, football
  { name: 'LA Coliseum',        lat: 34.0141, lon: -118.2879, radius: 150 }, // Track & field
  { name: 'Crypto.com Arena',   lat: 34.0430, lon: -118.2673, radius: 120 }, // Basketball, gymnastics
  { name: 'Rose Bowl',          lat: 34.1613, lon: -118.1676, radius: 150 }, // Soccer
  { name: 'Long Beach',         lat: 33.7701, lon: -118.1937, radius: 140 }, // Water polo, rowing
  { name: 'Intuit Dome',        lat: 33.9580, lon: -118.3480, radius: 120 }, // Basketball
  { name: 'Dedeaux Field/USC',  lat: 34.0210, lon: -118.2810, radius: 100 }, // Baseball, swimming
].map(v => ({ ...v, enc: toEnc(v.lat, v.lon) }));

console.log(`\n  Olympic TFR zones (${OLYMPIC_VENUES.length} venues):`);

// Only GA (not helicopters, not commercial) gets restricted by TFRs
const GA_ONLY = /^(C1[0-9]{2}|C2[0-9]{2}|P28[A-Z]|PA[0-9]{2}|BE[0-9]{2}|SR2[0-9]|DA[0-9]{2}|M20[A-Z]|PA32|PA34|AA5|RV[0-9]|SLG[0-9]|G2CA|TOBA|VENT|TRIN|LNCE|LGEZ|PC12|TBM[0-9]|E55P|CRUZ|CC11|S22T|P28R|P32R|C82R|BE36|BE58|C340|C414|P46T|SR20|SR22)/;

function isInTFR(latEnc, lonEnc) {
  for (const v of OLYMPIC_VENUES) {
    if (dist(latEnc, lonEnc, v.enc) < v.radius) return true;
  }
  return false;
}

let tfrStripped = 0;
let tfrFlightsRemoved = 0;
const tfrFilteredFlights = [];

for (const flight of allFlights) {
  const type = flight.t || '';
  const isGA = GA_ONLY.test(type) || type === '' || type === 'UNKNOWN';

  if (!isGA) {
    tfrFilteredFlights.push(flight);
    continue;
  }

  // Strip GA points inside TFR zones
  const newP = [];
  for (let i = 0; i < flight.p.length; i += 2) {
    if (isInTFR(flight.p[i], flight.p[i + 1])) {
      tfrStripped++;
      continue;
    }
    newP.push(flight.p[i], flight.p[i + 1]);
  }

  if (newP.length >= 4) {
    tfrFilteredFlights.push({ t: flight.t, p: newP });
  } else {
    tfrFlightsRemoved++;
  }
}

// Replace allFlights with TFR-filtered version
allFlights.length = 0;
allFlights.push(...tfrFilteredFlights);

for (const v of OLYMPIC_VENUES) {
  console.log(`    ${v.name}: lat=${v.lat}, lon=${v.lon}, r=${v.radius}`);
}
console.log(`    GA points stripped by TFRs: ${tfrStripped}`);
console.log(`    GA flights removed (entirely in TFR): ${tfrFlightsRemoved}`);

// ============================================================
// STEP 6: LA OLYMPICS — Helicopter surge
// News/media helicopters orbiting venues, LAPD security patrols,
// VIP shuttles between venues, and inter-venue media hops.
// ============================================================
const HELI_TYPES = ['EC35', 'AS50', 'B407', 'R44', 'B06', 'B429', 'EC45', 'S76'];
const SECURITY_TYPES = ['H60', 'UH60', 'B412']; // Black Hawks, military security

// News/media helicopter orbits around each venue
const MEDIA_ORBITS_PER_VENUE = 12;
let mediaHelisAdded = 0;

for (const venue of OLYMPIC_VENUES) {
  for (let h = 0; h < MEDIA_ORBITS_PER_VENUE; h++) {
    const heliType = HELI_TYPES[Math.floor(rand() * HELI_TYPES.length)];
    const orbitRadius = venue.radius * (0.8 + rand() * 0.6); // just outside TFR
    const numPts = 14 + Math.floor(rand() * 8);
    const startAngle = rand() * Math.PI * 2;
    const arcSpan = Math.PI * (0.8 + rand() * 1.2); // partial to full orbit

    const points = [];
    for (let i = 0; i < numPts; i++) {
      const t = i / (numPts - 1);
      const angle = startAngle + arcSpan * t;
      const r = orbitRadius + (rand() - 0.5) * 30;
      const lat = Math.round(venue.enc[0] + Math.cos(angle) * r);
      const lon = Math.round(venue.enc[1] + Math.sin(angle) * r);
      points.push(lat, lon);
    }

    if (points.length >= 4) {
      allFlights.push({ t: heliType, p: points });
      mediaHelisAdded++;
    }
  }
}

console.log(`\n  Olympic helicopter traffic:`);
console.log(`    Media orbits: ${mediaHelisAdded}`);

// VIP/shuttle helicopter flights between venues
const VIP_SHUTTLE_COUNT = 80;
let vipShuttleAdded = 0;

for (let s = 0; s < VIP_SHUTTLE_COUNT; s++) {
  const fromVenue = OLYMPIC_VENUES[Math.floor(rand() * OLYMPIC_VENUES.length)];
  let toVenue = OLYMPIC_VENUES[Math.floor(rand() * OLYMPIC_VENUES.length)];
  while (toVenue === fromVenue) {
    toVenue = OLYMPIC_VENUES[Math.floor(rand() * OLYMPIC_VENUES.length)];
  }

  const heliType = HELI_TYPES[Math.floor(rand() * HELI_TYPES.length)];

  const dLat = toVenue.enc[0] - fromVenue.enc[0];
  const dLon = toVenue.enc[1] - fromVenue.enc[1];
  const flightDist = Math.sqrt(dLat * dLat + dLon * dLon);
  const numPts = Math.max(8, Math.min(20, Math.round(flightDist / 20)));
  const curveBias = (rand() - 0.5) * 0.25;

  const points = [];
  for (let p = 0; p < numPts; p++) {
    const t = p / (numPts - 1);
    const perpLat = -dLon / flightDist;
    const perpLon = dLat / flightDist;
    const curveAmount = curveBias * flightDist * Math.sin(t * Math.PI);
    const jitLat = (rand() - 0.5) * 15;
    const jitLon = (rand() - 0.5) * 15;

    const lat = Math.round(fromVenue.enc[0] + dLat * t + perpLat * curveAmount + jitLat);
    const lon = Math.round(fromVenue.enc[1] + dLon * t + perpLon * curveAmount + jitLon);
    points.push(lat, lon);
  }

  if (points.length >= 4) {
    allFlights.push({ t: heliType, p: points });
    vipShuttleAdded++;
  }
}

console.log(`    VIP shuttles between venues: ${vipShuttleAdded}`);

// LAPD / security helicopter patrols — wide sweeps across the basin
const SECURITY_PATROL_COUNT = 40;
let securityAdded = 0;

for (let s = 0; s < SECURITY_PATROL_COUNT; s++) {
  const secType = SECURITY_TYPES[Math.floor(rand() * SECURITY_TYPES.length)];
  // Pick 2-3 venues to patrol between, creating wide sweeping paths
  const numWaypoints = 2 + Math.floor(rand() * 2);
  const waypoints = [];
  for (let w = 0; w < numWaypoints; w++) {
    const v = OLYMPIC_VENUES[Math.floor(rand() * OLYMPIC_VENUES.length)];
    waypoints.push(v.enc);
  }

  const numPts = 12 + Math.floor(rand() * 10);
  const points = [];

  for (let i = 0; i < numPts; i++) {
    const t = i / (numPts - 1);
    // Interpolate between waypoints
    const segTotal = waypoints.length - 1;
    const segFloat = t * segTotal;
    const segIdx = Math.min(Math.floor(segFloat), segTotal - 1);
    const segT = segFloat - segIdx;

    const fromWP = waypoints[segIdx];
    const toWP = waypoints[Math.min(segIdx + 1, waypoints.length - 1)];

    const lat = Math.round(fromWP[0] + (toWP[0] - fromWP[0]) * segT + (rand() - 0.5) * 40);
    const lon = Math.round(fromWP[1] + (toWP[1] - fromWP[1]) * segT + (rand() - 0.5) * 40);
    points.push(lat, lon);
  }

  if (points.length >= 4) {
    allFlights.push({ t: secType, p: points });
    securityAdded++;
  }
}

console.log(`    Security patrols: ${securityAdded}`);

// LAX ↔ venue VIP helicopter shuttles (dignitaries from airport to events)
const LAX = { lat: 33.9425, lon: -118.4081 };
const laxEnc = toEnc(LAX.lat, LAX.lon);
const LAX_VIP_COUNT = 30;
let laxVipAdded = 0;

for (let s = 0; s < LAX_VIP_COUNT; s++) {
  const venue = OLYMPIC_VENUES[Math.floor(rand() * OLYMPIC_VENUES.length)];
  const heliType = HELI_TYPES[Math.floor(rand() * HELI_TYPES.length)];
  const outbound = rand() > 0.4; // 60% from LAX to venue, 40% return

  const fromEnc = outbound ? laxEnc : venue.enc;
  const toEnc_ = outbound ? venue.enc : laxEnc;

  const dLat = toEnc_[0] - fromEnc[0];
  const dLon = toEnc_[1] - fromEnc[1];
  const flightDist = Math.sqrt(dLat * dLat + dLon * dLon);
  const numPts = Math.max(8, Math.min(18, Math.round(flightDist / 20)));
  const curveBias = (rand() - 0.5) * 0.2;

  const points = [];
  for (let p = 0; p < numPts; p++) {
    const t = p / (numPts - 1);
    const perpLat = -dLon / flightDist;
    const perpLon = dLat / flightDist;
    const curveAmount = curveBias * flightDist * Math.sin(t * Math.PI);

    const lat = Math.round(fromEnc[0] + dLat * t + perpLat * curveAmount + (rand() - 0.5) * 12);
    const lon = Math.round(fromEnc[1] + dLon * t + perpLon * curveAmount + (rand() - 0.5) * 12);
    points.push(lat, lon);
  }

  if (points.length >= 4) {
    allFlights.push({ t: heliType, p: points });
    laxVipAdded++;
  }
}

console.log(`    LAX ↔ venue VIP shuttles: ${laxVipAdded}`);

// ============================================================
// STEP 7: Amplify LAX commercial traffic (+18% for Olympics)
// Massive international visitor influx for the games
// ============================================================
const { amplifyLAX } = require('./amplify_lax');
const laxExtra = amplifyLAX(allFlights, origin, 0.18, 9999);
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
  scenario: '2028_smo_peak_olympics',
};

const json = JSON.stringify(output);
fs.writeFileSync(outputPath, json);

console.log(`\nSummary:`);
console.log(`  Original flights:     ${data.flights.length}`);
console.log(`  Extra local SMO:      ${localAdded}`);
console.log(`  Ferry flights out:    ${ferryAdded}`);
console.log(`  Return ferries in:    ${returnAdded}`);
console.log(`  Olympic helis:        ${mediaHelisAdded + vipShuttleAdded + securityAdded + laxVipAdded}`);
console.log(`  TFR flights removed:  ${tfrFlightsRemoved}`);
console.log(`  Total flights:        ${allFlights.length}`);
console.log(`\nWrote ${outputPath} (${(json.length / 1024 / 1024).toFixed(1)} MB)`);
