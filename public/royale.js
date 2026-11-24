import { fighters } from './fight-engine.js';
import { node, symbols, royaleTable } from './league-ui.js';
import { RoyaleScene, lootColors } from './royale-scene.js';

const $ = id => document.getElementById(id);
const byId = Object.fromEntries(fighters.map(f => [f.id, f]));
const name = id => byId[id]?.name ?? id;
const lootNames = { weapon: '武器', shield: '护盾', supply: '补给' };
const clock = ms => {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 60), seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
};
const standby = {
  entrants: fighters.map(({id},i) => ({ id, x: Math.cos(i * 2 * Math.PI / 5) * 7.5, z: Math.sin(i * 2 * Math.PI / 5) * 7.5, hp: 100, shield: 0, kos: 0 })),
  loot: [{id:'a',kind:'weapon',x:-4.1,z:1.9},{id:'b',kind:'shield',x:3.8,z:2.6},{id:'c',kind:'supply',x:1.6,z:-4.5}],
  zone: { phase: 0, radius: 10, nextRound: 3 },
  round: 1,
};
const tags = new Map(), roster = new Map();
for (const f of fighters) {
  const tag = node('span', f.name, 'royale-tag');
  tag.style.setProperty('--entrant', f.color);
  $('royale-tags').append(tag);
  tags.set(f.id,tag);

  const row = node('div', undefined, 'royale-entrant');
  row.style.setProperty('--entrant', f.color);
  const info = node('div', undefined, 'entrant-info'), identity = node('div');
  identity.append(node('strong',f.name), node('small',f.title));
  const hp = node('progress');
  hp.max = 100;
  hp.setAttribute('aria-label', f.name + ' 生命值');
  info.append(identity,hp);
  const digits = node('div',undefined,'entrant-hp'), main = node('span'), sub = node('small');
  digits.append(main,sub);
  row.append(node('span',symbols[f.id],'entrant-icon'),info,digits);
  $('royale-roster').append(row);
  roster.set(f.id,{ row,hp,main,sub });
}

function svgDot(kind, at, size, color, stroke) {
  const el = document.createElementNS('http://www.w3.org/2000/svg',kind);
  const x = 50 + at.x * 4.6, y = 50 + at.z * 4.6;
  if(kind === 'circle') {
    el.setAttribute('cx',x); el.setAttribute('cy',y); el.setAttribute('r',size);
  } else {
    el.setAttribute('x',x-size); el.setAttribute('y',y-size);
    el.setAttribute('width',size*2); el.setAttribute('height',size*2); el.setAttribute('rx',1);
  }
  el.setAttribute('fill',color);
  el.setAttribute('stroke',stroke);
  el.setAttribute('stroke-width','0.9');
  return el;
}
function renderHUD(state, actor, ranking) {
  const entries = ranking ? [...state.entrants].sort((a,b)=>a.place-b.place) : state.entrants;
  const alive = state.entrants.filter(p=>p.hp>0).length;
  $('royale-alive').textContent = String(alive).padStart(2,'0') + ' / 05';
  $('zone-phase').textContent = '安全区 ' + String(state.zone.phase+1).padStart(2,'0');
  $('zone-next').textContent = ranking ? '落幕' : state.round >= 15 ? '全场风暴' : state.zone.nextRound ? '第 ' + state.zone.nextRound + ' 轮缩圈' : '最终安全区';
  $('radar-zone').setAttribute('r',state.zone.radius*4.6);
  $('radar-loot').replaceChildren(...state.loot.map(i=>svgDot('rect',i,2.05,lootColors[i.kind],'#162039')));
  $('radar-players').replaceChildren(...state.entrants.filter(p=>p.hp).map(p=>svgDot('circle',p,p.id===actor?4.0:3.2,byId[p.id].color,p.id===actor?'#fff':'#171931')));
  for (const p of entries) {
    const { row, hp, main, sub } = roster.get(p.id);
    hp.value = p.hp;
    row.dataset.out = String(!ranking && !p.hp);
    row.dataset.active = String(p.id === actor || ranking && p.place === 1 || false);
    main.textContent = ranking || p.place ? '#' + p.place : p.hp + ' HP';
    sub.textContent = ranking ? p.kos + ' 击倒 · ' + ranking[p.place-1].points + ' 分' : p.hp ? (p.weapon?'武器 · ':'')+(p.shield?'盾 '+p.shield:p.kos+' 击倒') : '已淘汰';
    tags.get(p.id).classList.toggle('active',p.id === actor);
    if (ranking) $('royale-roster').append(row);
  }
}

