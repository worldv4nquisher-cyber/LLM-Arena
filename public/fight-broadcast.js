// Presentation time is separate from the deterministic simulation. Replaying or
// changing speed must never change a hit, the round score, or the winner.
import { eventTarget, createState, bands } from './strategy-rules.js';
const slowStart = 0.23;
const slowEnd = 0.7;
const slowRate = 0.28;

export function edgeWarning(beat, side) {
  const cell=beat.cells?.[side];
  return cell===0||cell===8?`${beat.band==='near'?'被逼角':'擂台边缘'} · ${cell}格`:'';
}

export function entranceStatus(game) {
  const cells=createState().fighters.map(f=>f.cell);
  return {clock:30,roundLabel:`ROUND ${String(game.rounds[0]?.round??1).padStart(2,'0')}`,rangeLabel:{near:'近',mid:'中',far:'远'}[bands(cells[1]-cells[0])],feedCounter:'ENTRANCE'};
}

export function isKeyHit(beat) {
  return beat.events.some(
    (event) =>
      event.damage > 0 &&
      (event.action === "ultimate" ||
        event.damage >= 12 ||
        beat.states[eventTarget(event)]?.hp === 0),
  );
}

export function describeExchange(beat,names) {
  const events=beat.events.flatMap(e=>{
    const actor=names[e.player],target=names[eventTarget(e)];
    if(e.outcome==='danger')return [`${target}踩中危险区，损失${e.damage}点生命`];
    if(e.outcome==='item')return [`${actor}拾取道具`];
    if(e.outcome==='parry')return [`${actor}招架反击，造成${e.damage}点伤害`];
    if(e.outcome==='throw')return [`${actor}投技破防，造成${e.damage}点伤害`];
    if(e.damage>0)return [`${actor}${e.action==='ultimate'?'绝技命中':e.outcome==='block'?'打在防守上':'出招命中'}，${target}损失${e.damage}点生命`];
    if(e.outcome==='evade')return [`${target}闪开了${actor}的攻势`];
    if(e.outcome==='counter')return [`${target}打断了${actor}的投技`];
    if(e.outcome==='miss')return [`${actor}的攻击落空`];
    return [];
  });
  return events.length?events.join('；')+'。':`${names.join('与')}继续试探，暂无伤害。`;
}

const highlightLabels={ko:'终结击倒',comeback:'逆风反超',combo:'连续命中',hit:'重击命中'};
export function buildHighlights(broadcast) {
  const rounds=new Map(),candidates=[];
  for(const part of broadcast.segments){
    if(part.type!=='fight')continue;
    if(!rounds.has(part.round))rounds.set(part.round,[]);
    rounds.get(part.round).push(part);
  }
  for(const parts of rounds.values()){
    const {round}=parts[0],chains=[0,0];
    let maxDeficit=0,recovered=false;
    for(const [index,part] of parts.entries()){
      const {beat}=part,kinds=[],hp=beat.states.map(s=>s.hp);
      const damage=Math.max(0,...beat.events.filter(e=>e.player===0||e.player===1).map(e=>e.damage));
      const knockout=hp.some(h=>h===0);
      if(knockout)kinds.push('ko');
      if(round.winner!==null){
        const lead=hp[round.winner]-hp[1-round.winner];
        if(!recovered&&maxDeficit>=20&&lead>0){kinds.push('comeback');recovered=true;}
        maxDeficit=Math.max(maxDeficit,-lead);
      }
      let run=1;
      for(const side of [0,1]){
        chains[side]=beat.events.some(e=>e.player===side&&e.damage>0)?chains[side]+1:0;
        if(chains[side]===3||chains[side]===2&&beat.planDriven?.[side]){
          if(!kinds.includes('combo'))kinds.push('combo');
          run=Math.max(run,chains[side]);
        }
      }
      if(!knockout&&isKeyHit(beat)&&damage>0)kinds.push('hit');
      if(kinds.length){
        const clip=parts.slice(Math.max(0,index-Math.max(run-1,kinds.includes('comeback')?2:1)),index+1);
        candidates.push({kinds,clip,damage,start:clip[0].start,end:part.end});
      }
    }
  }
  candidates.sort((a,b)=>b.damage-a.damage||a.start-b.start);
  const chosen=[];
  for(const kind of Object.keys(highlightLabels)){
    if(chosen.some(c=>c.kinds.includes(kind)))continue;
    const candidate=candidates.find(c=>c.kinds.includes(kind)&&chosen.every(other=>c.end<=other.start||c.start>=other.end));
    if(candidate)chosen.push(candidate);
  }
  if(!chosen.length&&rounds.size){
    const last=[...rounds.values()].at(-1).at(-1);
    chosen.push({kinds:[],clip:[last],start:last.start});
  }
  let duration=0;
  const segments=chosen.sort((a,b)=>a.start-b.start).flatMap(({kinds,clip},i)=>{
    const title=kinds.map(kind=>highlightLabels[kind]).join(' · ')||'最后交锋',start=clip[0].start,offset=duration;
    const highlight={index:i+1,total:chosen.length,title};
    duration+=clip.at(-1).end-start;
    return clip.map(part=>({...part,start:part.start-start+offset,end:part.end-start+offset,highlight}));
  });
  return {segments,duration,count:chosen.length};
}

