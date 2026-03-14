const fs = require('fs');
const path = require('path');

// ============================================================
// ADS-B DATA INGESTION
// ============================================================
// Parses real ADS-B position data from CSV or JSON files and
// converts them into the flight path format used by generate.js.
//
// Supported formats:
//
// 1. CSV (comma or tab separated):
//    Must have columns for latitude, longitude, and ideally a
//    flight/aircraft identifier. Auto-detects column names.
//    Supported column names (case-insensitive):
//      lat/latitude, lon/lng/longitude, icao/hex/icao24,
//      flight/callsign, alt/altitude, time/timestamp
//
// 2. JSON:
//    Array of position objects: [{ lat, lon, flight?, ... }, ...]
//    Or grouped by aircraft: { "FLIGHT1": [{ lat, lon }, ...], ... }
//    Or OpenSky/ADS-B Exchange style with "states" or "acList" arrays
//
// 3. SBS BaseStation format (port 30003 dump):
//    MSG,3 or MSG,2 records with lat/lon fields
//
// Usage:
//   const { parseADSBFile, pathsToScenario } = require('./ingest');
//   const paths = parseADSBFile('data.csv');
//   const scenario = pathsToScenario(paths, { title: 'Real Data' });
// ============================================================

/**
 * Parse a CSV string into rows of objects
 */
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // Detect separator
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(sep).map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(sep).map(v => v.trim().replace(/^["']|["']$/g, ''));
    if (vals.length < headers.length) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx]; });
    rows.push(obj);
  }
  return rows;
}

/**
 * Normalize a position object to { lat, lon, flight, alt, time }
 */
