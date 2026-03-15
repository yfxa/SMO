const fs = require('fs');
const path = require('path');

// ============================================================
// Convert basin-wide parcel polygons into a density grid
// Then find optimal drone hub locations using k-means clustering
// ============================================================

const geojsonPath = path.join(__dirname, 'la_zoning_basin.geojson');
const outputPath = path.join(__dirname, 'la_residential_basin_grid.json');

console.log('Loading basin GeoJSON...');
const raw = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));
const features = raw.features;
console.log(`  ${features.length} parcels`);

// Grid parameters — 200m cells like the original
const CELL_SIZE = 0.002; // ~200m in degrees

// Find bounds from the data
let minLat = 999, maxLat = -999, minLon = 999, maxLon = -999;
for (const f of features) {
  const geom = f.geometry;
  if (!geom || !geom.coordinates) continue;
  const coords = geom.type === 'MultiPolygon' ? geom.coordinates.flat(2) : geom.coordinates.flat(1);
  for (const [lon, lat] of coords) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
}

// Snap to grid
const gridSouth = Math.floor(minLat / CELL_SIZE) * CELL_SIZE;
const gridWest = Math.floor(minLon / CELL_SIZE) * CELL_SIZE;
const gridNorth = Math.ceil(maxLat / CELL_SIZE) * CELL_SIZE;
const gridEast = Math.ceil(maxLon / CELL_SIZE) * CELL_SIZE;

const cols = Math.round((gridEast - gridWest) / CELL_SIZE);
const rows = Math.round((gridNorth - gridSouth) / CELL_SIZE);
console.log(`\nGrid: ${cols}x${rows} = ${cols * rows} cells`);
console.log(`  Lat: ${gridSouth.toFixed(3)} - ${gridNorth.toFixed(3)}`);
console.log(`  Lon: ${gridWest.toFixed(3)} - ${gridEast.toFixed(3)}`);

// Count parcels per cell, track type
const cellData = {}; // key = "row,col" -> { sf: 0, mf: 0 }

function getCentroid(geometry) {
  let coords;
  if (geometry.type === 'MultiPolygon') {
    coords = geometry.coordinates.flat(2);
  } else {
    coords = geometry.coordinates.flat(1);
  }
  let sumLat = 0, sumLon = 0;
  for (const [lon, lat] of coords) {
    sumLat += lat;
    sumLon += lon;
  }
  return [sumLat / coords.length, sumLon / coords.length];
}

for (const f of features) {
  if (!f.geometry || !f.geometry.coordinates) continue;
  const [lat, lon] = getCentroid(f.geometry);
  const row = Math.floor((lat - gridSouth) / CELL_SIZE);
  const col = Math.floor((lon - gridWest) / CELL_SIZE);
  if (row < 0 || row >= rows || col < 0 || col >= cols) continue;

  const key = `${row},${col}`;
  if (!cellData[key]) cellData[key] = { sf: 0, mf: 0 };

  const z = (f.properties.Zoning || '').toUpperCase();
  if (/^(R1|RE|RS|RA|RZ)/.test(z)) cellData[key].sf++;
  else cellData[key].mf++;
}

// Build output cells
const cells = [];
let maxCount = 0;
for (const [key, data] of Object.entries(cellData)) {
  const total = data.sf + data.mf;
  if (total > maxCount) maxCount = total;
}

for (const [key, data] of Object.entries(cellData)) {
  const [row, col] = key.split(',').map(Number);
  const lat = +(gridSouth + (row + 0.5) * CELL_SIZE).toFixed(4);
  const lon = +(gridWest + (col + 0.5) * CELL_SIZE).toFixed(4);
  const total = data.sf + data.mf;
  const intensity = +(total / maxCount).toFixed(3);

  // d: 0=SF, 1=mixed, 2=MF
  let d;
  if (data.sf > 0 && data.mf > 0) d = 1;
  else if (data.mf > 0) d = 2;
  else d = 0;

  cells.push({ lat, lon, d, i: intensity });
}

console.log(`\n  Cells with residential data: ${cells.length}`);
console.log(`  Max parcels per cell: ${maxCount}`);
console.log(`  SF-only: ${cells.filter(c => c.d === 0).length}`);
console.log(`  Mixed:   ${cells.filter(c => c.d === 1).length}`);
console.log(`  MF-only: ${cells.filter(c => c.d === 2).length}`);

// ============================================================
// Find optimal drone hub locations using weighted k-means
// ============================================================
const NUM_HUBS = 8;

// LAX exclusion — no hubs near LAX
const LAX = { lat: 33.9425, lon: -118.4081 };
const LAX_EXCLUSION_DEG = 0.03; // ~3km

