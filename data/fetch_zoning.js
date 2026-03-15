const https = require('https');
const fs = require('fs');
const path = require('path');

// Fetch LA City residential zoning parcels around SMO from ArcGIS FeatureServer
const BASE = 'https://services5.arcgis.com/7nsPwEMP38bSkCjy/arcgis/rest/services/Zoning/FeatureServer/15/query';
const BBOX = '-118.55,33.93,-118.35,34.08'; // SMO delivery area
const BATCH = 2000;
const OUT = path.join(__dirname, 'la_zoning_residential.geojson');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const allFeatures = [];
  let offset = 0;

  // Also fetch categories to see what's available
  const catUrl = `${BASE}?where=1%3D1&geometryType=esriGeometryEnvelope&geometry=${encodeURIComponent(BBOX)}&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=CATEGORY&returnDistinctValues=true&returnGeometry=false&f=json&resultRecordCount=50`;
  const catResp = await fetch(catUrl);
  const catData = JSON.parse(catResp);
  console.log('Available categories in area:');
  if (catData.features) {
    const cats = [...new Set(catData.features.map(f => f.attributes.CATEGORY))];
    cats.sort();
    for (const c of cats) console.log('  ', c);
  }

  // Fetch all residential parcels
  while (true) {
    const url = `${BASE}?where=CATEGORY+LIKE+%27%25Residential%25%27&geometryType=esriGeometryEnvelope&geometry=${encodeURIComponent(BBOX)}&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=Zoning,CATEGORY&returnGeometry=true&outSR=4326&f=geojson&resultRecordCount=${BATCH}&resultOffset=${offset}`;

    console.log(`Fetching offset ${offset}...`);
    const resp = await fetch(url);
    const data = JSON.parse(resp);

    if (!data.features || data.features.length === 0) break;

    allFeatures.push(...data.features);
    console.log(`  Got ${data.features.length} features (total: ${allFeatures.length})`);

    if (!data.properties?.exceededTransferLimit) break;
    offset += BATCH;
  }

  console.log(`\nTotal residential parcels: ${allFeatures.length}`);

  // Categorize
  const cats = {};
  for (const f of allFeatures) {
    const c = f.properties.CATEGORY;
    cats[c] = (cats[c] || 0) + 1;
  }
  console.log('\nCategories:');
  for (const [c, n] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c}: ${n}`);
  }

  // Write GeoJSON
  const geojson = {
    type: 'FeatureCollection',
    features: allFeatures,
  };
  const json = JSON.stringify(geojson);
  fs.writeFileSync(OUT, json);
  console.log(`\nWrote ${OUT} (${(json.length / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch(e => console.error(e));
