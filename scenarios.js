// ============================================================
// SCENARIO DEFINITIONS
// ============================================================
// Each scenario defines the flight routes, airports, and
// rendering parameters for a single density map image.
//
// Route properties:
//   lat, lon       - origin point (airport/hub location)
//   bearing        - heading in degrees (0=N, 90=E, 180=S, 270=W)
//   distance       - how far flights travel (in degrees, ~0.01 = 1km)
//   spread         - heading randomization (degrees)
//   weight         - multiplier for number of paths on this route
//   originSpread   - randomization of starting position (degrees)
//
// Airport properties:
//   lat, lon       - position
//   name/label     - display name
//   major          - boolean, shows glow
//   runways        - array of { heading, length }
//   glowRadius     - pixel radius of airport glow
//   glowIntensity  - 0-1 glow brightness
//   droneHub       - boolean, draw concentric circles
//   hubRadius      - pixel radius per ring
//
// Rendering properties:
//   seed             - random seed (deterministic output)
//   samplesPerRoute  - flight paths per route per unit weight
//   intensity        - density accumulation rate
//   normalization    - 0-1, lower = more contrast (more red hotspots)
//   blurPasses       - number of gaussian blur passes
//   blurRadius       - blur kernel radius
//   trailAlpha       - individual flight line opacity
//   trailWidth       - individual flight line width
// ============================================================

// Shared airport definitions
const LAX = {
  name: 'LAX', label: 'LAX', lat: 33.9425, lon: -118.408, major: true,
  glowRadius: 40, glowIntensity: 0.3,
  runways: [
    { heading: 250, length: 0.035 }, { heading: 70, length: 0.035 },
    { heading: 250, length: 0.033 }, { heading: 70, length: 0.033 },
  ],
};

const KSMO = {
  name: 'KSMO', label: 'KSMO', lat: 34.0158, lon: -118.4513, major: false,
  runways: [{ heading: 210, length: 0.015 }],
};

const HHR = {
  name: 'HHR', label: 'HHR', lat: 33.9228, lon: -118.335, major: false,
  runways: [{ heading: 250, length: 0.02 }],
};

const CPM = {
  name: 'CPM', label: 'CPM', lat: 33.8903, lon: -118.2437, major: false,
  runways: [{ heading: 200, length: 0.015 }],
};

// Standard LAX routes (used in most scenarios)
const LAX_ROUTES = [
  // Primary departure/approach corridors
  { lat: 33.9425, lon: -118.408, bearing: 250, distance: 0.45, spread: 6, weight: 3.0, originSpread: 0.006 },   // West over ocean (main)
  { lat: 33.9425, lon: -118.408, bearing: 70, distance: 0.40, spread: 8, weight: 2.5, originSpread: 0.006 },    // East
  { lat: 33.9425, lon: -118.408, bearing: 190, distance: 0.35, spread: 5, weight: 1.5, originSpread: 0.005 },   // South
  { lat: 33.9425, lon: -118.408, bearing: 10, distance: 0.38, spread: 7, weight: 1.8, originSpread: 0.005 },    // North
  { lat: 33.9425, lon: -118.408, bearing: 290, distance: 0.35, spread: 6, weight: 1.2, originSpread: 0.005 },   // NW
  { lat: 33.9425, lon: -118.408, bearing: 160, distance: 0.30, spread: 5, weight: 1.0, originSpread: 0.005 },   // SSE
  { lat: 33.9425, lon: -118.408, bearing: 230, distance: 0.35, spread: 5, weight: 1.5, originSpread: 0.005 },   // SW ocean
  { lat: 33.9425, lon: -118.408, bearing: 120, distance: 0.28, spread: 6, weight: 0.8, originSpread: 0.005 },   // SE
  { lat: 33.9425, lon: -118.408, bearing: 320, distance: 0.30, spread: 5, weight: 0.8, originSpread: 0.005 },   // NNW
  { lat: 33.9425, lon: -118.408, bearing: 45, distance: 0.40, spread: 8, weight: 1.5, originSpread: 0.005 },    // NE toward Pasadena
  // Overflights / cross-traffic
  { lat: 34.15, lon: -118.55, bearing: 135, distance: 0.50, spread: 4, weight: 0.6, originSpread: 0.02 },
  { lat: 34.18, lon: -118.15, bearing: 225, distance: 0.50, spread: 4, weight: 0.5, originSpread: 0.02 },
  { lat: 33.75, lon: -118.40, bearing: 5, distance: 0.40, spread: 4, weight: 0.5, originSpread: 0.02 },
  { lat: 34.05, lon: -118.62, bearing: 85, distance: 0.45, spread: 3, weight: 0.4, originSpread: 0.02 },
];

