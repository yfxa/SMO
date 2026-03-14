const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// LA Basin bounding box (matching our density map bounds + buffer)
const LA_BOX = {
  south: 33.45,
  north: 34.45,
  west: -119.45,
  east: -117.40,
};

const tracesDir = path.join(__dirname, 'mlat_extract', 'traces');
const outputCSV = path.join(__dirname, 'la_basin_mlat_20260312.csv');
const outputJSON = path.join(__dirname, 'la_basin_mlat_20260312.json');

let totalFiles = 0;
let matchedFiles = 0;
let totalPoints = 0;
const allFlights = {};

const subdirs = fs.readdirSync(tracesDir).filter(d =>
  fs.statSync(path.join(tracesDir, d)).isDirectory()
);

console.log(`Scanning ${subdirs.length} subdirectories...`);

for (const subdir of subdirs) {
  const subpath = path.join(tracesDir, subdir);
  const files = fs.readdirSync(subpath).filter(f => f.endsWith('.json'));

  for (const fname of files) {
    totalFiles++;
    if (totalFiles % 5000 === 0) {
      console.log(`  Scanned ${totalFiles} files, found ${matchedFiles} in LA Basin (${totalPoints} points)...`);
    }

    try {
      const raw = fs.readFileSync(path.join(subpath, fname));
      const data = JSON.parse(zlib.gunzipSync(raw));
      const trace = data.trace || [];

      // Quick check: does any point fall in LA Basin?
      let inLA = false;
      for (const pt of trace) {
        const lat = pt[1];
        const lon = pt[2];
        if (lat >= LA_BOX.south && lat <= LA_BOX.north &&
            lon >= LA_BOX.west && lon <= LA_BOX.east) {
          inLA = true;
          break;
        }
      }

      if (!inLA) continue;

      matchedFiles++;
      const icao = data.icao || '';
      const reg = data.r || '';
      const type = data.t || '';

      // Extract only points within the LA Basin
      const laPoints = [];
      for (const pt of trace) {
        const lat = pt[1];
        const lon = pt[2];
        if (lat >= LA_BOX.south && lat <= LA_BOX.north &&
            lon >= LA_BOX.west && lon <= LA_BOX.east) {
          laPoints.push({
            timestamp: pt[0],
            lat,
            lon,
            alt: pt[3] || null,
          });
          totalPoints++;
        }
      }

      if (laPoints.length > 0) {
        allFlights[icao] = {
          icao,
          reg,
          type,
          points: laPoints,
        };
      }
    } catch (e) {
      // Skip corrupt files
    }
  }
}

console.log(`\nDone scanning ${totalFiles} trace files.`);
console.log(`Found ${matchedFiles} aircraft in LA Basin with ${totalPoints} position points.`);

// Write CSV
const csvLines = ['icao,reg,type,timestamp,lat,lon,alt'];
for (const [icao, flight] of Object.entries(allFlights)) {
  for (const pt of flight.points) {
    csvLines.push(`${flight.icao},${flight.reg},${flight.type},${pt.timestamp},${pt.lat},${pt.lon},${pt.alt ?? ''}`);
  }
}
fs.writeFileSync(outputCSV, csvLines.join('\n'));
console.log(`\nWrote CSV: ${outputCSV} (${csvLines.length - 1} rows)`);

// Write grouped JSON (for direct use with ingest.js)
const grouped = {};
for (const [icao, flight] of Object.entries(allFlights)) {
  grouped[icao] = flight.points.map(p => ({
    lat: p.lat,
    lon: p.lon,
    alt: p.alt,
    flight: icao,
    timestamp: p.timestamp,
  }));
}
fs.writeFileSync(outputJSON, JSON.stringify(grouped, null, 0));
const jsonSize = fs.statSync(outputJSON).size;
console.log(`Wrote JSON: ${outputJSON} (${(jsonSize / 1024).toFixed(0)} KB)`);
