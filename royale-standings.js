import { fighters } from './public/fight-engine.js';

export function addRoyaleResult(entries, ranking, key = 'id') {
  for (const result of ranking) {
    const id = result[key];
    const row = entries[id] ??= { id, played: 0, wins: 0, kos: 0, points: 0 };
    row.played++;
    row.wins += Number(result.place === 1);
    row.kos += result.kos;
    row.points += result.points;
  }
}

export function royaleStandings(entries = {}) {
  return Object.values(entries).sort((a, b) => b.points - a.points || b.wins - a.wins || b.kos - a.kos || a.id.localeCompare(b.id));
}

export const defaultRoyalePlayers = fighters.map(f => f.id);
