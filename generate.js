const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

// ============================================================
// AIR TRAFFIC DENSITY MAP GENERATOR
// ============================================================
// Usage: node generate.js [scenario_name]
//   node generate.js today
//   node generate.js all
// ============================================================

const WIDTH = 1920;
const HEIGHT = 1080;

// Default bounds — can be overridden per scenario
const DEFAULT_BOUNDS = {
  north: 34.35, south: 33.55,
  west: -119.35, east: -117.50,
};

let activeBounds = { ...DEFAULT_BOUNDS };

function latLonToXY(lat, lon) {
  return [
    ((lon - activeBounds.west) / (activeBounds.east - activeBounds.west)) * WIDTH,
    ((activeBounds.north - lat) / (activeBounds.north - activeBounds.south)) * HEIGHT,
  ];
}

// ============================================================
// SEEDED RANDOM
// ============================================================
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function gaussRng(rng) {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1 + 0.0001)) * Math.cos(2 * Math.PI * u2);
}

// ============================================================
// COLORMAP: matches AirNav RadarBox density style
// ============================================================
function densityColor(v) {
  v = Math.max(0, Math.min(1, v));
  let r, g, b;
  if (v < 0.05) {
    const t = v / 0.05;
    r = 0; g = t * 20; b = t * 15;
  } else if (v < 0.15) {
    const t = (v - 0.05) / 0.1;
    r = 0; g = 20 + t * 80; b = 15 + t * 10;
  } else if (v < 0.3) {
    const t = (v - 0.15) / 0.15;
    r = t * 20; g = 100 + t * 80; b = 25 - t * 10;
  } else if (v < 0.5) {
    const t = (v - 0.3) / 0.2;
    r = 20 + t * 120; g = 180 + t * 50; b = 15;
  } else if (v < 0.7) {
    const t = (v - 0.5) / 0.2;
    r = 140 + t * 100; g = 230 + t * 25; b = 15 - t * 5;
  } else if (v < 0.85) {
    const t = (v - 0.7) / 0.15;
    r = 240 + t * 15; g = 255 - t * 80; b = 10;
  } else {
    const t = (v - 0.85) / 0.15;
    r = 255; g = 175 - t * 130; b = 10 + t * 10;
  }
  return [Math.floor(r), Math.floor(g), Math.floor(b)];
}

// ============================================================
// FLIGHT PATH GENERATION
// ============================================================
function generateFlightPaths(routes, rng, samplesPerRoute = 200) {
  const paths = [];
  for (const route of routes) {
    const count = Math.round((route.weight || 1) * samplesPerRoute);
    for (let i = 0; i < count; i++) {
      const bearingSpread = (route.spread || 8) * (rng() - 0.5) * 2;
      const bearing = ((route.bearing || 0) + bearingSpread) * Math.PI / 180;
      const dist = (route.distance || 0.3) * (0.3 + rng() * 0.9);
      const startLat = route.lat + (rng() - 0.5) * (route.originSpread || 0.005);
      const startLon = route.lon + (rng() - 0.5) * (route.originSpread || 0.005);
      const endLat = startLat + Math.cos(bearing) * dist;
      const endLon = startLon + Math.sin(bearing) * dist / Math.cos(startLat * Math.PI / 180);
      const curveAmt = (rng() - 0.5) * 0.015;
      const steps = 40 + Math.floor(rng() * 40);
      const pts = [];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        pts.push([
          startLat + (endLat - startLat) * t + Math.sin(t * Math.PI) * curveAmt,
          startLon + (endLon - startLon) * t + Math.sin(t * Math.PI) * curveAmt * 0.4,
        ]);
      }
      paths.push(pts);
    }
  }
  return paths;
}

function generateRadialPaths(center, rng, opts = {}) {
  const { numSpokes = 12, pathsPerSpoke = 30, minDist = 0.01, maxDist = 0.08, spread = 3 } = opts;
  const paths = [];
  for (let spoke = 0; spoke < numSpokes; spoke++) {
    const baseBearing = (360 / numSpokes) * spoke;
    for (let p = 0; p < pathsPerSpoke; p++) {
      const bearing = (baseBearing + (rng() - 0.5) * spread * 2) * Math.PI / 180;
      const dist = minDist + rng() * (maxDist - minDist);
      const sLat = center[0] + (rng() - 0.5) * 0.002;
      const sLon = center[1] + (rng() - 0.5) * 0.002;
      const eLat = sLat + Math.cos(bearing) * dist;
      const eLon = sLon + Math.sin(bearing) * dist / Math.cos(sLat * Math.PI / 180);
      const steps = 15 + Math.floor(rng() * 15);
      const pts = [];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        pts.push([sLat + (eLat - sLat) * t, sLon + (eLon - sLon) * t]);
      }
      paths.push(pts);
    }
  }
  return paths;
}

