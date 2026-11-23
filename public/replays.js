import { fighters } from './fight-engine.js';
import { fighter, node, link, badge, time } from './league-ui.js';

const $ = id => document.getElementById(id), params = new URLSearchParams(location.search);
fighters.forEach(f=>{const o=node('option',`${f.name} · ${f.title}`);o.value=f.id;$('filter-fighter').append(o);});
async function seasons() {
  const r=await fetch('/api/league'),data=await r.json();
  for(const s of data.seasons||[]){const o=node('option',`第 ${s.number} 赛季${s.champion?` · 冠军 ${fighter(s.champion).name}`:' · 进行中'}`);o.value=String(s.number);$('filter-season').append(o);}
  $('filter-season').value=params.get('season')||'';$('filter-fighter').value=params.get('fighter')||'';
}
async function load() {
  const q=new URLSearchParams();if($('filter-season').value)q.set('season',$('filter-season').value);if($('filter-fighter').value)q.set('fighter',$('filter-fighter').value);
  history.replaceState(null,'',`/replays${q.size?`?${q}`:''}`);
  const r=await fetch(`/api/league/matches?${q}`),list=await r.json();
  $('replay-count').textContent=r.ok?`共 ${list.length} 场`:list.error;
  $('replay-list').replaceChildren(...(r.ok&&list.length?list.map(m=>{
    const row=node('div',undefined,`match-row ${m.status}`),vs=node('span',undefined,'schedule-vs');vs.append(badge(m.players[0]),node('i','VS'),badge(m.players[1]));
    const score=m.status==='live'?'● 直播中':m.result.winner===null?`平局 ${m.result.wins.join(' : ')}`:`${fighter(m.players[m.result.winner]).name} 胜 ${m.result.wins.join(' : ')}`;
    row.append(node('span',`S${m.season} · 第${m.round}轮 · ${time(m.startedAt)}`,'meta'),vs,node('span',score,'score'),link(`/?match=${m.id}`,m.status==='live'?'观看直播 ▶':'观看回放 ↻','watch'));return row;
  }):[node('p','暂无符合条件的比赛。','empty')]));
}
$('filter-season').addEventListener('change',load);$('filter-fighter').addEventListener('change',load);
await seasons();await load();
