import { fighters } from './fight-engine.js';
import { fighter, node, link, badge, tierChip, symbols } from './league-ui.js';

const $ = id => document.getElementById(id), NS = 'http://www.w3.org/2000/svg';
const id = new URLSearchParams(location.search).get('id') || 'gpt', me = fighter(id);
const svg = (tag, attrs={}) => {const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
document.title = `${me.name} · 选手档案 · LLM ARENA`;
$('fighter-hero').style.setProperty('--fighter', me.color);
fighters.forEach(f=>{const b=badge(f.id);if(f.id===id)b.setAttribute('aria-current','page');$('fighter-switch').append(b);});
$('fighter-name').firstChild.textContent = me.name;$('fighter-title').textContent = `${me.title} · ${me.description||''}`;
$('fighter-provider').textContent = `${me.provider||''} · ${me.skill||''}`;$('fighter-fallback').textContent = symbols[id]||'✦';

function radarChart(axes) {
  const size=320,c=size/2,r=110,s=svg('svg',{viewBox:`0 0 ${size} ${size}`,role:'img','aria-label':axes.map(a=>`${a.label}${a.value}`).join('，')});
  const point=(i,v)=>{const a=-Math.PI/2+i*2*Math.PI/axes.length;return [c+Math.cos(a)*r*v,c+Math.sin(a)*r*v];};
  for(const level of [.25,.5,.75,1])s.append(svg('polygon',{points:axes.map((_,i)=>point(i,level).join(',')).join(' '),fill:'none',stroke:'#ffffff1c'}));
  axes.forEach((a,i)=>{const [x,y]=point(i,1);s.append(svg('line',{x1:c,y1:c,x2:x,y2:y,stroke:'#ffffff14'}));const [lx,ly]=point(i,1.22),t=svg('text',{x:lx,y:ly+4,'text-anchor':'middle'});t.textContent=a.label;s.append(t);});
  s.append(svg('polygon',{points:axes.map((a,i)=>point(i,a.value/100).join(',')).join(' '),fill:me.color,'fill-opacity':.35,stroke:me.color,'stroke-width':2}));
  axes.forEach((a,i)=>{const [x,y]=point(i,a.value/100);s.append(svg('circle',{cx:x,cy:y,r:4,fill:me.color}));const t=svg('text',{x,y:y-8,'text-anchor':'middle',class:'value-label'});t.textContent=a.value;s.append(t);});
  return s;
}
function trendChart(points) {
  const w=520,h=180,p=26,values=points.map(x=>x.rating),min=Math.min(...values)-20,max=Math.max(...values)+20,s=svg('svg',{viewBox:`0 0 ${w} ${h}`,role:'img','aria-label':`等级分 ${values.at(-1)}`});
  const x=i=>p+(w-2*p)*(points.length>1?i/(points.length-1):.5),y=v=>h-p-(h-2*p)*(v-min)/Math.max(1,max-min);
  const base=svg('line',{x1:p,x2:w-p,y1:y(1500),y2:y(1500),stroke:'#ffffff22','stroke-dasharray':'4 4'});s.append(base);
  const label=svg('text',{x:p,y:y(1500)-4});label.textContent='1500';s.append(label);
  s.append(svg('polyline',{points:points.map((q,i)=>`${x(i)},${y(q.rating)}`).join(' '),fill:'none',stroke:me.color,'stroke-width':3,'stroke-linejoin':'round'}));
  points.forEach((q,i)=>s.append(svg('circle',{cx:x(i),cy:y(q.rating),r:3,fill:me.color})));
  const end=svg('text',{x:w-p,y:y(values.at(-1))-8,'text-anchor':'end'});end.textContent=String(values.at(-1));s.append(end);
  return s;
}
function card(label,value,detail='') {const e=node('div',undefined,'stat-card');e.append(node('small',label),node('strong',value),node('span',detail));return e;}
const pct = (a,b) => b?`${Math.round(a/b*100)}%`:'—';
async function load() {
  const r=await fetch(`/api/league/fighters/${encodeURIComponent(id)}`),data=await r.json();
  if(!r.ok){$('fighter-note').textContent=data.error||'暂无联赛数据。';return;}
  const a=data.record;
  $('fighter-meta').replaceChildren(tierChip(data.tiers,data.tier),node('span',`等级分 ${data.rating} · 最高 ${data.peak}`),node('span',`${data.seasons.filter(s=>s.champion).length} 次赛季冠军`));
  $('fighter-cards').replaceChildren(card('系列赛',`${a.seriesWins}-${a.seriesDraws}-${a.seriesLosses}`,'胜-平-负'),card('局数',`${a.gamesWon}:${a.gamesLost}`,`局胜率 ${pct(a.gamesWon,a.gamesWon+a.gamesLost+a.gamesDrawn)}`),card('回合',`${a.roundsWon}/${a.roundsPlayed}`,`KO ${a.kos} 次`),card('伤害',`${a.damageDealt}`,`承受 ${a.damageTaken}`));
  $('fighter-radar').replaceChildren(a.matches?radarChart(data.radar):node('p','完成第一场联赛后生成能力雷达。','empty'));
  $('fighter-trend').replaceChildren(trendChart(data.ratingHistory));
  $('fighter-seasons').replaceChildren(...data.seasons.map(s=>{const e=node('span',undefined,`tier-move ${s.to>s.from?'up':s.to<s.from?'down':'stay'}`);e.append(node('b',`S${s.number} 第${s.place}名${s.champion?' ♛':''}`),node('span',`${data.tiers[s.from]} → ${data.tiers[s.to]}`));return e;}));
  const table=node('table'),head=node('tr');['对手','系列赛 胜/平/负','局分','最近一场'].forEach(h=>head.append(node('th',h)));const thead=node('thead');thead.append(head);const body=node('tbody');
  for(const h of data.headToHead){const tr=node('tr'),who=node('td'),last=node('td');who.append(badge(h.opponent));
    if(h.last)last.append(h.last.pruned?node('span',`S${h.last.season} ${h.last.wins.join(':')}`):link(`/?match=${h.last.id}`,`S${h.last.season} ${h.last.wins.join(':')} ↻`,'watch'));
    tr.append(who,node('td',`${h.wins} / ${h.draws} / ${h.losses}`,h.wins>h.losses?'win':h.wins<h.losses?'loss':'draw'),node('td',`${h.gamesWon} : ${h.gamesLost}`),last);body.append(tr);}
  table.append(thead,body);$('fighter-h2h').replaceChildren(data.headToHead.length?table:node('p','尚无交锋记录。','empty'));
  $('fighter-matches').replaceChildren(...(data.matches.length?data.matches.map(m=>{const i=m.players.indexOf(id),o=m.players[1-i],res=m.result.winner===null?'draw':m.result.winner===i?'win':'loss';
    const row=node('div',undefined,'match-row');row.append(node('span',`S${m.season} · R${m.round}`,'meta'),badge(o),node('span',`${{win:'胜',loss:'负',draw:'平'}[res]} ${m.result.wins[i]}:${m.result.wins[1-i]}`,`score ${res}`),link(`/?match=${m.id}`,'回放 ↻','watch'));return row;}):[node('p','尚无联赛比赛。','empty')]));
}
async function portrait() {
  try{
    const T=await import('/vendor/three.module.js'),{makeFighter}=await import('./fight-models.js');
    const box=$('fighter-stage'),renderer=new T.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=T.SRGBColorSpace;
    const scene=new T.Scene(),camera=new T.PerspectiveCamera(30,1,.1,50);camera.position.set(0,1.6,8.4);camera.lookAt(0,1.2,0);
    scene.add(new T.HemisphereLight('#ffe9f4','#51405d',2.2));const sun=new T.DirectionalLight('#ffd2b0',2.4);sun.position.set(3,5,4);scene.add(sun);const rim=new T.DirectionalLight(me.color,2);rim.position.set(-3,3,-3);scene.add(rim);
    const model=makeFighter(me),floor=new T.Mesh(new T.CircleGeometry(1.4,48),new T.MeshStandardMaterial({color:me.color,transparent:true,opacity:.25}));floor.rotation.x=-Math.PI/2;scene.add(floor,model.root);
    box.append(renderer.domElement);$('fighter-fallback').remove();
    const resize=()=>{const w=box.clientWidth,h=box.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();};resize();addEventListener('resize',resize);
    const tick=t=>{model.root.rotation.y=Math.sin(t/2400)*.7;model.body.position.y=Math.sin(t/420)*.03;renderer.render(scene,camera);requestAnimationFrame(tick);};requestAnimationFrame(tick);
  }catch(error){console.error('Portrait unavailable:',error);}
}
load();portrait();