function normalizePosition(obj) {
  const lat = parseFloat(
    obj.lat ?? obj.latitude ?? obj.lat_deg ?? obj.Lat ?? obj.Latitude ?? NaN
  );
  const lon = parseFloat(
    obj.lon ?? obj.lng ?? obj.longitude ?? obj.lon_deg ?? obj.Lon ?? obj.Long ?? obj.Longitude ?? NaN
  );
  if (isNaN(lat) || isNaN(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const flight = (
    obj.flight ?? obj.callsign ?? obj.call ?? obj.icao ?? obj.hex ??
    obj.icao24 ?? obj.Flight ?? obj.Callsign ?? obj.Icao ?? obj.Id ?? 'unknown'
  ).toString().trim();

  const alt = parseFloat(obj.alt ?? obj.altitude ?? obj.alt_baro ?? obj.Alt ?? obj.GAlt ?? NaN);
  const time = parseFloat(obj.time ?? obj.timestamp ?? obj.postime ?? obj.PosTime ?? obj.t ?? NaN);

  return { lat, lon, flight: flight || 'unknown', alt: isNaN(alt) ? null : alt, time: isNaN(time) ? null : time };
}

/**
 * Parse SBS BaseStation format (port 30003 dump)
 * MSG,3,... records contain position data
 */
function parseSBS(text) {
  const lines = text.trim().split(/\r?\n/);
  const positions = [];
  for (const line of lines) {
    const fields = line.split(',');
    if (fields.length < 15) continue;
    if (fields[0] !== 'MSG') continue;
    const msgType = parseInt(fields[1]);
    if (msgType !== 2 && msgType !== 3) continue; // only position messages

    const icao = fields[4]?.trim();
    const lat = parseFloat(fields[14]);
    const lon = parseFloat(fields[15]);
    if (isNaN(lat) || isNaN(lon)) continue;

    const alt = parseFloat(fields[11]) || null;
    positions.push({ lat, lon, flight: icao || 'unknown', alt, time: null });
  }
  return positions;
}

/**
 * Parse ADS-B Exchange JSON format
 * Handles: { "ac": [...] } or { "acList": [...] } or { "states": [...] }
 */
function parseADSBExchange(data) {
  // ADS-B Exchange v2 format
  if (data.ac && Array.isArray(data.ac)) {
    return data.ac.flatMap(ac => {
      const flight = ac.flight || ac.r || ac.hex || 'unknown';
      if (ac.lat !== undefined && ac.lon !== undefined) {
        return [{ lat: ac.lat, lon: ac.lon, flight, alt: ac.alt_baro || ac.alt_geom || null, time: ac.now || null }];
      }
      // Trail data
      if (ac.trace) {
        return ac.trace.map(t => ({
          lat: t[1], lon: t[2], flight, alt: t[3] || null, time: t[0] || null,
        }));
      }
      return [];
    });
  }

  // VirtualRadar / ADS-B Exchange v1 format
  if (data.acList && Array.isArray(data.acList)) {
    return data.acList
      .filter(ac => ac.Lat !== undefined && ac.Long !== undefined)
      .map(ac => ({
        lat: ac.Lat, lon: ac.Long,
        flight: ac.Call || ac.Icao || ac.Id?.toString() || 'unknown',
        alt: ac.GAlt || ac.Alt || null,
        time: ac.PosTime || null,
      }));
  }

  // OpenSky format
  if (data.states && Array.isArray(data.states)) {
    return data.states
      .filter(s => s[6] !== null && s[5] !== null)
      .map(s => ({
        lat: s[6], lon: s[5],
        flight: (s[1] || s[0] || 'unknown').trim(),
        alt: s[7] || null,
        time: s[3] || s[4] || null,
      }));
  }

  return null; // not a recognized format
}

/**
 * Group positions by flight/aircraft and sort by time
 * Returns: Map<string, Array<{lat, lon}>>
 */
function groupByFlight(positions) {
  const groups = new Map();
  for (const pos of positions) {
    const key = pos.flight;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pos);
  }

  // Sort each group by time if available
  for (const [key, pts] of groups) {
    if (pts[0]?.time !== null) {
      pts.sort((a, b) => (a.time || 0) - (b.time || 0));
    }
  }

  return groups;
}

/**
 * Convert grouped positions into path arrays for the renderer
 * Returns array of [[lat, lon], [lat, lon], ...] paths
 */
function groupsToPaths(groups) {
  const paths = [];
  for (const [flight, positions] of groups) {
    if (positions.length < 2) continue;
    const pts = positions.map(p => [p.lat, p.lon]);
    paths.push(pts);
  }
  return paths;
}

/**
 * For single-snapshot data (no time series), create synthetic paths
 * by connecting nearby positions or radiating from clusters.
 * Each position becomes a short trail segment.
 */
function snapshotToPaths(positions, trailLength = 0.005) {
  const paths = [];
  for (const pos of positions) {
    // Create a short trail segment in a random-ish direction based on position
    const pseudoAngle = ((pos.lat * 1000 + pos.lon * 1000) % 360) * Math.PI / 180;
    const len = trailLength * (0.5 + ((pos.lat * 7919 + pos.lon * 6271) % 100) / 100);
    paths.push([
      [pos.lat - Math.cos(pseudoAngle) * len, pos.lon - Math.sin(pseudoAngle) * len],
      [pos.lat, pos.lon],
      [pos.lat + Math.cos(pseudoAngle) * len * 0.3, pos.lon + Math.sin(pseudoAngle) * len * 0.3],
    ]);
  }
  return paths;
}

// ============================================================
// MAIN PARSE FUNCTION
// ============================================================
/**
 * Parse an ADS-B data file (CSV, JSON, or SBS format)
 * Returns array of paths: [[lat,lon], [lat,lon], ...][]
 *
 * Options:
 *   boundsFilter: { north, south, east, west } - only keep positions in bounds
 *   minPathLength: minimum positions per flight to keep (default: 2)
 *   snapshotMode: force snapshot mode even if data has flight IDs (default: false)
 */
function parseADSBFile(filePath, options = {}) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  let positions = [];

  // Try JSON first
  if (ext === '.json' || ext === '.geojson') {
    const data = JSON.parse(text);

    // Check for specialized formats
    const specialized = parseADSBExchange(data);
    if (specialized) {
      positions = specialized;
    }
    // Check for GeoJSON
    else if (data.type === 'FeatureCollection' && data.features) {
      positions = data.features
        .filter(f => f.geometry?.type === 'Point' && f.geometry.coordinates)
        .map(f => ({
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
          flight: f.properties?.flight || f.properties?.callsign || f.properties?.icao || 'unknown',
          alt: f.properties?.altitude || null,
          time: f.properties?.time || f.properties?.timestamp || null,
        }));
    }
    // Pre-grouped format: { "FLIGHT1": [{lat, lon}, ...], ... }
    else if (!Array.isArray(data) && typeof data === 'object' && !data.type) {
      const keys = Object.keys(data);
      const firstVal = data[keys[0]];
      if (Array.isArray(firstVal) && firstVal.length > 0 && firstVal[0].lat !== undefined) {
        const groups = new Map();
        for (const [flight, pts] of Object.entries(data)) {
          const normalized = pts.map(p => normalizePosition({ ...p, flight })).filter(Boolean);
          if (normalized.length > 0) groups.set(flight, normalized);
        }
        return groupsToPaths(groups);
      }
    }
    // Simple array of positions
    else if (Array.isArray(data)) {
      positions = data.map(normalizePosition).filter(Boolean);
    }
  }
  // SBS format
  else if (ext === '.sbs' || ext === '.basestation' || text.startsWith('MSG,')) {
    positions = parseSBS(text);
  }
  // CSV/TSV
  else {
    const rows = parseCSV(text);
    positions = rows.map(normalizePosition).filter(Boolean);
  }

  // Apply bounds filter
  if (options.boundsFilter) {
    const b = options.boundsFilter;
    positions = positions.filter(p =>
      p.lat >= b.south && p.lat <= b.north &&
      p.lon >= b.west && p.lon <= b.east
    );
  }

  console.log(`  Parsed ${positions.length} positions from ${path.basename(filePath)}`);

  if (positions.length === 0) return [];

  // Determine if we have time-series or snapshot data
  const flights = groupByFlight(positions);
  const avgPerFlight = positions.length / flights.size;
  const hasTimeSeries = avgPerFlight > 3 && !options.snapshotMode;

  if (hasTimeSeries) {
    console.log(`  Grouped into ${flights.size} flights (avg ${avgPerFlight.toFixed(1)} positions each)`);
    const paths = groupsToPaths(flights);
    const minLen = options.minPathLength || 2;
    return paths.filter(p => p.length >= minLen);
  } else {
    console.log(`  Snapshot mode: creating ${positions.length} trail segments`);
    return snapshotToPaths(positions);
  }
}

