import { once } from "node:events";
import test from "node:test";
import assert from "node:assert/strict";
import { simulateFight, fighters, styles } from "../public/fight-engine.js";
import { createArena } from "../server.js";

test("fight replay is deterministic, bounded, and settles damage simultaneously", () => {
  const input = { players: ["gpt", "claude"], seed: 123 };
  assert.deepEqual(simulateFight(input), simulateFight(input));
  for (const f of fighters)
    for (const tactic of Object.keys(styles))
      for (let seed = 0; seed < 15; seed++) {
        const replay = simulateFight({
          players: [f.id, "gemini"],
          tactics: [tactic, "balanced"],
          seed,
        });
        assert(replay.rounds.length >= 2 && replay.rounds.length <= 3);
        const wins = [0, 0];
        for (const round of replay.rounds) {
          assert(round.beats.length > 0 && round.beats.length <= 45);
          let health = [100, 100];
          for (const beat of round.beats) {
            assert(
              beat.states[1].x - beat.states[0].x >= 2.2,
              "keep collision space for attack animations",
            );
            beat.states.forEach((state, i) => {
              assert.equal(
                state.hp,
                Math.max(
                  0,
                  health[i] -
                    beat.events
                      .filter((e) => e.player !== i)
                      .reduce((sum, e) => sum + e.damage, 0),
                ),
              );
              assert(state.energy >= 0 && state.energy <= 100);
              assert(state.x >= -3.1 && state.x <= 3.1);
              health[i] = state.hp;
            });
          }
          const final = round.beats.at(-1).states;
          assert.equal(
            round.winner,
            final[0].hp === final[1].hp
              ? null
              : final[0].hp > final[1].hp
                ? 0
                : 1,
          );
          if (round.winner !== null) wins[round.winner]++;
          assert.deepEqual(round.wins, wins);
        }
        assert.deepEqual(replay.wins, wins);
      }
});

test("fight input rejects unknown fighters, unsafe seeds and unsupported tactics", () => {
  for (const input of [
    {},
    { players: ["gpt", "fake"] },
    { players: ["gpt", "claude"], seed: -1 },
    { players: ["gpt", "claude"], seed: 1.5 },
    { players: ["gpt", "claude"], tactics: ["balanced", "__proto__"] },
  ])
    assert.throws(() => simulateFight(input));
});

test("keyless fight API serves complete replays and local 3D assets; classic remains available", async (t) => {
  const app = createArena({ env: {}, turnDelay: 0 });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const url = `http://127.0.0.1:${app.address().port}`;
  const post = (body, headers = {}) =>
    fetch(`${url}/api/fights`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const response = await post({ players: ["deepseek", "grok"], seed: 42 });
  assert.equal(response.status, 200);
  const replay = await response.json();
  assert.equal(replay.mode, "demo");
  assert.equal(replay.seed, 42);
  assert(replay.rounds.length > 1);
  assert.equal((await post({ players: ["gpt", "bad"] })).status, 400);
  assert.equal(
    (
      await post(
        { players: ["gpt", "claude"] },
        { "Sec-Fetch-Site": "cross-site" },
      )
    ).status,
    415,
  );
  assert.equal(
    (
      await post(
        { players: ["gpt", "claude"] },
        { "Content-Type": "text/plain" },
      )
    ).status,
    415,
  );
  assert.equal(
    (await post({ players: ["gpt", "claude"], padding: "x".repeat(3000) }))
      .status,
    400,
  );
  for (const asset of [
    "/",
    "/classic",
    "/fight.js",
    "/fight-scene.js",
    "/fight-models.js",
    "/fight-engine.js",
    "/fight-broadcast.js",
    "/fight-broadcast.css",
    "/fight.css",
    "/vendor/three.module.js",
  ]) {
    const r = await fetch(url + asset);
    assert.equal(r.status, 200, asset);
    assert(
      r.headers.get("content-security-policy").includes("default-src 'self'"),
    );
  }
  assert.equal(
    (await fetch(url + "/api/fighters").then((r) => r.json())).length,
    5,
  );
  assert.equal((await fetch(url + "/vendor/../../server.js")).status, 404);
});
