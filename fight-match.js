import {baseMoves, movePool, ultimates, defaultCustom, validateCustom, createState, makeView, legalMoves, resolveTurn, seededRng, planConditions, planMatches, rulesSummary} from './public/strategy-rules.js';
import {ModelError} from './opponents.js';

const freshStats = () => ({mistakes:0,decisions:0,predictionsCorrect:0,predictions:0,feintsSuccessful:0,feintsAttempted:0,planTurns:0,budgetUsed:0,scouts:0,rounds:[],betweenRoundImprovement:[]});
function rates(s) {
  return {...s,mistakeRate:s.mistakes/Math.max(1,s.decisions),predictionHitRate:s.predictionsCorrect/Math.max(1,s.predictions),feintSuccessRate:s.feintsSuccessful/Math.max(1,s.feintsAttempted)};
}
async function invoke(controller, method, view, deadlines) {
  let timer;
  try {
    const result=await Promise.race([Promise.resolve().then(()=>controller[method](structuredClone(view))),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new ModelError('timeout')),view.you?.budgetLeft===0?deadlines.quick:deadlines.normal);})]);
    if(!result || typeof result!=='object' || Array.isArray(result)) throw new Error('invalid output');
    return {result};
  } catch(e) {return {error:typeof e?.message==='string'?e.message:'controller threw',providerFailure:controller.mode==='live'&&e instanceof ModelError};} finally {clearTimeout(timer);}
}
function decisionError(r, view) {
  if(!view.legalMoves.some(m=>m.id===r.move)) return 'illegal move';
  if(typeof r.reason!=='string'||!r.reason.length||r.reason.length>40) return 'invalid reason';
  if(r.predict!==undefined&&typeof r.predict!=='string') return 'invalid prediction';
  if(r.plan!==undefined&&(!Array.isArray(r.plan)||r.plan.length>3||r.plan.some(p=>!p||!planConditions.includes(p.if)||typeof p.then!=='string'||![...baseMoves,...movePool,...ultimates,{id:'custom'}].some(m=>m.id===p.then)))) return 'invalid plan';
}
const winnerOf = hp => hp[0]===hp[1]?null:hp[0]>hp[1]?0:1;
export async function runSeries({players,controllers,games=2,seed=1,memory=[],onProgress,deadlines={normal:15000,quick:5000}}={}) {
  deadlines={normal:15000,quick:5000,...deadlines};
  if(![deadlines.normal,deadlines.quick].every(n=>Number.isFinite(n)&&n>0)) throw new Error('Invalid referee deadlines');
  if(!Array.isArray(players)||players.length!==2||!Array.isArray(controllers)||controllers.length!==2||!Number.isInteger(games)||games<1) throw new Error('Two players and controllers and positive games required');
  const replay={version:2,seed,players:[...players],controllers:controllers.map(c=>c.id),games:[],series:{wins:[0,0]},rulesSummary};
  const history=structuredClone(memory), totals=[freshStats(),freshStats()];
  const failures=[0,0];
  const callController=async(c,method,view,index)=>{
    const call=await invoke(c,method,view,deadlines);
    if(method==='decide') failures[index]=call.providerFailure?failures[index]+1:0;
    if(failures[index]>=3) throw new ModelError(`${c.id} 连续三次服务商请求失败：${call.error}。本场未计入战绩。`);
    return call;
  };
  for(let g=0;g<games;g++) {
    const sides=g%2?[1,0]:[0,1], cs=sides.map(i=>controllers[i]), rng=seededRng(`${seed}:${g}`), stats=[freshStats(),freshStats()], bans=[], draftMistakes=[[],[]];
    for(let i=0;i<2;i++) {
      stats[i].decisions++;
      const call=await callController(cs[i],'draft',{phase:'ban',pool:movePool.filter(m=>!bans.includes(m.id)),bans:[...bans],memory:history},sides[i]);
      let ban=call.result?.ban;
      if(call.error||!movePool.some(m=>m.id===ban)||bans.includes(ban)) {draftMistakes[i].push(call.error||'invalid ban');stats[i].mistakes++;ban=movePool.find(m=>!bans.includes(m.id)).id;}
      bans.push(ban);
    }
    const pool=movePool.filter(m=>!bans.includes(m.id));
    const picks=await Promise.all(cs.map((c,i)=>callController(c,'draft',{phase:'pick',pool,bans,ultimates,memory:history},sides[i])));
    const selections=picks.map((call,i)=>{
      stats[i].decisions++;
      const r=call.result;
      const error=call.error||(!r||!Array.isArray(r.picks)||r.picks.length!==4||new Set(r.picks).size!==4||r.picks.some(id=>!pool.some(m=>m.id===id))||!ultimates.some(m=>m.id===r.ultimate)?'invalid picks':null);
      if(error) {draftMistakes[i].push(error);stats[i].mistakes++;}
      const selected=error?{picks:pool.slice(0,4).map(m=>m.id),ultimate:'nova',custom:defaultCustom}:r;
      if(!validateCustom(selected.custom).valid) {draftMistakes[i].push('invalid custom');stats[i].mistakes++;selected.custom=defaultCustom;}
      return selected;
    });
    const game={sides,draft:{bans,selections,mistakes:draftMistakes},rounds:[],wins:[0,0],stats:[]};
    const budgets=[24,24],notes=[[],[]];
    for(let round=1;round<=3 && Math.max(...game.wins)<2;round++) {
      let state=createState(selections.map(s=>[...s.picks,s.ultimate]),selections.map(s=>s.custom));
      const plans=[[],[]],beats=[],startStats=stats.map(s=>({...s}));
      for(let turn=1;turn<=30;turn++) {
        state.fighters.forEach((f,i)=>f.budgetLeft=budgets[i]);
        const views=[0,1].map(i=>makeView(state,i,{round,turnsLeft:31-turn,recentMoves:beats.slice(-5).map(b=>({moves:b.moves,events:b.events})),plan:plans[i],memory:history,reviewNotes:notes[i]}));
        const submissions=await Promise.all(cs.map(async(c,i)=>{
          if(plans[i].length) {
            const p=plans[i].shift();
            if(planMatches(p.if,views[i],beats.at(-1),i)&&views[i].legalMoves.some(m=>m.id===p.then)) {stats[i].planTurns++;return {move:p.then,reason:'按计划把握战机',planDriven:true};}
            plans[i]=[];
          }
          stats[i].decisions++;
          const call=await callController(c,'decide',views[i],sides[i]);
          if(budgets[i]>0) {budgets[i]--;stats[i].budgetUsed++;}
          const error=call.error||decisionError(call.result,views[i]);
          if(error) {stats[i].mistakes++;return {mistake:error,reason:'判断失误，失去行动机会'};}
          plans[i]=structuredClone(call.result.plan||[]);
          return call.result;
        }));
        const resolved=resolveTurn(state,submissions,rng);state=resolved.state;
        const beat={...resolved.beat,reasons:submissions.map(s=>s.reason),predictions:submissions.map(s=>s.predict??null),planDriven:submissions.map(s=>!!s.planDriven),mistakes:submissions.map(s=>s.mistake||null)};
        for(let i=0;i<2;i++) {
          const prediction=submissions[i].predict, opponentMove=views[1-i].legalMoves.find(m=>m.id===beat.moves[1-i]);
          if(prediction) {stats[i].predictions++;if(prediction===beat.moves[1-i]||prediction===opponentMove?.kind) stats[i].predictionsCorrect++;}
          if(beat.moves[i]==='feint') {stats[i].feintsAttempted++;if(beat.feints[i]) stats[i].feintsSuccessful++;}
          if(beat.moves[i]==='scout') stats[i].scouts++;
          beat.states[i].budgetLeft=budgets[i];
        }
        beat.commentary=beat.names.map((name,i)=>`${players[sides[i]]}意图${beat.reasons[i]}，使出${name}${beat.feints[i]?'诱骗成功':''}`).join('；')+'。';
        beats.push(beat);
        if(onProgress) await onProgress({game:g+1,round,turn});
        if(state.fighters.some(f=>f.hp===0)) break;
      }
      const winner=winnerOf(state.fighters.map(f=>f.hp));
      if(winner!==null) game.wins[winner]++;
      const reviews=await Promise.all(cs.map(async(c,i)=>{
        stats[i].decisions++;
        const call=await callController(c,'review',{round,you:{...state.fighters[i]},opponent:{...state.fighters[1-i]},beats,winner,memory:history},sides[i]);
        if(call.error||typeof call.result?.notes!=='string'||typeof call.result?.adjust!=='string') {stats[i].mistakes++;return {notes:'复盘失误',adjust:'',mistake:call.error||'invalid review'};}
        notes[i].push(call.result);return call.result;
      }));
      const damage=[0,1].map(i=>beats.flatMap(b=>b.events).filter(e=>e.player===i&&e.outcome!=='danger').reduce((n,e)=>n+e.damage,0));
      stats.forEach((s,i)=>{
        const summary={damageShare:damage[i]/Math.max(1,damage[0]+damage[1]),predictionRate:(s.predictionsCorrect-startStats[i].predictionsCorrect)/Math.max(1,s.predictions-startStats[i].predictions)};
        if(s.rounds.length) {const prev=s.rounds.at(-1);s.betweenRoundImprovement.push({damageShare:summary.damageShare-prev.damageShare,predictionRate:summary.predictionRate-prev.predictionRate});}
        s.rounds.push(summary);
      });
      game.rounds.push({round,beats,reviews,winner,wins:[...game.wins],ending:state.fighters.some(f=>!f.hp)?'ko':'time-up'});
    }
    game.winner=winnerOf(game.wins);game.stats=stats.map(rates);
    if(game.winner!==null) replay.series.wins[sides[game.winner]]++;
    for(let i=0;i<2;i++) {
      const t=totals[sides[i]],s=stats[i];
      for(const key of Object.keys(t)) if(Array.isArray(t[key])) t[key].push(...s[key]);else t[key]+=s[key];
    }
    history.push({game:g+1,sides,controllerSides:cs.map(c=>c.id),winner:game.winner,opponentMoveFrequencies:[0,1].map(i=>{const counts={};for(const r of game.rounds)for(const b of r.beats)counts[b.moves[i]]=(counts[b.moves[i]]||0)+1;return counts;}),damageTaken:[0,1].map(i=>game.rounds.flatMap(r=>r.beats).flatMap(b=>b.events).filter(e=>e.player!==i).reduce((n,e)=>n+e.damage,0))});
    replay.games.push(game);
  }
  replay.series.winner=winnerOf(replay.series.wins);replay.series.stats=totals.map(rates);
  replay.memory=history.slice(memory.length);
  return replay;
}
