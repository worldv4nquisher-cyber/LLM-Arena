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

export function availableModels(env) {
  const models = Object.fromEntries(Object.entries(demoModels).map(([id, model]) => [id, { ...model, mode: 'demo' }]));
  const providers = [['openai', 'OpenAI', env.OPENAI_API_KEY, env.OPENAI_MODEL],
    ['anthropic', 'Anthropic', env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL]];
  for (const [id, description, key, name] of providers) {
    if (key?.trim() && name?.trim()) models[id] = { mode: 'live', description, key: key.trim(), name: name.trim() };
  }
  return models;
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
  const openai = id === 'openai';
  const response = await request(openai ? 'https://api.openai.com/v1/responses' : 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(openai ? { Authorization: `Bearer ${model.key}` } :
        { 'x-api-key': model.key, 'anthropic-version': '2023-06-01' }),
    },
    body: JSON.stringify(openai
      ? { model: model.name, input: prompt, max_output_tokens: 256, store: false }
      : { model: model.name, max_tokens: 128, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (!response.ok) throw new Error('Model request failed');
  const data = await response.json();
  const content = openai
    ? data.output?.filter(part => part.type === 'message').flatMap(part => part.content ?? [])
      .filter(part => part.type === 'output_text').map(part => part.text).join('')
    : data.content?.filter(part => part.type === 'text').map(part => part.text).join('');
  try {
    const move = JSON.parse(content)?.move;
    return Number.isInteger(move) ? move : null;
  } catch {
    return null;
  }
}
