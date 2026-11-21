import { once } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import { games, newBoard, play, legalMoves } from '../public/rules.js';
import { availableModels, demoMove, parseMove } from '../opponents.js';
import { createArena } from '../server.js';

function playSequence(game, moves) {
  let state = { board: newBoard(game) };
  for (const [i, move] of moves.entries()) state = play(game, state.board, i % 2 + 1, move);
  return state;
}

test('tic-tac-toe detects diagonals and draws, and rejects occupied cells', () => {
  const game = games['tic-tac-toe'];
  const win = playSequence(game, [1, 2, 5, 4, 9]);
  assert.equal(win.winner, 1);
  assert.deepEqual(win.line, [[0, 0], [1, 1], [2, 2]]);
  const draw = playSequence(game, [1, 2, 3, 5, 4, 6, 8, 7, 9]);
  assert.equal(draw.winner, 0);
  assert.throws(() => play(game, win.board, 2, 5), /Illegal move/);
});

test('connect four applies gravity and detects horizontal, vertical and diagonal wins', () => {
  const game = games['connect-four'];
  const horizontal = playSequence(game, [1, 1, 2, 2, 3, 3, 4]);
  assert.deepEqual(horizontal.line, [[5, 0], [5, 1], [5, 2], [5, 3]]);
  assert.equal(playSequence(game, [1, 2, 1, 2, 1, 2, 1]).winner, 1);
  const diagonal = playSequence(game, [1, 2, 2, 3, 7, 3, 3, 4, 7, 4, 6, 4, 4]);
  assert.equal(diagonal.winner, 1);
  assert.equal(diagonal.line.length, 4);
  const filled = playSequence(game, [4, 4, 4, 4, 4, 4]);
  assert(!legalMoves(game, filled.board).includes(4));
});

test('tactical opponent blocks an immediate loss and takes a winning move', () => {
  const game = games['tic-tac-toe'];
  const blocked = playSequence(game, [4, 1, 8, 2]);
  assert.equal(demoMove('tactician', game, blocked.board, 1), 3);
  const win = playSequence(game, [1, 4, 2, 5]);
  assert.equal(demoMove('tactician', game, win.board, 1), 3);
});

async function server(t, options = {}) {
  const app = createArena({ env: {}, turnDelay: 0, ...options });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  return `http://127.0.0.1:${app.address().port}`;
}

