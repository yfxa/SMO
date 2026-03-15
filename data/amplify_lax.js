// ============================================================
// Shared LAX traffic amplification module
// Duplicates commercial flights near LAX with jitter to simulate
// increased international/domestic travel in future scenarios.
// ============================================================

const COMM_REGEX = /^(A3[0-9]{2}|B7[0-9]{2}|B73[0-9]|B38M|B39M|A20N|A21N|A19N|E[0-9]{3}|CRJ[0-9]|MD[0-9]{2}|DC[0-9]{2}|B78X|A359)/;
const LAX = { lat: 33.9425, lon: -118.4081 };
const LAX_GROUND = 150; // encoded units for detecting LAX flights

/**
 * Amplify LAX commercial traffic by a growth factor.
 * @param {Array} flights - array of flight objects { t, p }
 * @param {Object} origin - { lat, lon } encoding origin
 * @param {number} growthFactor - e.g. 0.10 for 10% more, 0.25 for 25% more
 * @param {number} [seedStart=1337] - random seed
 * @returns {{ flights: Array, added: number }} - extra flights to append
 */
function amplifyLAX(flights, origin, growthFactor, seedStart = 1337) {
  const laxEnc = [
    Math.round((LAX.lat - origin.lat) * 10000),
    Math.round((LAX.lon - origin.lon) * 10000),
  ];

  let seed = seedStart;
  function rand() {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return seed / 0x7fffffff;
  }

  // Find LAX commercial flights
  const laxFlights = [];
  for (const f of flights) {
    if (!COMM_REGEX.test(f.t || '')) continue;
    let nearLax = false;
    for (let i = 0; i < f.p.length; i += 2) {
      const dlat = f.p[i] - laxEnc[0];
      const dlon = f.p[i + 1] - laxEnc[1];
      if (Math.sqrt(dlat * dlat + dlon * dlon) < LAX_GROUND) {
        nearLax = true;
        break;
      }
    }
    if (nearLax) laxFlights.push(f);
  }

  // Duplicate a fraction of them
  const numExtra = Math.round(laxFlights.length * growthFactor);
  const extraFlights = [];

  for (let i = 0; i < numExtra; i++) {
    // Pick a random LAX flight to clone
    const src = laxFlights[Math.floor(rand() * laxFlights.length)];

    // Add slight jitter for realistic variation
    const jitterLat = Math.round((rand() - 0.5) * 30);
    const jitterLon = Math.round((rand() - 0.5) * 30);

    const newP = [];
    for (let j = 0; j < src.p.length; j += 2) {
      newP.push(src.p[j] + jitterLat);
      newP.push(src.p[j + 1] + jitterLon);
    }

    extraFlights.push({ t: src.t, p: newP });
  }

  console.log(`  LAX amplification: ${laxFlights.length} commercial flights found, added ${extraFlights.length} extra (+${Math.round(growthFactor * 100)}%)`);

  return { flights: extraFlights, added: extraFlights.length };
}

module.exports = { amplifyLAX };
