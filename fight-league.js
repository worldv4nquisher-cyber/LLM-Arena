// The automatic league schedules round-robin seasons, computes each series in the
// background and releases it as a live broadcast on the server clock.
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {randomInt} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {buildBroadcast} from './public/fight-broadcast.js';
import {eventTarget} from './public/strategy-rules.js';

export const tiers=['青铜','白银','黄金','铂金','钻石','星穹'];
export const START_RATING=1500, START_TIER=2, RATING_K=32, SERIES_GAMES=2;
const POINTS={win:3,draw:1,loss:0};

export function roundRobin(ids) {
  const slots=ids.length%2?[...ids,null]:[...ids],n=slots.length,rounds=[],firsts=Object.fromEntries(ids.map(id=>[id,0]));
  for(let r=0;r<n-1;r++) {
    const pairs=[];
    for(let i=0;i<n/2;i++) {
      const a=slots[i],b=slots[n-1-i];
      if(a!==null&&b!==null){const pair=firsts[b]<firsts[a]?[b,a]:[a,b];firsts[pair[0]]++;pairs.push(pair);}
    }
    rounds.push(pairs);
    slots.splice(1,0,slots.pop());
  }
  return rounds;
}
export const expectedScore=(rating,opponent)=>1/(1+10**((opponent-rating)/400));
export function rateGame(a,b,score,k=RATING_K) {
  const change=k*(score-expectedScore(a,b));
  return [a+change,b-change];
}

function emptyAgg(){return {matches:0,seriesWins:0,seriesDraws:0,seriesLosses:0,gamesWon:0,gamesLost:0,gamesDrawn:0,roundsWon:0,roundsPlayed:0,kos:0,damageDealt:0,damageTaken:0,decisions:0,mistakes:0,predictions:0,predictionsCorrect:0,feintsAttempted:0,feintsSuccessful:0,planTurns:0,scouts:0};}
function summarize(replay) {
  const sides=[0,1].map(p=>({p,...emptyAgg(),matches:1}));
  for(const game of replay.games) {
    for(let side=0;side<2;side++) {
      const s=sides[game.sides[side]];
      if(game.winner===null)s.gamesDrawn++;else if(game.winner===side)s.gamesWon++;else s.gamesLost++;
      for(const round of game.rounds) {
        s.roundsPlayed++;if(round.winner===side){s.roundsWon++;if(round.ending==='ko')s.kos++;}
        for(const beat of round.beats)for(const e of beat.events) {
          if(e.player===side&&e.outcome!=='danger')s.damageDealt+=e.damage||0;
          if(eventTarget(e)===side)s.damageTaken+=e.damage||0;
        }
      }
    }
  }
  replay.series.stats.forEach((t,i)=>{for(const key of ['decisions','mistakes','predictions','predictionsCorrect','feintsAttempted','feintsSuccessful','planTurns','scouts'])sides[i][key]+=t[key]||0;});
  const winner=replay.series.winner;
  sides.forEach((s,i)=>{if(winner===null)s.seriesDraws++;else if(winner===i)s.seriesWins++;else s.seriesLosses++;delete s.p;});
  return sides;
}
function addAgg(target,source){for(const key of Object.keys(target))target[key]+=source[key]||0;return target;}
export function radar(a) {
  const ratio=(x,y)=>y?x/y:0,pct=n=>Math.round(Math.max(0,Math.min(1,n))*100);
  return [
    {id:'offense',label:'进攻',value:pct(ratio(a.damageDealt,a.damageDealt+a.damageTaken))},
    {id:'reading',label:'读招',value:pct(ratio(a.predictionsCorrect,a.predictions))},
    {id:'feint',label:'佯攻',value:pct(ratio(a.feintsSuccessful,a.feintsAttempted))},
    {id:'discipline',label:'稳定',value:a.decisions?pct(1-a.mistakes/a.decisions):0},
    {id:'combo',label:'连招',value:pct(ratio(a.planTurns,a.planTurns+a.decisions))},
    {id:'finish',label:'终结',value:pct(ratio(a.kos,a.roundsPlayed))},
  ];
}

