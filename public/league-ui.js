// Homepage league desk: live match, schedule and season standings.
import { fighters } from './fight-engine.js';

export const symbols = {gpt:'✧',claude:'✺',gemini:'✦',deepseek:'≋',grok:'♆'};
export const fighter = id => fighters.find(f=>f.id===id) || {id,name:id,title:'',color:'#c3b0fc'};
export function node(tag,text,className) {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
export function link(href,text,className) {const e=node('a',text,className);e.href=href;return e;}
export const clock = ms => {const s=Math.max(0,Math.round(ms/1000));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
export const time = ms => new Date(ms).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
export function badge(id) {
  const f=fighter(id),e=link(`/fighter?id=${encodeURIComponent(id)}`,undefined,'league-fighter');e.style.setProperty('--fighter',f.color);
  e.append(node('span',symbols[id]||'✦','league-symbol'),node('b',f.name));return e;
}
export function tierChip(tiers,tier) {const e=node('span',tiers[tier]||'','tier-chip');e.dataset.tier=String(tier);return e;}
export function matchStatus(m,now) {
  if(m.status==='done')return m.result.winner===null?`平局 ${m.result.wins.join(' : ')}`:`${fighter(m.players[m.result.winner]).name} 胜 ${m.result.wins.join(' : ')}`;
  if(m.status==='live')return `直播中 · ${clock(now-m.startedAt)} / ${clock(m.duration)}`;
  if(m.status==='void')return `取消 · ${m.error||'未计入'}`;
  return m.estimatedStart?`预计 ${time(m.estimatedStart)}${m.computing?' · 后台计算中':m.ready?' · 已就绪':''}`:'待赛';
}

export function mountLeague({onWatch}) {
  const $ = id => document.getElementById(id);
  let data=null,offset=0;
  function standings(season,tiers) {
    const table=node('table'),head=node('tr');['名次','选手','段位','等级分','胜 / 平 / 负','局分','积分'].forEach(h=>head.append(node('th',h)));
    const thead=node('thead');thead.append(head);const body=node('tbody');
    season.standings.forEach(r=>{const tr=node('tr');const name=node('td');name.append(badge(r.id));const tier=node('td');tier.append(tierChip(tiers,r.tier));
      tr.append(node('td',String(r.place),'place'),name,tier,node('td',String(r.rating)),node('td',`${r.wins} / ${r.draws} / ${r.losses}`),node('td',`${r.gamesWon} : ${r.gamesLost}`),node('td',String(r.points),'points'));body.append(tr);});
    table.append(thead,body);return table;
  }
  function schedule(season,now) {
    const list=node('div',undefined,'schedule');
    const rounds=[...new Set(season.matches.map(m=>m.round))];
    for(const round of rounds) {
      const group=node('div',undefined,'schedule-round');group.append(node('h4',`第 ${round} 轮`));
      for(const m of season.matches.filter(x=>x.round===round)) {
        const row=node('div',undefined,`schedule-row ${m.status}`);row.dataset.match=m.id;
        const vs=node('span',undefined,'schedule-vs');vs.append(badge(m.players[0]),node('i','VS'),badge(m.players[1]));
        row.append(vs,node('span',matchStatus(m,now),'schedule-status'));
        if(m.status==='live'||m.status==='done'){const b=node('button',m.status==='live'?'观看直播 ▶':'回放 ↻','schedule-watch');b.addEventListener('click',()=>onWatch(m.id));row.append(b);}
        else row.append(node('span','', 'schedule-watch placeholder'));
        group.append(row);
      }
      list.append(group);
    }
    return list;
  }
  function liveCard(now) {
    const card=$('league-live'),m=data.live||data.next;card.replaceChildren();card.dataset.state=data.live?'live':'next';
    if(!data.season){card.append(node('strong','联赛准备中'));return;}
    if(data.season.status==='complete'){card.dataset.state='break';card.append(node('small','SEASON COMPLETE'),node('strong',`第 ${data.season.number} 赛季结束 · 冠军 ${fighter(data.previous?.champion).name}`),node('span',`新赛季约 ${clock(data.season.nextAt-now)} 后开赛`));return;}
    if(!m){card.append(node('strong','本赛季比赛已全部结束'));return;}
    const vs=node('div',undefined,'live-vs');vs.append(badge(m.players[0]),node('i','VS'),badge(m.players[1]));
    if(data.live){
      const b=node('button','进入直播 ▶','primary-button live-button');b.id='league-watch-live';b.addEventListener('click',()=>onWatch(m.id));
      card.append(node('small',`● LIVE · 第 ${data.season.number} 赛季 · 第 ${m.round} 轮`),vs,node('span',`已开赛 ${clock(now-m.startedAt)} / 全长 ${clock(m.duration)} · 双局换边`,'live-progress'),b);
    }else card.append(node('small',`NEXT · 第 ${m.round} 轮`),vs,node('span',matchStatus(m,now),'live-progress'));
  }
  function render() {
    if(!data)return;const now=Date.now()+offset;
    $('season-badge').textContent=data.season?`SEASON ${String(data.season.number).padStart(2,'0')} · ${data.live?'LIVE':'AUTO'}`:'AUTO LEAGUE';
    if(!data.season){$('league-status').textContent='联赛准备中…';return;}
    $('league-title').textContent=`第 ${data.season.number} 赛季`;
    $('league-status').textContent=`已赛 ${data.season.played}/${data.season.total} 场 · 循环赛，每场两局换边 · 胜3分 平1分 · 等级分按国际象棋Elo计算`;
    liveCard(now);
    $('league-schedule').replaceChildren(schedule(data.season,now));
    const scroll=node('div',undefined,'table-scroll');scroll.append(standings(data.season,data.tiers));$('league-standings').replaceChildren(scroll);
    const prev=$('league-previous');prev.replaceChildren();
    if(data.previous){
      prev.hidden=false;prev.append(node('small',`第 ${data.previous.number} 赛季冠军`));const champ=node('div',undefined,'champion');champ.append(node('span','♛','crown'),badge(data.previous.champion));prev.append(champ);
      const moves=node('div',undefined,'tier-moves');
      data.previous.changes.forEach(c=>{const e=node('span',undefined,`tier-move ${c.change>0?'up':c.change<0?'down':'stay'}`);e.append(node('b',`${c.place}. ${fighter(c.id).name}`),node('span',c.change>0?`▲ 晋级 ${data.tiers[c.to]}`:c.change<0?`▼ 降级 ${data.tiers[c.to]}`:`保级 ${data.tiers[c.to]}`));moves.append(e);});
      prev.append(moves);
    }else prev.hidden=true;
  }
  async function refresh() {
    try{const r=await fetch('/api/league'),json=await r.json();if(!r.ok)throw new Error(json.error);data=json;offset=data.now-Date.now();render();}
    catch(error){$('league-status').textContent=error.message||'联赛暂时不可用';}
  }
  refresh();setInterval(refresh,5000);setInterval(render,1000);
  return {refresh,get data(){return data;}};
}
