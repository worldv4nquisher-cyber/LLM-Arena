import test from "node:test";
import assert from "node:assert/strict";
import { CONTACT, combatPositions, motion, reaction } from "../public/fight-choreography.js";
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
