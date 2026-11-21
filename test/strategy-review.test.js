import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {connect} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {createArena} from '../server.js';
import {createLadder} from '../fight-ladder.js';
import {createState,resolveTurn,seededRng} from '../public/strategy-rules.js';

function providerReply(view) {
  if(view.phase==='ban')return {ban:view.pool[0].id};
  if(view.phase==='pick')return {picks:view.pool.slice(0,4).map(m=>m.id),ultimate:'nova',custom:{name:'拳',damage:2,speed:4,range:['near','mid']}};
  if(view.beats)return {notes:'复盘',adjust:'wait'};
  return {move:'rest',reason:'休息'};
}

function resolve(cells,moves,energy=0) {
  const state=createState([['drain'],['drain']]);
  state.fighters.forEach((f,i)=>{f.cell=cells[i];f.energy=Array.isArray(energy)?energy[i]:energy;});
  return resolveTurn(state,moves.map(move=>({move})),seededRng(1));
}

test('disconnected uploads cannot reject body reads out of any POST route',async t=>{
  const app=createArena({env:{},ladder:createLadder({path:null})});
  app.listen(0,'127.0.0.1');await once(app,'listening');
  t.after(()=>new Promise(resolve=>app.close(resolve)));
  for(const path of ['/api/ladder/run','/api/fights','/api/matches']) {
    const received=once(app,'request');
    const socket=connect(app.address().port,'127.0.0.1');await once(socket,'connect');
    socket.write(`POST ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"`);
    const [req]=await received;
    const aborted=once(req,'aborted');
    socket.destroy();await aborted;await delay(10);
    assert.equal((await fetch(`http://127.0.0.1:${app.address().port}/api/controllers`)).status,200);
  }
});

test('collision resolution never displaces a stationary opponent',()=>{
  assert.deepEqual(resolve([2,4],['dash','guard']).beat.cells,[3,4]);
  assert.deepEqual(resolve([2,4],['guard','dash']).beat.cells,[2,3]);
  assert.deepEqual(resolve([0,1],['guard','step_in']).beat.cells,[0,1]);
  assert.deepEqual(resolve([7,8],['step_in','rest']).beat.cells,[7,8]);
  assert.deepEqual(resolve([2,4],['dash','dash']).beat.cells,[2,3]);
  assert.deepEqual(resolve([2,4],['step_back','rest']).beat.cells,[1,4]);
});

test('drain trades use pre-hit energy and settle gains and losses simultaneously',()=>{
  for(const energy of [0,10,90]) {
    const result=resolve([2,4],['drain','drain'],energy);
    assert.deepEqual(result.state.fighters.map(f=>f.energy),[Math.min(100,energy+12),Math.min(100,energy+12)]);
  }
  const a=resolve([2,4],['drain','drain'],[0,20]).state.fighters.map(f=>f.energy);
  const b=resolve([2,4],['drain','drain'],[20,0]).state.fighters.map(f=>f.energy);
  assert.deepEqual(a,[27,17]);assert.deepEqual(a,b.reverse());
  assert.deepEqual(resolve([0,8],['drain','drain']).state.fighters.map(f=>f.energy),[4,4]);
});

test('provider abort cancels its peer and keeps the live slot until paid cleanup settles',async t=>{
  const third=Promise.withResolvers(),cleanup=Promise.withResolvers();
  let failingTurns=0,peerTurns=0,aborted=false,active=0;
  t.after(()=>cleanup.resolve());
  const request=async(url,options)=>{
    const openai=url.includes('openai'),body=JSON.parse(options.body),view=JSON.parse((body.input||body.messages[0].content).split('View JSON: ')[1]);
    if(view.legalMoves) {
      if(openai){failingTurns++;return new Response('',{status:401});}
      if(++peerTurns===3) {
        active++;third.resolve();
        options.signal.addEventListener('abort',()=>{aborted=true;},{once:true});
        try{await cleanup.promise;}finally{active--;}
      }
    }
    const text=JSON.stringify(providerReply(view));
    return Response.json(openai?{output:[{type:'message',content:[{type:'output_text',text}]}]}:{content:[{type:'text',text}]});
  };
  const ladder=createLadder({path:null}),app=createArena({env:{OPENAI_API_KEY:'test',OPENAI_MODEL:'o',ANTHROPIC_API_KEY:'test',ANTHROPIC_MODEL:'a'},request,ladder,deadlines:{normal:1000,quick:1000}});
  app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
  const root=`http://127.0.0.1:${app.address().port}`,body={players:['gpt','claude'],controllers:['openai:o','anthropic:a'],games:1,seed:1};
  const post=()=>fetch(root+'/api/fights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const first=await post();assert.equal(first.status,202);const {id}=await first.json();
  await third.promise;await delay(10);
  assert.equal(failingTurns,3);assert.equal(aborted,true);assert.equal(active,1);
  assert.equal((await fetch(root+`/api/fights/${id}`).then(r=>r.json())).status,'running');
  assert.equal((await post()).status,429);
  cleanup.resolve();let job;
  for(let i=0;i<200;i++){job=await fetch(root+`/api/fights/${id}`).then(r=>r.json());if(job.status!=='running')break;await delay(2);}
  assert.equal(job.status,'error');assert.match(job.error,/HTTP 401/);assert.equal(active,0);
  assert.deepEqual(await ladder.snapshot(),[]);assert.equal((await post()).status,202);
});