/**
 * Convert parsed paths into a scenario config for the renderer.
 * This bypasses the route-generation system and injects paths directly.
 */
function pathsToScenario(paths, options = {}) {
  return {
    title: options.title || 'Real ADS-B Data',
    subtitle: options.subtitle || '',
    seed: options.seed || 99999,
    samplesPerRoute: 0, // no synthetic routes
    scatterRatio: options.scatterRatio ?? 0.8,
    dotAlpha: options.dotAlpha ?? 0.06,
    dotSize: options.dotSize ?? 1.5,
    lineIntensity: options.lineIntensity ?? 0.4,
    normGlow: options.normGlow ?? 0.35,
    normDetail: options.normDetail ?? 0.25,
    glowWeight: options.glowWeight ?? 0.55,
    detailWeight: options.detailWeight ?? 0.5,
    blurPasses: options.blurPasses ?? 4,
    blurRadius: options.blurRadius ?? 5,
    trailAlpha: options.trailAlpha ?? 0.045,
    trailWidth: options.trailWidth ?? 1.0,
    airports: options.airports || [],
    routes: [], // empty - we inject paths directly
    _rawPaths: paths, // special field: renderer uses these directly
  };
}

module.exports = { parseADSBFile, pathsToScenario, parseCSV, normalizePosition, groupByFlight };
