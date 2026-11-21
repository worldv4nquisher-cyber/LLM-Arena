import { games, newBoard } from './rules.js';

const ui = id => document.getElementById(id);
const selectors = [ui('red-model'), ui('blue-model')];
const descriptions = [ui('red-description'), ui('blue-description')];
const avatars = [ui('player-1'), ui('player-2')];
const gameButtons = [...document.querySelectorAll('[data-game]')];
const start = ui('start');
const stop = ui('stop-match');
const boardElement = ui('board');
const moveLog = ui('move-log');
const names = {
  'tic-tac-toe': '井字棋',
  'connect-four': '四子棋',
};
const rules = {
  'tic-tac-toe': '红方执 ×，蓝方执 ○；率先连成三枚获胜。',
  'connect-four': '棋子从列顶落下；率先连成四枚获胜。',
};
const historyKey = 'llm-arena-recent-v1';
const models = new Map();
let gameId = 'tic-tac-toe';
let board;
let cells;
let controller;
let history = readHistory();

function readHistory(fallback = []) {
  try {
    const saved = JSON.parse(localStorage.getItem(historyKey));
    if (Array.isArray(saved)) {
      return saved.filter(entry => Object.hasOwn(names, entry?.game) &&
        Array.isArray(entry.players) && entry.players.length === 2 &&
        entry.players.every(name => typeof name === 'string') &&
        [0, 1, 2].includes(entry.winner) && Number.isInteger(entry.turns)).slice(0, 20);
    }
    return [];
  } catch { return fallback; }
}

function status(label, state = 'idle', player = null) {
  ui('status').textContent = label;
  ui('status').dataset.state = state;
  ui('status').dataset.player = player ?? '';
}

function playerLabel(player, players) {
  return `${player === 1 ? '红方' : '蓝方'} · ${players[player - 1].name}`;
}

function refreshBoardLabel() {
  const colors = ['空', '红', '蓝'];
  boardElement.setAttribute('aria-label', `${names[gameId]}棋盘，各行从上到下：${board
    .map(row => row.map(value => colors[value]).join('、')).join('；')}`);
}

function setTurn(player) {
  avatars.forEach((element, i) => element.classList.toggle('active', i + 1 === player));
}

function boardLabel(number) {
  const label = document.createElement('span');
  label.className = 'board-label';
  label.setAttribute('aria-hidden', 'true');
  label.textContent = number;
  return label;
}

function resetMatch() {
  const game = games[gameId];
  board = newBoard(game);
  boardElement.classList.toggle('gravity', game.gravity);
  cells = board.map(row => row.map(() => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.setAttribute('aria-hidden', 'true');
    return cell;
  }));
  const columnLabels = board[0].map((_, i) => boardLabel(i + 1));
  boardElement.replaceChildren(...columnLabels, ...cells.flatMap((row, i) => [boardLabel(i + 1), ...row]));
  refreshBoardLabel();
  setTurn(null);
  moveLog.replaceChildren();
  ui('log-empty').hidden = false;
  ui('turn-count').textContent = '00 步';
  ui('rule').textContent = rules[gameId];
  start.querySelector('span').textContent = '开始对局';
  status('等待开赛');
}

function updateSelections() {
  const selected = selectors.map(select => models.get(select.value));
  const live = selected.some(model => model?.mode === 'live');
  ui('mode').lastChild.textContent = live ? ' 真实模型' : ' 机器人演示';
  descriptions.forEach((element, i) => {
    const model = selected[i];
    element.textContent = model ? (model.mode === 'demo' ? `内置机器人 · ${model.description}` : model.description) : '';
  });
  start.disabled = !selected.every(Boolean);
}

function addMove(event, players) {
  const { row, col, player, turn } = event;
  board[row][col] = player;
  boardElement.querySelector('.last')?.classList.remove('last');
  const cell = cells[row][col];
  cell.dataset.player = player;
  cell.classList.add('last');
  const mark = document.createElement('span');
  mark.className = 'mark';
  cell.append(mark);
  refreshBoardLabel();

  const entry = document.createElement('li');
  const num = document.createElement('span');
  const name = document.createElement('span');
  const detail = document.createElement('span');
  num.className = 'move-num';
  num.textContent = String(turn).padStart(2, '0');
  name.className = player === 1 ? 'move-name' : 'move-name blue';
  name.textContent = playerLabel(player, players);
  name.title = name.textContent;
  detail.textContent = `第 ${row + 1} 行 · 第 ${col + 1} 列`;
  entry.append(num, name, detail);
  ui('log-empty').hidden = true;
  moveLog.append(entry);
  moveLog.scrollTop = moveLog.scrollHeight;
  ui('turn-count').textContent = `${num.textContent} 步`;
}

