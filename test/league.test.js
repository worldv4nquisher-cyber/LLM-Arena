import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLeague, roundRobin, expectedScore, rateGame, tierChanges, START_TIER } from '../fight-league.js';
import { runSeries } from '../fight-match.js';
import { createBuiltinController, personalities } from '../fight-controllers.js';
import { createArena } from '../server.js';
import { createLadder } from '../fight-ladder.js';

const roster = personalities.map(id => ({ id, controller: `builtin:${id}` }));
const run = input => runSeries({ ...input, controllers: input.controllers.map(c => createBuiltinController(c.split(':')[1], { seed: input.seed })) });

function clockedLeague(options = {}) {
  const clock = { t: 1_000_000 };
  const league = createLeague({ path: null, run, roster, autostart: false, now: () => clock.t, ...options });
  async function advance(ms = 10 * 60_000) { clock.t += ms; await league.tick(); while (league.computing) { await league.computing; await league.tick(); } }
  return { league, clock, advance };
}

test('round robin pairs every fighter once and balances first side', () => {
  const rounds = roundRobin(personalities), pairs = rounds.flat();
  assert.equal(rounds.length, 5);
  assert.equal(pairs.length, 10);
  assert.equal(new Set(pairs.map(p => [...p].sort().join())).size, 10);
  for (const id of personalities) {
    assert.equal(pairs.filter(p => p.includes(id)).length, 4);
    for (const round of rounds) assert.ok(round.filter(p => p.includes(id)).length <= 1);
  }
  const firsts = personalities.map(id => pairs.filter(p => p[0] === id).length);
  assert.ok(Math.max(...firsts) - Math.min(...firsts) <= 2, `first-side counts ${firsts}`);
});

test('elo rewards upsets more than expected wins', () => {
  assert.equal(expectedScore(1500, 1500), 0.5);
  const [upset] = rateGame(1400, 1600, 1), [favored] = rateGame(1600, 1400, 1);
  assert.ok(upset - 1400 > favored - 1600);
  const [a, b] = rateGame(1520, 1480, 0);
  assert.equal(Math.round(a + b), 3000);
});

test('tier changes promote the top two and relegate the bottom two within bounds', () => {
  const final = personalities.map((id, i) => ({ id, place: i + 1 }));
  const changes = tierChanges(final, { gpt: { tier: 5 }, grok: { tier: 0 } });
  assert.deepEqual(changes.map(c => c.change), [0, 1, 0, -1, 0]);
  assert.equal(changes[1].to, START_TIER + 1);
});

test('a built-in season runs automatically to a champion with ratings, profiles and replays', async () => {
  const { league, advance } = clockedLeague({ intermission: 1000, firstDelay: 0 });
  await advance(0);
  let snap = await league.snapshot();
  assert.equal(snap.season.number, 1);
  assert.equal(snap.season.total, 10);
  let sawLive = false;
  for (let i = 0; i < 80 && snap.season.status !== 'complete'; i++) {
    await advance();
    snap = await league.snapshot();
    if (snap.live) {
      sawLive = true;
      const watch = await league.match(snap.live.id);
      assert.equal(watch.replay.games.length, 2);
      assert.deepEqual(watch.replay.games.map(g => g.sides), [[0, 1], [1, 0]]);
      assert.ok(watch.match.elapsed >= 0);
    }
  }
  assert.ok(sawLive);
  assert.equal(snap.season.status, 'complete');
  assert.equal(snap.season.played, 10);
  assert.equal(snap.previous.number, 1);
  assert.equal(snap.previous.champion, snap.previous.final[0].id);
  assert.deepEqual(snap.previous.changes.map(c => c.change), [1, 1, 0, -1, -1]);
  assert.equal(snap.ratings.length, 5);
  assert.equal(Math.round(snap.ratings.reduce((n, r) => n + r.rating, 0) / 5), 1500);

  const profile = await league.fighter('gpt');
  assert.equal(profile.record.matches, 4);
  assert.equal(profile.radar.length, 6);
  assert.ok(profile.radar.every(a => a.value >= 0 && a.value <= 100));
  assert.equal(profile.headToHead.length, 4);
  assert.equal(profile.ratingHistory.length, 5);
  assert.equal(profile.seasons.length, 1);

  assert.equal((await league.library()).length, 10);
  assert.equal((await league.library({ fighter: 'claude' })).length, 4);
  assert.equal((await league.library({ season: 2 })).length, 0);

  await advance();
  snap = await league.snapshot();
  assert.equal(snap.season.number, 2);
  await league.close();
});

