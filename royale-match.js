import { seededRng } from './public/strategy-rules.js';
import { invoke } from './fight-match.js';
import { ModelError } from './opponents.js';

export const ISLAND_RADIUS = 10;
export const BEAT_MS = 900;
const ZONES = [10, 8, 6, 4.2, 2.7, 1.4];
const PHASE_ROUNDS = 2;
const DIRECTIONS = ['东', '东南', '南', '西南', '西', '西北', '北', '东北'];
const LOOT = ['weapon', 'shield', 'supply'];
const PLACEMENT_POINTS = [10, 7, 5, 3, 1];
export const rulesSummary = '五人自由混战。每回合从 legalMoves 选一项：移动、攻击、防御或拾取；每两轮缩圈，圈外回合结束扣血，第15轮起全场扣血。武器增加伤害和射程，护盾吸收伤害，补给恢复生命。可附带公开集火提议，但没有队伍或保护。最后存活者夺冠；积分为生存排名加每击倒 2 分。';
const dist = (a, b = { x: 0, z: 0 }) => Math.hypot(a.x - b.x, a.z - b.z);
const position = (angle, radius) => ({
  x: Number((Math.cos(angle) * radius).toFixed(3)),
  z: Number((Math.sin(angle) * radius).toFixed(3)),
});

function legalMoves(you, entrants, items) {
  const moves = [{ id: 'defend', type: 'defend' }];
  for (let i = 0; i < DIRECTIONS.length; i++) {
    const step = position(i * Math.PI / 4, 2.35);
    const to = { x: you.x + step.x, z: you.z + step.z };
    if (dist(to) <= ISLAND_RADIUS - 0.25 && !entrants.some(p => p !== you && p.hp && dist(to, p) < 1.15)) {
      moves.push({ id: 'move:' + i, type: 'move', direction: DIRECTIONS[i], to });
    }
  }
  for (const p of entrants) {
    if (p !== you && p.hp && dist(you, p) <= (you.weapon ? 4.65 : 3.5)) {
      moves.push({ id: 'attack:' + p.id, type: 'attack', target: p.id });
    }
  }
  for (const item of items) {
    if (dist(you, item) <= 2 && (item.kind !== 'weapon' || !you.weapon)) {
      moves.push({ id: 'pickup:' + item.id, type: 'pickup', item: item.id, kind: item.kind });
    }
  }
  return moves;
}

export function decideRoyale(view, id, rng) {
  const { you, rivals, loot, zone, legalMoves } = view;
  const pick = kind => legalMoves.find(m => m.kind === kind);
  const nearest = [...rivals].sort((a, b) => dist(you, a) - dist(you, b))[0];
  const leader = [...rivals].sort((a, b) => b.kos - a.kos || b.hp - a.hp)[0];
  const allyCall = [...view.callouts].reverse().find(c => c.actor !== you.id && c.target !== you.id && rivals.some(p => p.id === c.actor) && rivals.some(p => p.id === c.target));
  const callout = rivals.length > 1 && ((view.round === 1 && id === 'gpt') || rng() < 0.16) ? leader.id : undefined;
  const select = (m, reason) => ({ move: m.id, reason, ...(callout ? { callout } : {}) });
  const movement = legalMoves.filter(m => m.type === 'move');
  const toward = target => [...movement].sort((a, b) => dist(a.to, target) - dist(b.to, target))[0];
  const center = toward({ x: 0, z: 0 });
  const outside = dist(you) > zone.radius;
  const late = zone.phase === ZONES.length - 1;
  const attacks = legalMoves.filter(m => m.type === 'attack').map(m => ({ m, p: rivals.find(p => p.id === m.target) }));
  const attack = attacks.map(({m, p}) => {
    const damage = damageFor(you, p) - p.shield;
    return { m, p, score: (damage >= p.hp ? 35 : 0) - (p.hp + p.shield) * 0.18 + (p.id === allyCall?.target ? 9 : 0) + rng() * 5 };
  }).sort((a,b) => b.score - a.score)[0];
  if (pick('supply') && you.hp <= 76) return select(pick('supply'), '补给就在脚边，先恢复生命');
  if (outside && center && (!attack || dist(center.to) <= zone.radius || !late)) return select(center, '已在风暴里，先向安全区撤离');
  if (pick('weapon')) return select(pick('weapon'), '先夺武器，扩大有效射程');
  if (pick('shield') && you.shield < 22 && (!attack || id === 'claude')) return select(pick('shield'), '捡护盾争取下一次交锋的优势');
  if (attack) {
    const { m, p } = attack;
    if (p.id === allyCall?.target) return select(m, '响应公开集火，给领跑者施压');
    if (p.id === allyCall?.actor) return select(m, '对方露出破绽，暂放集火先抢击倒');
    return select(m, p.hp <= 30 ? '抓住残血窗口，争取击倒' : '对手进入射程，抢先压低血线');
  }
  const targetLoot = [...loot].filter(l => dist(l) < zone.radius - 0.4 && (l.kind === 'weapon' && !you.weapon || l.kind === 'shield' && you.shield < 12 || l.kind === 'supply' && you.hp < 68))
    .sort((a, b) => dist(you, a) - dist(you, b))[0];
  if (id === 'claude' && !you.guard && !outside && dist(you, nearest) < 4.1 && rng() < 0.5) {
    return select(legalMoves[0], '对方即将近身，先防御再反击');
  }
  if (late && outside && center) return select(center, '决胜圈已到，继续靠向核心');
  const target = targetLoot && dist(you, targetLoot) < 5.5 ? targetLoot : nearest;
  const advance = toward(target);
  if (advance) return select(advance, target === nearest ? '向最近的对手推进，建立攻击距离' : '走向圈内资源点，补足装备');
  return select(legalMoves[0], '暂时没有安全落点，原地防御');
}

