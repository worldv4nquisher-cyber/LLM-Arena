import test from "node:test";
import assert from "node:assert/strict";
import { simulateFight } from "../public/fight-engine.js";
import { buildBroadcast, broadcastAt, buildHighlights, describeExchange, isKeyHit, roundCall, entranceStatus } from "../public/fight-broadcast.js";
import { mountVoice } from "../public/fight-spectator.js";

test('entrance status clears prior clock, range and feed for replay and swapped drafts',()=>{
  for(const sides of [[0,1],[1,0]]) {
    const previous={clock:11,roundLabel:'ROUND 02',rangeLabel:'近',feedCounter:'FINAL'};
    assert.deepEqual({...previous,...entranceStatus({sides,rounds:[{round:1}]})},{clock:30,roundLabel:'ROUND 01',rangeLabel:'远',feedCounter:'ENTRANCE'});
  }
  assert.equal(entranceStatus({rounds:[{round:2}]}).roundLabel,'ROUND 02');
  assert.equal(entranceStatus({rounds:[]}).roundLabel,'ROUND 01');
});

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

test("strategy series concatenates every game with distinct side and round context", () => {
  const beat = {actions:["guard","guard"],events:[],states:[{hp:100},{hp:100}]};
  const games = [0,1].map(i => ({sides:i?[1,0]:[0,1],rounds:[{round:1,beats:[beat],winner:null,wins:[0,0]}]}));
  const replay = {version:2,games}, original = structuredClone(replay);
  const timeline = buildBroadcast(replay);
  assert.equal(timeline.segments.filter(s=>s.type==='entrance').length,4);
  assert.equal(timeline.segments.filter(s=>s.type==='fight').length,2);
  const swapped = timeline.segments.find(s=>s.gameIndex===1);
  assert.deepEqual(swapped.game.sides,[1,0]);
  assert.equal(broadcastAt(timeline,swapped.start).gameIndex,1);
  assert.equal(broadcastAt(timeline,swapped.start).type,'entrance');
  assert.ok(timeline.segments.every((s,i,a)=>i===0||Math.abs(s.start-a[i-1].end)<1e-9));
  assert.equal(broadcastAt(timeline,timeline.duration).type,'complete');
  assert.deepEqual(replay,original);
  assert.deepEqual(buildBroadcast({games:[]}),{segments:[],duration:0});
});

test("highlights stitch nonoverlapping key exchanges in chronological order", () => {
  const hit=(player,damage,hp,planned=false)=>({
    states:hp.map(hp=>({hp})),events:[{player,damage,action:'strike',outcome:'hit'}],
    planDriven:[planned,false],
  });
  const wait=hp=>({states:hp.map(hp=>({hp})),events:[]});
  const rounds=[
    {round:1,winner:0,beats:[hit(1,30,[70,100]),wait([70,100]),wait([90,100]),hit(0,8,[90,92]),hit(0,8,[90,84]),wait([90,84]),hit(0,6,[90,78]),hit(0,6,[90,72],true)]},
    {round:2,winner:0,beats:[hit(0,40,[100,60]),wait([100,60]),wait([100,60]),hit(0,60,[100,0])]},
  ];
  const replay={games:[{sides:[1,0],rounds}]},original=structuredClone(replay);
  const reel=buildHighlights(buildBroadcast(replay));
  const clips=[...new Set(reel.segments.map(s=>s.highlight))];
  assert.equal(reel.count,4);
  assert.deepEqual(clips.map(c=>c.title),['逆风反超','连续命中','重击命中','终结击倒']);
  assert.equal(reel.segments[0].start,0);
  assert.ok(reel.segments.every((s,i,a)=>i===0||Math.abs(s.start-a[i-1].end)<1e-9));
  const final=reel.segments.at(-1);
  assert.equal(broadcastAt(reel,final.start+0.9).slowMotion,true);
  assert.deepEqual(broadcastAt(reel,final.start).game.sides,[1,0]);
  assert.equal(broadcastAt(reel,reel.duration).type,'complete');
  assert.deepEqual(replay,original);
});

test("play-by-play follows exchange outcomes and correct player/target sides", () => {
  const names=['甲','乙'],events=[
    {player:1,action:'ultimate',outcome:'hit',damage:23},
    {player:null,target:1,action:'blast',outcome:'danger',damage:6},
    {player:0,action:'guard',outcome:'item',damage:0},
  ];
  assert.equal(describeExchange({events},names),'乙绝技命中，甲损失23点生命；乙踩中危险区，损失6点生命；甲拾取道具。');
  assert.equal(describeExchange({events:[]},names),'甲与乙继续试探，暂无伤害。');
});

test("voice starts muted, uses zh-CN, cancels on mute and degrades to captions", () => {
  const button=()=>Object.assign(new EventTarget(),{setAttribute(key,value){this[key]=value;}});
  const on=button(),calls=[];
  const speaking=mountVoice(on,{
    SpeechSynthesisUtterance:class {constructor(text){this.text=text;}},
    speechSynthesis:{getVoices:()=>[],speak:utterance=>calls.push(utterance),cancel:()=>calls.push('cancel')},
  });
  speaking.say('开赛');
  assert.deepEqual(calls,[]);
  on.dispatchEvent(new Event('click'));
  speaking.say('重击',true);
  assert.equal(calls.at(-1).lang,'zh-CN');
  assert.equal(calls.at(-1).text,'重击');
  on.dispatchEvent(new Event('click'));
  assert.equal(on['aria-pressed'],'false');
  assert.equal(calls.at(-1),'cancel');
  speaking.say('准备');
  assert.equal(calls.at(-1),'cancel');
  const off=button(),captions=mountVoice(off,{});
  captions.say('准备',true);
  assert.equal(off.disabled,true);
  assert.equal(off.textContent,'仅文字解说');
});
