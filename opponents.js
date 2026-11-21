import { legalMoves, play } from './public/rules.js';

export const demoModels = {
  tactician: { name: '赤焰', description: '攻守兼备' },
  striker: { name: '霜刃', description: '专注进攻' },
  wildcard: { name: '流星', description: '随机落子' },
};

function attackScore(game, board, player, row, col) {
  let score = 0;
  for (const [dy, dx] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    for (let offset = 0; offset < game.target; offset++) {
      let count = 0;
      for (let step = -offset; step < game.target - offset; step++) {
        const cell = board[row + step * dy]?.[col + step * dx];
        if (cell == null || (cell && cell !== player)) {
          count = 0;
          break;
        }
        if (cell === player) count++;
      }
      score += count ** 2;
    }
  }
  return score;
}

export function demoMove(model, game, board, player, random = Math.random) {
  const moves = legalMoves(game, board);
  if (model === 'wildcard') return moves[Math.floor(random() * moves.length)];
  const enemy = 3 - player;
  const winning = moves.find(move => play(game, board, player, move).winner === player);
  if (winning != null) return winning;

  return moves.map(move => {
    const next = play(game, board, player, move);
    const threatened = model === 'tactician' && legalMoves(game, next.board)
      .some(reply => play(game, next.board, enemy, reply).winner === enemy);
    const score = attackScore(game, next.board, player, next.row, next.col);
    return { move, score: score - (threatened ? 1000 : 0) + random() };
  }).sort((a, b) => b.score - a.score)[0].move;
}

const providers = [
  ['openai', 'OpenAI', 'OPENAI_API_KEY', 'OPENAI_MODEL'],
  ['anthropic', 'Anthropic', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'],
];

export function availableModels(env) {
  const models = Object.fromEntries(Object.entries(demoModels).map(([id, model]) => [id, { ...model, mode: 'demo' }]));
  const seconds = Number(env.MODEL_TIMEOUT_SECONDS);
  const timeout = (Number.isFinite(seconds) && seconds > 0 ? seconds : 30) * 1000;
  for (const [provider, description, keyName, modelName] of providers) {
    const key = env[keyName]?.trim();
    const names = [...new Set((env[modelName] ?? '').split(',').map(name => name.trim()).filter(Boolean))];
    if (!key) continue;
    for (const name of names) models[`${provider}:${name}`] = { mode: 'live', provider, description, key, name, timeout };
  }
  return models;
}

export class ModelError extends Error {
  constructor(reason, detail) {
    super(reason);
    this.detail = detail;
  }
}

function httpReason(status, model) {
  if (status === 401 || status === 403) return `API 密钥无效或无权访问（HTTP ${status}），请检查 ${model.description} 密钥`;
  if (status === 404) return `找不到模型「${model.name}」，请检查模型 ID`;
  if (status === 429) return '请求过于频繁或额度不足（HTTP 429）';
  if (status === 400) return '请求被拒绝（HTTP 400），请确认模型支持文本对话';
  return `服务商暂时不可用（HTTP ${status}）`;
}

export function parseMove(content) {
  const text = String(content ?? '');
  for (const candidate of [text.trim(), ...(text.match(/\{[^{}]*\}/g) ?? [])]) {
    try {
      const move = JSON.parse(candidate)?.move;
      if (Number.isInteger(move)) return move;
    } catch { /* Try the next candidate. */ }
  }
  return null;
}

export async function liveMove(id, model, game, board, player, signal, request = fetch) {
  const prompt = [
    `Play ${game.gravity ? 'Connect Four' : 'Tic-Tac-Toe'}. You are player ${player}. 0 means empty.`,
    `Board (rows from top to bottom): ${JSON.stringify(board)}`,
    game.gravity ? 'A move is a 1-based column; the piece falls to the bottom of that column.' :
      'A move is a 1-based cell number, left to right and top to bottom.',
    `Win by making a line of ${game.target}. Legal moves: ${legalMoves(game, board).join(', ')}.`,
    'Respond with only a JSON object like {"move":1}, using your chosen legal move. No Markdown or prose.',
  ].join('\n');
  const openai = model.provider === 'openai';
  const timeout = AbortSignal.timeout(model.timeout ?? 30_000);
  let response;
  let data;
  try {
    response = await request(openai ? 'https://api.openai.com/v1/responses' : 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(openai ? { Authorization: `Bearer ${model.key}` } :
          { 'x-api-key': model.key, 'anthropic-version': '2023-06-01' }),
      },
      body: JSON.stringify(openai
        ? { model: model.name, input: prompt, max_output_tokens: 2048, store: false }
        : { model: model.name, max_tokens: 256, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.any([signal, timeout]),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ModelError(httpReason(response.status, model), `HTTP ${response.status} ${body.slice(0, 300)}`);
    }
    data = await response.json();
  } catch (error) {
    if (error instanceof ModelError || signal.aborted) throw error;
    if (timeout.aborted) throw new ModelError(`${(model.timeout ?? 30_000) / 1000} 秒内未响应`, 'timeout');
    throw new ModelError(response ? '返回了无法解析的响应' : `无法连接 ${model.description} 服务`, error.message);
  }
  const content = openai
    ? data.output?.filter(part => part.type === 'message').flatMap(part => part.content ?? [])
      .filter(part => part.type === 'output_text').map(part => part.text).join('')
    : data.content?.filter(part => part.type === 'text').map(part => part.text).join('');
  const move = parseMove(content);
  const truncated = openai ? data.status === 'incomplete' : data.stop_reason === 'max_tokens';
  if (move === null && truncated) throw new ModelError('输出达到长度上限，未给出落子', JSON.stringify(data).slice(0, 300));
  return move;
}