const damageFor = (actor, target) => Math.round((actor.weapon ? 28 : 19) * (target.guard ? 0.55 : 1));

export async function runRoyale({ players, controllers, seed, onProgress, deadlines = {} }) {
  if (players?.length !== 5 || new Set(players).size !== 5 || controllers?.length !== 5) {
    throw new Error('Five unique fighters and five controllers required');
  }
  const rng = seededRng(seed);
  const entrants = players.map((id, i) => ({
    id, ...position((i / players.length + rng() * 0.025) * Math.PI * 2, 7.5),
    hp: 100, shield: 0, weapon: false, guard: false, kos: 0, place: null,
  }));
  const abort = new AbortController();
  const limits = { normal: 15000, quick: 5000, ...deadlines };
  const beats = [], items = [], callouts = [], coops = new Map();
  const failures = new Map();
  const order = [...entrants];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const alive = () => entrants.filter(p => p.hp > 0);
  const snapshot = (zone, round) => ({ entrants: entrants.map(p => ({ ...p })), loot: items.map(i => ({ ...i })), zone: { ...zone }, round });
  const spawn = (radius, round) => {
    const rotation = rng() * 2 * Math.PI;
    for (let i = 0; i < LOOT.length; i++) {
      const spot = position(rotation + i * 2 * Math.PI / 3, radius * (0.5 + 0.24 * rng()));
      items.push({ id: round + '-' + i, kind: LOOT[(i + round) % LOOT.length], ...spot });
    }
  };
  let zone = { phase: 0, radius: ZONES[0], nextRound: 3, damage: 0 };
  spawn(zone.radius, 1);
  const initial = snapshot(zone, 1);
  const eliminate = (target, actor, events) => {
    const place = alive().length + 1;
    target.place = place;
    if (actor) actor.kos++;
    events.push({ type: 'elimination', target: target.id, by: actor?.id ?? null, place });
  };
  for (let round = 1; alive().length > 1; round++) {
    const phase = Math.min(ZONES.length - 1, Math.floor((round - 1) / PHASE_ROUNDS));
    const effects = [];
    if (phase !== zone.phase) {
      zone = { phase, radius: ZONES[phase], nextRound: phase < ZONES.length - 1 ? round + PHASE_ROUNDS : null, damage: 5 + phase * 2 };
      items.splice(0, items.length, ...items.filter(i => dist(i) < zone.radius - 0.3));
      if (phase < 4) spawn(zone.radius, round);
      effects.push({ type: 'zone', phase });
    }
    const first = (round - 1) % order.length;
    for (const actor of [...order.slice(first), ...order.slice(0, first)]) {
      if (!actor.hp) continue;
      if (alive().length === 1) break;
      const turn = beats.length + 1;
      const controller = controllers[players.indexOf(actor.id)];
      const legal = legalMoves(actor, entrants, items);
      onProgress?.({ turn, round });
      const opponent = alive().filter(p => p !== actor);
      const signals = callouts.filter(c => round - c.round <= 2).slice(-8);
      const { result, providerFailure, error } = await invoke(controller, 'decide', {
        event: 'royale', turn, round, rulesSummary, zone, you: actor, rivals: opponent, loot: items,
        legalMoves: legal, callouts: signals,
      }, limits, abort.signal);
      failures.set(actor.id, providerFailure ? (failures.get(actor.id) || 0) + 1 : 0);
      if (failures.get(actor.id) >= 3) {
        throw new ModelError(controller.id + ' 连续三次服务商请求失败：' + error + '。本场未计入战绩。');
      }
      const action = legal.find(m => m.id === result?.move);
      const reason = typeof result?.reason === 'string' ? result.reason.trim() : '';
      const valid = Boolean(action && reason && reason.length <= 40);
      const move = valid ? action : legal[0];
      const events = effects.splice(0);
      actor.guard = move.type === 'defend';
      if (valid && opponent.some(p => p.id === result.callout) && opponent.length > 1) {
        const signal = { actor: actor.id, target: result.callout, round };
        callouts.push(signal);
        events.push({ type: 'callout', ...signal });
      }
      if (move.type === 'move') Object.assign(actor, move.to);
      if (move.type === 'pickup') {
        const item = items.splice(items.findIndex(i => i.id === move.item), 1)[0];
        if (item.kind === 'weapon') actor.weapon = true;
        if (item.kind === 'shield') actor.shield = Math.min(36, actor.shield + 24);
        if (item.kind === 'supply') actor.hp = Math.min(100, actor.hp + 30);
        events.push({ type: 'pickup', kind: item.kind });
      }
      if (move.type === 'attack') {
        const target = entrants.find(p => p.id === move.target);
        const partners = [actor.id, target.id].sort().join(':');
        if (round - coops.get(partners) <= 2) {
          coops.delete(partners);
          events.push({ type: 'betrayal', target: target.id });
        }
        const proposal = signals.findLast(c => c.target === target.id && c.actor !== actor.id && opponent.some(p => p.id === c.actor));
        if (proposal) {
          coops.set([actor.id, proposal.actor].sort().join(':'), round);
          events.push({ type: 'cooperate', partner: proposal.actor, target: target.id });
        }
        const raw = damageFor(actor, target);
        const absorbed = Math.min(raw, target.shield);
        target.shield -= absorbed;
        const damage = Math.min(target.hp, raw - absorbed);
        target.hp -= damage;
        events.push({ type: 'hit', target: target.id, damage, absorbed });
        if (!target.hp) eliminate(target, actor, events);
      }
      if (alive().length > 1 && (dist(actor) > zone.radius || round >= 15)) {
        const damage = Math.min(actor.hp, round >= 15 ? 20 + (round - 15) * 6 : zone.damage);
        actor.hp -= damage;
        events.push({ type: 'storm', target: actor.id, damage });
        if (!actor.hp) eliminate(actor, null, events);
      }
      if (alive().length === 1) alive()[0].place = 1;
      beats.push({ turn, actor: actor.id, move, reason: valid ? reason : '指令无效或超时，裁判改为防御', events, ...snapshot(zone, round) });
    }
  }
  const ranking = [...entrants].sort((a, b) => a.place - b.place).map(p => ({
    id: p.id, controller: controllers[players.indexOf(p.id)].id, place: p.place, kos: p.kos,
    points: PLACEMENT_POINTS[p.place - 1] + 2 * p.kos,
  }));
  return { version: 1, event: 'royale', seed, beatMs: BEAT_MS, islandRadius: ISLAND_RADIUS, players, initial, beats, ranking };
}