function showHistory() {
  ui('history-empty').hidden = history.length > 0;
  ui('history-list').replaceChildren(...history.map(entry => {
    const item = document.createElement('li');
    const info = document.createElement('div');
    const mode = document.createElement('small');
    info.textContent = entry.players.join(' vs ');
    mode.textContent = `${names[entry.game]} · ${entry.turns} 步 · ${entry.live ? '真实模型' : '演示'}`;
    info.append(mode);
    const outcome = document.createElement('strong');
    outcome.textContent = entry.winner === 0 ? '平局' : `${entry.winner === 1 ? '红方' : '蓝方'}获胜`;
    if (entry.forfeit) outcome.textContent += ' · 对手违规';
    item.append(info, outcome);
    return item;
  }));
}

async function* matchEvents(response) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line) yield JSON.parse(line);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function startMatch() {
  const players = selectors.map(select => models.get(select.value));
  const playerIds = selectors.map(select => select.value);
  const settings = [...selectors, ...gameButtons];
  resetMatch();
  const match = new AbortController();
  controller = match;
  start.disabled = true;
  start.querySelector('span').textContent = '对局进行中';
  stop.hidden = false;
  settings.forEach(control => { control.disabled = true; });
  status('准备开赛', 'active');
  if (boardElement.getBoundingClientRect().bottom > window.innerHeight) {
    ui('match').scrollIntoView();
  }
  let turns = 0;
  try {
    const response = await fetch('./api/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: gameId, players: playerIds }),
      signal: match.signal,
    });
    if (!response.ok) throw new Error((await response.json()).error);
    let ended = false;
    for await (const event of matchEvents(response)) {
      switch (event.type) {
        case 'turn':
          setTurn(event.player);
          status(`${playerLabel(event.player, players)} 正在思考`, 'active', event.player);
          break;
        case 'move':
          turns = event.turn;
          addMove(event, players);
          break;
        case 'result': {
          ended = true;
          const forfeit = event.reason === 'illegal-move';
          const winner = event.winner === 0 ? '平局' : `${playerLabel(event.winner, players)} 获胜`;
          status(forfeit ? `${winner} · 对手落子无效` : winner, 'result');
          event.line?.forEach(([row, col]) => cells[row][col].classList.add('win'));
          history = readHistory(history);
          history.unshift({
            game: gameId, players: players.map(model => model.name), winner: event.winner, turns,
            live: players.some(model => model.mode === 'live'), forfeit,
          });
          history = history.slice(0, 20);
          try { localStorage.setItem(historyKey, JSON.stringify(history)); } catch { /* Storage is optional. */ }
          showHistory();
          break;
        }
        case 'error':
          throw new Error(event.message);
      }
      if (ended) break;
    }
    if (!ended) throw new Error('对局连接中断，请重试。');
  } catch (error) {
    status(match.signal.aborted ? '对局已停止' :
      (error instanceof TypeError ? '无法连接竞技场，请重试。' : error.message), 'error');
  } finally {
    controller = null;
    start.disabled = false;
    start.querySelector('span').textContent = '再来一局';
    stop.hidden = true;
    setTurn(null);
    settings.forEach(control => { control.disabled = false; });
  }
}

gameButtons.forEach(button => button.addEventListener('click', () => {
  if (gameId === button.dataset.game) return;
  gameId = button.dataset.game;
  gameButtons.forEach(option => option.setAttribute('aria-pressed', String(option === button)));
  resetMatch();
}));
selectors.forEach(select => select.addEventListener('change', () => {
  updateSelections();
  resetMatch();
}));
start.addEventListener('click', startMatch);
stop.addEventListener('click', () => controller?.abort());
window.addEventListener('storage', event => {
  if (event.key !== historyKey || event.storageArea !== localStorage) return;
  history = readHistory();
  showHistory();
});
resetMatch();
showHistory();

try {
  const response = await fetch('./api/models');
  if (!response.ok) throw new Error();
  for (const model of await response.json()) models.set(model.id, model);
  for (const [i, select] of selectors.entries()) {
    const demo = document.createElement('optgroup');
    const live = document.createElement('optgroup');
    demo.label = '内置机器人（免密钥）';
    live.label = '真实模型';
    for (const model of models.values()) {
      const option = new Option(model.name, model.id);
      (model.mode === 'demo' ? demo : live).append(option);
    }
    select.append(demo);
    if (live.children.length) select.append(live);
    select.value = i === 0 ? 'tactician' : 'striker';
  }
  updateSelections();
} catch {
  status('选手列表加载失败，请刷新。', 'error');
}