function generateHoldingPatterns(center, rng, opts = {}) {
  const { count = 50, minRadius = 0.005, maxRadius = 0.025 } = opts;
  const paths = [];
  for (let i = 0; i < count; i++) {
    const radius = minRadius + rng() * (maxRadius - minRadius);
    const startAngle = rng() * Math.PI * 2;
    const arc = Math.PI * (0.5 + rng() * 1.5);
    const steps = 30 + Math.floor(rng() * 20);
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const angle = startAngle + arc * t;
      pts.push([
        center[0] + Math.cos(angle) * radius + (rng() - 0.5) * 0.001,
        center[1] + Math.sin(angle) * radius / Math.cos(center[0] * Math.PI / 180) + (rng() - 0.5) * 0.001,
      ]);
    }
    paths.push(pts);
  }
  return paths;
}

// ============================================================
// DENSITY GRID with multi-scale blur
// ============================================================
function boxBlur(grid, w, h, radius) {
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, count = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        if (nx >= 0 && nx < w) { sum += grid[y * w + nx]; count++; }
      }
      tmp[y * w + x] = sum / count;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny >= 0 && ny < h) { sum += tmp[ny * w + x]; count++; }
      }
      grid[y * w + x] = sum / count;
    }
  }
}

// ============================================================
// RENDER
// ============================================================
async function renderDensityMap(scenario) {
  // Set active bounds from scenario or defaults
  activeBounds = scenario.bounds ? { ...scenario.bounds } : { ...DEFAULT_BOUNDS };

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(scenario.seed || 12345);

  console.log(`  Rendering ${scenario.name}...`);
  console.log(`  Bounds: N${activeBounds.north} S${activeBounds.south} W${activeBounds.west} E${activeBounds.east}`);

  // --- BACKGROUND ---
  // If a baseMap image is provided, use it. Otherwise draw a plain background.
  if (scenario.baseMap) {
    const mapPath = path.isAbsolute(scenario.baseMap)
      ? scenario.baseMap
      : path.join(__dirname, scenario.baseMap);
    if (fs.existsSync(mapPath)) {
      console.log(`  Loading base map: ${path.basename(mapPath)}`);
      const img = await loadImage(mapPath);
      ctx.drawImage(img, 0, 0, WIDTH, HEIGHT);
    } else {
      console.warn(`  Base map not found: ${mapPath}, using plain background`);
      ctx.fillStyle = '#04111c';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  } else {
    const bg = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 0, WIDTH / 2, HEIGHT / 2, WIDTH * 0.7);
    bg.addColorStop(0, '#0a2535');
    bg.addColorStop(1, '#04111c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // --- GENERATE FLIGHT PATHS ---
  let allPaths = [];

  // Injected real data paths (from ingest.js)
  if (scenario._rawPaths && scenario._rawPaths.length > 0) {
    allPaths = allPaths.concat(scenario._rawPaths);
    console.log(`  Loaded ${scenario._rawPaths.length} real-data paths`);
  }

  if (scenario.routes) {
    allPaths = allPaths.concat(generateFlightPaths(scenario.routes, rng, scenario.samplesPerRoute || 200));
  }
  if (scenario.radialHubs) {
    for (const hub of scenario.radialHubs) {
      allPaths = allPaths.concat(generateRadialPaths(hub.center, rng, hub));
    }
  }
  if (scenario.holdingPatterns) {
    for (const hp of scenario.holdingPatterns) {
      allPaths = allPaths.concat(generateHoldingPatterns(hp.center, rng, hp));
    }
  }
  console.log(`  Total flight paths: ${allPaths.length}`);

  // =========================================================
  // DENSITY-MAPPED RENDERING
  // =========================================================
  // Two layers composited:
  //   1. GLOW layer: density grid → blur → colormap (smooth warm glow)
  //   2. DETAIL layer: pixel-level density → colormap (crisp flight lines)
  // Both use the same green→yellow→orange→red colormap so colors
  // shift naturally based on how many flights overlap.
  // =========================================================

  console.log(`  Total flight paths: ${allPaths.length} → density-mapped render`);

  // --- Build pixel-level density grid ---
  const detail = new Float32Array(WIDTH * HEIGHT);
  const pixelSpacing = scenario.pixelSpacing ?? 1.5;

  // Classify paths by length for differential weight
  const pathsWithLength = allPaths.map(pts => {
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      const dlat = pts[i][0] - pts[i-1][0];
      const dlon = pts[i][1] - pts[i-1][1];
      len += Math.sqrt(dlat*dlat + dlon*dlon);
    }
    return { pts, len };
  });
  const lengths = pathsWithLength.map(p => p.len).sort((a, b) => a - b);
  const p20 = lengths[Math.floor(lengths.length * 0.20)] || 0.001;
  const p80 = lengths[Math.floor(lengths.length * 0.80)] || 0.1;

  let totalPoints = 0;
  for (const { pts, len } of pathsWithLength) {
    if (pts.length < 2) continue;

    // Weight: GA paths contribute less density, commercial more
    let weight;
    if (len < p20) weight = 0.3;
    else if (len < p80) weight = 0.7;
    else weight = 1.0;

    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = latLonToXY(pts[i][0], pts[i][1]);
      const [x1, y1] = latLonToXY(pts[i + 1][0], pts[i + 1][1]);
      const dx = x1 - x0, dy = y1 - y0;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const steps = Math.max(1, Math.ceil(dist / pixelSpacing));

      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const px = Math.round(x0 + dx * t);
        const py = Math.round(y0 + dy * t);
        if (px >= 0 && px < WIDTH && py >= 0 && py < HEIGHT) {
          detail[py * WIDTH + px] += weight;
          totalPoints++;
        }
      }
    }
  }
  console.log(`  Accumulated ${totalPoints} density samples`);

  // --- Build blurred glow grid (lower res for performance) ---
  const CELL = scenario.cellSize || 3;
  const dW = Math.ceil(WIDTH / CELL);
  const dH = Math.ceil(HEIGHT / CELL);
  const glowGrid = new Float32Array(dW * dH);

  // Downsample detail into glow grid
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const v = detail[y * WIDTH + x];
      if (v > 0) {
        const gx = Math.floor(x / CELL);
        const gy = Math.floor(y / CELL);
        if (gx < dW && gy < dH) glowGrid[gy * dW + gx] += v;
      }
    }
  }

  const blurPasses = scenario.blurPasses ?? 3;
  const blurRadius = scenario.blurRadius ?? 8;
  for (let p = 0; p < blurPasses; p++) boxBlur(glowGrid, dW, dH, blurRadius);

  // --- Normalization ---
  function percentileValue(arr, pct) {
    const nonzero = [];
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] > 0) nonzero.push(arr[i]);
    }
    if (nonzero.length === 0) return 1;
    nonzero.sort((a, b) => a - b);
    return nonzero[Math.min(nonzero.length - 1, Math.floor(nonzero.length * pct / 100))] || 1;
  }

  const detailNormPct = scenario.detailNormPct ?? 96;
  const glowNormPct = scenario.glowNormPct ?? 93;
  const maxDetail = percentileValue(detail, detailNormPct);
  const maxGlow = percentileValue(glowGrid, glowNormPct);
  const glowOpacity = scenario.glowOpacity ?? 0.15;
  const detailOpacity = scenario.detailOpacity ?? 0.45;
  console.log(`  Detail norm: p${detailNormPct}=${maxDetail.toFixed(1)}, Glow norm: p${glowNormPct}=${maxGlow.toFixed(3)}`);

  // --- Composite onto canvas ---
  const imgData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  const pixels = imgData.data;

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const idx = (y * WIDTH + x) * 4;

      // Glow layer (smooth, blurred)
      const gx = Math.floor(x / CELL);
      const gy = Math.floor(y / CELL);
      const gv = Math.min(1, glowGrid[gy * dW + gx] / maxGlow);

      // Detail layer (crisp, per-pixel)
      const dv = Math.min(1, detail[y * WIDTH + x] / maxDetail);

      // Color is driven by DETAIL density — this keeps crisp lines colored
      // Glow just adds a soft spread around hot areas
      const colorVal = Math.min(1, Math.max(dv, gv * 0.7));
      if (colorVal < 0.003) continue;

      const [r, g, b] = densityColor(colorVal);

      // Alpha: use sqrt for detail so faint trails are visible but don't overwhelm
      const detailAlpha = dv > 0 ? Math.min(0.85, Math.sqrt(dv) * detailOpacity) : 0;
      const glowAlpha = gv * gv * glowOpacity;
      const alpha = Math.min(1, detailAlpha + glowAlpha);

      // Additive blend onto base map
      pixels[idx]     = Math.min(255, pixels[idx]     + Math.floor(r * alpha));
      pixels[idx + 1] = Math.min(255, pixels[idx + 1] + Math.floor(g * alpha));
      pixels[idx + 2] = Math.min(255, pixels[idx + 2] + Math.floor(b * alpha));
    }
  }
  ctx.putImageData(imgData, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  // --- AIRPORT MARKERS ---
  if (scenario.airports) {
    for (const ap of scenario.airports) {
      const [ax, ay] = latLonToXY(ap.lat, ap.lon);

      if (ap.major) {
        ctx.globalCompositeOperation = 'lighter';
        const grd = ctx.createRadialGradient(ax, ay, 0, ax, ay, ap.glowRadius || 40);
        grd.addColorStop(0, `rgba(255, 120, 30, ${ap.glowIntensity || 0.3})`);
        grd.addColorStop(0.4, `rgba(255, 60, 10, ${(ap.glowIntensity || 0.3) * 0.4})`);
        grd.addColorStop(1, 'rgba(255, 40, 5, 0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(ax, ay, ap.glowRadius || 40, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }

      if (ap.runways) {
        ctx.strokeStyle = ap.major ? 'rgba(255, 90, 40, 0.55)' : 'rgba(90, 190, 140, 0.4)';
        ctx.lineWidth = ap.major ? 2.0 : 1.0;
        for (const rw of ap.runways) {
          const rad = rw.heading * Math.PI / 180;
          const len = rw.length || 0.015;
          const [rx1, ry1] = latLonToXY(ap.lat - Math.cos(rad) * len, ap.lon - Math.sin(rad) * len);
          const [rx2, ry2] = latLonToXY(ap.lat + Math.cos(rad) * len, ap.lon + Math.sin(rad) * len);
          ctx.beginPath(); ctx.moveTo(rx1, ry1); ctx.lineTo(rx2, ry2); ctx.stroke();
        }
      }

      if (ap.droneHub) {
        ctx.globalCompositeOperation = 'lighter';
        for (let ring = 1; ring <= 4; ring++) {
          const radius = ring * (ap.hubRadius || 15);
          ctx.strokeStyle = `rgba(0, 200, 255, ${0.12 / ring})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.arc(ax, ay, radius, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  // --- TITLE ---
  if (scenario.title) {
    ctx.textAlign = 'left';
    ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = 'rgba(150, 210, 245, 0.65)';
    ctx.fillText(scenario.title, 20, 25);
    if (scenario.subtitle) {
      ctx.font = '11px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = 'rgba(120, 180, 210, 0.45)';
      ctx.fillText(scenario.subtitle, 20, 42);
    }
  }

  return canvas;
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = { renderDensityMap };

// ============================================================
// MAIN
// ============================================================
const SCENARIOS = require(path.join(__dirname, 'scenarios.js'));

async function main() {
  if (process.argv[2] === '--realdata' && process.argv[3]) {
    const tmpFile = process.argv[3];
    const { scenario, outputPath } = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    const canvas = await renderDensityMap({ ...scenario, name: 'realdata' });
    const buf = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buf);
    console.log(`  Saved: ${outputPath} (${(buf.length / 1024).toFixed(0)} KB)`);
    return;
  }

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const arg = process.argv[2] || 'all';
  const scenarioNames = arg === 'all' ? Object.keys(SCENARIOS) : [arg];

  for (const name of scenarioNames) {
    const scenario = SCENARIOS[name];
    if (!scenario) {
      console.error(`Unknown scenario: ${name}. Available: ${Object.keys(SCENARIOS).join(', ')}`);
      continue;
    }
    console.log(`\nGenerating: ${scenario.title || name}`);
    const canvas = await renderDensityMap({ ...scenario, name });
    const outPath = path.join(outputDir, `${name}.png`);
    const buf = canvas.toBuffer('image/png');
    fs.writeFileSync(outPath, buf);
    console.log(`  Saved: ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);
  }
  console.log('\nDone!');
}

if (require.main === module) {
  main().catch(console.error);
}
