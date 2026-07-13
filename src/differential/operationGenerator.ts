// Seeded generator of valid operation sequences for the differential
// harness. Every emitted operation passes validateOperation and targets
// ids that exist in the state it was generated against; timestamps come
// from a virtual clock derived from the seed, never the wall clock.
//
// Coverage by construction: solves across multiple events, +2 and DNF
// penalties, edits and deletes of existing records, manual and
// import-shaped competition results (source: "wca-import" with WCA
// identity fields), session creation and removal (never below one).

import { chance, createRng, pick, randomInt } from "./prng";
import type { Rng } from "./prng";
import { CUBE_DIMENSIONS, createEmptySolves } from "../storage/normalize";
import type { Operation } from "../storage/operations";
import type { ReferenceState } from "./referenceState";

// Fixed epoch for all generated data; analytics NOW sits safely after the
// longest possible generated timeline (400 ops x <= 4h steps < 70 days).
export const GENERATOR_EPOCH = Date.UTC(2026, 0, 1);
export const ANALYTICS_NOW = Date.UTC(2026, 4, 1);

const PENALTIES = [null, null, null, null, null, null, "+2", "DNF"] as const;

export interface OperationGenerator {
  next(state: ReferenceState): Operation;
}

export function createOperationGenerator(seed: number): OperationGenerator {
  const rng: Rng = createRng(seed);
  let counter = 0;
  let virtualTime = GENERATOR_EPOCH;

  const nextId = (prefix: string) => `${prefix}-${seed}-${(counter += 1)}`;
  const advanceClock = () => {
    virtualTime += randomInt(rng, 60, 4 * 3600) * 1000;
    return virtualTime;
  };

  const makeSolve = () => {
    const penalty = pick(rng, PENALTIES);
    return {
      id: nextId("solve"),
      // The live timer stores a DNF with millis 0; imports keep the raw
      // time. Generate both shapes.
      millis: penalty === "DNF" && chance(rng, 0.5) ? 0 : randomInt(rng, 3000, 60000),
      penalty,
      reviewed: chance(rng, 0.5),
      cubeDimension: pick(rng, CUBE_DIMENSIONS),
      localCreatedAt: advanceClock(),
    };
  };

  const makeCompetition = () => {
    const isImport = chance(rng, 0.4);
    const event = pick(rng, CUBE_DIMENSIONS);
    return {
      id: nextId("comp"),
      competitionName: `Generated Open ${counter}`,
      // Dates may land anywhere in the generated window, including before
      // existing results, exercising the sort-on-add semantics.
      date: new Date(GENERATOR_EPOCH + randomInt(rng, 0, 100 * 86400) * 1000).toISOString(),
      event,
      bestMs: chance(rng, 0.7) ? randomInt(rng, 2500, 50000) : null,
      averageMs: randomInt(rng, 3000, 60000),
      source: isImport ? "wca-import" : "manual",
      notes: chance(rng, 0.2) ? `note ${counter}` : undefined,
      wcaCompetitionId: isImport ? `GeneratedOpen${counter}` : null,
      wcaRoundId: isImport ? randomInt(rng, 1, 3) : null,
      roundLabel: isImport ? pick(rng, ["First round", "Semi Final", "Final"]) : null,
      wcaId: isImport ? "2019GABA01" : null,
    };
  };

  const allSolveRefs = (state: ReferenceState) =>
    state.sessions.flatMap((session) =>
      CUBE_DIMENSIONS.flatMap((dimension) =>
        (session.solves[dimension] || []).map((solve) => ({
          sessionId: session.id,
          cubeDimension: dimension,
          solveId: String(solve.id),
        }))
      )
    );

  const addSession = (): Operation => ({
    type: "AddSession",
    session: {
      id: nextId("session"),
      name: `Session ${counter}`,
      createdAt: advanceClock(),
      solves: createEmptySolves(),
    },
  });

  return {
    next(state: ReferenceState): Operation {
      if (state.sessions.length === 0) return addSession();

      const solves = allSolveRefs(state);
      const roll = rng();

      if (roll < 0.4) {
        return {
          type: "AddSolve",
          sessionId: pick(rng, state.sessions).id,
          cubeDimension: pick(rng, CUBE_DIMENSIONS),
          solve: makeSolve(),
        };
      }
      if (roll < 0.52 && solves.length > 0) {
        const target = pick(rng, solves);
        const patch = chance(rng, 0.6)
          ? { penalty: pick(rng, PENALTIES) }
          : { millis: randomInt(rng, 3000, 60000) };
        return { type: "UpdateSolve", ...target, patch };
      }
      if (roll < 0.6 && solves.length > 0) {
        return { type: "DeleteSolve", ...pick(rng, solves) };
      }
      if (roll < 0.75) {
        return { type: "AddCompetitionResult", competition: makeCompetition() };
      }
      if (roll < 0.82 && state.competitions.length > 0) {
        const target = pick(rng, state.competitions);
        const patch = chance(rng, 0.5)
          ? { averageMs: randomInt(rng, 3000, 60000) }
          : { competitionName: `Renamed Open ${counter}`, bestMs: randomInt(rng, 2500, 50000) };
        return { type: "UpdateCompetitionResult", competitionId: target.id, patch };
      }
      if (roll < 0.87 && state.competitions.length > 0) {
        return { type: "DeleteCompetitionResult", competitionId: pick(rng, state.competitions).id };
      }
      if (roll < 0.94) {
        return addSession();
      }
      if (state.sessions.length > 1) {
        return { type: "RemoveSession", sessionId: pick(rng, state.sessions).id };
      }
      // Only one session left: add data instead of removing it.
      return {
        type: "AddSolve",
        sessionId: state.sessions[0].id,
        cubeDimension: pick(rng, CUBE_DIMENSIONS),
        solve: makeSolve(),
      };
    },
  };
}
