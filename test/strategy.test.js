import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,resolveTurn,makeView,legalMoves,validateCustom,seededRng,movePool,ultimates,moveCategory,eventTarget} from '../public/strategy-rules.js';
import {runSeries} from '../fight-match.js';
import {createBuiltinController,personalities} from '../fight-controllers.js';

function state(cells=[3,4]) {const s=createState([movePool.map(m=>m.id).concat(ultimates.map(m=>m.id)),movePool.map(m=>m.id)]);s.fighters.forEach((f,i)=>{f.cell=cells[i];f.energy=100;});return s;}
const turn=(s,a,b)=>resolveTurn(s,[{move:a},{move:b}],seededRng(4));
const series=(seed=42,games=2)=>runSeries({players:['gpt','claude'],controllers:['gpt','claude'].map(id=>createBuiltinController(id,{seed})),seed,games});
test('custom budget validation, quick restriction and hidden scout information',()=>{
  assert.equal(validateCustom({name:'拳',damage:2,speed:4,range:['near','mid']}).valid,true);
  for(const c of [null,{}, {name:'拳',damage:8,speed:4,range:['near']},{name:'拳',damage:-1,speed:0,range:['near']}]) assert.equal(validateCustom(c).valid,false);
  const s=state();s.fighters[0].budgetLeft=0;
  assert.ok(legalMoves(s).every(m=>m.quick));assert.ok(!legalMoves(s).some(m=>m.id==='throw'));
  assert.equal(makeView(s,0).opponent.energy,null);
  const r=turn(s,'scout','guard');
  assert.equal(makeView(r.state,0).opponent.energy,r.state.fighters[1].energy);
  assert.equal(makeView(r.state,1).opponent.energy,null);
  assert.deepEqual(makeView(r.state,0).opponent.loadout,s.fighters[1].loadout);
});
test('counter table, trades, feints, armor, whiff, lag and stage',()=>{
  assert.equal(turn(state(),'throw','guard').state.fighters[1].hp,88);
  let r=turn(state(),'jab','strike');assert.deepEqual(r.state.fighters.map(f=>f.hp),[100,95]);
  r=turn(state(),'jab','jab');assert.deepEqual(r.state.fighters.map(f=>f.hp),[95,95]);
  r=turn(state(),'feint','guard');assert.equal(r.beat.feints[0],true);assert.equal(r.state.fighters[1].lag,1);
  assert.equal(turn(state(),'jab','parry').state.fighters[0].hp,92);
  assert.equal(turn(state(),'throw','parry').state.fighters[1].hp,88);
  assert.equal(turn(state(),'heavy','evade').state.fighters[1].hp,100);
  assert.equal(turn(state(),'jab','heavy').state.fighters[0].hp,82);
  r=turn(state([2,6]),'jab','guard');assert.equal(r.beat.events[0].outcome,'miss');
  let s=state([0,8]);for(let i=0;i<24;i++)s=turn(s,'guard','guard').state;
  assert.ok(s.stage.items.length>0);assert.ok(s.stage.dangers.length>0);
});
test('deterministic series, replay accounting, resource and winner invariants, side swap',async()=>{
  const a=await series();assert.deepEqual(a,await series());
  assert.deepEqual(a.games.map(g=>g.sides),[[0,1],[1,0]]);
  const wins=[0,0];
  for(const g of a.games) {
    const roundWins=[0,0];
    for(const r of g.rounds) {
      let hp=[100,100];
      for(const b of r.beats) {
        for(let i=0;i<2;i++) {
          const damage=b.events.filter(e=>eventTarget(e)===i).reduce((n,e)=>n+e.damage,0);
          hp[i]=Math.max(0,hp[i]-damage);
          if(b.events.some(e=>e.player===i&&e.outcome==='item'&&e.item==='heal')) hp[i]=Math.min(100,hp[i]+15);
          assert.equal(b.states[i].hp,hp[i]);
          for(const k of ['hp','energy','stamina']) assert.ok(b.states[i][k]>=0&&b.states[i][k]<=100);
          assert.ok(Math.abs(b.states[i].x)<=3.100001);
          assert.equal(b.mistakes[i],null);
        }
        assert.ok(b.states[1].x-b.states[0].x>=2.2-1e-9);
        assert.ok(b.cells[0]<b.cells[1]);assert.match(b.commentary,/[\u4e00-\u9fff]/);
      }
      const rw=hp[0]===hp[1]?null:hp[0]>hp[1]?0:1;
      assert.equal(r.winner,rw);if(rw!==null)roundWins[rw]++;
    }
    assert.deepEqual(g.wins,roundWins);assert.equal(g.winner,roundWins[0]===roundWins[1]?null:roundWins[0]>roundWins[1]?0:1);
    if(g.winner!==null)wins[g.sides[g.winner]]++;
    assert.ok(g.stats.every(s=>s.budgetUsed<=24));
  }
  assert.deepEqual(a.series.wins,wins);
});
function scripted(decide) {return {id:'test',draft:async v=>v.phase==='ban'?{ban:v.pool.at(-1).id}:{picks:v.pool.slice(0,4).map(m=>m.id),ultimate:'nova',custom:{name:'拳',damage:2,speed:4,range:['near','mid']}},decide,review:async()=>({notes:'继续观察',adjust:'wait'})};}
test('garbage, throws and timeouts are recorded as stunned with lag',async()=>{
  for(const decide of [async()=>null,async()=>{throw new Error('broken');},async()=>{throw null;},async()=>({move:'invented',reason:'乱来'}),()=>new Promise(()=>{})]) {
    let calls=0;
    const c=scripted(v=>{if(calls++===0)return decide(v);return {move:'rest',reason:'休息'};});
    const replay=await runSeries({players:['a','b'],controllers:[c,scripted(async()=>({move:'rest',reason:'休息'}))],games:1,deadlines:{normal:10,quick:5}});
    const b=replay.games[0].rounds[0].beats[0];assert.equal(b.moves[0],'stunned');assert.ok(b.mistakes[0]);assert.equal(b.states[0].lag,2);assert.ok(replay.games[0].stats[0].mistakes>0);
  }
});
test('plans save controller calls; depleted budget only exposes quick moves',async()=>{
  let calls=0,quick=0;
  const c=scripted(async v=>{calls++;if(v.you.budgetLeft===0){quick++;assert.ok(v.legalMoves.every(m=>m.quick));}return {move:'rest',reason:'恢复体力',plan:v.you.budgetLeft>0?[{if:'always',then:'rest'},{if:'always',then:'rest'}]:undefined};});
  const r=await runSeries({players:['a','b'],controllers:[c,scripted(async()=>({move:'rest',reason:'恢复体力'}))],games:1});
  const s=r.games[0].stats[0];assert.equal(s.planTurns,48);assert.equal(calls,42);assert.ok(quick>0);assert.equal(s.budgetUsed,24);
});
test('exact and category predictions score ids, categories, absent and wrong guesses independently',async()=>{
  for(const [predict,exact,category] of [['guard',1,1],['parry',0,1],['defend',0,1],['attack',0,0],['invented',0,0],[undefined,0,0]]) {
    const r=await runSeries({players:['a','b'],controllers:[scripted(async()=>({move:'rest',reason:'观察',predict})),scripted(async()=>({move:'guard',reason:'防守'}))],games:1});
    const s=r.games[0].stats[0];
    assert.equal(s.predictionExactHitRate,exact);assert.equal(s.predictionCategoryHitRate,category);assert.equal(s.predictionHitRate,category);
    assert.equal(s.predictions,predict?r.games[0].rounds.reduce((n,r)=>n+r.beats.length,0):0);
  }
  for(const [id,category] of [['strike','attack'],['custom','attack'],['throw','throw'],['evade','defend'],['barrier','defend'],['dash','move'],['feint','feint'],['scout','scout'],['rest','rest'],['invented',undefined]])assert.equal(moveCategory(id),category);
});
test('round improvement uses each controller own round data, including swapped games',async()=>{
  const r=await runSeries({players:['a','b'],controllers:[scripted(async v=>({move:'rest',reason:'观察',predict:v.round===1?'guard':'rest'})),scripted(async()=>({move:'rest',reason:'观察',predict:'guard'}))],games:2});
  for(const g of r.games){
    const a=g.stats[g.sides.indexOf(0)],b=g.stats[g.sides.indexOf(1)];
    assert.equal(a.rounds[0].predictionRate,0);assert.equal(a.rounds[1].predictionRate,1);
    assert.equal(a.betweenRoundImprovement[0].predictionRate,1);
    assert.ok(b.rounds.every(s=>s.predictionRate===0));assert.ok(b.betweenRoundImprovement.every(s=>s.predictionRate===0));
  }
  assert.ok(r.series.stats[0].betweenRoundImprovement.some(s=>s.predictionRate===1));
  assert.ok(r.series.stats[1].betweenRoundImprovement.every(s=>s.predictionRate===0));
});
test('plan reasons identify the executed conditional step',async()=>{
  const c=scripted(async()=>({move:'guard',reason:'等待时机',plan:[{if:'always',then:'rest'},{if:'opponent_guarded',then:'guard'}]}));
  const r=await runSeries({players:['a','b'],controllers:[c,scripted(async()=>({move:'guard',reason:'防守'}))],games:1});
  const beats=r.games[0].rounds[0].beats;
  assert.equal(beats[0].planSteps[0],null);assert.equal(beats[1].reasons[0],'连招第1步：若无条件→休息');
  assert.equal(beats[2].reasons[0],'连招第2步：若对手格挡→格挡');assert.equal(beats[2].planSteps[0],2);
});
test('built-ins retain feints against repeated defense after review',async()=>{
  const view=makeView(state(),0,{turnsLeft:26,recentMoves:['guard','guard','guard','parry','strike'].map(m=>({moves:['rest',m],events:[]})),reviewNotes:[{adjust:'punish-defense'}]});
  view.you.energy=20;
  const choices=await Promise.all(Array.from({length:40},(_,seed)=>createBuiltinController('gpt',{seed}).decide(view)));
  assert.ok(choices.some(c=>c.move==='feint'));assert.ok(choices.some(c=>c.move==='throw'));
});
test('200-game seeded built-in round robin is varied and decisive',async()=>{
  const wins=Object.fromEntries(personalities.map(id=>[id,0])),endings={},moves={},finishes={},lengths=[];
  const ability={predictions:0,exact:0,category:0,feints:0,successfulFeints:0},predicted={},actual={};
  for(let seed=0;seed<10;seed++)for(let a=0;a<5;a++)for(let b=a+1;b<5;b++) {
    const ids=[personalities[a],personalities[b]];
    const r=await runSeries({players:ids,controllers:ids.map(id=>createBuiltinController(id,{seed})),games:2,seed});
    for(const g of r.games){if(g.winner!==null)wins[ids[g.sides[g.winner]]]++;
      for(const s of g.stats){ability.predictions+=s.predictions;ability.exact+=s.predictionsExactCorrect;ability.category+=s.predictionsCorrect;ability.feints+=s.feintsAttempted;ability.successfulFeints+=s.feintsSuccessful;}
      for(const round of g.rounds){endings[round.ending]=(endings[round.ending]||0)+1;lengths.push(round.beats.length);
        for(const beat of round.beats)for(const m of beat.moves)moves[m]=(moves[m]||0)+1;
        for(const beat of round.beats)for(let i=0;i<2;i++)if(beat.predictions[i]){const p=moveCategory(beat.predictions[i])||beat.predictions[i],a=moveCategory(beat.moves[1-i])||'stunned';predicted[p]=(predicted[p]||0)+1;actual[a]=(actual[a]||0)+1;}
        const last=round.beats.at(-1);if(round.winner!==null){const m=last.moves[round.winner];finishes[m]=(finishes[m]||0)+1;}
      }
    }
  }
  console.log('BALANCE',JSON.stringify({wins,endings,moves,finishes}));
  const chance=Object.entries(predicted).reduce((n,[category,count])=>n+count*(actual[category]||0),0)/ability.predictions**2;
  console.log('ABILITY',JSON.stringify({...ability,exactRate:ability.exact/ability.predictions,categoryRate:ability.category/ability.predictions,chance}));
  assert.ok(ability.feints>0);assert.ok(ability.successfulFeints>0);assert.ok(ability.category/ability.predictions>chance+.03);
  assert.ok(Object.values(wins).every(n=>n>0));assert.ok(endings.ko>0);assert.ok(lengths.some(n=>n<12));assert.ok(lengths.some(n=>n>20));assert.ok(Object.keys(moves).length>=12);assert.ok(!moves.stunned);
  assert.ok(Object.values(wins).every(n=>n>=24&&n<=60));
  const totalFinishes=Object.values(finishes).reduce((a,b)=>a+b,0);
  assert.ok(Object.values(finishes).every(n=>n/totalFinishes<=.205));
});
