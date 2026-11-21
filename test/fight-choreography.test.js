import test from "node:test";
import assert from "node:assert/strict";
import { CONTACT, combatPositions, motion, reaction, sidestep, playbackCues, advancePlayback } from "../public/fight-choreography.js";
import { simulateFight } from "../public/fight-engine.js";

test("melee closes the visual gap at contact without crossing either fighter", () => {
  for (let seed = 0; seed < 25; seed++) {
    for (const round of simulateFight({ players: ["gpt", "claude"], seed }).rounds) {
      let previous = [{ x: -2.1 }, { x: 2.1 }];
      for (const beat of round.beats) {
        for (let frame = 0; frame <= 60; frame++) {
          const [left, right] = combatPositions(previous, beat, frame / 60);
          assert(right - left >= 1.12 - 1e-9, "simultaneous lunges must not cross");
        }
        if (beat.events.some((e) => ["strike", "heavy"].includes(e.action) && e.outcome !== "miss")) {
          const [left, right] = combatPositions(previous, beat, CONTACT);
          assert(Math.abs(right - left - 1.12) < 1e-9, "a connecting punch must reach its target");
        }
        assert.deepEqual(combatPositions(previous, beat, 1), beat.states.map((s) => s.x));
        previous = beat.states;
      }
    }
  }
});

test("damage reactions never precede contact; KO settles instead of returning to idle", () => {
  const beat = { states: [{ hp: 100 }, { hp: 0 }], events: [{ player: 0, damage: 20, outcome: "hit" }] };
  for (const p of [0, 0.2, CONTACT - 0.001]) {
    assert.equal(reaction(beat, 1, p).recoil, 0);
    assert.equal(reaction(beat, 1, p).down, 0);
  }
  assert(reaction(beat, 1, 0.6).recoil > 0.9);
  assert.equal(reaction(beat, 1, 1).down, 1);
  assert.equal(reaction(beat, 0, 0.6).recoil, 0);
  beat.events[0].outcome = "evade";
  beat.events[0].damage = 0;
  assert.equal(reaction(beat, 1, 0.6).recoil, 0);
});

test("heavy attacks have a distinct anticipation while all strikes recover", () => {
  assert(motion("heavy", 0.22).windup > motion("strike", 0.22).windup * 2);
  assert(motion("heavy", 0.25).extension < motion("strike", 0.25).extension);
  for (const action of ["strike", "heavy", "blast", "ultimate"]) {
    assert.equal(motion(action, CONTACT).extension, 1);
    assert.equal(motion(action, 1).extension, 0);
  }
});

test("a failed sidestep is caught in the attack lane, not shown as a successful dodge", () => {
  // Seed 27, R1 exchange 13: Claude's sidestep fails against GPT's lethal blast.
  const beat = simulateFight({ players: ["gpt", "claude"], seed: 27 }).rounds[0].beats[12];
  assert.equal(beat.actions[1], "evade");
  assert.equal(beat.events[0].outcome, "hit");
  assert(sidestep(beat, 1, 0.25) > 0.9, "start the dodge attempt");
  assert.equal(sidestep(beat, 1, CONTACT), 0, "the hit and target share the attack lane");
  const escaped = { ...beat, events: [{ ...beat.events[0], damage: 0, outcome: "evade" }] };
  assert.equal(sidestep(escaped, 1, CONTACT), 1, "successful dodge clears the projectile");
});

test("stalled rendering cannot skip deciding contact and collapse cues", () => {
  const replay = simulateFight({ players: ["gpt", "claude"], seed: 2777097442 });
  const cues = playbackCues(replay);
  let elapsed = 0;
  const seen = [];
  while (elapsed < cues.at(-1)) {
    elapsed = advancePlayback(elapsed, 2, cues);
    seen.push(elapsed);
  }
  assert(cues.every((cue) => seen.includes(cue)), "even two-second stalls must render every protected pose");
  let normal = 0;
  for (let frame = 0; frame < 600; frame++) normal = advancePlayback(normal, 1 / 60, cues);
  assert(Math.abs(normal - 10) < 1e-9, "normal rendering preserves 1x wall-clock playback");
});