function match(url, game, players, options = {}) {
  return fetch(`${url}/api/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ game, players }),
    ...options,
  });
}

async function events(response) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /x-ndjson/);
  return (await response.text()).trim().split('\n').map(line => JSON.parse(line));
}

test('serves the arena, hides unconfigured models, and rejects invalid requests', async t => {
  const url = await server(t);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /开始对局/);
  assert.equal((await fetch(`${url}/server.js`)).status, 404);
  const models = await (await fetch(`${url}/api/models`)).json();
  assert.equal(models.length, 3);
  assert(models.every(model => model.mode === 'demo'));
  assert.equal((await match(url, '__proto__', ['tactician', 'striker'])).status, 400);
  assert.equal((await match(url, 'tic-tac-toe', ['tactician', 'openai'])).status, 400);
  assert.equal((await match(url, 'tic-tac-toe', ['tactician', 'striker'], {
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
  })).status, 415);
});

for (const [gameId, game] of Object.entries(games)) {
  test(`streams a legal complete ${gameId} demo match`, async t => {
    const url = await server(t);
    const transcript = await events(await match(url, gameId, ['tactician', 'striker']));
    let next = { board: newBoard(game), winner: null };
    let turn = 0;
    for (const event of transcript.filter(item => item.type === 'move')) {
      assert.equal(next.winner, null);
      assert.equal(event.player, turn % 2 + 1);
      assert.equal(event.turn, ++turn);
      next = play(game, next.board, event.player, event.move);
      assert.equal(event.row, next.row);
      assert.equal(event.col, next.col);
    }
    assert.notEqual(next.winner, null);
    assert.deepEqual(transcript.at(-1), { type: 'result', winner: next.winner, line: next.line });
  });
}

const env = {
  OPENAI_API_KEY: 'mock-openai-key', OPENAI_MODEL: 'mock-openai-model',
  ANTHROPIC_API_KEY: 'mock-anthropic-key', ANTHROPIC_MODEL: 'mock-anthropic-model',
};

test('two live adapters play from model moves and forfeit an illegal move', async t => {
  const calls = [];
  const url = await server(t, {
    env,
    request: async (endpoint, options) => {
      calls.push({ endpoint, ...options });
      if (endpoint.includes('openai')) return Response.json({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"move":1}' }] }],
      });
      return Response.json({ content: [{ type: 'text', text: '{"move":5}' }] });
    },
  });
  const models = await (await fetch(`${url}/api/models`)).json();
  assert.equal(models.filter(model => model.mode === 'live').length, 2);
  assert(!JSON.stringify(models).includes('mock-openai-key'));
  assert(!JSON.stringify(models).includes('mock-anthropic-key'));
  const transcript = await events(await match(url, 'tic-tac-toe',
    ['openai:mock-openai-model', 'anthropic:mock-anthropic-model']));
  assert.deepEqual(transcript.filter(entry => entry.type === 'move').map(entry => entry.move), [1, 5]);
  assert.deepEqual(transcript.at(-1), { type: 'result', winner: 2, reason: 'illegal-move' });
  assert.deepEqual(calls.map(call => call.endpoint), [
    'https://api.openai.com/v1/responses',
    'https://api.anthropic.com/v1/messages',
    'https://api.openai.com/v1/responses',
  ]);
  assert.equal(calls[0].headers.Authorization, 'Bearer mock-openai-key');
  assert.equal(calls[1].headers['x-api-key'], 'mock-anthropic-key');
  assert.match(JSON.parse(calls[1].body).messages[0].content, /Legal moves: 2, 3, 4, 5, 6, 7, 8, 9/);
});

test('provider errors are not wins, name the failing side and do not leak the upstream response', async t => {
  t.mock.method(console, 'error', () => {});
  const url = await server(t, { env, request: async () => new Response('private error', { status: 401 }) });
  const transcript = await events(await match(url, 'tic-tac-toe', ['striker', 'openai:mock-openai-model']));
  assert.deepEqual(transcript.map(event => event.type), ['turn', 'move', 'turn', 'error']);
  assert.equal(transcript.at(-1).player, 2);
  assert.match(transcript.at(-1).message, /^蓝方「mock-openai-model」API 密钥无效/);
  assert(!JSON.stringify(transcript).includes('private error'));
});

test('explains rate limits, unknown models, truncated output and timeouts', async t => {
  t.mock.method(console, 'error', () => {});
  const cases = [
    [async () => new Response('', { status: 429 }), /红方「mock-openai-model」请求过于频繁或额度不足/],
    [async () => new Response('', { status: 404 }), /找不到模型「mock-openai-model」/],
    [async () => Response.json({ status: 'incomplete', output: [{ type: 'reasoning' }] }), /输出达到长度上限/],
    [async (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
      /红方「mock-openai-model」1 秒内未响应/],
    [async () => { throw new TypeError('fetch failed'); }, /无法连接 OpenAI 服务/],
  ];
  for (const [request, message] of cases) {
    const url = await server(t, { env: { ...env, MODEL_TIMEOUT_SECONDS: '1' }, request });
    const transcript = await events(await match(url, 'tic-tac-toe', ['openai:mock-openai-model', 'striker']));
    assert.equal(transcript.at(-1).type, 'error');
    assert.match(transcript.at(-1).message, message);
  }
});

test('lists several models per provider and reads moves wrapped in Markdown', () => {
  const models = availableModels({ OPENAI_API_KEY: 'key', OPENAI_MODEL: 'gpt-a, gpt-b,,gpt-a', ANTHROPIC_MODEL: 'no-key' });
  assert.deepEqual(Object.keys(models).filter(id => models[id].mode === 'live'), ['openai:gpt-a', 'openai:gpt-b']);
  assert.equal(parseMove('```json\n{"move": 4}\n```'), 4);
  assert.equal(parseMove('I will play {"move":7}.'), 7);
  assert.equal(parseMove('column three'), null);
});
