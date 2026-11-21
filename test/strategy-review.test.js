import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {connect} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {createArena} from '../server.js';
import {createLadder} from '../fight-ladder.js';

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
