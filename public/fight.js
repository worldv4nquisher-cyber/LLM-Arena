import { fighters } from './fight-engine.js';
import { baseMoves, movePool, ultimates, eventTarget, mistakeLabel } from './strategy-rules.js';
import { buildBroadcast, broadcastAt, roundCall, entranceStatus, edgeWarning } from './fight-broadcast.js';
import { CONTACT, playbackCues, advancePlayback } from './fight-choreography.js';
import { ArenaAudio } from './fight-audio.js';

const $ = id => document.getElementById(id), audio = new ArenaAudio();
const players = [$('player-0'),$('player-1')], controls = [$('controller-0'),$('controller-1')];
const symbols = {gpt:'✧',claude:'✺',gemini:'✦',deepseek:'≋',grok:'♆'}, ranges = {near:'近',mid:'中',far:'远'};
const moveNames = Object.fromEntries([...baseMoves,...movePool,...ultimates].map(m=>[m.id,m.name]));
const moveName = id => moveNames[id] || ({custom:'自创招',attack:'打击',defend:'防守',move:'移动',stunned:'硬直'}[id]) || id || '未预判';
const fighter = id => fighters.find(f=>f.id===id);
let scene, replay, timeline, controllers=[], history=[], elapsed=0, playing=false, loading=false, finished=false;
let lastFrame, lastBeat='', lastPhase='', currentGame=-1, cues=[];
const config = side => fighter(replay&&currentGame>=0 ? replay.players[replay.games[currentGame].sides[side]] : players[side].value);
const pct = n => `${(n*100).toFixed(1)}%`, delta = n => `${n>=0?'+':''}${(n*100).toFixed(1)}pp`;
function node(tag,text,className) {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
function option(value,text) {const e=node('option',text);e.value=value;return e;}
async function json(url,options) {const r=await fetch(url,options),data=await r.json();if(!r.ok)throw new Error(data.error||'请求失败，请重试。');return data;}
const post = (url,body) => json(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function poll(url,onProgress) {
  while(true) {const job=await json(url);if(job.status==='error')throw new Error(job.error||'任务失败');if(job.status==='done')return job;onProgress(job.progress);await new Promise(r=>setTimeout(r,500));}
}
function announce(title,subtitle='',eyebrow='CELESTIAL STRATEGY',kind='slate') {
  const e=$('center-announcement');e.classList.remove('hidden');e.classList.toggle('result',kind==='result');e.dataset.kind=kind;
  e.querySelector('strong').textContent=title;e.querySelector('span').textContent=subtitle;e.querySelector('small').textContent=eyebrow;
}
function updateNames() {
  players.forEach((_,i)=>{const f=config(i);$(`name-${i}`).textContent=f.name;$(`title-${i}`).textContent=f.title;$(`portrait-${i}`).textContent=symbols[f.id];$(`hud-${i}`).style.setProperty('--fighter',f.color);$(`config-${i}`).style.setProperty('--fighter',fighter(players[i].value).color);});
  document.querySelectorAll('.roster-card').forEach(e=>{const selected=e.dataset.fighter===players[0].value;e.classList.toggle('selected',selected);e.setAttribute('aria-pressed',String(selected));});
}
function updateStats(states=[0,1].map(()=>({hp:100,energy:0,stamina:100,budgetLeft:24})),wins=[0,0]) {
  states.forEach((s,i)=>{
    $(`hp-${i}`).textContent=s.hp;
    for(const key of ['health','energy','stamina'])$(`${key}-${i}`).style.width=`${key==='health'?s.hp:s[key]}%`;
    $(`stamina-value-${i}`).textContent=s.stamina;$(`energy-${i}`).parentElement.title=`能量 ${s.energy}/100`;
    $(`budget-${i}`).textContent=`思考 ${s.budgetLeft}/24`;$(`scouted-${i}`).hidden=!s.scouted;
    $(`edge-${i}`).hidden=true;
    $(`wins-${i}`).textContent=[0,1].map(n=>wins[i]>n?'◆':'◇').join(' ');
  });
}
function lock(locked) {[...players,...controls,$('series-games'),$('match-seed'),...document.querySelectorAll('.roster-card')].forEach(e=>e.disabled=locked);}
function reset() {
  replay=null;playing=false;finished=false;elapsed=0;currentGame=-1;lastBeat='';lastPhase='';
  scene?.setFighters(players.map(p=>fighter(p.value)));if(scene){scene.pose=null;scene.presentation=null;}
  updateNames();updateStats();
  for(const id of ['draft-card','review-card','series-results','broadcast-highlight'])$(id).hidden=true;
  for(let i=0;i<2;i++){$(`reason-${i}`).textContent='等待策略指令';$(`status-${i}`).textContent='';}
  $('range-band').textContent='远';$('clock').textContent='30';$('game-label').textContent='三局两胜';$('round-label').textContent='ROUND 01';
  $('stage-ticker').textContent='场地平静 · 九格战场';$('pause').disabled=true;$('replay').disabled=true;$('broadcast-state').textContent='赛前准备';
  $('battle-feed').replaceChildren(node('li','等待第一声开赛铃。','feed-empty'));$('feed-counter').textContent='READY';$('commentary').textContent='选择形象与控制器，让策略真正上场。';
  $('broadcast').dataset.phase='ready';announce('胜负，即将揭晓。','同时出招 · 读招博弈 · 计划连招');
}
players.forEach((select,i)=>{fighters.forEach(f=>select.append(option(f.id,`${f.name} · ${f.title}`)));select.value=i?'claude':'gpt';select.addEventListener('change',reset);controls[i].addEventListener('change',reset);});
$('series-games').addEventListener('change',reset);
fighters.forEach(f=>{
  const e=node('button',undefined,'roster-card');e.dataset.fighter=f.id;e.style.setProperty('--fighter',f.color);e.setAttribute('aria-label',`选择 ${f.name} 作为一号选手`);
  const text=node('span');text.append(node('b',f.name),node('small',f.title));e.append(node('span',symbols[f.id],'roster-symbol'),text,node('span',f.description,'roster-caption'));
  e.addEventListener('click',()=>{players[0].value=f.id;reset();});$('fighter-roster').append(e);
});
function draftCard(game) {
  const card=$('draft-card');card.replaceChildren(node('h3',`第 ${currentGame+1} 局 · ${currentGame?'换边 · ':''}赛前选招`),node('p',`禁招：${game.draft.bans.map(moveName).join(' / ')}`,'card-kicker'));
  const columns=node('div',undefined,'strategy-columns');
  game.draft.selections.forEach((s,i)=>{const col=node('div');col.append(node('h4',`${i?'右':'左'} · ${config(i).name}`),node('p',`招式 ${s.picks.map(moveName).join(' · ')}`),node('p',`绝技 ${moveName(s.ultimate)}`),node('p',`自创「${s.custom.name}」· 伤害 ${4+3*s.custom.damage} · ${s.custom.range.map(r=>ranges[r]).join('/')} · 启动 ${5-s.custom.speed}`),node('small',s.reason||'裁判采用默认配置'));if(game.draft.mistakes[i].length)col.append(node('p','选招失误 · 已由裁判替换','warning'));columns.append(col);});card.append(columns);
}
function reviewCard(round) {
  const card=$('review-card'),columns=node('div',undefined,'strategy-columns');card.replaceChildren(node('h3',`回合复盘 · ${roundCall(round)}`));
  round.reviews.forEach((r,i)=>{const col=node('div');col.append(node('h4',config(i).name),node('p',r.notes));columns.append(col);});card.append(columns);
}
function resetEntrance(game) {
  const status=entranceStatus(game);
  $('clock').textContent=status.clock;$('round-label').textContent=status.roundLabel;$('range-band').textContent=status.rangeLabel;$('feed-counter').textContent=status.feedCounter;
}
function begin() {
  timeline=buildBroadcast(replay);cues=playbackCues(timeline);elapsed=0;playing=true;finished=false;lastFrame=undefined;lastBeat='';lastPhase='';currentGame=-1;
  scene.resetPose();scene.paused=false;$('series-results').hidden=true;$('battle-feed').replaceChildren();$('pause').disabled=false;$('pause').textContent='Ⅱ 暂停';$('replay').disabled=false;$('start').textContent='↻ 重新开赛';lock(true);
  resetEntrance(replay.games[0]);
}
function historyControls() {document.querySelectorAll('.history-replay').forEach(e=>e.disabled=loading||!scene);}
async function startMatch(seed) {
  if(loading||!scene||!controllers.length)return;
  if(seed===undefined){if(!$('match-seed').reportValidity())return;if($('match-seed').value!=='')seed=Number($('match-seed').value);}
  loading=true;playing=false;lock(true);$('start').disabled=true;$('edit-settings').disabled=true;$('pause').disabled=true;$('replay').disabled=true;
  for(const id of ['draft-card','review-card','series-results'])$(id).hidden=true;
  historyControls();announce('后台计算中','正在创建系列赛…');
  try {
    const {id}=await post('/api/fights',{players:players.map(p=>p.value),controllers:controls.map(c=>c.value),games:Number($('series-games').value),...(seed===undefined?{}:{seed})});
    const job=await poll(`/api/fights/${id}`,p=>{const text=`后台计算中 · 第${p.game||1}局 第${p.round||1}回合`;$('broadcast-state').textContent=text;announce(text,`正在推演第 ${p.turn||0} 拍，完成后正常速度演出。`);});
    replay=job.replay;begin();
  }catch(error){replay=null;lock(false);announce('暂时无法开赛',error.message);$('broadcast-state').textContent='计算失败';$('commentary').textContent=error.message;}
  finally{loading=false;$('start').disabled=!scene;$('edit-settings').disabled=false;historyControls();}
}
function renderHistory() {
  $('history').replaceChildren();if(!history.length){$('history').textContent='尚无完赛记录，第一场传奇由你开启。';return;}
  history.forEach(m=>{
    const row=node('div',undefined,'history-row'),button=node('button','回看比赛 ↗','history-replay');
    button.addEventListener('click',()=>{
      if(loading||!scene)return;playing=false;lock(false);players.forEach((p,i)=>p.value=m.players[i]);
      if(m.replay){replay=m.replay;begin();}
      else if(m.controllers.every(id=>controllers.some(c=>c.id===id))){controls.forEach((c,i)=>c.value=m.controllers[i]);$('series-games').value=String(m.games);startMatch(m.seed);}
      else announce('控制器未配置','这场比赛使用的真实模型当前不可用。');
      $('broadcast').scrollIntoView({block:'start',behavior:'smooth'});
    });
    row.append(node('span',m.players.map(id=>fighter(id).name).join(' vs ')),node('strong',`${m.wins.join(' : ')} · ${m.games}局`),button);$('history').append(row);
  });historyControls();
}
function table(headers,rows) {
  const e=node('table'),head=node('thead'),tr=node('tr');headers.forEach(h=>tr.append(node('th',h)));head.append(tr);e.append(head);
  const body=node('tbody');rows.forEach(values=>{const row=node('tr');values.forEach(v=>row.append(node('td',v)));body.append(row);});e.append(body);return e;
}
function improvement(s) {
  const a=s.betweenRoundImprovement,v=Array.isArray(a)?{damageShare:a.reduce((n,x)=>n+x.damageShare,0)/Math.max(1,a.length),predictionRate:a.reduce((n,x)=>n+x.predictionRate,0)/Math.max(1,a.length)}:a;
  return `伤害 ${delta(v.damageShare)} / 预判 ${delta(v.predictionRate)}`;
}
const controllerLabel = id => controllers.find(c=>c.id===id)?.label||id;
function resultTable() {
  const panel=$('series-results'),winner=replay.series.winner;
  panel.replaceChildren(node('h2',winner===null?'系列赛平局':`${fighter(replay.players[winner]).name} 赢得系列赛`),node('p',`${replay.series.wins.join(' : ')} · ${replay.games.length} 局系列赛 · SEED ${replay.seed}`,'card-kicker'));
  const scroll=node('div',undefined,'table-scroll');scroll.append(table(['选手 / 控制器','胜局','失误率','预判命中率（类别）','佯攻成功率','回合间提升'],replay.series.stats.map((s,i)=>[`${fighter(replay.players[i]).name} / ${controllerLabel(replay.controllers[i])}`,replay.series.wins[i],pct(s.mistakeRate),pct(s.predictionCategoryHitRate??s.predictionHitRate),pct(s.feintSuccessRate),improvement(s)])));panel.append(scroll);panel.hidden=false;
}
function finish() {
  finished=true;playing=false;lock(false);$('pause').disabled=true;$('broadcast-state').textContent='系列赛结束';$('feed-counter').textContent='FINAL';
  for(const id of ['draft-card','review-card','broadcast-highlight'])$(id).hidden=true;$('broadcast').dataset.phase='complete';
  const game=replay.games.at(-1),winner=replay.series.winner;
  scene.pose=null;scene.presentation={type:'result',states:game.rounds.at(-1).beats.at(-1).states,winner:winner===null?null:game.sides.indexOf(winner)};
  announce(winner===null?'系列赛 · 平局':`${fighter(replay.players[winner]).name} 获胜`,`${replay.series.wins.join(' : ')} · ${replay.games.length} 局系列赛`,'SERIES COMPLETE','result');
  $('commentary').textContent='策略已见分晓。下方查看双方能力统计与完整系列赛比分。';resultTable();audio.victory();scene.stage.react(1.8);
  const record={players:replay.players,controllers:replay.controllers,games:replay.games.length,wins:replay.series.wins,seed:replay.seed,replay};
  history=[record,...history.filter(m=>m.seed!==record.seed||String(m.players)!==String(record.players)||String(m.controllers)!==String(record.controllers)||m.games!==record.games)].slice(0,8);
  try{localStorage.setItem('celestial-strategy-matches',JSON.stringify(history));}catch{/* Playback also works without storage. */}
  renderHistory();refreshLadder();
}
function beatDetails(beat,round,index) {
  updateStats(beat.states,round.round>1?replay.games[currentGame].rounds[round.round-2].wins:[0,0]);
  const edges=beat.states.map((_,i)=>edgeWarning(beat,i));
  for(let i=0;i<2;i++){$(`reason-${i}`).textContent=beat.reasons[i];$(`status-${i}`).textContent=beat.mistakes[i]?`失误·硬直 · ${mistakeLabel(beat.mistakes[i])}`:beat.planDriven[i]?'连招计划':'';$(`status-${i}`).classList.toggle('warning',!!beat.mistakes[i]);$(`edge-${i}`).textContent=edges[i];$(`edge-${i}`).hidden=!edges[i];}
  $('range-band').textContent=`${ranges[beat.band]}${beat.cells.some(c=>c===0||c===8)?' · 边缘':''}`;
  $('commentary').textContent=beat.commentary+' '+beat.predictions.map((p,i)=>`${config(i).name}预判${moveName(p)}${beat.planDriven[i]?' · 连招计划':''}${beat.feints[i]?' · 佯攻成功':''}${beat.moves[i]==='scout'?' · 侦察完成':''}${beat.mistakes[i]?' · 失误·硬直':''}`).join('；');
  edges.forEach((label,i)=>{if(label)$('commentary').textContent+=`；${config(i).name}${label}`;});
  const items=beat.stage.items.map(x=>`${{heal:'治疗',energy:'能量',stamina:'体力'}[x.type]}道具@${x.cell}`),dangers=beat.stage.dangers.map(d=>`危险区 ${d.cells.join('/')} · -6 HP`),collected=beat.events.filter(e=>e.outcome==='item').map(e=>`${config(e.player).name}拾取道具`);
  $('stage-ticker').textContent=[...collected,...items,...dangers].join(' · ')||'场地平静 · 九格战场';
  $('battle-feed').prepend(node('li',`G${currentGame+1} R${round.round} · ${index+1} ${beat.names.map((name,i)=>`${name}${beat.mistakes[i]?`（${mistakeLabel(beat.mistakes[i])}）`:''}${edges[i]?`（${edges[i]}）`:''}`).join(' / ')}`));while($('battle-feed').children.length>24)$('battle-feed').lastChild.remove();$('feed-counter').textContent=`${index+1} EXCHANGES`;
  beat.events.forEach(e=>{if(!e.damage)return;const n=$(`damage-${eventTarget(e)}`);n.textContent=`−${e.damage}`;n.classList.remove('pop');void n.offsetWidth;n.classList.add('pop');});audio.exchange(beat.events);
}
function frame(now) {
  const dt=Math.max(0,(now-(lastFrame??now))/1000);lastFrame=now;
  if(scene){scene.paused=Boolean(replay&&!playing&&!finished);$('broadcast').dataset.paused=String(scene.paused);}audio.setPaused(document.hidden||Boolean(replay&&!playing&&!finished));
  if(playing&&replay&&scene){
    elapsed=advancePlayback(elapsed,dt*Number($('speed').value),cues,dt);const shot=broadcastAt(timeline,elapsed);$('broadcast').dataset.phase=shot.type;
    $('draft-card').hidden=shot.type!=='entrance';$('review-card').hidden=shot.type!=='outro';$('broadcast-highlight').hidden=!shot.slowMotion;
    if(shot.type==='complete')finish();else{
      if(currentGame!==shot.gameIndex){currentGame=shot.gameIndex;lastPhase='';lastBeat='';scene.setFighters([config(0),config(1)]);scene.resetPose();updateNames();updateStats();draftCard(shot.game);for(let i=0;i<2;i++){$(`reason-${i}`).textContent='等待策略指令';$(`status-${i}`).textContent='';}$('stage-ticker').textContent=currentGame?'换边 · 双方交换左右位置与禁招顺序':'赛前选招 · 同时提交，公平对决';}
      $('game-label').textContent=`第 ${currentGame+1}/${replay.games.length} 局${currentGame?' · 换边':''}`;
      const phaseKey=`${currentGame}-${shot.type}-${shot.round?.round}-${shot.player}`;
      if(shot.type==='entrance'){
        scene.pose=null;scene.presentation=shot;
        if(lastPhase!==phaseKey){lastPhase=phaseKey;resetEntrance(shot.game);const f=config(shot.player);announce(`${currentGame?'换边 · ':''}${f.name} 登场`,`${f.title} · ${replay.controllers[shot.game.sides[shot.player]]}`,'DRAFT / ENTRANCE','entrance');$('broadcast-state').textContent='赛前选招';$('commentary').textContent='双方禁招后同时选招，自创招须通过10点预算校验。';}
      }else{
        const {round}=shot;$('round-label').textContent=`ROUND ${String(round.round).padStart(2,'0')}`;const wins=round.round>1?shot.game.rounds[round.round-2].wins:[0,0];
        if(shot.type==='countdown'){
          scene.pose=null;scene.presentation=null;const count=Math.min(3,Math.floor(shot.progress*3.8)),key=`${phaseKey}-${count}`;
          if(lastPhase!==key){lastPhase=key;const budgets=round.round>1?shot.game.rounds[round.round-2].beats.at(-1).states.map(s=>s.budgetLeft):[24,24];updateStats([0,1].map(i=>({hp:100,energy:0,stamina:100,budgetLeft:budgets[i]})),wins);for(let i=0;i<2;i++){$(`reason-${i}`).textContent='准备下一回合';$(`status-${i}`).textContent='';}$('range-band').textContent='远';$('stage-ticker').textContent='九格战场 · 双方回到起点';announce(count===3?'开战！':String(3-count),`${config(0).name} VS ${config(1).name}`,`第 ${currentGame+1} 局 · 第 ${round.round} 回合`,'countdown');$('clock').textContent='30';$('broadcast-state').textContent='开赛倒计时';if(count===3)audio.bell();}
        }else if(shot.type==='fight'){
          const key=`${currentGame}-${round.round}-${shot.index}`;scene.presentation={type:'fight',slowMotion:shot.slowMotion};scene.setPose(shot.index?round.beats[shot.index-1].states:[{x:-2.1},{x:2.1}],shot.beat,shot.progress,key);$('center-announcement').classList.add('hidden');$('broadcast-state').textContent='比赛进行中';$('clock').textContent=30-shot.index;
          if(lastBeat!==key&&shot.progress>=CONTACT){lastBeat=key;beatDetails(shot.beat,round,shot.index);}
        }else if(shot.type==='outro'){
          scene.pose=null;scene.presentation={type:'outro',states:round.beats.at(-1).states,winner:round.winner};
          if(lastPhase!==phaseKey){lastPhase=phaseKey;updateStats(round.beats.at(-1).states,round.wins);reviewCard(round);announce(roundCall(round),`${round.winner===null?'本轮平局':`${config(round.winner).name} 拿下本轮`} · ${round.wins.join(' : ')}`,'ROUND COMPLETE','outro');$('broadcast-state').textContent='回合复盘';$('commentary').textContent=round.reviews.map((r,i)=>`${config(i).name}：${r.notes}`).join('；');audio.knockout();}
        }
      }
    }
  }
  requestAnimationFrame(frame);
}
$('start').addEventListener('click',()=>startMatch());
$('edit-settings').addEventListener('click',()=>{if(loading)return;lock(false);reset();players[0].focus();});
$('replay').addEventListener('click',()=>{if(replay&&!loading)begin();});
$('pause').addEventListener('click',()=>{if(!replay||finished)return;playing=!playing;$('pause').textContent=playing?'Ⅱ 暂停':'▶ 继续';$('broadcast-state').textContent=playing?'比赛继续':'比赛已暂停';lastFrame=undefined;});
document.querySelectorAll('[data-camera]').forEach(button=>button.addEventListener('click',()=>{if(scene)scene.cameraMode=button.dataset.camera;document.querySelectorAll('[data-camera]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));}));
$('sound').addEventListener('click',async()=>{try{const enabled=await audio.toggle();$('sound').setAttribute('aria-pressed',String(enabled));$('sound').querySelector('span').textContent=enabled?'音效开':'音效关';}catch{$('sound').querySelector('span').textContent='音效不可用';}});
document.addEventListener('keydown',event=>{if(event.repeat||event.altKey||event.ctrlKey||event.metaKey||['INPUT','SELECT','TEXTAREA','BUTTON','A'].includes(event.target.tagName))return;if(event.code==='Space'){event.preventDefault();$('pause').click();}if(event.key.toLowerCase()==='r')$('replay').click();if(['1','2','3'].includes(event.key))document.querySelectorAll('[data-camera]')[Number(event.key)-1].click();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing)$('pause').click();});
async function refreshLadder(){
  try{const rows=await json('/api/ladder');$('ladder-table').replaceChildren(table(['控制器','场 / 胜 / 负 / 平','胜率','失误率','预判命中率（类别）','佯攻成功率','回合间提升'],rows.map(s=>[controllerLabel(s.id),`${s.games} / ${s.wins} / ${s.losses} / ${s.draws}`,pct(s.winRate),pct(s.mistakeRate),pct(s.predictionCategoryHitRate??s.predictionHitRate),pct(s.feintSuccessRate),improvement(s)])));$('ladder-status').textContent=rows.length?'能力统计按累计决策次数加权 · 回合间提升为百分点变化':'暂无战绩。完成一场比赛，或运行内置天梯。';}catch(error){$('ladder-status').textContent=error.message;}
}
$('run-ladder').addEventListener('click',async()=>{ $('run-ladder').disabled=true;try{$('ladder-status').textContent='后台计算中 · 内置天梯';const {id}=await post('/api/ladder/run',{games:2});await poll(`/api/ladder/run/${id}`,p=>{$('ladder-status').textContent=`后台计算中 · 天梯 ${p.completed||0}/${p.total||10} 组 · 第${p.game||1}局 第${p.round||1}回合`;});await refreshLadder();}catch(error){$('ladder-status').textContent=error.message;}finally{$('run-ladder').disabled=false;} });
try{const saved=JSON.parse(localStorage.getItem('celestial-strategy-matches')||'[]');if(Array.isArray(saved))history=saved.filter(m=>m&&Array.isArray(m.players)&&m.players.length===2&&m.players.every(id=>fighter(id))&&Array.isArray(m.wins)&&m.wins.length===2&&Array.isArray(m.controllers)&&m.controllers.length===2&&Number.isSafeInteger(m.seed)).slice(0,8);}catch{/* Ignore damaged local history. */}
reset();renderHistory();requestAnimationFrame(frame);
try{
  controllers=await json('/api/controllers');if(!controllers.length)throw new Error('没有可用控制器');controls.forEach((s,i)=>{controllers.forEach(c=>s.append(option(c.id,c.label)));s.value=`builtin:${players[i].value}`;});
  const {FightScene}=await import('./fight-scene.js');scene=new FightScene($('scene'),players.map(p=>fighter(p.value)));$('loading-scene').remove();$('start').disabled=false;historyControls();
  $('scene').addEventListener('rendererror',()=>{playing=false;$('start').disabled=true;$('pause').disabled=true;announce('3D 画面已中断','请刷新页面重新连接渲染器。');});
}catch(error){$('loading-scene').textContent='无法初始化比赛，请检查连接与 WebGL 支持。';announce('暂时无法载入',error.message);console.error('Arena initialization failed:',error);}
refreshLadder();