// KSMO (Santa Monica Airport) routes - enough to be clearly visible
const KSMO_ROUTES = [
  { lat: 34.0158, lon: -118.4513, bearing: 210, distance: 0.14, spread: 10, weight: 1.2, originSpread: 0.003 },
  { lat: 34.0158, lon: -118.4513, bearing: 30, distance: 0.14, spread: 10, weight: 1.2, originSpread: 0.003 },
  { lat: 34.0158, lon: -118.4513, bearing: 300, distance: 0.12, spread: 8, weight: 0.8, originSpread: 0.003 },
  { lat: 34.0158, lon: -118.4513, bearing: 120, distance: 0.12, spread: 8, weight: 0.8, originSpread: 0.003 },
  { lat: 34.0158, lon: -118.4513, bearing: 0, distance: 0.10, spread: 12, weight: 0.5, originSpread: 0.003 },
  { lat: 34.0158, lon: -118.4513, bearing: 180, distance: 0.10, spread: 12, weight: 0.5, originSpread: 0.003 },
];

// HHR (Hawthorne) routes
const HHR_ROUTES = [
  { lat: 33.9228, lon: -118.335, bearing: 250, distance: 0.08, spread: 12, weight: 0.3, originSpread: 0.003 },
  { lat: 33.9228, lon: -118.335, bearing: 70, distance: 0.08, spread: 12, weight: 0.3, originSpread: 0.003 },
];

