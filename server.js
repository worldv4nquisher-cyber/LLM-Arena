import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { games, newBoard, legalMoves, play } from './public/rules.js';
import { availableModels, demoMove, liveMove, ModelError } from './opponents.js';
import { fighters } from './public/fight-engine.js';
import { randomInt, randomUUID } from 'node:crypto';
import { createBuiltinController, createFlakyController, personalities, liveController } from './fight-controllers.js';
import { runSeries } from './fight-match.js';
import { createLadder } from './fight-ladder.js';
import { createLeague } from './fight-league.js';
import { createDanmaku } from './fight-danmaku.js';
import { runRoyale } from './royale-match.js';
import { defaultRoyalePlayers } from './royale-standings.js';

const assets = new Map([
  ['/', ['fight.html', 'text/html; charset=utf-8']],
  ['/royale', ['royale.html', 'text/html; charset=utf-8']],
  ['/royale.js', ['royale.js', 'text/javascript; charset=utf-8']],
  ['/royale-scene.js', ['royale-scene.js', 'text/javascript; charset=utf-8']],
  ['/royale.css', ['royale.css', 'text/css; charset=utf-8']],
  ['/classic', ['index.html', 'text/html; charset=utf-8']],
  ['/fight.css', ['fight.css', 'text/css; charset=utf-8']],
  ['/fight.js', ['fight.js', 'text/javascript; charset=utf-8']],
  ['/fight-scene.js', ['fight-scene.js', 'text/javascript; charset=utf-8']],
  ['/fight-choreography.js', ['fight-choreography.js', 'text/javascript; charset=utf-8']],
  ['/fight-stage.js', ['fight-stage.js', 'text/javascript; charset=utf-8']],
  ['/fight-audio.js', ['fight-audio.js', 'text/javascript; charset=utf-8']],
  ['/fight-models.js', ['fight-models.js', 'text/javascript; charset=utf-8']],
  ['/fight-engine.js', ['fight-engine.js', 'text/javascript; charset=utf-8']],
  ['/fight-broadcast.js', ['fight-broadcast.js', 'text/javascript; charset=utf-8']],
  ['/fight-broadcast.css', ['fight-broadcast.css', 'text/css; charset=utf-8']],
  ['/fight-spectator.js', ['fight-spectator.js', 'text/javascript; charset=utf-8']],
  ['/fight-spectator.css', ['fight-spectator.css', 'text/css; charset=utf-8']],
  ['/fighter', ['fighter.html', 'text/html; charset=utf-8']],
  ['/replays', ['replays.html', 'text/html; charset=utf-8']],
  ['/league.css', ['league.css', 'text/css; charset=utf-8']],
  ['/league-ui.js', ['league-ui.js', 'text/javascript; charset=utf-8']],
  ['/fighter.js', ['fighter.js', 'text/javascript; charset=utf-8']],
  ['/replays.js', ['replays.js', 'text/javascript; charset=utf-8']],
  ['/vendor/three.module.js', ['../node_modules/three/build/three.module.js', 'text/javascript; charset=utf-8']],
  ['/arena.css', ['arena.css', 'text/css; charset=utf-8']],
  ['/arena.js', ['arena.js', 'text/javascript; charset=utf-8']],
  ['/rules.js', ['rules.js', 'text/javascript; charset=utf-8']],
  ['/strategy-rules.js', ['strategy-rules.js', 'text/javascript; charset=utf-8']],
  ['/arena.svg', ['arena.svg', 'image/svg+xml']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
]);

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

const validSpectator = id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);

async function matchInput(req) {
  const chunks = [];
  let length = 0;
  try {
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      length += chunk.length;
      if (length > 2048) {
        req.resume();
        return null;
      }
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return null;
  }
}

