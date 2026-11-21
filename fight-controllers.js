import {seededRng,defaultCustom} from './public/strategy-rules.js';

export const personalities=['gpt','claude','gemini','deepseek','grok'];
export function createBuiltinController(id, {seed=1}={}) {
  if(!personalities.includes(id)) throw new Error('Unknown fighter personality');
  const rng=seededRng(`${seed}:${id}`);
  const preferences={gpt:['strike','heavy','parry','blast'],claude:['parry','strike','evade','heavy'],gemini:['sweep','strike','heavy','lunge'],deepseek:['blast','snipe','barrier','drain'],grok:['heavy','evade','strike','sweep']}[id];
  return {
    id:`builtin:${id}`,label:`内置策略 ${id}`,
    async draft(v) {
      if(v.phase==='ban') return {ban:v.pool.find(m=>m.id===({gpt:'snipe',claude:'blast',gemini:'parry',deepseek:'lunge',grok:'barrier'}[id]))?.id||v.pool[0].id};
      const picks=[...preferences,...v.pool.map(m=>m.id)].filter((m,i,a)=>a.indexOf(m)===i&&v.pool.some(p=>p.id===m)).slice(0,4);
      return {picks,ultimate:id==='deepseek'?'sky':id==='gemini'?'prison':'nova',custom:{...defaultCustom,name:'破阵拳',damage:id==='gemini'?4:3,speed:id==='gemini'?4:3},reason:'依据射程选择攻防组合'};
    },
    async decide(v) {
      const legal=v.legalMoves,has=m=>legal.some(x=>x.id===m),counts={};
      for(const b of v.recentMoves) {const m=b.moves[1-(v.you.cell<v.opponent.cell?0:1)];counts[m]=(counts[m]||0)+1;}
      const predict=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'step_in';
      let choice,reason;
      const choose=(m,r)=>{if(!choice&&has(m)){choice=m;reason=r;}};
      if(v.you.stamina<20) choose('rest','体力不足，休息等待反击');
      if(v.turn===2 && ['deepseek','gpt'].includes(id)) choose('scout','先侦察底牌，再制定攻势');
      if(['guard','parry','evade','barrier'].includes(predict)) {
        if(v.reviewNotes.some(n=>n.adjust==='punish-defense')) choose('throw','复盘发现防守习惯，优先投技破防');
        if(rng()<.55) choose('throw','预判对手防守，用投技破防');
        if(rng()<.65) choose('feint','对手偏爱防守，佯攻诱出破绽');
      }
      if(id==='grok'&&rng()<.17) choose('feint','用虚招扰乱对方的出招节奏');
      if(id==='claude'&&['jab','strike','heavy','custom','lunge'].includes(predict)&&rng()<.65) choose('parry','预判近身打击，以招架反击');
      if(id==='deepseek'&&v.band==='near'&&rng()<.65) choose('step_back','拉开距离，建立远程优势');
      if(v.reviewNotes.some(n=>n.adjust==='take-initiative')&&predict==='heavy') choose('jab','复盘后抢快，以刺拳打断重招');
      for(const m of ['prison','nova','sky']) choose(m,'能量已满，以终结技争取胜局');
      if(v.band==='far'&&id!=='deepseek') choose('dash','远距离难命中，突进争夺主动');
      if(id==='deepseek') {choose('snipe','保持远距，用狙击压低血线');choose('blast','在安全距离用气弹消耗');}
      const attacks=legal.filter(m=>m.damage>0);
      if(!choice&&attacks.length) {
        const scored=attacks.map(m=>({m,score:m.damage/(m.startup+v.you.lag+1)+(rng()-.5)*5+(m.id==='custom'?-.8:0)+(id==='gemini'&&m.startup<3?2:0)+(predict==='jab'&&m.id==='heavy'?4:0)})).sort((a,b)=>b.score-a.score);
        choice=scored[0].m.id;reason=`预判${predict==='rest'?'休息':'对手出招'}，以${scored[0].m.name}抢占先手`;
      }
      choose('step_in','接近对手，把战斗带入有效射程');
      choose('guard','暂时格挡，观察下一次机会');
      const plan=rng()<.35?[{if:'far',then:'step_in'},{if:'near',then:has('jab')?'jab':'guard'}]:undefined;
      return {move:choice,reason,predict,plan};
    },
    async review(v) {
      const guards=v.beats.filter(b=>['guard','parry'].includes(b.moves[1-(v.you.cell<v.opponent.cell?0:1)])).length;
      return guards>3?{notes:'对手常防守，下一局增加投技与佯攻',adjust:'punish-defense'}:{notes:'对手主动进攻，下一局争取先手与射程',adjust:'take-initiative'};
    },
  };
}
export const createBuiltinControllers = (options={}) => Object.fromEntries(personalities.map(id=>[id,createBuiltinController(id,options)]));
