import test from "node:test";
import assert from "node:assert/strict";
import { simulateFight } from "../public/fight-engine.js";
import { buildBroadcast, broadcastAt, isKeyHit, roundCall } from "../public/fight-broadcast.js";

test("broadcast stages each fighter and every countdown without changing replay results", () => {
  const replay = simulateFight({ players: ["gpt", "claude"], seed: 374849025 });
  const original = structuredClone(replay);
  const timeline = buildBroadcast(replay);
  assert.deepEqual(timeline.segments.slice(0, 2).map((s) => [s.type, s.player]), [
    ["entrance", 0], ["entrance", 1],
  ]);
  for (const round of replay.rounds) {
    const segments = timeline.segments.filter((s) => s.round === round);
    assert.equal(segments[0].type, "countdown");
    assert.equal(segments.at(-1).type, "outro");
    assert.deepEqual(segments.filter((s) => s.type === "fight").map((s) => s.beat), round.beats);
    assert(segments[0].end - segments[0].start >= 3.8 - 1e-9);
    assert(segments.at(-1).end - segments.at(-1).start >= 3.8 - 1e-9);
  }
  // Sampling forward, backward (replay), or at a different playback speed is
  // stateless. Presentation can never alter server-computed HP or scores.
  const before = broadcastAt(timeline, 12);
  for (let elapsed = 0; elapsed <= timeline.duration; elapsed += 0.08)
    broadcastAt(timeline, elapsed);
  assert.deepEqual(broadcastAt(timeline, 12), before);
  assert.equal(broadcastAt(timeline, timeline.duration).type, "complete");
  assert.deepEqual(replay, original);
});

test("connected key hits slow the impact window, then reach the next exchange exactly once", () => {
  const keyBeat = {
    actions: ["ultimate", "guard"],
    events: [{ player: 0, action: "ultimate", outcome: "hit", damage: 18 }],
    states: [{ x: -2, hp: 100 }, { x: 2, hp: 82 }],
  };
  const ordinary = { ...keyBeat, events: [{ player: 0, action: "strike", damage: 5 }] };
  const miss = { ...keyBeat, events: [{ player: 0, action: "ultimate", damage: 0 }] };
  assert(isKeyHit(keyBeat));
  assert(!isKeyHit(ordinary));
  assert(!isKeyHit(miss));
  assert(isKeyHit({ ...ordinary, states: [{ hp: 100 }, { hp: 0 }] }));
  const timeline = buildBroadcast({
    beatDuration: 0.85,
    rounds: [{ round: 1, beats: [keyBeat, ordinary] }],
  });
  const [key, next] = timeline.segments.filter((s) => s.type === "fight");
  assert(key.end - key.start > next.end - next.start);
  const hit = broadcastAt(timeline, key.start + 0.9);
  const later = broadcastAt(timeline, key.start + 1.1);
  assert(hit.slowMotion);
  assert(later.slowMotion);
  assert(Math.abs((later.progress - hit.progress) - (0.2 / 1.2 * 0.28)) < 1e-9);
  assert(broadcastAt(timeline, key.end - 0.0001).progress > 0.99);
  assert.equal(broadcastAt(timeline, key.end).index, 1);
  assert.equal(broadcastAt(timeline, next.end).type, "outro");
});

test("round slates distinguish time-limit draws from actual double knockouts", () => {
  const round = (hp, winner) => ({ winner, beats: [{ states: hp.map((hp) => ({ hp })) }] });
  assert.equal(roundCall(round([0, 0], null)), "DOUBLE K.O.");
  assert.equal(roundCall(round([20, 0], 0)), "K.O.");
  assert.equal(roundCall(round([20, 10], 0)), "TIME UP");
  assert.equal(roundCall(round([20, 20], null)), "DRAW");
});
