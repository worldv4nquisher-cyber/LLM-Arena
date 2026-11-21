// The server computes an entire replay before the browser starts its match clock.
// No network request or model latency is allowed to interrupt the choreography.
export const fighters = [
  { id: 'gpt', name: 'GPT', title: '星织龙姬', provider: 'OpenAI', color: '#c0a4ff', hair: '#e8defa', dress: '#e8ddfa', dark: '#615080', feature: 'dragon', style: 'balanced', skill: '星龙脉冲', description: '银发 · 龙角 · 星光龙翼' },
  { id: 'claude', name: 'Claude', title: '琥珀咏者', provider: 'Anthropic', color: '#ffae6b', hair: '#dd7637', dress: '#efab65', dark: '#493345', feature: 'flower', style: 'counter', skill: '万象之书', description: '橙发 · 花饰 · 魔法书' },
  { id: 'gemini', name: 'Gemini', title: '双子星灵', provider: 'Google', color: '#b397ff', hair: '#7771e6', dress: '#7262ce', dark: '#353365', feature: 'cat', style: 'aggressive', skill: '双星闪击', description: '蓝紫长发 · 猫耳 · 双星' },
  { id: 'deepseek', name: 'DeepSeek', title: '深海回响', provider: 'DeepSeek', color: '#72d7ff', hair: '#285d9e', dress: '#234e83', dark: '#203455', feature: 'maid', style: 'counter', skill: '鲸海潮汐', description: '深蓝发 · 女仆裙 · 鲸尾' },
  { id: 'grok', name: 'Grok', title: '破界夜姬', provider: 'xAI', color: '#ffc36b', hair: '#f3c97e', dress: '#3d344e', dark: '#982e59', feature: 'devil', style: 'aggressive', skill: '混沌裁决', description: '金色双马尾 · 黑裙 · 战戟' },
];

export const styles = { balanced: '均衡战术', aggressive: '强攻压制', counter: '防守反击' };
export const actionNames = { advance: '逼近', strike: '突进打击', heavy: '蓄力重击', guard: '能量格挡', evade: '侧步闪避', blast: '能量弹', ultimate: '终结技' };

function seeded(seed) {
  let value = seed >>> 0;
  return () => { value += 0x6D2B79F5; let n = value; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}

function choose(state, opponent, style, random) {
  if (state.energy >= 75) return 'ultimate';
  const distance = Math.abs(state.x - opponent.x);
  const roll = random();
  if (state.hp < 30 && roll < .27) return 'evade';
  if (style === 'counter' && roll < .3) return 'guard';
  if (distance > 3) return roll < .44 && state.energy >= 18 ? 'blast' : 'advance';
  if (roll < (style === 'aggressive' ? .5 : .32)) return 'heavy';
  if (roll < .72) return 'strike';
  return roll < .84 ? 'guard' : state.energy >= 18 ? 'blast' : 'strike';
}

export function simulateFight({ players, tactics, seed = 1 }) {
  if (!Array.isArray(players) || players.length !== 2 || !players.every(id => fighters.some(f => f.id === id))) throw new Error('Invalid fighters');
  if (tactics !== undefined && (!Array.isArray(tactics) || tactics.length !== 2 || !tactics.every(s => Object.hasOwn(styles, s)))) throw new Error('Invalid tactics');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid seed');
  const random = seeded(seed);
  const plans = tactics ?? players.map(id => fighters.find(f => f.id === id).style);
  const rounds = [];
  const wins = [0, 0];
  for (let round = 1; round <= 3 && Math.max(...wins) < 2; round++) {
    const states = [0, 1].map(i => ({ hp: 100, energy: 15, x: i ? 2.1 : -2.1, damage: 0, hits: 0, blocks: 0 }));
    const beats = [];
    for (let tick = 0; tick < 45; tick++) {
      const actions = states.map((s, i) => choose(s, states[1 - i], plans[i], random));
      const events = [];
      for (let i = 0; i < 2; i++) {
        const s = states[i], other = states[1 - i], direction = i ? -1 : 1;
        if (actions[i] === 'advance') s.x += direction * .7;
        if (actions[i] === 'strike' || actions[i] === 'heavy') s.x += direction * Math.min(.5, Math.max(0, Math.abs(s.x - other.x) - 1.2));
        if (actions[i] === 'evade') s.x -= direction * .6;
        s.x = Math.max(i ? .7 : -3.1, Math.min(i ? 3.1 : -.7, s.x));
      }
      // Both choices are resolved simultaneously: neither side gets a turn-order advantage.
      const damages = [0, 0];
      for (let i = 0; i < 2; i++) {
        const action = actions[i], s = states[i], other = states[1 - i];
        s.energy = Math.min(100, s.energy + 9);
        if (['guard', 'evade', 'advance'].includes(action)) continue;
        const ranged = action === 'blast' || action === 'ultimate';
        if (action === 'blast') s.energy -= 18;
        if (action === 'ultimate') s.energy -= 75;
        let amount = action === 'ultimate' ? 30 : action === 'heavy' ? 17 : action === 'blast' ? 12 : 10;
        let outcome = 'hit';
        if (!ranged && Math.abs(s.x - other.x) > 2.5) { amount = 0; outcome = 'miss'; }
        else if (actions[1 - i] === 'evade' && random() < .8) { amount = 0; outcome = 'evade'; }
        else if (actions[1 - i] === 'guard') { amount = Math.ceil(amount * .25); outcome = 'block'; other.blocks++; }
        else { amount += Math.floor(random() * 4); s.hits++; }
        damages[1 - i] += amount;
        s.damage += amount;
        events.push({ player: i, action, damage: amount, outcome });
      }
      states.forEach((s, i) => { s.hp = Math.max(0, s.hp - damages[i]); });
      beats.push({ tick, actions, events, states: structuredClone(states) });
      if (states.some(s => s.hp === 0)) break;
    }
    // A double KO / equal HP round is a draw, not an arbitrary red-side victory.
    const winner = states[0].hp === states[1].hp ? null : states[0].hp > states[1].hp ? 0 : 1;
    if (winner !== null) wins[winner]++;
    rounds.push({ round, beats, winner, wins: [...wins] });
  }
  return { version: 1, seed, players, tactics: plans, mode: 'demo', beatDuration: .85, rounds, wins, winner: wins[0] === wins[1] ? null : wins[0] > wins[1] ? 0 : 1 };
}