const detail = (e, b) => {
  const actor = name(b.actor);
  switch(e.type) {
    case 'zone': return '安全区缩至第 ' + (e.phase + 1) + ' 阶段，圈外将持续扣血。';
    case 'callout': return actor + ' 公开提议：集火 ' + name(e.target) + '！';
    case 'cooperate': return actor + ' 响应 ' + name(e.partner) + ' 的集火提议。';
    case 'betrayal': return actor + ' 转火 ' + name(e.target) + '，临时合作破裂。';
    case 'elimination': return (e.by ? name(e.by) + ' 击倒 ' + name(e.target) : name(e.target) + ' 被风暴淘汰') + '，第 ' + e.place + ' 名。';
    case 'storm': return name(e.target) + ' 承受 ' + e.damage + ' 点风暴伤害。';
    case 'hit': return actor + ' 命中 ' + name(e.target) + '，造成 ' + e.damage + ' 点伤害' + (e.absorbed ? '（护盾吸收 ' + e.absorbed + '）' : '') + '。';
    case 'pickup': return actor + ' 拾取' + lootNames[e.kind] + '。';
    default: return '';
  }
};
function highlight(beat) {
  const { move } = beat;
  const headline = beat.events.filter(e=>['hit','pickup','storm','elimination'].includes(e.type)).map(e=>detail(e,beat));
  if (move.type === 'move') headline.unshift(name(beat.actor) + ' 向' + move.direction + '移动。');
  if (move.type === 'defend') headline.unshift(name(beat.actor) + ' 进入防御姿态。');
  const important = beat.events.filter(e=>['zone','elimination','callout','cooperate','betrayal','pickup'].includes(e.type));
  $('royale-commentary').textContent = headline.join(' ');
  $('royale-turn').textContent = '第 ' + beat.round + ' 轮 / 回合 ' + String(beat.turn).padStart(2,'0') + ' · ' + name(beat.actor);
  $('royale-reason').hidden = false;
  $('royale-reason').textContent = '策略：' + beat.reason;
  for (const event of important) {
    const feed = $('royale-feed');
    feed.querySelector('.royale-empty')?.remove();
    const li = node('li');
    li.dataset.type = event.type;
    li.append(node('b','T' + String(beat.turn).padStart(2,'0')), document.createTextNode(detail(event,beat)));
    feed.prepend(li);
    if (feed.children.length > 9) feed.lastElementChild.remove();
  }
  renderHUD(beat,beat.actor);
}

async function json(url, options) {
  const res = await fetch(url,options), data = await res.json();
  if(!res.ok) throw new Error(data.error || '请求失败，请重试。');
  return data;
}
async function refreshScores() {
  await Promise.all([
    json('/api/league').then(x=>$('royale-league').replaceChildren(royaleTable(x.royale ?? [])))
      .catch(()=>$('royale-league').textContent='联赛暂时不可用。'),
    json('/api/ladder/royale').then(rows=>$('royale-ladder').replaceChildren(royaleTable(rows,id=>id.startsWith('builtin:')?'内置 · '+name(id.slice(8)):id,'控制器')))
      .catch(()=>$('royale-ladder').textContent='天梯暂时不可用。'),
  ]);
}

const start = $('royale-start'), pause = $('royale-pause'), repeat = $('royale-replay');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let scene, replay, running = false, elapsed = 0, rendered = -1, previous, winner, state = standby;
const intro = 3200;

function fallback() {
  scene = null;
  $('royale-fallback').hidden = false;
  for (const tag of tags.values()) tag.hidden = true;
  for (const b of document.querySelectorAll('[data-royale-camera]')) b.disabled = true;
}
try { scene = new RoyaleScene($('royale-world'),fighters,fallback); } catch { fallback(); }
renderHUD(standby);
refreshScores();