export function seasonStandings(season,ratings={}) {
  const rows=Object.fromEntries(season.participants.map(p=>[p.id,{id:p.id,controller:p.controller,played:0,wins:0,draws:0,losses:0,gamesWon:0,gamesLost:0,points:0,rating:Math.round(ratings[p.id]?.rating??START_RATING),tier:ratings[p.id]?.tier??START_TIER}]));
  for(const m of season.matches) {
    if(m.status!=='done')continue;
    m.players.forEach((id,i)=>{
      const r=rows[id];if(!r)return;
      r.played++;r.gamesWon+=m.result.wins[i];r.gamesLost+=m.result.wins[1-i];
      if(m.result.winner===null){r.draws++;r.points+=POINTS.draw;}else if(m.result.winner===i){r.wins++;r.points+=POINTS.win;}else{r.losses++;r.points+=POINTS.loss;}
    });
  }
  return Object.values(rows).sort((a,b)=>b.points-a.points||(b.gamesWon-b.gamesLost)-(a.gamesWon-a.gamesLost)||b.rating-a.rating||a.id.localeCompare(b.id)).map((r,i)=>({...r,place:i+1}));
}
export function tierChanges(final,ratings) {
  const n=final.length,moves=n>=5?2:1;
  return final.map((row,i)=>{
    const from=ratings[row.id]?.tier??START_TIER,step=i<moves?1:i>=n-moves?-1:0,to=Math.max(0,Math.min(tiers.length-1,from+step));
    return {id:row.id,place:row.place,from,to,change:to-from};
  });
}

const publicMatch=(m,now)=>({id:m.id,season:m.season,round:m.round,order:m.order,players:m.players,controllers:m.controllers,status:m.status==='computing'||m.status==='ready'?'scheduled':m.status,computing:m.status==='computing',ready:m.status==='ready',startedAt:m.startedAt??null,endsAt:m.endsAt??null,duration:m.status==='live'||m.status==='done'?m.duration:null,elapsed:m.status==='live'?Math.max(0,now-m.startedAt):null,error:m.error,...(m.status==='done'?{result:m.result}:{})});

function predictionOutcome(m,pick) {
  if(pick===null||m.status!=='done'&&m.status!=='void')return null;
  if(m.status==='void')return 'void';
  return m.result.winner===null?'draw':pick===m.result.winner?'correct':'wrong';
}
function predictionFor(m,spectator) {
  const votes=[0,0],pick=m.picks?.[spectator]??null;
  for(const side of Object.values(m.picks??{}))votes[side]++;
  return {votes,pick,outcome:predictionOutcome(m,pick)};
}

