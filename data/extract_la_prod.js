const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// LA Basin bounding box (wider than map bounds for safety)
const LA_BOX = {
  south: 33.45,
  north: 34.45,
  west: -119.45,
  east: -117.40,
};

// Find the traces directory — prod tar extracts to a different structure
const dataDir = __dirname;
let tracesDir;

// Try common locations
const candidates = [
  path.join(dataDir, 'prod_extract', 'traces'),
  path.join(dataDir, 'prod_extract'),
];
for (const c of candidates) {
  if (fs.existsSync(c)) {
    // Check if it has hex subdirectories
    const items = fs.readdirSync(c);
    if (items.some(d => /^[0-9a-f]{2}$/i.test(d))) {
      tracesDir = c;
      break;
    }
    // Maybe traces is a subdirectory
    const sub = path.join(c, 'traces');
    if (fs.existsSync(sub)) {
      tracesDir = sub;
      break;
    }
  }
}

if (!tracesDir) {
  console.error('Could not find traces directory. Expected prod_extract/traces/ with hex subdirs.');
  console.log('Available in data dir:', fs.readdirSync(dataDir).join(', '));
  process.exit(1);
}

const outputCSV = path.join(dataDir, 'la_basin_prod_20260312.csv');
const outputJSON = path.join(dataDir, 'la_basin_prod_20260312.json');

let totalFiles = 0;
let matchedFiles = 0;
let totalPoints = 0;
const allFlights = {};

const subdirs = fs.readdirSync(tracesDir).filter(d => {
  try { return fs.statSync(path.join(tracesDir, d)).isDirectory(); }
  catch(e) { return false; }
});

console.log(`Scanning ${subdirs.length} subdirectories in ${tracesDir}...`);

for (const subdir of subdirs) {
  const subpath = path.join(tracesDir, subdir);
  let files;
  try {
    files = fs.readdirSync(subpath).filter(f => f.endsWith('.json'));
  } catch(e) { continue; }

  for (const fname of files) {
    totalFiles++;
    if (totalFiles % 10000 === 0) {
      console.log(`  Scanned ${totalFiles} files, found ${matchedFiles} in LA Basin (${totalPoints} points)...`);
    }

    try {
      const raw = fs.readFileSync(path.join(subpath, fname));
      let data;
      try {
        data = JSON.parse(zlib.gunzipSync(raw));
      } catch(e) {
        // Maybe not gzipped in prod?
        data = JSON.parse(raw);
      }
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
      const icao = data.icao || fname.replace('.json', '');
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
        // Prod may have multiple trace files per aircraft — merge
        if (allFlights[icao]) {
          allFlights[icao].points.push(...laPoints);
        } else {
          allFlights[icao] = { icao, reg, type, points: laPoints };
        }
      }
    } catch (e) {
      // Skip corrupt files
    }
  }
}

console.log(`\nDone scanning ${totalFiles} trace files.`);
console.log(`Found ${matchedFiles} aircraft in LA Basin with ${totalPoints} position points.`);
console.log(`Unique aircraft: ${Object.keys(allFlights).length}`);

// Write CSV
const csvLines = ['icao,reg,type,timestamp,lat,lon,alt'];
for (const [icao, flight] of Object.entries(allFlights)) {
  for (const pt of flight.points) {
    csvLines.push(`${flight.icao},${flight.reg},${flight.type},${pt.timestamp},${pt.lat},${pt.lon},${pt.alt ?? ''}`);
  }
}
fs.writeFileSync(outputCSV, csvLines.join('\n'));
console.log(`\nWrote CSV: ${outputCSV} (${csvLines.length - 1} rows)`);

// Write grouped JSON
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
console.log(`Wrote JSON: ${outputJSON} (${(jsonSize / 1024 / 1024).toFixed(1)} MB)`);
