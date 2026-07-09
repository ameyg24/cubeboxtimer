// WCA-style scramble generator.
//
// This is a random-MOVE generator, not the random-STATE generator the WCA
// actually uses for 2x2-3x3 (via TNoodle). Random-state scrambling needs a
// cube solver and is out of scope here. What this does implement, matching
// standard cubing convention:
//   - 2x2x2 scrambles only use R/U/F - a 2x2 has no fixed centers, so the
//     whole puzzle can be freely reoriented and 3 faces reach every case.
//   - No two consecutive moves share a face (e.g. "R ... R'").
//   - No three consecutive moves share an axis (e.g. "R L R2"), since
//     opposite-face moves commute and stacking a third only wastes length.
//   - 4x4x4/5x5x5 use standard outer-block-turn notation (Rw = 2-layer wide,
//     3Rw = 3-layer wide), each move picking its own layer depth at random.
// Move counts (9 / 20 / 40 / 60) follow the lengths conventionally used for
// WCA-style practice scrambles at each size; they aren't a guarantee of
// minimum solve depth the way official WCA scrambles are.

const FACE_AXIS = { R: "x", L: "x", U: "y", D: "y", F: "z", B: "z" };
const AMOUNTS = ["", "'", "2"];

const DIMENSION_CONFIG = {
  "2x2x2": { faces: ["R", "U", "F"], maxDepth: 1, length: 9 },
  "3x3x3": { faces: ["R", "U", "F", "L", "D", "B"], maxDepth: 1, length: 20 },
  "4x4x4": { faces: ["R", "U", "F", "L", "D", "B"], maxDepth: 2, length: 40 },
  "5x5x5": { faces: ["R", "U", "F", "L", "D", "B"], maxDepth: 3, length: 60 },
};

function notationFor(face, depth) {
  if (depth === 1) return face;
  if (depth === 2) return `${face}w`;
  return `${depth}${face}w`;
}

export function generateScramble(type, dimension) {
  const { faces, maxDepth, length } = DIMENSION_CONFIG[dimension] || DIMENSION_CONFIG["3x3x3"];

  const moves = [];
  let lastFace = null;
  let lastAxis = null;
  let axisStreak = 0;

  for (let i = 0; i < length; i++) {
    let face;
    do {
      face = faces[Math.floor(Math.random() * faces.length)];
    } while (face === lastFace || (FACE_AXIS[face] === lastAxis && axisStreak >= 2));

    const depth = 1 + Math.floor(Math.random() * maxDepth);
    const amount = AMOUNTS[Math.floor(Math.random() * AMOUNTS.length)];
    moves.push(notationFor(face, depth) + amount);

    const axis = FACE_AXIS[face];
    axisStreak = axis === lastAxis ? axisStreak + 1 : 1;
    lastFace = face;
    lastAxis = axis;
  }

  return moves.join(" ");
}
