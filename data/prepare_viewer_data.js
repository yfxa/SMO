const fs = require('fs');
const path = require('path');

const csvPath = path.join(__dirname, 'la_basin_prod_20260312.csv');
const outputPath = path.join(__dirname, 'viewer_data.json');

console.log('Reading CSV...');
const raw = fs.readFileSync(csvPath, 'utf-8');
const lines = raw.split('\n').filter(l => l.trim());
const header = lines[0].split(',');
console.log(`  ${lines.length - 1} rows`);

// Parse into flights grouped by ICAO
const flights = {};
for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(',');
  const icao = cols[0];
  const type = cols[2] || '';
  const lat = parseFloat(cols[4]);
  const lon = parseFloat(cols[5]);

  if (isNaN(lat) || isNaN(lon)) continue;

  if (!flights[icao]) {
    flights[icao] = { type, pts: [] };
  }
  // Store as integers: offset from bounds origin * 10000 (~11m accuracy)
  // This makes numbers small (0-8000 range) instead of full lat/lon
  flights[icao].pts.push([
    Math.round((lat - 33.45) * 10000),
    Math.round((lon + 119.45) * 10000),
  ]);
}

// Build type statistics
const typeStats = {};
const flightList = [];

for (const [icao, flight] of Object.entries(flights)) {
  if (flight.pts.length < 2) continue; // skip single-point

  const t = flight.type || 'UNKNOWN';
  if (!typeStats[t]) typeStats[t] = { count: 0, flights: 0 };
  typeStats[t].count += flight.pts.length;
  typeStats[t].flights++;

  // Flatten points array: [lat0,lon0,lat1,lon1,...] saves ~30% JSON size
  const flat = new Array(flight.pts.length * 2);
  for (let i = 0; i < flight.pts.length; i++) {
    flat[i * 2] = flight.pts[i][0];
    flat[i * 2 + 1] = flight.pts[i][1];
  }
  flightList.push({
    t: flight.type || '',
    p: flat,
  });
}

// Categorize types
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
  // Origin for integer decoding: lat = origin.lat + pt[0]/10000, lon = origin.lon + pt[1]/10000
  origin: { lat: 33.45, lon: -119.45 },
  bounds: { south: 33.4465, north: 34.3335, west: -119.32, east: -117.47 },
  types: typeStats,
  flights: flightList,
};

console.log(`\nTypes: ${Object.keys(typeStats).length}`);
console.log(`Flights: ${flightList.length}`);
console.log(`\nTop types:`);
const sorted = Object.entries(typeStats).sort((a, b) => b[1].count - a[1].count);
for (const [type, stats] of sorted.slice(0, 20)) {
  console.log(`  ${type}: ${stats.flights} flights, ${stats.count} pts (${stats.category})`);
}

const json = JSON.stringify(output);
fs.writeFileSync(outputPath, json);
console.log(`\nWrote ${outputPath} (${(json.length / 1024 / 1024).toFixed(1)} MB)`);
