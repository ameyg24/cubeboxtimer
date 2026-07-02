import { describe, it, expect } from "vitest";
import { generateScramble } from "../scramble.js";

// generateScramble uses Math.random() internally (no injectable RNG — adding
// one just for tests would add API surface to a small utility for little
// benefit). Instead these run the generator many times per dimension and
// assert the structural invariants hold on every run, which gives strong
// confidence without depending on exact random output.
const RUNS = 25;

const FACE_AXIS = { R: "x", L: "x", U: "y", D: "y", F: "z", B: "z" };
const MOVE_PATTERN = /^[1-9]?[RUFLDB]w?['2]?$/;
const baseFace = (move) => move.match(/[RUFLDB]/)[0];

describe("generateScramble", () => {
  it("produces the expected move count for each cube size", () => {
    expect(generateScramble("WCA", "2x2x2").split(" ")).toHaveLength(9);
    expect(generateScramble("WCA", "3x3x3").split(" ")).toHaveLength(20);
    expect(generateScramble("WCA", "4x4x4").split(" ")).toHaveLength(40);
    expect(generateScramble("WCA", "5x5x5").split(" ")).toHaveLength(60);
  });

  it("only uses R/U/F for 2x2x2, since a 2x2 has no fixed centers", () => {
    for (let i = 0; i < RUNS; i++) {
      const moves = generateScramble("WCA", "2x2x2").split(" ");
      expect(moves.every((m) => ["R", "U", "F"].includes(baseFace(m)))).toBe(true);
    }
  });

  it("never repeats a move on the same face back to back, including wide moves", () => {
    for (const dimension of ["3x3x3", "4x4x4", "5x5x5"]) {
      const moves = generateScramble("WCA", dimension).split(" ");
      for (let i = 1; i < moves.length; i++) {
        expect(baseFace(moves[i])).not.toBe(baseFace(moves[i - 1]));
      }
    }
  });

  it("never stacks three consecutive moves on the same axis", () => {
    for (const dimension of ["3x3x3", "4x4x4", "5x5x5"]) {
      for (let run = 0; run < RUNS; run++) {
        const moves = generateScramble("WCA", dimension).split(" ");
        for (let i = 2; i < moves.length; i++) {
          const axes = [moves[i - 2], moves[i - 1], moves[i]].map((m) => FACE_AXIS[baseFace(m)]);
          const allSameAxis = axes[0] === axes[1] && axes[1] === axes[2];
          expect(allSameAxis).toBe(false);
        }
      }
    }
  });

  it("only emits valid outer-block-turn notation", () => {
    for (const dimension of ["2x2x2", "3x3x3", "4x4x4", "5x5x5"]) {
      const moves = generateScramble("WCA", dimension).split(" ");
      expect(moves.every((m) => MOVE_PATTERN.test(m))).toBe(true);
    }
  });

  it("restricts 4x4x4 to single and 2-layer-wide turns (no 3-layer-wide)", () => {
    for (let i = 0; i < RUNS; i++) {
      const moves = generateScramble("WCA", "4x4x4").split(" ");
      expect(moves.every((m) => !/^[1-9]/.test(m))).toBe(true);
    }
  });

  it("falls back to the 3x3x3 move set for an unknown dimension", () => {
    const moves = generateScramble("WCA", "unknown").split(" ");
    expect(moves).toHaveLength(20);
    const knownFaces = new Set(["R", "U", "F", "L", "D", "B"]);
    expect(moves.every((m) => knownFaces.has(baseFace(m)))).toBe(true);
    expect(moves.every((m) => !/^[1-9]/.test(m) && !m.includes("w"))).toBe(true);
  });
});