export function createArena({ env = process.env, turnDelay, request = fetch, ladder = createLadder(), deadlines, league: leagueOptions } = {}) {
  const models = availableModels(env);
  let liveInProgress = false;
  const controllers = [
    ...personalities.map(id => ({id:`builtin:${id}`, label:`内置策略 ${id}`, mode:'builtin'})),
    {id:'demo:flaky',label:'故障演练 · GPT（偶发非法招式）',mode:'demo'},
    ...Object.entries(models).filter(([,m])=>m.mode==='live').map(([id,m])=>({id,label:`${m.description} ${m.name}`,mode:'live'})),
  ];
  const jobs = new Map();
  const validJSON = req => req.headers['sec-fetch-site'] !== 'cross-site' &&
    req.headers['content-type']?.split(';')[0].trim() === 'application/json' &&
    (!req.headers.origin || req.headers.origin === `http://${req.headers.host}` || req.headers.origin === `https://${req.headers.host}`);
  function reserveJob(event) {
    while(jobs.size>=20) {
      const finished=[...jobs].find(([,job])=>job.status!=='running');
      if(!finished)return null;
      jobs.delete(finished[0]);
    }
    const id=randomUUID(),job={status:'running',progress:{game:0,round:0,turn:0},...(event?{event}:{})};
    jobs.set(id,job);return {id,job};
  }
  const brain=(id,seed)=>id==='demo:flaky'?createFlakyController({seed}):id.startsWith('builtin:')?createBuiltinController(id.slice(8),{seed}):liveController(id,models[id],{request});
  async function compute(input,job) {
    const replay=await runSeries({...input,controllers:input.controllers.map(id=>brain(id,input.seed)),memory:await ladder.memory(input.controllers),deadlines,onProgress:p=>{job.progress=p;}});
    await ladder.record(replay);return replay;
  }
  const leagueRoster=()=>{
    const custom=Object.fromEntries(String(env.LEAGUE_ROSTER||'').split(',').map(x=>x.trim().split('=')).filter(([f,c])=>c&&personalities.includes(f)&&controllers.some(x=>x.id===c)));
    return personalities.map(id=>({id,controller:custom[id]||`builtin:${id}`}));
  };
  const league=leagueOptions?createLeague({roster:leagueRoster,ladder,...leagueOptions,run:async input=>{
    const isLive=input.controllers.some(id=>models[id]?.mode==='live');
    if(isLive&&liveInProgress)throw Object.assign(new Error('busy'),{retry:true});
    if(isLive)liveInProgress=true;
    try{return await compute(input,{progress:{}});}
    catch(error){throw new Error(error instanceof ModelError?error.message:'比赛计算失败。');}
    finally{if(isLive)liveInProgress=false;}
  }}):null;
  const danmaku=league?createDanmaku(league,leagueOptions.now):null;
  const leagueRoute=async(req,res,path)=>{
    if(!league)return json(res,404,{error:'联赛未启用。'});
    const query=new URL(req.url,'http://local').searchParams;
    if(req.method==='GET'&&path==='/api/league'){
      const spectator=query.get('spectator');
      return json(res,200,await league.snapshot(validSpectator(spectator)?spectator:undefined));
    }
    if(req.method==='GET'&&path==='/api/league/matches'){
      const season=query.has('season')?Number(query.get('season')):undefined,fighter=query.get('fighter')||undefined;
      if(season!==undefined&&!Number.isSafeInteger(season))return json(res,400,{error:'赛季无效。'});
      return json(res,200,await league.library({season,fighter}));
    }
    let m;
    if((m=/^\/api\/league\/matches\/([\w-]{1,40})\/(prediction|danmaku)$/.exec(path))){
      const [,id,kind]=m;
      if(req.method==='GET'&&kind==='danmaku'){
        if(req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'仅接受本站的请求。'});
        return danmaku.stream(id,req.socket.remoteAddress,res);
      }
      if(req.method==='POST'){
        if(!validJSON(req))return json(res,415,{error:'仅接受本站的 JSON 请求。'});
        const input=await matchInput(req);
        if(!validSpectator(input?.spectator))return json(res,400,{error:'观众标识无效。'});
        if(kind==='prediction'&&input.side!==0&&input.side!==1)return json(res,400,{error:'请选择一位选手。'});
        const {status,data}=kind==='prediction'?await league.predict(id,input.spectator,input.side):
          await danmaku.send(id,input.spectator,req.socket.remoteAddress,input.text);
        return json(res,status,data);
      }
    }
    if(req.method==='GET'&&(m=/^\/api\/league\/matches\/([\w-]{1,40})$/.exec(path))){const found=await league.match(m[1]);return json(res,found?200:404,found||{error:'找不到联赛比赛。'});}
    if(req.method==='GET'&&(m=/^\/api\/league\/fighters\/([\w-]{1,40})$/.exec(path))){const found=await league.fighter(m[1]);return json(res,found?200:404,found||{error:'找不到选手。'});}
    if(req.method==='POST'&&path==='/api/league/reset'){
      if(!validJSON(req))return json(res,415,{error:'仅接受本站的 JSON 请求。'});
      const token=env.LEAGUE_ADMIN_TOKEN;
      if(!token||req.headers.authorization!==`Bearer ${token}`)return json(res,403,{error:'需要联赛管理员令牌。'});
      await league.reset();return json(res,200,{ok:true});
    }
    return json(res,404,{error:'未找到。'});
  };

  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
    const path = req.url?.split('?')[0];
    const asset = assets.get(path);
    if (req.method === 'GET' && asset) {
      try {
        const contents = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': asset[1] });
        res.end(contents);
      } catch {
        json(res, 500, { error: '无法载入页面。' });
      }
      return;
    }
    if (path === '/api/league' || path?.startsWith('/api/league/')) return leagueRoute(req, res, path);
    if (req.method === 'GET' && path === '/api/models') {
      return json(res, 200, Object.entries(models).map(([id, { name, description, mode }]) =>
        ({ id, name, description, mode })));
    }
    if (req.method === 'GET' && path === '/api/fighters') return json(res, 200, fighters);
    if (req.method === 'GET' && path === '/api/controllers') return json(res, 200, controllers);
    if (req.method === 'GET' && path === '/api/ladder') return json(res, 200, await ladder.snapshot());
    if (req.method === 'GET' && path === '/api/ladder/royale') return json(res, 200, await ladder.royaleSnapshot());
    if (req.method === 'GET' && /^\/api\/royale\/[^/]+$/.test(path)) {
      const job=jobs.get(path.split('/').at(-1));
      return job?.event==='royale'?json(res,200,job):json(res,404,{error:'找不到混战任务。'});
    }
    if (req.method === 'POST' && path === '/api/royale') {
      if(!validJSON(req))return json(res,415,{error:'仅接受本站的 JSON 比赛请求。'});
      const input=await matchInput(req);
      const seed=input?.seed??randomInt(0x100000000);
      const ids=input?.controllers??defaultRoyalePlayers.map(id=>'builtin:'+id);
      if(!input||typeof input!=='object'||Array.isArray(input)||!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff||
        !Array.isArray(ids)||ids.length!==5||new Set(ids).size!==5||!ids.every(id=>controllers.some(c=>c.id===id&&c.mode!=='demo'))) {
        return json(res,400,{error:'混战需要五位不同的有效控制器和有效种子。'});
      }
      const isLive=ids.some(id=>models[id]?.mode==='live');
      if(isLive&&liveInProgress)return json(res,429,{error:'已有真实模型对局进行中，请稍后再试。'});
      const reserved=reserveJob('royale');
      if(!reserved)return json(res,429,{error:'比赛任务已满，请稍后重试。'});
      const {id,job}=reserved;
      if(isLive)liveInProgress=true;
      setImmediate(async()=>{
        try {
          const replay=await runRoyale({players:defaultRoyalePlayers,controllers:ids.map(c=>brain(c,seed)),seed,deadlines,onProgress:p=>{job.progress=p;}});
          await Promise.all([ladder.recordRoyale(replay.ranking),league?.recordRoyale(replay.ranking)]);
          job.replay=replay;job.status='done';
        }catch(error){job.status='error';job.error=error instanceof ModelError?error.message:'混战计算失败。';}
        finally{if(isLive)liveInProgress=false;}
      });
      return json(res,202,{id});
    }
    if (req.method === 'GET' && (/^\/api\/fights\/[^/]+$/.test(path)||/^\/api\/ladder\/run\/[^/]+$/.test(path))) {
      const job=jobs.get(path.split('/').at(-1));
      return job&&!job.event?json(res,200,job):json(res,404,{error:'找不到比赛任务。'});
    }
    if(req.method==='POST' && path==='/api/ladder/run') {
      if(!validJSON(req))return json(res,415,{error:'仅接受本站的 JSON 比赛请求。'});
      const input=await matchInput(req),count=input?.games??2;
      if(!input||typeof input!=='object'||Array.isArray(input)||!Number.isInteger(count)||count<1||count>20)return json(res,400,{error:'场数必须为1到20。'});
      const reserved=reserveJob();if(!reserved)return json(res,429,{error:'比赛任务已满，请稍后重试。'});
      const {id,job}=reserved;
      setImmediate(async()=>{
        try {
          let completed=0;
          for(let a=0;a<personalities.length;a++)for(let b=a+1;b<personalities.length;b++) {
            const players=[personalities[a],personalities[b]];
            await compute({players,controllers:players.map(p=>`builtin:${p}`),games:count,seed:randomInt(0x100000000)},job);
            job.progress={...job.progress,completed:++completed,total:10};
          }
          job.status='done';job.result={completed,games:completed*count};
        }catch{job.status='error';job.error='天梯运行失败。';}
      });
      return json(res,202,{id});
    }
    if (req.method === 'POST' && path === '/api/fights') {
      if (!validJSON(req)) {
        return json(res, 415, { error: '仅接受本站的 JSON 比赛请求。' });
      }
      try {
        const input = await matchInput(req);
        if (!input || !Array.isArray(input.players)||input.players.length!==2||!input.players.every(id=>fighters.some(f=>f.id===id)) ||
            !Array.isArray(input.controllers)||input.controllers.length!==2||!input.controllers.every(id=>controllers.some(c=>c.id===id)) ||
            ![1,2,4].includes(input.games??2) || (input.seed!==undefined&&(!Number.isSafeInteger(input.seed)||input.seed<0||input.seed>0xffffffff))) throw new Error('Invalid request');
        const isLive=input.controllers.some(id=>models[id]?.mode==='live');
        if(isLive&&liveInProgress)return json(res,429,{error:'已有真实模型对局进行中，请稍后再试。'});
        const reserved=reserveJob();if(!reserved)return json(res,429,{error:'比赛任务已满，请稍后重试。'});
        const {id,job}=reserved;
        if(isLive)liveInProgress=true;
        setImmediate(async()=>{
          try {
            job.replay=await compute({players:input.players,controllers:input.controllers,games:input.games??2,seed:input.seed??randomInt(0x100000000)},job);
            job.status='done';
          }catch(error){job.status='error';job.error=error instanceof ModelError?error.message:'比赛计算失败。';}
          finally{if(isLive)liveInProgress=false;}
        });
        return json(res, 202, {id});
      } catch {
        return json(res, 400, { error: '请选择两位有效选手、控制器及场数（1、2、4）。' });
      }
    }
    if (req.method !== 'POST' || path !== '/api/matches') return json(res, 404, { error: '未找到。' });
    if (req.headers['sec-fetch-site'] === 'cross-site' ||
        req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
      return json(res, 415, { error: '仅接受本站的 JSON 对局请求。' });
    }

    let input;
    try {
      input = await matchInput(req);
    } catch {
      return;
    }
    if (typeof input?.game !== 'string' || !Object.hasOwn(games, input.game) ||
        !Array.isArray(input.players) || input.players.length !== 2 ||
        !input.players.every(id => typeof id === 'string' && Object.hasOwn(models, id))) {
      return json(res, 400, { error: '请选择有效的游戏和两位选手。' });
    }
    const isLive = input.players.some(id => models[id].mode === 'live');
    const playbackDelay = turnDelay ?? (isLive ? 430 : 1000);
    if (isLive && liveInProgress) return json(res, 429, { error: '已有真实模型对局进行中，请稍后再试。' });
    if (isLive) liveInProgress = true;

    const controller = new AbortController();
    const { signal } = controller;
    res.on('close', () => controller.abort());
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
    const send = event => res.write(JSON.stringify(event) + '\n');
    const game = games[input.game];
    let board = newBoard(game);
    let turn = 0;
    let player = 1;
    const sides = ['红方', '蓝方'];
    try {
      while (!signal.aborted) {
        const id = input.players[player - 1];
        const model = models[id];
        send({ type: 'turn', player });
        const response = model.mode === 'demo' ? { move: demoMove(id, game, board, player) } :
          await liveMove(id, model, game, board, player, signal, request);
        const { move, raw } = response;
        await delay(playbackDelay, undefined, { signal });
        if (!legalMoves(game, board).includes(move)) {
          const unit = game.gravity ? '列' : '格';
          const detail = move === null ? `无法解析：${JSON.stringify(raw.slice(0, 80))}` :
            move < 1 || move > (game.gravity ? game.columns : game.rows * game.columns) ?
              `落子 ${move} 超出范围` : `第 ${move} ${unit}${game.gravity ? '已满' : '已被占用'}`;
          send({ type: 'result', winner: 3 - player, reason: 'illegal-move', invalidPlayer: player, detail });
          break;
        }
        const next = play(game, board, player, move);
        board = next.board;
        send({ type: 'move', turn: ++turn, player, move, row: next.row, col: next.col });
        if (next.winner !== null) {
          send({ type: 'result', winner: next.winner, line: next.line });
          break;
        }
        player = 3 - player;
      }
    } catch (error) {
      if (!signal.aborted) {
        const model = models[input.players[player - 1]];
        const reason = error instanceof ModelError ? error.message : '模型连接失败';
        console.error(`[${model.description ?? model.name}] ${model.name}: ${error.detail ?? error.message}`);
        send({ type: 'error', player,
          message: `${sides[player - 1]}「${model.name}」${reason}。本场未计入战绩。` });
      }
    } finally {
      if (isLive) liveInProgress = false;
      res.end();
    }
  });
  server.league = league;
  if (league) server.on('close', () => league.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  createArena({ league: process.env.LEAGUE === 'off' ? undefined : {} }).listen(port, host, () => console.log(`LLM Arena listening on http://${host}:${port}`));
}
