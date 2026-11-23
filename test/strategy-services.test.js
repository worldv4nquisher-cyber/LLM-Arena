import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {availableModels,ModelError} from '../opponents.js';
import {liveController,parseControllerReply,createBuiltinController} from '../fight-controllers.js';
import {runSeries} from '../fight-match.js';
import {createLadder} from '../fight-ladder.js';
import {createArena} from '../server.js';

const env={OPENAI_API_KEY:'test-openai-key',OPENAI_MODEL:'test-o',ANTHROPIC_API_KEY:'test-anthropic-key',ANTHROPIC_MODEL:'test-a'};
function replyFor(view) {
  if(view.phase==='ban')return {ban:view.pool[0].id};
  if(view.phase==='pick')return {picks:view.pool.slice(0,4).map(m=>m.id),ultimate:'nova',custom:{name:'星拳',damage:2,range:['near','mid'],speed:4},reason:'选择均衡组合'};
  if(view.beats)return {notes:'继续观察对手',adjust:'wait'};
  return {move:'rest',reason:'恢复体力',predict:'rest'};
}
function mockProvider(provider,handler=replyFor,seen=[]) {
  return async(url,options)=>{
    const body=JSON.parse(options.body),prompt=body.input||body.messages[0].content;
    const view=JSON.parse(prompt.split('View JSON: ')[1]);
    seen.push({url,options,body,prompt,view});
    const result=await handler(view,seen.length);
    if(result instanceof Response)return result;
    const text=`说明文字\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\``;
    return Response.json(provider==='openai'?{output:[{type:'message',content:[{type:'output_text',text}]}]}:{content:[{type:'text',text}]});
  };
}
const options=controllers=>({players:['gpt','claude'],controllers,games:1,seed:7,deadlines:{normal:100,quick:100}});
test('first JSON object parsing handles fences, nested plans, quoted braces and malformed prefixes',()=>{
  assert.deepEqual(parseControllerReply('prose {bad}\n```json\n{"move":"guard","reason":"括号 } \\\"","plan":[{"if":"near","then":"jab"}]}\n```'),{move:'guard',reason:'括号 } "',plan:[{if:'near',then:'jab'}]});
  assert.deepEqual(parseControllerReply('nothing'),{});
  assert.deepEqual(parseControllerReply(null),{});
  assert.deepEqual(parseControllerReply('{"move":"rest"}{"move":"jab"}'),{move:'rest'});
});
for(const [id,model] of Object.entries(availableModels(env)).filter(([,m])=>m.mode==='live')) {
  test(`${model.provider}: draft/decide/review success, private view and quick prompt`,async()=>{
    const seen=[],controller=liveController(id,model,{request:mockProvider(model.provider,replyFor,seen)});
    const r=await runSeries(options([controller,createBuiltinController('gpt',{seed:3})]));
    assert.equal(r.games[0].stats[0].mistakes,0);
    assert.ok(seen.some(c=>c.view.phase==='ban'));assert.ok(seen.some(c=>c.view.phase==='pick'));assert.ok(seen.some(c=>c.view.beats));
    const decision=seen.find(c=>c.view.legalMoves);
    assert.equal(decision.view.opponent.energy,null);assert.equal(decision.view.opponent.loadout,null);
    assert.match(decision.prompt,/Simultaneous hidden/);assert.match(decision.prompt,/策略格斗/);assert.match(decision.prompt,/legalMoves/);
    await controller.decide({...decision.view,you:{...decision.view.you,budgetLeft:0},legalMoves:decision.view.legalMoves.filter(m=>m.quick)});
    const quick=seen.find(c=>c.view.you?.budgetLeft===0&&c.view.legalMoves);
    assert.ok(quick);assert.match(quick.prompt,/Quick turn/);assert.ok(!quick.prompt.includes('Simultaneous hidden'));
    assert.ok(quick.view.legalMoves.every(m=>m.quick));
    if(model.provider==='openai') {assert.match(decision.url,/\/responses$/);assert.equal(decision.options.headers.Authorization,`Bearer ${model.key}`);assert.equal(quick.body.max_output_tokens,256);assert.equal(decision.body.store,false);}
    else {assert.match(decision.url,/\/messages$/);assert.equal(decision.options.headers['x-api-key'],model.key);assert.equal(decision.options.headers['anthropic-version'],'2023-06-01');assert.equal(quick.body.max_tokens,256);}
  });
  test(`${model.provider}: invalid move and one provider failure stun, three HTTP 401 turns abort`,async()=>{
    let turns=0;
    const request=mockProvider(model.provider,v=>{
      if(v.legalMoves) {turns++;if(turns===1)return {move:'invented',reason:'错误出招'};if(turns===2)return new Response('',{status:503});}
      return replyFor(v);
    });
    const r=await runSeries(options([liveController(id,model,{request}),createBuiltinController('gpt')]));
    const beats=r.games[0].rounds.flatMap(r=>r.beats);
    assert.equal(beats[0].moves[0],'stunned');assert.equal(beats[1].moves[0],'stunned');assert.match(beats[0].mistakes[0],/illegal move/);assert.match(beats[1].mistakes[0],/HTTP 503/);
    assert.ok(r.games[0].stats[0].mistakes>=2);
    let failed=0;
    await assert.rejects(runSeries(options([liveController(id,model,{request:async()=>{failed++;return new Response('sensitive upstream body',{status:401});}}),createBuiltinController('gpt')])),e=>e instanceof ModelError&&/连续三次.*HTTP 401/.test(e.message)&&!e.message.includes('sensitive'));
    assert.equal(failed,5);
  });
}
test('provider network failure maps to ModelError and consecutive counter resets after success',async()=>{
  const model=availableModels(env)['openai:test-o'];
  await assert.rejects(liveController('openai:test-o',model,{request:async()=>{throw new Error('secret network detail');}}).decide({you:{budgetLeft:24}}),e=>e instanceof ModelError&&/无法连接/.test(e.message)&&!e.message.includes('secret'));
  let n=0;
  const request=mockProvider('openai',v=>{if(v.legalMoves&&++n%3!==0)return new Response('',{status:429});return replyFor(v);});
  const replay=await runSeries(options([liveController('openai:test-o',model,{request}),createBuiltinController('gpt')]));
  assert.ok(replay.games.length===1);assert.ok(replay.games[0].stats[0].mistakes>0);
});
test('ladder aggregates weighted counters, persists and restores pair memory, tolerates missing/corrupt/unwritable files',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'strategy-ladder-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'nested','ladder.json'),ladder=createLadder({path});assert.deepEqual(await ladder.snapshot(),[]);
  const r=await runSeries({...options(['gpt','claude'].map(id=>createBuiltinController(id))),games:2});
  await Promise.all([ladder.record(r),ladder.record(r)]);
  const snapshot=await ladder.snapshot();assert.equal(snapshot.length,2);
  for(const row of snapshot){assert.equal(row.games,4);assert.equal(row.wins+row.losses+row.draws,4);assert.equal(row.winRate,row.wins/4);const index=r.controllers.indexOf(row.id),stats=r.series.stats[index];assert.equal(row.mistakeRate,stats.mistakeRate);assert.equal(row.predictionHitRate,stats.predictionHitRate);assert.equal(row.predictionExactHitRate,stats.predictionExactHitRate);assert.equal(row.predictionCategoryHitRate,stats.predictionCategoryHitRate);assert.equal(row.feintSuccessRate,stats.feintSuccessRate);}
  const restored=createLadder({path});assert.deepEqual(await restored.snapshot(),snapshot);
  const legacy=JSON.parse(await readFile(path,'utf8'));
  for(const s of Object.values(legacy.entries))for(const key of ['predictionsScored','predictionsCategoryCorrect','predictionsExactCorrect'])delete s[key];
  const legacyPath=join(dir,'legacy.json');await writeFile(legacyPath,JSON.stringify(legacy));
  const migrated=createLadder({path:legacyPath});assert.ok((await migrated.snapshot()).every(s=>s.predictionCategoryHitRate===0&&s.predictionExactHitRate===0));
  await migrated.record(r);
  for(const row of await migrated.snapshot()){const s=r.series.stats[r.controllers.indexOf(row.id)];assert.equal(row.predictionCategoryHitRate,s.predictionCategoryHitRate);assert.equal(row.predictionExactHitRate,s.predictionExactHitRate);}
  const memory=await restored.memory(r.controllers);assert.equal(memory.length,4);assert.ok(memory[0].opponentMoveFrequencies);assert.deepEqual(await restored.memory(['x','y']),[]);
  const reversed=await restored.memory([...r.controllers].reverse());assert.deepEqual(reversed[0].sides,memory[0].sides.map(i=>1-i));
  const later=await runSeries({...options(['gpt','claude'].map(id=>createBuiltinController(id))),memory});assert.equal(later.memory.length,1);
  const broken=join(dir,'broken.json');await writeFile(broken,'not json');assert.deepEqual(await createLadder({path:broken}).snapshot(),[]);
  const unwritable=createLadder({path:'/dev/null/ladder.json'});await unwritable.record(r);assert.equal((await unwritable.snapshot()).length,2);
});
async function serve(t,options={}) {
  const ladder=options.ladder||createLadder({path:null}),app=createArena({env:{},ladder,...options});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
  const root=`http://127.0.0.1:${app.address().port}`;
  return {root,ladder,post:(path,body,headers={})=>fetch(root+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}),get:path=>fetch(root+path)};
}
async function poll(api,path){for(let i=0;i<500;i++){const r=await api.get(path),job=await r.json();if(job.status!=='running')return job;await delay(2);}throw new Error('job did not finish');}
const input={players:['gpt','claude'],controllers:['builtin:gpt','builtin:claude'],games:1,seed:3};
test('async fight endpoints, validation, ladder round robin, bounded job retention',async t=>{
  const api=await serve(t),list=await api.get('/api/controllers').then(r=>r.json());assert.equal(list.filter(c=>c.mode==='builtin').length,5);assert.ok(list.filter(c=>c.mode==='builtin').every(c=>c.label.includes('内置策略')));assert.ok(list.some(c=>c.id==='demo:flaky'&&c.mode==='demo'));
  assert.deepEqual(await api.get('/api/ladder').then(r=>r.json()),[]);
  for(const bad of [{...input,games:3},{...input,seed:-1},{...input,controllers:['builtin:gpt','bad']},{...input,players:['bad','gpt']},{}])assert.equal((await api.post('/api/fights',bad)).status,400);
  for(const path of ['/api/fights','/api/ladder/run']) {
    assert.equal((await api.post(path,input,{'Sec-Fetch-Site':'cross-site'})).status,415);
    assert.equal((await api.post(path,input,{'Content-Type':'text/plain'})).status,415);
    assert.equal((await api.post(path,input,{Origin:'https://evil.test'})).status,415);
  }
  const response=await api.post('/api/fights',input);assert.equal(response.status,202);const {id}=await response.json();
  const job=await poll(api,`/api/fights/${id}`);assert.equal(job.status,'done');assert.equal(job.replay.seed,3);assert.ok(job.progress.turn>0);
  assert.equal((await api.get('/api/ladder').then(r=>r.json())).length,2);
  assert.equal((await api.get('/api/fights/missing')).status,404);
  assert.equal((await api.post('/api/ladder/run',{games:0})).status,400);
  const run=await api.post('/api/ladder/run',{games:1});assert.equal(run.status,202);const ladderId=(await run.json()).id;
  const result=await poll(api,`/api/ladder/run/${ladderId}`);assert.equal(result.status,'done');assert.equal(result.result.games,10);
  const rows=await api.get('/api/ladder').then(r=>r.json());assert.equal(rows.length,5);assert.equal(rows.reduce((n,s)=>n+s.games,0),22);
  for(let n=0;n<20;n++){const r=await api.post('/api/fights',input);assert.equal(r.status,202);await poll(api,`/api/fights/${(await r.json()).id}`);}
  assert.equal((await api.get(`/api/fights/${id}`)).status,404);
});
test('fault rehearsal is an opt-in server-computed match with referee mistake metadata',async t=>{
  const api=await serve(t);
  const response=await api.post('/api/fights',{...input,controllers:['demo:flaky','builtin:claude'],seed:2});
  assert.equal(response.status,202);
  const job=await poll(api,`/api/fights/${(await response.json()).id}`);
  assert.equal(job.status,'done');
  const beat=job.replay.games[0].rounds[0].beats[0];
  assert.equal(beat.mistakes[0],'illegal move');
  assert.equal(beat.actions[0],'stunned');
  assert.ok(job.replay.series.stats[0].mistakeRate>0);
});
test('configured live controller listing hides secrets, live concurrency cap, 401 abort does not touch ladder',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const api=await serve(t,{env,request:async()=>{await gate;return new Response('private response',{status:401});}});
  const listing=await api.get('/api/controllers').then(r=>r.text());assert.ok(listing.includes('openai:test-o'));assert.ok(listing.includes('anthropic:test-a'));assert.ok(!listing.includes('test-openai-key'));assert.ok(!listing.includes('test-anthropic-key'));
  const body={...input,controllers:['openai:test-o','builtin:gpt']};
  const first=await api.post('/api/fights',body);assert.equal(first.status,202);
  assert.equal((await api.post('/api/fights',body)).status,429);release();
  const job=await poll(api,`/api/fights/${(await first.json()).id}`);assert.equal(job.status,'error');assert.match(job.error,/HTTP 401/);assert.match(job.error,/未计入战绩/);assert.ok(!JSON.stringify(job).includes('private response'));
  assert.deepEqual(await api.get('/api/ladder').then(r=>r.json()),[]);
  const second=await api.post('/api/fights',body);assert.equal(second.status,202);await poll(api,`/api/fights/${(await second.json()).id}`);
});
