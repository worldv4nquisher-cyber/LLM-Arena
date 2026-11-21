import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { games, newBoard, legalMoves, play } from './public/rules.js';
import { availableModels, demoMove, liveMove, ModelError } from './opponents.js';
import { fighters, simulateFight } from './public/fight-engine.js';
import { randomInt } from 'node:crypto';

const assets = new Map([
  ['/', ['fight.html', 'text/html; charset=utf-8']],
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
  ['/vendor/three.module.js', ['../node_modules/three/build/three.module.js', 'text/javascript; charset=utf-8']],
  ['/arena.css', ['arena.css', 'text/css; charset=utf-8']],
  ['/arena.js', ['arena.js', 'text/javascript; charset=utf-8']],
  ['/rules.js', ['rules.js', 'text/javascript; charset=utf-8']],
  ['/arena.svg', ['arena.svg', 'image/svg+xml']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
]);

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function matchInput(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > 2048) {
      req.resume();
      return null;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return null;
  }
}

export function createArena({ env = process.env, turnDelay, request = fetch } = {}) {
  const models = availableModels(env);
  let liveInProgress = false;

  return createServer(async (req, res) => {
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
    if (req.method === 'GET' && path === '/api/models') {
      return json(res, 200, Object.entries(models).map(([id, { name, description, mode }]) =>
        ({ id, name, description, mode })));
    }
    if (req.method === 'GET' && path === '/api/fighters') return json(res, 200, fighters);
    if (req.method === 'POST' && path === '/api/fights') {
      if (req.headers['sec-fetch-site'] === 'cross-site' || req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        return json(res, 415, { error: '仅接受本站的 JSON 比赛请求。' });
      }
      try {
        const input = await matchInput(req);
        if (!input || typeof input !== 'object') throw new Error('Invalid request');
        const replay = simulateFight({ players: input.players, tactics: input.tactics, seed: input.seed ?? randomInt(0x100000000) });
        return json(res, 200, replay);
      } catch {
        return json(res, 400, { error: '请选择两位有效选手和战术。' });
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  createArena().listen(port, host, () => console.log(`LLM Arena listening on http://${host}:${port}`));
}