export function roundCall(round) {
  const states = round.beats.at(-1).states;
  if (states.every((state) => state.hp === 0)) return "DOUBLE K.O.";
  if (states.some((state) => state.hp === 0)) return "K.O.";
  return round.winner === null ? "DRAW" : "TIME UP";
}

export function buildBroadcast(replay) {
  if (replay.games) {
    let duration = 0;
    const segments = replay.games.flatMap((game, gameIndex) => {
      const broadcast = buildBroadcast({ ...game, beatDuration: 1.35 });
      const parts = broadcast.segments.map(part => ({ ...part, start: part.start + duration, end: part.end + duration, game, gameIndex }));
      duration += broadcast.duration;
      return parts;
    });
    return { segments, duration };
  }
  const segments = [];
  let end = 0;
  const add = (type, duration, data = {}) => {
    segments.push({ type, start: end, end: end + duration, ...data });
    end += duration;
  };
  for (let player = 0; player < 2; player++) add("entrance", 3.8, { player });
  for (const round of replay.rounds) {
    add("countdown", 3.8, { round });
    round.beats.forEach((beat, index) => {
      const baseDuration = Math.max(1.2, replay.beatDuration);
      const keyHit = isKeyHit(beat);
      const duration = keyHit
        ? baseDuration * (1 + (slowEnd - slowStart) * (1 / slowRate - 1))
        : baseDuration;
      add("fight", duration, { round, beat, index, baseDuration, keyHit });
    });
    add("outro", 3.8, { round });
  }
  return { segments, duration: end };
}

// Absolute presentation time for a combat pose, including key-hit slow motion.
export function fightTimeAt(segment, progress) {
  const slowed = Math.max(0, Math.min(progress, slowEnd) - slowStart);
  return segment.start + segment.baseDuration *
    (progress + (segment.keyHit ? slowed * (1 / slowRate - 1) : 0));
}

export function broadcastAt(timeline, elapsed) {
  const segment = timeline.segments.find((part) => elapsed < part.end);
  if (!segment) return { type: "complete" };
  const local = Math.max(0, elapsed - segment.start);
  if (segment.type !== "fight")
    return { ...segment, progress: local / (segment.end - segment.start) };
  let progress = local / segment.baseDuration;
  if (segment.keyHit && progress > slowStart) {
    const slowDuration = (slowEnd - slowStart) / slowRate;
    progress = progress < slowStart + slowDuration
      ? slowStart + (progress - slowStart) * slowRate
      : slowEnd + progress - slowStart - slowDuration;
  }
  return {
    ...segment,
    progress: Math.min(1, progress),
    slowMotion: segment.keyHit && progress >= slowStart && progress < slowEnd,
  };
}