export function createLeague({path=new URL('./data/league/',import.meta.url),run,now=Date.now,intermission=45000,seasonBreak=90000,firstDelay=5000,roster,ladder,interval=1000,autostart=true,keepReplays=400}={}) {
  const root=path===null?null:path instanceof URL?fileURLToPath(path):path;
  const replays=new Map();
  let state=null,computing=null,timer=null,ticking=Promise.resolve(),closed=false;
  const fresh=()=>({version:1,ratings:{},seasons:[]});
  const participants=()=>(typeof roster==='function'?roster():roster).map(p=>({id:p.id,controller:p.controller}));
  const ready=(async()=>{
    if(root!==null)try{const saved=JSON.parse(await readFile(join(root,'state.json'),'utf8'));if(saved.version===1&&Array.isArray(saved.seasons))state=saved;}catch{/* Start a new league. */}
    state??=fresh();
    for(const m of state.seasons.flatMap(s=>s.matches))if(m.status==='computing')m.status='scheduled';
  })();
  let writing=Promise.resolve();
  function persist() {
    if(root===null)return writing;
    const snapshot=JSON.stringify(state);
    writing=writing.then(async()=>{try{await mkdir(root,{recursive:true});await writeFile(join(root,'state.json.tmp'),snapshot);await rename(join(root,'state.json.tmp'),join(root,'state.json'));}catch{/* The league keeps running in memory. */}});
    return writing;
  }
  async function saveReplay(id,replay) {
    replays.set(id,replay);
    if(root===null)return;
    try{await mkdir(join(root,'replays'),{recursive:true});await writeFile(join(root,'replays',`${id}.json`),JSON.stringify(replay));replays.delete(id);}catch{/* Keep it in memory. */}
  }
  async function loadReplay(id) {
    if(replays.has(id))return replays.get(id);
    if(root===null)return null;
    try{return JSON.parse(await readFile(join(root,'replays',`${id}.json`),'utf8'));}catch{return null;}
  }
  const rating=id=>state.ratings[id]??={rating:START_RATING,tier:START_TIER,peak:START_RATING};
  function newSeason(at) {
    const list=participants(),number=(state.seasons.at(-1)?.number??0)+1;
    list.forEach(p=>rating(p.id));
    const matches=roundRobin(list.map(p=>p.id)).flatMap((pairs,r)=>pairs.map((players,i)=>({players,round:r+1}))).map((m,i)=>({
      id:`s${number}-m${String(i+1).padStart(2,'0')}`,season:number,round:m.round,order:i+1,players:m.players,
      controllers:m.players.map(id=>list.find(p=>p.id===id).controller),seed:randomInt(0x100000000),status:'scheduled'}));
    const season={number,status:'active',startedAt:at,nextAt:at+firstDelay,participants:list,matches};
    state.seasons.push(season);return season;
  }
  function finalize(m,replay,at) {
    const before=m.players.map(id=>rating(id).rating);let ratings=[...before];
    for(const game of replay.games) {
      const first=game.sides[0],score=game.winner===null?.5:game.winner===0?1:0;
      const next=rateGame(ratings[first],ratings[1-first],score);ratings[first]=next[0];ratings[1-first]=next[1];
    }
    m.players.forEach((id,i)=>{const r=rating(id);r.rating=ratings[i];r.peak=Math.max(r.peak,ratings[i]);});
    m.result={wins:replay.series.wins,winner:replay.series.winner,games:replay.games.map(g=>({sides:g.sides,winner:g.winner===null?null:g.sides[g.winner],rounds:g.rounds.length})),stats:summarize(replay),ratings:{before:before.map(Math.round),after:ratings.map(Math.round)}};
    m.status='done';m.endedAt=at;
  }
  function completeSeason(season,at) {
    const final=seasonStandings(season,state.ratings),played=season.matches.some(m=>m.status==='done');
    const changes=played?tierChanges(final,state.ratings):final.map(r=>({id:r.id,place:r.place,from:r.tier,to:r.tier,change:0}));
    for(const c of changes)rating(c.id).tier=c.to;
    Object.assign(season,{status:'complete',endedAt:at,nextAt:at+seasonBreak,champion:played?final[0]?.id??null:null,final,changes});
  }
  async function pruneReplays() {
    const done=state.seasons.flatMap(s=>s.matches).filter(m=>m.status==='done'&&!m.pruned);
    for(const m of done.slice(0,Math.max(0,done.length-keepReplays))){m.pruned=true;replays.delete(m.id);if(root!==null)await rm(join(root,'replays',`${m.id}.json`),{force:true}).catch(()=>{});}
  }
  function startCompute(m) {
    m.status='computing';
    const task=(async()=>{
      try{
        const replay=await run({players:m.players,controllers:m.controllers,games:SERIES_GAMES,seed:m.seed});
        if(state.seasons.at(-1)?.matches.includes(m)&&m.status==='computing'){await saveReplay(m.id,replay);m.duration=Math.round(buildBroadcast(replay).duration*1000);m.status='ready';}
      }catch(error){if(m.status==='computing'){if(error?.retry)m.status='scheduled';else{m.status='void';m.error=typeof error?.message==='string'?error.message:'比赛计算失败。';}}}
      finally{computing=null;await persist();}
    })();
    computing=task;
  }
  async function step() {
    await ready;if(closed)return;
    const at=now();let season=state.seasons.at(-1);
    if(!season||season.status==='complete'&&at>=season.nextAt){season=newSeason(at);await persist();}
    if(season.status!=='active')return;
    const live=season.matches.find(m=>m.status==='live');
    if(live&&at>=live.endsAt) {
      const replay=await loadReplay(live.id);
      if(replay)finalize(live,replay,at);else{live.status='void';live.error='回放丢失。';}
      season.nextAt=at+intermission;await pruneReplays();await persist();
    }
    if(!season.matches.some(m=>m.status==='live')) {
      const next=season.matches.find(m=>['scheduled','computing','ready'].includes(m.status));
      if(!next){completeSeason(season,at);await persist();return;}
      if(next.status==='ready'&&at>=season.nextAt){next.status='live';next.startedAt=at;next.endsAt=at+next.duration;await persist();}
    }
    const pending=season.matches.find(m=>m.status==='scheduled');
    if(!computing&&pending&&season.matches.filter(m=>m.status==='ready').length<1)startCompute(pending);
  }
  const tick=()=>(ticking=ticking.then(step,step));
  const estimate=(season,at)=>{
    const avg=season.matches.filter(m=>m.duration).reduce((n,m,_,a)=>n+m.duration/a.length,0)||260000;
    let t=Math.max(at,season.nextAt??at);const live=season.matches.find(m=>m.status==='live');if(live)t=live.endsAt+intermission;
    return Object.fromEntries(season.matches.filter(m=>['scheduled','computing','ready'].includes(m.status)).map(m=>{const start=t;t+=(m.duration||avg)+intermission;return [m.id,start];}));
  };
  const allMatches=()=>state.seasons.flatMap(s=>s.matches);
  function spectatorScore(spectator) {
    let points=0,streak=0,last=null;
    for(const m of allMatches()){
      const pick=m.picks?.[spectator]??null,outcome=predictionOutcome(m,pick);
      if(!outcome)continue;
      if(outcome==='correct'){points++;streak++;}
      else if(outcome==='wrong')streak=0;
      last={id:m.id,player:m.players[pick],outcome};
    }
    return {points,streak,last};
  }
  function fighterAggregate(id,matches) {
    const agg=emptyAgg();for(const m of matches){const i=m.players.indexOf(id);if(i>=0)addAgg(agg,m.result.stats[i]);}return agg;
  }
  const api={
    tick,
    get computing(){return computing;},
    async snapshot(spectator) {
      await ready;const at=now(),season=state.seasons.at(-1);
      if(!season)return {now:at,season:null,live:null,next:null,tiers,ratings:[],previous:null,seasons:[]};
      const times=season.status==='active'?estimate(season,at):{};
      const matches=season.matches.map(m=>({...publicMatch(m,at),estimatedStart:times[m.id]??null,prediction:predictionFor(m,spectator)}));
      const previous=[...state.seasons].reverse().find(s=>s.status==='complete');
      return {now:at,tiers,...(spectator?{spectator:spectatorScore(spectator)}:{}),season:{number:season.number,status:season.status,startedAt:season.startedAt,endedAt:season.endedAt??null,nextAt:season.nextAt,matches,standings:seasonStandings(season,state.ratings),played:season.matches.filter(m=>m.status==='done').length,total:season.matches.length},
        live:matches.find(m=>m.status==='live')??null,next:matches.find(m=>m.status==='scheduled')??null,
        ratings:Object.entries(state.ratings).map(([id,r])=>({id,rating:Math.round(r.rating),tier:r.tier,peak:Math.round(r.peak)})).sort((a,b)=>b.rating-a.rating),
        previous:previous?{number:previous.number,champion:previous.champion,final:previous.final,changes:previous.changes,endedAt:previous.endedAt}:null,
        seasons:state.seasons.map(s=>({number:s.number,status:s.status,champion:s.champion??null}))};
    },
    async predict(id,spectator,side) {
      await ready;
      const m=allMatches().find(x=>x.id===id);
      if(!m)return {status:404,data:{error:'找不到联赛比赛。'}};
      if(!['scheduled','computing','ready'].includes(m.status))return {status:409,data:{error:'本场竞猜已关闭。'}};
      (m.picks??={})[spectator]=side;
      const data=predictionFor(m,spectator);
      await persist();
      return {status:200,data};
    },
    async isLive(id) {
      await ready;
      return !!state.seasons.at(-1)?.matches.some(m=>m.id===id&&m.status==='live'&&now()<m.endsAt);
    },
    async library({season,fighter}={}) {
      await ready;const at=now();
      return allMatches().filter(m=>(m.status==='done'||m.status==='live')&&!m.pruned&&(season===undefined||m.season===season)&&(fighter===undefined||m.players.includes(fighter))).map(m=>publicMatch(m,at)).reverse();
    },
    async match(id) {
      await ready;const m=allMatches().find(x=>x.id===id),at=now();
      if(!m)return null;
      if(m.status!=='done'&&m.status!=='live')return {match:publicMatch(m,at),replay:null,serverNow:at};
      return {match:publicMatch(m,at),replay:m.pruned?null:await loadReplay(id),serverNow:at};
    },
    async fighter(id) {
      await ready;if(!state.ratings[id])return null;
      const done=allMatches().filter(m=>m.status==='done'&&m.players.includes(id)),r=state.ratings[id],agg=fighterAggregate(id,done);
      const opponents={};
      for(const m of done){const i=m.players.indexOf(id),o=m.players[1-i],h=opponents[o]??={opponent:o,matches:0,wins:0,draws:0,losses:0,gamesWon:0,gamesLost:0,last:null};h.matches++;h.gamesWon+=m.result.wins[i];h.gamesLost+=m.result.wins[1-i];if(m.result.winner===null)h.draws++;else if(m.result.winner===i)h.wins++;else h.losses++;h.last={id:m.id,season:m.season,wins:[m.result.wins[i],m.result.wins[1-i]],pruned:!!m.pruned};}
      const seasons=state.seasons.filter(s=>s.status==='complete').map(s=>{const row=s.final.find(x=>x.id===id),c=s.changes.find(x=>x.id===id);return row&&{number:s.number,place:row.place,points:row.points,champion:s.champion===id,from:c.from,to:c.to};}).filter(Boolean);
      return {id,rating:Math.round(r.rating),peak:Math.round(r.peak),tier:r.tier,tiers,record:agg,radar:radar(agg),
        ratingHistory:[{id:null,season:null,rating:START_RATING},...done.map(m=>({id:m.id,season:m.season,rating:m.result.ratings.after[m.players.indexOf(id)]}))],
        headToHead:Object.values(opponents),seasons,
        matches:done.map(m=>publicMatch(m,now())).reverse().slice(0,30)};
    },
    async reset() {
      await ready;await ticking;await computing;
      state=fresh();replays.clear();
      if(root!==null)await rm(join(root,'replays'),{recursive:true,force:true}).catch(()=>{});
      await ladder?.reset?.();await persist();await tick();
    },
    start(){if(!timer&&!closed){timer=setInterval(tick,interval);timer.unref?.();tick();}},
    async close(){closed=true;clearInterval(timer);timer=null;await ticking;await computing;await writing;},
  };
  if(autostart)api.start();
  return api;
}
