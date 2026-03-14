const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
const { parseADSBFile, pathsToScenario } = require('./ingest');

// ============================================================
// RENDER REAL ADS-B DATA
// ============================================================
// Usage:
//   node render-data.js <data-file> [options]
//
// Examples:
//   node render-data.js data/flights.csv
//   node render-data.js data/adsb.json --title "LAX Dec 2024" --output lax-dec.png
//   node render-data.js data/opensky.json --bounds 33.72,-118.62,34.19,-118.10
//   node render-data.js data/dump.sbs --scatter 1.5 --blur 6
//
// Supported data formats:
//   CSV/TSV  - columns: lat, lon, flight/callsign, [alt, time]
//   JSON     - array of {lat, lon, flight}, or ADS-B Exchange / OpenSky format
//   SBS      - BaseStation port 30003 dump (MSG,2/3 records)
//   GeoJSON  - FeatureCollection of Point features
//
// Options:
//   --title "text"       Map title
//   --subtitle "text"    Map subtitle
//   --output file.png    Output filename (default: output/realdata.png)
//   --bounds S,W,N,E     Lat/lon bounds filter (default: LA area)
//   --scatter N          Scatter ratio 0-3 (default: 0.8)
//   --blur N             Blur radius 1-10 (default: 5)
//   --dot-alpha N        Dot opacity 0-1 (default: 0.05)
//   --trail-alpha N      Trail line opacity 0-1 (default: 0.02)
//   --norm-glow N        Glow normalization 0-1 (default: 0.35)
//   --norm-detail N      Detail normalization 0-1 (default: 0.25)
//   --snapshot           Force snapshot mode (no flight grouping)
//   --show-airports      Show LAX/KSMO/HHR/CPM markers
//   --with-scenario X    Overlay on a scenario from scenarios.js
// ============================================================

// Import the render function from generate.js by extracting it
// We need to re-require generate.js's internals
// Instead, we duplicate the render call since generate.js's renderDensityMap isn't exported
// Let's fix this: make generate.js export its render function

