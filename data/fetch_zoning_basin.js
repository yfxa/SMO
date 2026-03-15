const fs = require('fs');
const path = require('path');

// ============================================================
// Fetch residential zoning data for the FULL LA Basin
// from LA City ArcGIS FeatureServer
// Broader bounds than the original SMO-centric fetch
// ============================================================

const SERVICE_URL = 'https://services5.arcgis.com/7nsPwEMP38bSkCjy/arcgis/rest/services/Zoning/FeatureServer/15/query';

// Full basin bounds covering the basemap area
const BOUNDS = {
  south: 33.85,
  north: 34.15,
  west: -118.80,
  east: -118.10,
};

const RESIDENTIAL_TYPES = ['R1', 'R2', 'R3', 'R4', 'R5', 'RD', 'RE', 'RS', 'RW', 'RU', 'RZ'];

async function fetchPage(offset) {
  const params = new URLSearchParams({
    where: RESIDENTIAL_TYPES.map(t => `Zoning LIKE '${t}%'`).join(' OR '),
    geometry: `${BOUNDS.west},${BOUNDS.south},${BOUNDS.east},${BOUNDS.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'Zoning,CATEGORY',
    returnGeometry: 'true',
    f: 'geojson',
    resultRecordCount: 2000,
    resultOffset: offset,
  });

  const url = `${SERVICE_URL}?${params}`;
  console.log(`  Fetching offset ${offset}...`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  return resp.json();
}

async function main() {
  console.log('Fetching basin-wide residential zoning data...');
  console.log(`Bounds: ${JSON.stringify(BOUNDS)}`);

  let allFeatures = [];
  let offset = 0;

  while (true) {
    const data = await fetchPage(offset);
    const features = data.features || [];
    console.log(`  Got ${features.length} features`);
    allFeatures = allFeatures.concat(features);

    if (features.length < 2000) break;
    offset += 2000;
  }

  console.log(`\nTotal features: ${allFeatures.length}`);

  // Classify
  let sf = 0, mf = 0;
  for (const f of allFeatures) {
    const z = f.properties.Zoning || '';
    if (/^(R1|RE|RS|RA|RZ)/.test(z)) sf++;
    else mf++;
  }
  console.log(`  Single-family: ${sf}`);
  console.log(`  Multi-family:  ${mf}`);

  // Save as GeoJSON
  const geojson = {
    type: 'FeatureCollection',
    features: allFeatures,
  };

  const outPath = path.join(__dirname, 'la_zoning_basin.geojson');
  fs.writeFileSync(outPath, JSON.stringify(geojson));
  console.log(`\nWrote ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
