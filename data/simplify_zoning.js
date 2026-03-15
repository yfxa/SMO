const fs = require('fs');
const path = require('path');

// Create a grid-based density map from the real zoning parcel data
// Each grid cell gets a score based on how many residential parcels intersect it
// and whether they're single-family or multi-family

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'la_zoning_residential.geojson'), 'utf8'));

// Grid parameters — ~200m cells
const CELL_SIZE = 0.002; // degrees (~200m)
const BOUNDS = {
  south: 33.93, north: 34.08,
  west: -118.55, east: -118.35,
};

const cols = Math.ceil((BOUNDS.east - BOUNDS.west) / CELL_SIZE);
const rows = Math.ceil((BOUNDS.north - BOUNDS.south) / CELL_SIZE);
console.log(`Grid: ${cols}x${rows} = ${cols * rows} cells`);

// For each parcel, find which grid cells its centroid falls in
// and increment the density
const sfGrid = new Float32Array(cols * rows);  // single-family
const mfGrid = new Float32Array(cols * rows);  // multi-family

for (const feature of data.features) {
  const cat = feature.properties.CATEGORY;
  const isMF = cat.includes('Multiple');

  // Get centroid
  const coords = feature.geometry.coordinates[0]; // outer ring
  let cx = 0, cy = 0;
  for (const [lon, lat] of coords) {
    cx += lon;
    cy += lat;
  }
  cx /= coords.length;
  cy /= coords.length;

  const col = Math.floor((cx - BOUNDS.west) / CELL_SIZE);
  const row = Math.floor((BOUNDS.north - cy) / CELL_SIZE);

  if (col >= 0 && col < cols && row >= 0 && row < rows) {
    const idx = row * cols + col;
    if (isMF) mfGrid[idx]++;
    else sfGrid[idx]++;
  }

  // Also fill cells that the parcel polygon covers (approximate with bbox)
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const c0 = Math.floor((minLon - BOUNDS.west) / CELL_SIZE);
  const c1 = Math.floor((maxLon - BOUNDS.west) / CELL_SIZE);
  const r0 = Math.floor((BOUNDS.north - maxLat) / CELL_SIZE);
  const r1 = Math.floor((BOUNDS.north - minLat) / CELL_SIZE);

  for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
    for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
      const idx = r * cols + c;
      if (isMF) mfGrid[idx] += 0.3;
      else sfGrid[idx] += 0.3;
    }
  }
}

// Merge into output: only cells with residential density
const cells = [];
let maxSF = 0, maxMF = 0;
for (let i = 0; i < cols * rows; i++) {
  if (sfGrid[i] > maxSF) maxSF = sfGrid[i];
  if (mfGrid[i] > maxMF) maxMF = mfGrid[i];
}
console.log('Max SF density:', maxSF.toFixed(1), 'Max MF density:', maxMF.toFixed(1));

for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const idx = r * cols + c;
    const sf = sfGrid[idx];
    const mf = mfGrid[idx];
    if (sf < 0.5 && mf < 0.5) continue;

    const lat = BOUNDS.north - (r + 0.5) * CELL_SIZE;
    const lon = BOUNDS.west + (c + 0.5) * CELL_SIZE;

    // Density category: 0=low SF, 1=medium mixed, 2=high MF
    let density;
    if (mf > sf * 2) density = 2;      // mostly multi-family
    else if (mf > sf * 0.5) density = 1; // mixed
    else density = 0;                    // mostly single-family

    // Intensity (0-1)
    const total = sf + mf;
    const intensity = Math.min(1, total / Math.max(maxSF, maxMF) * 1.5);

    cells.push({
      lat: Math.round(lat * 10000) / 10000,
      lon: Math.round(lon * 10000) / 10000,
      d: density,   // 0=SF, 1=mixed, 2=MF
      i: Math.round(intensity * 100) / 100, // intensity 0-1
    });
  }
}

console.log(`Cells with residential: ${cells.length} / ${cols * rows}`);

const output = {
  cellSize: CELL_SIZE,
  bounds: BOUNDS,
  cells: cells,
  stats: {
    totalParcels: data.features.length,
    singleFamily: data.features.filter(f => f.properties.CATEGORY.includes('Single')).length,
    multiFamily: data.features.filter(f => f.properties.CATEGORY.includes('Multiple')).length,
  },
};

const outPath = path.join(__dirname, 'la_residential_grid.json');
const json = JSON.stringify(output);
fs.writeFileSync(outPath, json);
console.log(`Wrote ${outPath} (${(json.length / 1024).toFixed(0)} KB)`);
