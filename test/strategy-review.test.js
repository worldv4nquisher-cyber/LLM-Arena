import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {connect} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {createArena} from '../server.js';
import {createLadder} from '../fight-ladder.js';
import {createState,resolveTurn,seededRng} from '../public/strategy-rules.js';

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