function begin() {
  running = true;
  elapsed = 0;
  previous = undefined;
  rendered = -1;
  winner = undefined;
  state = replay.initial;
  for (const p of state.entrants) $('royale-roster').append(roster.get(p.id).row);
  $('royale-winner').hidden = true;
  $('royale-reason').hidden = true;
  $('royale-feed').replaceChildren(node('li','五位选手就位，战况稍后更新。','royale-empty'));
  $('royale-commentary').textContent = '落点已分配。各自为战，留意公开集火提议。';
  $('royale-turn').textContent = '解说席 · OPENING';
  start.disabled = true;
  repeat.disabled = true;
  pause.disabled = false;
  pause.textContent = 'Ⅱ 暂停';
  renderHUD(state);
}
function finish() {
  running = false;
  winner = replay.ranking[0].id;
  state = replay.beats.at(-1);
  $('royale-winner-name').textContent = name(winner) + ' 夺冠';
  $('royale-winner').hidden = false;
  $('royale-status').textContent = '比赛结束';
  $('royale-turn').textContent = '解说席 · FINAL';
  $('royale-commentary').textContent = '最后幸存者 ' + name(winner) + ' 拿下冠军。选手的生存名次与击倒已计入混战积分。';
  $('royale-reason').hidden = true;
  $('royale-progress').value = 1;
  pause.disabled = true;
  repeat.disabled = false;
  start.disabled = false;
  start.firstChild.textContent = '再来一场 ';
  renderHUD(state,undefined,replay.ranking);
  refreshScores();
}
function frame(timestamp) {
  if(running && replay) {
    elapsed += Math.min(100, timestamp - (previous ?? timestamp));
    previous = timestamp;
  }
  if(replay && !winner) {
    const playhead = Math.max(0, elapsed-intro), total = replay.beatMs*replay.beats.length;
    $('royale-progress').value = playhead/total;
    $('royale-clock').textContent = clock(playhead);
    if(elapsed>=intro) {
      const beatIndex = Math.min(replay.beats.length-1,Math.floor(playhead/replay.beatMs));
      const beat = replay.beats[beatIndex], before = replay.beats[beatIndex-1] ?? replay.initial;
      const progress = playhead>=total ? 1 : (playhead%replay.beatMs)/replay.beatMs;
      if(progress>=0.32 && rendered!==beatIndex) {
        rendered=beatIndex;
        highlight(beat);
      }
      if(playhead>=total) finish();
      else {
        $('royale-status').textContent = running?'混战进行中':'比赛暂停';
        draw({ state:beat,before,beat,progress:reduceMotion.matches?Math.round(progress):progress,time:timestamp/1000,tags });
        requestAnimationFrame(frame);
        return;
      }
    } else {
      $('royale-status').textContent = running ? '倒计时 · ' + Math.ceil((intro-elapsed)/1000) : '比赛暂停';
    }
  }
  draw({state,time:timestamp/1000,winner,tags});
  requestAnimationFrame(frame);
}
function draw(frameState) {
  try { scene?.render(frameState); } catch { fallback(); }
}
requestAnimationFrame(frame);

start.addEventListener('click',async()=>{
  start.disabled = true;
  repeat.disabled = true;
  const prior = replay;
  if(winner) {
    $('royale-winner').hidden = true;
    winner = undefined;
    replay = undefined;
    state = standby;
    renderHUD(standby);
  }
  $('royale-status').textContent = '正在准备比赛';
  try {
    const { id } = await json('/api/royale',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    for(let attempts=0;attempts<60;attempts++) {
      const job = await json('/api/royale/' + encodeURIComponent(id));
      if(job.status==='error') throw new Error(job.error);
      if(job.status==='done') { replay=job.replay; begin(); return; }
      await new Promise(resolve=>setTimeout(resolve,350));
    }
    throw new Error('准备比赛超时，请重试。');
  } catch(error) {
    replay = prior;
    if(prior) finish();
    $('royale-status').textContent = '无法开赛';
    $('royale-commentary').textContent = error.message;
    start.disabled = false;
  }
});
pause.addEventListener('click',()=>{
  if(!replay || winner) return;
  running = !running;
  previous = undefined;
  pause.textContent = running?'Ⅱ 暂停':'▶ 继续';
});
repeat.addEventListener('click',()=>{ if(replay && winner) begin(); });
document.addEventListener('visibilitychange',()=>{ if(document.hidden && running) pause.click(); });
document.querySelectorAll('[data-royale-camera]').forEach(button=>button.addEventListener('click',()=>{
  if(!scene) return;
  scene.cameraMode = button.dataset.royaleCamera;
  for(const b of document.querySelectorAll('[data-royale-camera]')) b.setAttribute('aria-pressed',String(button===b));
}));
