import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuiltinController,createFlakyController} from '../fight-controllers.js';
import {runSeries} from '../fight-match.js';
import {createState,resolveTurn,mistakeLabel,cellPositions,WORLD_EDGE} from '../public/strategy-rules.js';
import {edgeWarning,buildBroadcast,broadcastAt,fightTimeAt} from '../public/fight-broadcast.js';
import {stunPose,combatPositions} from '../public/fight-choreography.js';

test('seeded built-in edge retreat reaches the spectator timeline without changing referee positions',async()=>{
  const players=['grok','deepseek'],seed=2;
  const replay=await runSeries({players,controllers:players.map(id=>createBuiltinController(id,{seed})),games:1,seed});
  const round=replay.games[0].rounds[2],beat=round.beats[22];
  assert.deepEqual(beat.cells,[4,8]);
  assert.equal(edgeWarning(beat,0),'');
  assert.equal(edgeWarning(beat,1),'擂台边缘 · 8格');
  assert.equal(beat.moves[1],'step_back');
  assert.equal(replay.series.stats.reduce((n,s)=>n+s.mistakes,0),0);
  const timeline=buildBroadcast(replay);
  const segment=timeline.segments.find(s=>s.type==='fight'&&s.beat===beat);
  const shot=broadcastAt(timeline,fightTimeAt(segment,0.6));
  assert.equal(shot.beat,beat);
  const positions=combatPositions(round.beats[21].states,beat,1);
  assert.deepEqual(positions,beat.states.map(s=>s.x));
  assert.ok(Math.abs(positions[1]-4.45)<1e-9);
  assert.ok(positions[1]-positions[0]>=2.2);
});

test('all cell pairs preserve readable spacing and put edge fighters just inside the floor rim',()=>{
  assert.equal(WORLD_EDGE,4.45);
  const gaps=new Map();
  for(let left=0;left<8;left++)for(let right=left+1;right<=8;right++) {
    const positions=cellPositions([left,right]);
    assert.ok(positions.every(x=>Math.abs(x)<=4.45+1e-9));
    assert.ok(positions.every(x=>Math.abs(x)+0.9<5.4));
    const gap=positions[1]-positions[0];
    assert.ok(gap>=2.2-1e-9);
    gaps.set(right-left,gap);
    if(left===0)assert.ok(Math.abs(positions[0]+4.45)<1e-9);
    if(right===8)assert.ok(Math.abs(positions[1]-4.45)<1e-9);
    const mirror=cellPositions([8-right,8-left]);
    assert.ok(Math.abs(positions[0]+mirror[1])<1e-9);
    if(right-left>1) {
      assert.ok(Math.abs(cellPositions([left+1,right])[1]-positions[1])<1e-9);
      assert.ok(Math.abs(cellPositions([left,right-1])[0]-positions[0])<1e-9);
    }
  }
  assert.ok(gaps.get(1)<gaps.get(2)&&gaps.get(3)<gaps.get(4));
  const state=createState();
  const {beat}=resolveTurn(state,[{mistake:'timeout'},{move:'guard'}]);
  assert.deepEqual(beat.states.map(s=>s.x),cellPositions([2,6]));
});

test('edge labels distinguish corners, either side, retreat back to center and absent cell metadata',()=>{
  assert.equal(edgeWarning({cells:[0,1],band:'near'},0),'被逼角 · 0格');
  assert.equal(edgeWarning({cells:[7,8],band:'near'},1),'被逼角 · 8格');
  assert.equal(edgeWarning({cells:[2,6],band:'far'},1),'');
  assert.equal(edgeWarning({},0),'');
});

test('illegal and timed-out submissions are inert, vulnerable and visibly stunned, never guarding',()=>{
  const state=createState();state.fighters[1].cell=3;
  for(const mistake of ['illegal move','timeout']) {
    const {beat}=resolveTurn(state,[{mistake},{move:'jab'}]);
    assert.equal(beat.actions[0],'stunned');
    assert.equal(beat.moves[0],'stunned');
    assert.equal(beat.states[0].lag,2);
    assert.equal(beat.states[0].hp,94);
    assert.equal(beat.states[0].stamina,100);
    assert.deepEqual(beat.cells,[2,3]);
    assert.equal(beat.events[0].outcome,'hit');
    assert.equal(stunPose(beat.actions[0],0.6).droop,1);
    assert.equal(combatPositions(beat.states,beat,0.6)[0],beat.states[0].x);
  }
  assert.deepEqual(stunPose('guard',0.6),{droop:0,sway:0});
  assert.deepEqual(stunPose('stunned',0),{droop:0,sway:0});
  assert.equal(mistakeLabel(null),'');
  assert.equal(mistakeLabel('timeout'),'决策超时');
  assert.equal(mistakeLabel('illegal move'),'非法招式');
  assert.equal(mistakeLabel('bad output'),'指令异常');
});

test('opt-in flaky controller uses the ordinary referee and accounts for every replay mistake',async()=>{
  const seed=2;
  const replay=await runSeries({players:['gpt','claude'],controllers:[createFlakyController({seed}),createBuiltinController('claude',{seed})],games:2,seed});
  let mistakes=0;
  for(const game of replay.games) {
    const side=game.sides.indexOf(0);
    for(const round of game.rounds)for(const beat of round.beats)if(beat.mistakes[side]) {
      mistakes++;
      assert.equal(beat.mistakes[side],'illegal move');
      assert.equal(beat.actions[side],'stunned');
      assert.match(beat.reasons[side],/非法招式/);
      assert.match(beat.commentary,/失误硬直/);
    }
  }
  assert.ok(mistakes>0);
  assert.equal(replay.games[0].rounds[0].beats[0].mistakes[0],'illegal move');
  assert.equal(replay.series.stats[0].mistakes,mistakes);
  assert.equal(replay.series.stats[0].mistakeRate,mistakes/replay.series.stats[0].decisions);
  assert.equal(replay.series.stats[1].mistakes,0);
});
