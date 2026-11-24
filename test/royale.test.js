import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { runRoyale } from '../royale-match.js';
import { createBuiltinController, liveController, personalities } from '../fight-controllers.js';
import { createLadder } from '../fight-ladder.js';
import { createLeague } from '../fight-league.js';
import { createArena } from '../server.js';

const seed = 71;
const players = [...personalities];
const bots = () => players.map(id => createBuiltinController(id, { seed }));

test('five keyless players produce a deterministic, bounded and scored replay', async () => {
  const replay = await runRoyale({ players, controllers: bots(), seed });
  assert.deepEqual(replay, await runRoyale({ players, controllers: bots(), seed }));
  assert.equal(replay.initial.entrants.length, 5);
  assert.deepEqual(replay.initial.loot.map(i => i.kind).sort(), ['shield', 'supply', 'weapon']);
  assert.ok(replay.beats.length < 110);
  assert.deepEqual(replay.ranking.map(r => r.place), [1, 2, 3, 4, 5]);
  assert.equal(replay.beats.at(-1).entrants.filter(p => p.hp).length, 1);
  const events = replay.beats.flatMap(b => b.events);
  assert.equal(events.filter(e => e.type === 'elimination').length, 4);
  assert.ok(events.some(e => e.type === 'callout'));
  assert.ok(events.some(e => e.type === 'hit'));
  assert.equal(replay.ranking.reduce((sum,r)=>sum+r.kos,0), events.filter(e=>e.type==='elimination'&&e.by).length);
  for (const [i, row] of replay.ranking.entries()) {
    assert.equal(row.points, [10, 7, 5, 3, 1][i] + 2 * row.kos);
  }
  assert.ok(replay.beats.every(b=>b.reason && b.entrants.every(p=>p.hp>=0 && p.hp<=100 && Math.hypot(p.x,p.z)<=replay.islandRadius)));
});

test('campers take storm damage; illegal and timed-out commands become defense', async () => {
  const oldViews = [];
  const replay = await runRoyale({
    players, seed, deadlines: { normal: 30 },
    controllers: players.map((id,i)=>({id, decide: view=>{
      assert.equal(view.you.id,id);
      assert.equal(view.event,'royale');
      oldViews.push(view);
      if(i === 0) return {move:'attack:missing',reason:'不存在'};
      if(i === 1 && view.round === 1) return new Promise(()=>{});
      return {move:'defend',reason:'等待风暴经过',callout:view.you.id};
    }})),
  });
  const beats = replay.beats;
  assert.ok(beats.filter(b=>b.actor===players[0]).every(b=>b.move.id==='defend'&&b.reason.includes('无效')));
  assert.match(beats.find(b=>b.actor===players[1]).reason,/超时/);
  assert.ok(oldViews.every(v=>v.callouts.length===0));
  assert.ok(beats.some(b=>b.events.some(e=>e.type==='storm')));
  assert.ok(beats.some(b=>b.events.some(e=>e.type==='zone')));
  assert.ok(beats.every((b,i)=>b.zone.radius<=(beats[i-1]??replay.initial).zone.radius));
  assert.ok(beats[0].loot.length > 0);
  assert.ok(beats.at(-1).round < 20);
});

test('configured model uses the same decision contract without duel-only rules', async () => {
  const lineup = bots();
  let viewed = 0;
  lineup[0] = liveController('openai:test',{mode:'live',provider:'openai',name:'test',key:'fake',description:'OpenAI'},{
    request: async (_url,{body})=>{
      const prompt=JSON.parse(body).input;
      assert.match(prompt,/机器人混战/);
      assert.doesNotMatch(prompt,/Simultaneous hidden/);
      const view=JSON.parse(prompt.split('View JSON: ')[1]);
      assert.equal(view.event,'royale');
      assert.ok(view.rivals.length>=1);
      assert.ok(view.legalMoves.some(m=>m.id==='defend'));
      viewed++;
      return Response.json({output:[{type:'message',content:[{type:'output_text',text:'{"move":"defend","reason":"暂时防御"}'}]}]});
    },
  });
  const replay = await runRoyale({players, controllers:lineup, seed});
  assert.ok(viewed > 0);
  assert.equal(replay.ranking.find(r=>r.id===players[0]).controller,'openai:test');
});

test('royale route updates separate league and controller ladder standings', async t => {
  const ladder = createLadder({ path: null });
  const server = createArena({ env: {}, ladder, league: { path: null, autostart: false } });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base = 'http://127.0.0.1:'+server.address().port;
  const get = async path => (await fetch(base+path)).json();
  const post = body=>fetch(base+'/api/royale',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({controllers:Array(5).fill('builtin:gpt')})).status,400);
  const reply = await post({seed});
  assert.equal(reply.status,202);
  const { id } = await reply.json();
  assert.equal((await fetch(base+'/api/fights/'+id)).status,404);
  let result;
  for(let i=0;i<100;i++){
    result=await get('/api/royale/'+id);
    if(result.status!=='running')break;
    await delay(10);
  }
  assert.equal(result?.status,'done');
  const {royale} = await get('/api/league');
  const rows = await get('/api/ladder/royale');
  assert.equal(rows.length,5);
  assert.equal(royale.length,5);
  assert.deepEqual(await get('/api/ladder'),[]);
  for(const r of result.replay.ranking){
    assert.deepEqual(rows.find(row=>row.id===r.controller), {id:r.controller,played:1,wins:Number(r.place===1),kos:r.kos,points:r.points});
    assert.deepEqual(royale.find(row=>row.id===r.id), {id:r.id,played:1,wins:Number(r.place===1),kos:r.kos,points:r.points});
  }
  assert.match(await (await fetch(base+'/royale')).text(),/机器人混战/);
});

test('a public royale request cannot trigger paid model calls', async t => {
  let requests = 0;
  const server = createArena({
    env: { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'test-model', LEAGUE_ADMIN_TOKEN: 'test-token' },
    ladder: createLadder({ path: null }),
    request: async () => { requests++; return new Response('',{status:401}); },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const reply = await fetch('http://127.0.0.1:'+server.address().port+'/api/royale',{
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ controllers:['openai:test-model',...players.slice(1).map(p=>'builtin:'+p)] }),
  });
  assert.equal(reply.status,403);
  assert.equal(requests,0);
});

test('a royale finishing during league reset scores on both new boards', async () => {
  const ladder = createLadder({path:null}), resetLadder = ladder.reset;
  const entered = Promise.withResolvers(), resume = Promise.withResolvers();
  ladder.reset = async () => {
    entered.resolve();
    await resume.promise;
    await resetLadder();
  };
  const league = createLeague({ roster:players.map(id=>({id,controller:'builtin:'+id})), path:null, autostart:false, ladder });
  const {ranking} = await runRoyale({players,controllers:bots(),seed});
  const resetting = league.reset();
  await entered.promise;
  const scoring = league.recordRoyale(ranking);
  resume.resolve();
  await Promise.all([resetting,scoring]);
  assert.equal((await ladder.royaleSnapshot()).length,5);
  assert.equal((await league.snapshot()).royale.length,5);
  await league.close();
});