// ============================================================
// SCENARIOS
// ============================================================
module.exports = {

  // ----------------------------------------------------------
  // TODAY (2025) - Baseline matching the reference screenshot
  // ----------------------------------------------------------
  today: {
    title: 'Air Traffic Density — Los Angeles',
    subtitle: '2025 — Current conditions',
    seed: 42,
    samplesPerRoute: 250,
    scatterRatio: 1.2,
    dotAlpha: 0.04,
    dotSize: 1.0,
    lineIntensity: 0.4,
    normGlow: 0.35,
    normDetail: 0.25,
    glowWeight: 0.55,
    detailWeight: 0.5,
    blurPasses: 4,
    blurRadius: 5,
    trailAlpha: 0.018,
    trailWidth: 0.4,
    airports: [LAX, KSMO, HHR, CPM],
    routes: [
      ...LAX_ROUTES,
      ...KSMO_ROUTES,
      ...HHR_ROUTES,
    ],
  },

  // ----------------------------------------------------------
  // 2028 - KSMO closing, peak evacuation traffic
  // All planes departing KSMO simultaneously
  // ----------------------------------------------------------
  '2028_ksmo_peak': {
    title: 'Air Traffic Density — Los Angeles',
    subtitle: '2028 — KSMO final days: peak departure surge',
    seed: 2028,
    samplesPerRoute: 250,
    scatterRatio: 1.2,
    dotAlpha: 0.04,
    dotSize: 1.0,
    lineIntensity: 0.4,
    normGlow: 0.30,
    normDetail: 0.22,
    glowWeight: 0.55,
    detailWeight: 0.5,
    blurPasses: 4,
    blurRadius: 5,
    trailAlpha: 0.02,
    trailWidth: 0.5,
    airports: [
      LAX,
      { ...KSMO, major: true, glowRadius: 30, glowIntensity: 0.35 },
      HHR, CPM,
    ],
    routes: [
      ...LAX_ROUTES,
      ...HHR_ROUTES,
      // KSMO mass departure - every direction, very heavy traffic
      { lat: 34.0158, lon: -118.4513, bearing: 0, distance: 0.18, spread: 12, weight: 1.5, originSpread: 0.004 },
      { lat: 34.0158, lon: -118.4513, bearing: 30, distance: 0.20, spread: 10, weight: 2.0, originSpread: 0.004 },
      { lat: 34.0158, lon: -118.4513, bearing: 60, distance: 0.18, spread: 10, weight: 1.5, originSpread: 0.004 },
      { lat: 34.0158, lon: -118.4513, bearing: 90, distance: 0.15, spread: 12, weight: 1.2, originSpread: 0.004 },
      { lat: 34.0158, lon: -118.4513, bearing: 120, distance: 0.15, spread: 10, weight: 1.0, originSpread: 0.004 },
      { lat: 34.0158, lon: -118.4513, bearing: 150, distance: 0.15, spread: 10, weight: 1.0, originSpread: 0.004 },
      { lat: 34.0158, lon: -118.4513, bearing: 180, distance: 0.12, spread: 10, weight: 0.8, originSpread: 0.004 },
      { lat: 34.0158, lon: -118.4513, bearing: 210, distance: 0.18, spread: 10, weight: 2.0, originSpread: 0.004 },
      { lat: 34.0158, lon: -118.4513, bearing: 240, distance: 0.15, spread: 10, weight: 1.2, originSpread: 0.004 },
      { lat: 34.0158, lon: -118.4513, bearing: 270, distance: 0.12, spread: 12, weight: 1.0, originSpread: 0.004 },
      { lat: 34.0158, lon: -118.4513, bearing: 300, distance: 0.15, spread: 10, weight: 1.5, originSpread: 0.004 },
      { lat: 34.0158, lon: -118.4513, bearing: 330, distance: 0.18, spread: 10, weight: 1.5, originSpread: 0.004 },
    ],
    // Holding patterns around KSMO as planes queue
    holdingPatterns: [
      { center: [34.0158, -118.4513], count: 80, minRadius: 0.008, maxRadius: 0.035 },
    ],
  },

  // ----------------------------------------------------------
  // 2030 - KSMO closed, sky is clear above Santa Monica
  // ----------------------------------------------------------
  '2030_ksmo_closed': {
    title: 'Air Traffic Density — Los Angeles',
    subtitle: '2030 — KSMO closed: clear skies over Santa Monica',
    seed: 2030,
    samplesPerRoute: 250,
    scatterRatio: 1.2,
    dotAlpha: 0.04,
    dotSize: 1.0,
    lineIntensity: 0.4,
    normGlow: 0.35,
    normDetail: 0.25,
    glowWeight: 0.55,
    detailWeight: 0.5,
    blurPasses: 4,
    blurRadius: 5,
    trailAlpha: 0.018,
    trailWidth: 0.4,
    airports: [
      LAX, HHR, CPM,
      // KSMO is gone - just a label showing where it was
      { name: 'former KSMO', label: '(former KSMO)', lat: 34.0158, lon: -118.4513, major: false, runways: [] },
    ],
    routes: [
      // LAX routes same but some adjusted to no longer cross KSMO space
      ...LAX_ROUTES,
      ...HHR_ROUTES,
      // No KSMO routes at all
    ],
  },

  // ----------------------------------------------------------
  // 2033 - Barker Hangar drone hub, radial drone traffic
  // ----------------------------------------------------------
  '2033_drone_hub': {
    title: 'Air Traffic Density — Los Angeles',
    subtitle: '2033 — Barker Hangar drone hub: radial traffic pattern',
    seed: 2033,
    samplesPerRoute: 250,
    scatterRatio: 1.2,
    dotAlpha: 0.04,
    dotSize: 1.0,
    lineIntensity: 0.4,
    normGlow: 0.30,
    normDetail: 0.22,
    glowWeight: 0.55,
    detailWeight: 0.5,
    blurPasses: 4,
    blurRadius: 5,
    trailAlpha: 0.02,
    trailWidth: 0.4,
    airports: [
      LAX, HHR, CPM,
      {
        name: 'BARKER HUB', label: 'BARKER DRONE HUB', lat: 34.0148, lon: -118.4513,
        major: true, glowRadius: 25, glowIntensity: 0.2,
        runways: [],
        droneHub: true, hubRadius: 20,
      },
    ],
    routes: [
      ...LAX_ROUTES,
      ...HHR_ROUTES,
    ],
    radialHubs: [
      {
        center: [34.0148, -118.4513],
        numSpokes: 24,
        pathsPerSpoke: 60,
        minDist: 0.003,
        maxDist: 0.09,
        spread: 3,
      },
    ],
  },

};
