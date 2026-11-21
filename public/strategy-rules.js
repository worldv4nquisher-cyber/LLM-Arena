export const bands = d => d === 1 ? 'near' : d <= 3 ? 'mid' : 'far';
export function seededRng(seed = 1) {
  let n = 2166136261;
  for (const c of String(seed)) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return () => { n += 0x6D2B79F5; let t = Math.imul(n ^ n >>> 15, n | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const all = ['near', 'mid', 'far'];
const move = (id, name, kind, ranges = all, stamina = 0, damage = 0, startup = 1, recovery = 0, anim = 'guard', extra = {}) => ({ id, name, kind, ranges, stamina, energy: 0, damage, startup, recovery, quick: false, anim, ...extra });
export const baseMoves = [
  move('step_in','进步','move',all,0,0,1,0,'advance',{quick:true,step:1}),
  move('dash','突进','move',all,15,0,1,0,'advance',{step:2}),
  move('step_back','退步','move',all,0,0,1,0,'evade',{quick:true,step:-1}),
  move('guard','格挡','guard',all,0,0,1,0,'guard',{quick:true}),
  move('jab','刺拳','attack',['near'],14,5,1,0,'strike',{quick:true}),
  move('throw','投技','throw',['near'],12,12,2,1,'heavy'),
  move('feint','佯攻','feint',all,5,0,1,0,'strike',{quick:true}),
  move('scout','侦察','scout'), move('rest','休息','rest',all,0,0,1,0,'guard',{quick:true}),
];
export const movePool = [
  move('strike','直击','attack',['near','mid'],12,10,2,0,'strike'),
  move('heavy','重击','attack',['near'],20,18,4,2,'heavy',{armor:['jab']}),
  move('sweep','扫腿','attack',['near'],12,9,2,1,'strike'),
  move('lunge','突刺','attack',['mid'],16,11,3,1,'strike',{step:1}),
  move('blast','气弹','attack',['mid','far'],12,10,3,0,'blast',{energy:15,projectile:true}),
  move('snipe','狙击','attack',['far'],16,14,4,1,'blast',{energy:20,projectile:true}),
  move('parry','招架','parry',all,8), move('evade','闪避','evade',all,8,0,1,0,'evade'),
  move('drain','汲能','attack',['mid'],10,7,3,0,'blast',{drain:15}),
  move('barrier','屏障','guard',all,5,0,1,0,'guard',{energy:10}),
];
export const ultimates = [
  move('nova','星爆','attack',['near','mid'],20,30,3,2,'ultimate',{energy:100}),
  move('sky','天穹炮','attack',['mid','far'],20,26,4,2,'ultimate',{energy:100,projectile:true}),
  move('prison','瞬狱','attack',['near'],20,28,1,3,'ultimate',{energy:100}),
];
export const defaultCustom = {name:'星拳',damage:2,range:['near','mid'],speed:4};
export function moveCategory(id) {
  const kind=id==='custom'?'attack':[...baseMoves,...movePool,...ultimates].find(m=>m.id===id)?.kind;
  return ['guard','parry','evade'].includes(kind)?'defend':kind;
}
export function validateCustom(input) {
  const c = input;
  const valid = c && typeof c.name === 'string' && c.name.length > 0 && c.name.length <= 16 && Number.isInteger(c.damage) && c.damage >= 0 && Number.isInteger(c.speed) && c.speed >= 0 && c.speed <= 4 && Array.isArray(c.range) && c.range.includes('near') && new Set(c.range).size === c.range.length && c.range.every(r => all.includes(r)) && 2*c.damage + c.speed + (c.range.includes('mid') ? 2 : 0) + (c.range.includes('far') ? 3 : 0) <= 10;
  const v = valid ? c : defaultCustom;
  return {valid:!!valid, move:move('custom',v.name,'attack',[...v.range],14+4*v.damage,4+3*v.damage,5-v.speed,1,'strike')};
}
export const rulesSummary = '九格战场；同时出招；投破防、快打断慢、同速互击；每局24次深思，计划免费；三局两胜，每回合30拍。';
export function createState(loadouts = [[],[]], customs = [defaultCustom,defaultCustom]) {
  return {turn:0, fighters:[2,6].map((cell,i) => ({hp:100,stamina:100,energy:0,cell,lag:0,scouted:false,budgetLeft:24,loadout:loadouts[i],custom:validateCustom(customs[i]).move})),stage:{items:[],dangers:[]}};
}
export function availableMoves(f) { return [...baseMoves,...movePool.filter(m=>f.loadout.includes(m.id)),...ultimates.filter(m=>f.loadout.includes(m.id)),f.custom].filter(Boolean); }
export function legalMoves(state, side = 0) {
  const f = state.you || state.fighters[side];
  const band = state.band || bands(Math.abs(state.fighters[0].cell-state.fighters[1].cell));
  return availableMoves(f).filter(m=>m.stamina<=f.stamina && m.energy<=f.energy && m.ranges.includes(band) && (f.budgetLeft>0 || m.quick));
}
export function makeView(state, side, extra = {}) {
  const f=state.fighters[side], o=state.fighters[1-side];
  return structuredClone({turn:state.turn+1,you:f,opponent:{hp:o.hp,stamina:o.stamina,cell:o.cell,lag:o.lag,energy:f.scouted?o.energy:null,loadout:f.scouted?o.loadout:null,custom:f.scouted?o.custom:null},distance:Math.abs(f.cell-o.cell),band:bands(Math.abs(f.cell-o.cell)),edge:[f.cell===0||f.cell===8,o.cell===0||o.cell===8],stage:state.stage,legalMoves:legalMoves(state,side),rulesSummary,...extra});
}
export const planConditions = ['always','opponent_guarded','hit','missed','was_hit','near','mid','far'];
export function planMatches(condition, view, previous, side) {
  if(condition==='always') return true;
  if(all.includes(condition)) return condition===view.band;
  if(!previous) return false;
  if(condition==='opponent_guarded') return ['guard','parry','evade','barrier'].includes(previous.moves[1-side]);
  const damage = previous.events.filter(e=>e.player===side).reduce((s,e)=>s+e.damage,0);
  return condition==='hit'?damage>0:condition==='missed'?previous.events.some(e=>e.player===side&&e.outcome==='miss'):condition==='was_hit'?previous.events.some(e=>e.player===1-side&&e.damage>0):false;
}
export function resolveTurn(input, submissions, rng = seededRng(1)) {
  const state=structuredClone(input), fs=state.fighters, turn=++state.turn;
  const moves=submissions.map((s,i)=>s.mistake?move('stunned','失误眩晕','stunned'):availableMoves(fs[i]).find(m=>m.id===s.move));
  if(moves.some(m=>!m)) throw new Error('Unvalidated move');
  const events=[], feints=[false,false], damageTaken=[0,0], lag=moves.map(m=>m.recovery);
  state.stage.items=state.stage.items.filter(x=>x.expires>=turn);
  state.stage.dangers=state.stage.dangers.filter(x=>x.expires>=turn);
  if([6,14,22].includes(turn)) {
    const free=Array.from({length:9},(_,i)=>i).filter(c=>!fs.some(f=>f.cell===c));
    state.stage.items.push({cell:free[Math.floor(rng()*free.length)],type:['heal','energy','stamina'][Math.floor(rng()*3)],expires:turn+5});
  }
  if([10,20].includes(turn)) { const c=Math.floor(rng()*8); state.stage.dangers.push({cells:[c,c+1],expires:turn+4}); }
  const startup=moves.map((m,i)=>m.startup+fs[i].lag);
  const oldCells=fs.map(f=>f.cell);
  const desired=moves.map((m,i)=>Math.max(0,Math.min(8,oldCells[i]+(i===0?1:-1)*(m.step||0))));
  if(desired[0]>=desired[1]) { const center=(oldCells[0]+oldCells[1])/2; desired[0]=Math.floor(center-.5); desired[1]=desired[0]+1; }
  fs.forEach((f,i)=>{ f.cell=desired[i]; f.stamina-=moves[i].stamina; f.energy-=moves[i].energy; });
  const band=bands(fs[1].cell-fs[0].cell);
  // Lunge's range is evaluated at submission distance; other attacks use final positions.
  const inRange=(m)=>m.ranges.includes(m.id==='lunge'?bands(oldCells[1]-oldCells[0]):band);
  const attacking=m=>['attack','throw'].includes(m.kind);
  const cancelled=[false,false];
  function hit(i) {
    const j=1-i,m=moves[i],o=moves[j];
    if(cancelled[i]||!attacking(m)) return;
    let damage=m.damage,outcome='hit';
    if(!inRange(m)) {events.push({player:i,action:m.anim,damage:0,outcome:'miss'});return;}
    if(m.kind==='throw' && attacking(o) && inRange(o) && startup[j]<=startup[i]) {events.push({player:i,action:m.anim,damage:0,outcome:'counter'});return;}
    if(o.kind==='parry' && ['strike','heavy','jab','lunge','custom'].includes(m.id)) {
      damageTaken[i]+=8; fs[j].energy=Math.min(100,fs[j].energy+8); events.push({player:j,action:o.anim,damage:8,outcome:'parry'});return;
    }
    if((o.id==='barrier'&&m.projectile)||(o.kind==='evade'&&(m.projectile||m.id==='heavy'))) {events.push({player:i,action:m.anim,damage:0,outcome:'evade'});return;}
    if(o.id==='guard'&&['strike','heavy','jab','blast','custom'].includes(m.id)) {damage*=.25;outcome='block';fs[j].energy=Math.min(100,fs[j].energy+5);}
    if(['rest','feint','stunned'].includes(o.kind)) damage*=1.25;
    if((fs[j].cell===0||fs[j].cell===8)&&(m.id==='heavy'||m.kind==='throw'||m.anim==='ultimate')) damage+=5;
    damage=Math.round(damage); damageTaken[j]+=damage;
    fs[i].energy=Math.min(100,fs[i].energy+8);
    if(m.drain) {const stolen=Math.min(fs[j].energy,m.drain);fs[j].energy-=stolen;fs[i].energy=Math.min(100,fs[i].energy+stolen);}
    if(m.id==='sweep') lag[j]++;
    if(attacking(o)&&startup[i]<startup[j]&&!o.armor?.includes(m.id)) cancelled[j]=true;
    events.push({player:i,action:m.anim,damage,outcome:m.kind==='throw'?'throw':outcome});
  }
  for(const i of startup[0]<=startup[1]?[0,1]:[1,0]) hit(i);
  moves.forEach((m,i)=>{
    if(m.kind==='feint'&&['guard','parry','evade'].includes(moves[1-i].kind)) {feints[i]=true;lag[1-i]++;fs[i].energy=Math.min(100,fs[i].energy+15);}
    if(m.kind==='scout') fs[i].scouted=true;
    if(m.kind==='stunned') lag[i]+=2;
    if(m.kind==='rest') fs[i].stamina+=25;
    for(const danger of state.stage.dangers) if(danger.cells.includes(fs[i].cell)) {damageTaken[i]+=6;events.push({player:1-i,action:'blast',damage:6,outcome:'danger'});}
    fs[i].hp=Math.max(0,fs[i].hp-damageTaken[i]);
    fs[i].lag=lag[i];fs[i].stamina=Math.min(100,fs[i].stamina+10);fs[i].energy=Math.min(100,fs[i].energy+4);
    state.stage.items=state.stage.items.filter(item=>{if(item.cell!==fs[i].cell)return true;const key={heal:'hp',energy:'energy',stamina:'stamina'}[item.type];fs[i][key]=Math.min(100,fs[i][key]+{heal:15,energy:30,stamina:40}[item.type]);events.push({player:i,action:'guard',damage:0,outcome:'item',item:item.type});return false;});
  });
  const gap=2.2+(fs[1].cell-fs[0].cell-1)*4/7;
  const center=Math.max(-3.1+gap/2,Math.min(3.1-gap/2,((fs[0].cell+fs[1].cell)/2-4)*.4));
  return {state,beat:{turn,actions:moves.map(m=>m.anim),moves:moves.map(m=>m.id),names:moves.map(m=>m.name),events,states:fs.map((f,i)=>({...structuredClone(f),x:center+(i?1:-1)*gap/2})),stamina:fs.map(f=>f.stamina),cells:fs.map(f=>f.cell),band,stage:structuredClone(state.stage),feints}};
}