// Actually, let's just call generate.js with the scenario
// by writing a temp scenario and calling the same pipeline

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };
  let i = 2;
  while (i < argv.length) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args.flags[key] = argv[i + 1];
        i += 2;
      } else {
        args.flags[key] = true;
        i++;
      }
    } else {
      args.positional.push(argv[i]);
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const dataFile = args.positional[0];

  if (!dataFile) {
    console.log(`
Air Traffic Density Map — Real Data Renderer

Usage: node render-data.js <data-file> [options]

Data formats:
  CSV/TSV    Columns: lat, lon, flight/callsign, [altitude, timestamp]
  JSON       Array of {lat, lon, flight} or ADS-B Exchange / OpenSky format
  SBS        BaseStation port 30003 dump
  GeoJSON    FeatureCollection of Point features

Options:
  --title "text"       Map title
  --subtitle "text"    Map subtitle
  --output file.png    Output path (default: output/realdata.png)
  --bounds S,W,N,E     Lat/lon bounds (default: LA area 33.72,-118.62,34.19,-118.10)
  --scatter N          Position scatter ratio (default: 0.8)
  --blur N             Glow blur radius (default: 5)
  --dot-alpha N        Individual dot opacity (default: 0.05)
  --trail-alpha N      Trail line opacity (default: 0.02)
  --snapshot           Force snapshot mode (no flight path grouping)
  --show-airports      Show airport markers (LAX, KSMO, HHR, CPM)
  --with-scenario X    Overlay real data on scenario from scenarios.js

Example CSV format:
  flight,lat,lon,alt,timestamp
  UAL123,33.95,-118.40,2500,1700000001
  UAL123,33.96,-118.39,3500,1700000010
  SWA456,34.01,-118.45,1200,1700000002
`);
    process.exit(0);
  }

  if (!fs.existsSync(dataFile)) {
    console.error(`File not found: ${dataFile}`);
    process.exit(1);
  }

  // Parse bounds
  let boundsFilter = undefined;
  if (args.flags.bounds) {
    const parts = args.flags.bounds.split(',').map(Number);
    if (parts.length === 4) {
      boundsFilter = { south: parts[0], west: parts[1], north: parts[2], east: parts[3] };
    }
  }

  console.log(`\nParsing: ${dataFile}`);
  const paths = parseADSBFile(dataFile, {
    boundsFilter,
    snapshotMode: !!args.flags.snapshot,
  });

  if (paths.length === 0) {
    console.error('No valid flight paths found in data file.');
    console.log('Ensure your file has lat/lon columns and positions within the map bounds.');
    process.exit(1);
  }

  console.log(`  Extracted ${paths.length} flight paths`);

  // Build airport list
  let airports = [];
  if (args.flags['show-airports']) {
    airports = [
      { name: 'LAX', label: 'LAX', lat: 33.9425, lon: -118.408, major: true, glowRadius: 40, glowIntensity: 0.3,
        runways: [{ heading: 250, length: 0.035 }, { heading: 70, length: 0.035 }] },
      { name: 'KSMO', label: 'KSMO', lat: 34.0158, lon: -118.4513, major: false,
        runways: [{ heading: 210, length: 0.015 }] },
      { name: 'HHR', label: 'HHR', lat: 33.9228, lon: -118.335, major: false,
        runways: [{ heading: 250, length: 0.02 }] },
      { name: 'CPM', label: 'CPM', lat: 33.8903, lon: -118.2437, major: false,
        runways: [{ heading: 200, length: 0.015 }] },
    ];
  }

  // Parse render bounds (separate from filter bounds)
  let renderBounds = undefined;
  if (args.flags.bounds) {
    const parts = args.flags.bounds.split(',').map(Number);
    if (parts.length === 4) {
      renderBounds = { south: parts[0], west: parts[1], north: parts[2], east: parts[3] };
    }
  }

  // Build scenario
  const scenario = pathsToScenario(paths, {
    title: args.flags.title || `Real ADS-B Data — ${path.basename(dataFile)}`,
    subtitle: args.flags.subtitle || '',
    scatterRatio: parseFloat(args.flags.scatter) || 0.15,
    blurRadius: parseInt(args.flags.blur) || 5,
    dotAlpha: parseFloat(args.flags['dot-alpha']) || 0.06,
    trailAlpha: parseFloat(args.flags['trail-alpha']) || 0.035,
    normGlow: parseFloat(args.flags['norm-glow']) || 0.35,
    normDetail: parseFloat(args.flags['norm-detail']) || 0.25,
    airports,
  });

  // Set base map, bounds, and extra params on scenario
  if (args.flags['base-map']) {
    scenario.baseMap = args.flags['base-map'];
  }
  if (renderBounds) {
    scenario.bounds = renderBounds;
  }
  if (args.flags['heatmap-opacity']) {
    scenario.heatmapOpacity = parseFloat(args.flags['heatmap-opacity']);
  }
  if (args.flags['glow-weight']) {
    scenario.glowWeight = parseFloat(args.flags['glow-weight']);
  }
  if (args.flags['detail-weight']) {
    scenario.detailWeight = parseFloat(args.flags['detail-weight']);
  }
  if (args.flags['line-intensity']) {
    scenario.lineIntensity = parseFloat(args.flags['line-intensity']);
  }

  // Optionally merge with an existing scenario
  if (args.flags['with-scenario']) {
    const SCENARIOS = require(path.join(__dirname, 'scenarios.js'));
    const base = SCENARIOS[args.flags['with-scenario']];
    if (base) {
      console.log(`  Overlaying on scenario: ${args.flags['with-scenario']}`);
      // Merge: keep base airports/routes, add real data paths
      scenario.airports = [...(base.airports || []), ...scenario.airports];
      scenario.routes = base.routes || [];
      scenario.radialHubs = base.radialHubs;
      scenario.holdingPatterns = base.holdingPatterns;
      scenario.samplesPerRoute = base.samplesPerRoute || 200;
    } else {
      console.warn(`  Warning: scenario '${args.flags['with-scenario']}' not found, rendering data only`);
    }
  }

  // Render using generate.js's pipeline
  // We need to call renderDensityMap — let's require the module
  // First, export it from generate.js
  const generatePath = path.join(__dirname, 'generate.js');

  // We'll call it as a subprocess with a temp scenario file
  const outputFile = args.flags.output || 'output/realdata.png';
  const outputPath = path.isAbsolute(outputFile) ? outputFile : path.join(__dirname, outputFile);
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Write temporary scenario with embedded paths
  const tmpScenario = path.join(__dirname, '_tmp_realdata_scenario.json');
  fs.writeFileSync(tmpScenario, JSON.stringify({
    scenario,
    outputPath,
  }));

  // Run the render
  console.log(`\nRendering density map...`);

  // Inline render since we can't easily export from generate.js
  // Let's just require the render function by restructuring
  // Actually, let's just duplicate the render inline — cleaner approach:
  // require generate.js as a module

  // Simplest: call node generate.js with a special mode
  const { execSync } = require('child_process');
  execSync(`node "${generatePath}" --realdata "${tmpScenario}"`, {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env, PATH: process.env.PATH },
  });

  // Cleanup
  if (fs.existsSync(tmpScenario)) fs.unlinkSync(tmpScenario);

  console.log(`\nDone! Output: ${outputPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