// Filter cells not in LAX zone for hub placement
const eligibleCells = cells.filter(c => {
  const dlat = c.lat - LAX.lat;
  const dlon = c.lon - LAX.lon;
  return Math.sqrt(dlat * dlat + dlon * dlon) > LAX_EXCLUSION_DEG;
});

console.log(`\n  Eligible cells for hub placement: ${eligibleCells.length}`);

// Weighted k-means
function kMeansWeighted(points, k, maxIter = 50) {
  // Initialize centroids using k-means++
  const centroids = [];
  // Pick first centroid — highest intensity cell
  const sorted = [...points].sort((a, b) => b.i - a.i);
  centroids.push({ lat: sorted[0].lat, lon: sorted[0].lon });

  for (let c = 1; c < k; c++) {
    // Pick next centroid proportional to squared distance from nearest existing centroid
    let totalDist = 0;
    const dists = points.map(p => {
      let minD = Infinity;
      for (const cent of centroids) {
        const d = Math.sqrt((p.lat - cent.lat) ** 2 + (p.lon - cent.lon) ** 2);
        if (d < minD) minD = d;
      }
      const wd = minD * minD * (p.i + 0.1);
      totalDist += wd;
      return wd;
    });

    let r = Math.random() * totalDist;
    for (let i = 0; i < points.length; i++) {
      r -= dists[i];
      if (r <= 0) {
        centroids.push({ lat: points[i].lat, lon: points[i].lon });
        break;
      }
    }
    if (centroids.length <= c) {
      centroids.push({ lat: points[Math.floor(Math.random() * points.length)].lat, lon: points[Math.floor(Math.random() * points.length)].lon });
    }
  }

  // Iterate
  for (let iter = 0; iter < maxIter; iter++) {
    // Assign cells to nearest centroid
    const clusters = Array.from({ length: k }, () => []);
    for (const p of points) {
      let minD = Infinity, minIdx = 0;
      for (let c = 0; c < k; c++) {
        const d = Math.sqrt((p.lat - centroids[c].lat) ** 2 + (p.lon - centroids[c].lon) ** 2);
        if (d < minD) { minD = d; minIdx = c; }
      }
      clusters[minIdx].push(p);
    }

    // Update centroids (weighted by intensity)
    let moved = false;
    for (let c = 0; c < k; c++) {
      if (clusters[c].length === 0) continue;
      let sumLat = 0, sumLon = 0, sumW = 0;
      for (const p of clusters[c]) {
        const w = p.i + 0.1;
        sumLat += p.lat * w;
        sumLon += p.lon * w;
        sumW += w;
      }
      const newLat = sumLat / sumW;
      const newLon = sumLon / sumW;
      if (Math.abs(newLat - centroids[c].lat) > 0.0001 || Math.abs(newLon - centroids[c].lon) > 0.0001) {
        moved = true;
      }
      centroids[c] = { lat: newLat, lon: newLon };
    }

    if (!moved) {
      console.log(`  k-means converged at iteration ${iter}`);
      break;
    }
  }

  // Count cells per cluster
  const clusterSizes = Array(k).fill(0);
  const clusterWeights = Array(k).fill(0);
  for (const p of points) {
    let minD = Infinity, minIdx = 0;
    for (let c = 0; c < k; c++) {
      const d = Math.sqrt((p.lat - centroids[c].lat) ** 2 + (p.lon - centroids[c].lon) ** 2);
      if (d < minD) { minD = d; minIdx = c; }
    }
    clusterSizes[minIdx]++;
    clusterWeights[minIdx] += p.i;
  }

  return centroids.map((c, i) => ({
    lat: +c.lat.toFixed(4),
    lon: +c.lon.toFixed(4),
    cells: clusterSizes[i],
    weight: +clusterWeights[i].toFixed(1),
  }));
}

console.log(`\nFinding ${NUM_HUBS} optimal drone hub locations...`);
const hubs = kMeansWeighted(eligibleCells, NUM_HUBS);

// Sort by weight (biggest cluster first)
hubs.sort((a, b) => b.weight - a.weight);

console.log('\nOptimal hub locations:');
for (let i = 0; i < hubs.length; i++) {
  const h = hubs[i];
  console.log(`  Hub ${i + 1}: lat=${h.lat}, lon=${h.lon} (${h.cells} cells, weight=${h.weight})`);
}

// Save grid + hub locations
const output = {
  cellSize: CELL_SIZE,
  bounds: { south: gridSouth, north: gridNorth, west: gridWest, east: gridEast },
  cells: cells,
  hubs: hubs,
};

const json = JSON.stringify(output);
fs.writeFileSync(outputPath, json);
console.log(`\nWrote ${outputPath} (${(json.length / 1024).toFixed(0)} KB)`);
