import { describe, it, expect } from "vitest";
import { generateScramble } from "../scramble.js";

describe("generateScramble", () => {
  it("produces the expected move count for each cube size", () => {
    expect(generateScramble("WCA", "2x2x2").split(" ")).toHaveLength(9);
    expect(generateScramble("WCA", "3x3x3").split(" ")).toHaveLength(20);
    expect(generateScramble("WCA", "4x4x4").split(" ")).toHaveLength(40);
    expect(generateScramble("WCA", "5x5x5").split(" ")).toHaveLength(40);
  });

  it("never repeats a move on the same face back to back", () => {
    const moves = generateScramble("WCA", "3x3x3").split(" ");
    for (let i = 1; i < moves.length; i++) {
      expect(moves[i][0]).not.toBe(moves[i - 1][0]);
    }
  });

  it("falls back to the 3x3x3 move set for an unknown dimension", () => {
    const moves = generateScramble("WCA", "unknown").split(" ");
    const knownFaces = new Set(["R", "U", "F", "L", "D", "B"]);
    expect(moves.every((m) => knownFaces.has(m[0]))).toBe(true);
  });
});