test('league state and replays persist across restarts and reset clears them', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'league-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ladder = createLadder({ path: null });
  const first = clockedLeague({ path: dir, ladder, firstDelay: 0 });
  await first.advance(0);
  for (let i = 0; i < 6; i++) await first.advance();
  const done = (await first.league.library()).filter(m => m.status === 'done');
  assert.ok(done.length >= 1);
  await first.league.close();
  assert.ok((await readdir(join(dir, 'replays'))).length >= done.length);

  const second = createLeague({ path: dir, run, roster, autostart: false });
  assert.equal((await second.library()).filter(m => m.status === 'done').length, done.length);
  assert.ok((await second.match(done[0].id)).replay.games.length);
  await second.reset();
  const snap = await second.snapshot();
  assert.equal(snap.season.number, 1);
  assert.equal(snap.season.played, 0);
  assert.equal((await second.library()).length, 0);
  assert.equal((await ladder.snapshot()).length, 0);
  await second.close();
});

test('league API serves schedule, matches, fighters and an authorized reset', async t => {
  const app = createArena({ env: { LEAGUE_ADMIN_TOKEN: 'secret' }, turnDelay: 0, ladder: createLadder({ path: null }), league: { path: null, autostart: false, firstDelay: 0 } });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  const url = `http://127.0.0.1:${app.address().port}`;
  await app.league.tick();
  while (app.league.computing) { await app.league.computing; await app.league.tick(); }
  const snap = await (await fetch(`${url}/api/league`)).json();
  assert.equal(snap.season.matches.length, 10);
  assert.ok(snap.live);
  const live = await (await fetch(`${url}/api/league/matches/${snap.live.id}`)).json();
  assert.equal(live.match.status, 'live');
  assert.equal(live.replay.players.length, 2);
  assert.equal((await fetch(`${url}/api/league/matches/nope`)).status, 404);
  assert.equal((await (await fetch(`${url}/api/league/matches?fighter=${snap.live.players[0]}`)).json()).length, 1);
  assert.equal((await fetch(`${url}/api/league/matches?season=x`)).status, 400);
  assert.equal((await fetch(`${url}/api/league/fighters/gpt`)).status, 200);
  assert.equal((await fetch(`${url}/api/league/fighters/nobody`)).status, 404);
  const reset = headers => fetch(`${url}/api/league/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
  assert.equal((await reset({})).status, 403);
  assert.equal((await reset({ Authorization: 'Bearer wrong' })).status, 403);
  assert.equal((await reset({ Authorization: 'Bearer secret' })).status, 200);
  for (const page of ['/fighter', '/replays', '/league.css', '/league-ui.js', '/fighter.js', '/replays.js']) assert.equal((await fetch(url + page)).status, 200, page);
});

test('a season with only void matches crowns nobody and keeps tiers', async () => {
  const clock = { t: 0 };
  const league = createLeague({ path: null, roster, autostart: false, firstDelay: 0, now: () => clock.t, run: async () => { throw new Error('down'); } });
  for (let i = 0; i < 30; i++) { clock.t += 1000; await league.tick(); if (league.computing) await league.computing; }
  const snap = await league.snapshot();
  assert.equal(snap.previous.number, 1);
  assert.equal(snap.previous.champion, null);
  assert.ok(snap.previous.changes.every(c => c.change === 0));
  assert.ok(snap.ratings.every(r => r.tier === START_TIER));
  await league.close();
});
