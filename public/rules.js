export const games = {
  'tic-tac-toe': { rows: 3, columns: 3, target: 3, gravity: false },
  'connect-four': { rows: 6, columns: 7, target: 4, gravity: true },
};

export function newBoard(game) {
  return Array.from({ length: game.rows }, () => Array(game.columns).fill(0));
}

export function legalMoves(game, board) {
  if (game.gravity) return board[0].flatMap((cell, col) => cell ? [] : [col + 1]);
  return board.flat().flatMap((cell, index) => cell ? [] : [index + 1]);
}

export function play(game, board, player, move) {
  if (!legalMoves(game, board).includes(move)) throw new Error('Illegal move');
  const index = move - 1;
  const col = index % game.columns;
  const row = game.gravity ? board.findLastIndex(line => !line[col]) : Math.floor(index / game.columns);
  const next = board.map(line => [...line]);
  next[row][col] = player;

  for (const [dy, dx] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const line = [[row, col]];
    for (const sign of [-1, 1]) {
      for (let y = row + dy * sign, x = col + dx * sign; next[y]?.[x] === player; y += dy * sign, x += dx * sign) {
        if (sign === -1) line.unshift([y, x]);
        else line.push([y, x]);
      }
    }
    if (line.length >= game.target) return { board: next, row, col, winner: player, line };
  }
  return { board: next, row, col, winner: legalMoves(game, next).length ? null : 0, line: [] };
}
