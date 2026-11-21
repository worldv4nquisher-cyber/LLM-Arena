import {seededRng,defaultCustom,moveCategory} from './public/strategy-rules.js';
import {ModelError} from './opponents.js';

export const personalities=['gpt','claude','gemini','deepseek','grok'];
export function createBuiltinController(id, {seed=1}={}) {
  if(!personalities.includes(id)) throw new Error('Unknown fighter personality');
  const rng=seededRng(`${seed}:${id}`);
  const preferences={gpt:['strike','heavy','parry','blast'],claude:['parry','strike','evade','heavy'],gemini:['sweep','strike','heavy','lunge'],deepseek:['heavy','parry','strike','blast'],grok:['heavy','evade','strike','sweep']}[id];
  return {
    id:`builtin:${id}`,label:`内置策略 ${id}`,
    async draft(v) {
      if(v.phase==='ban') return {ban:v.pool.find(m=>m.id===({gpt:'snipe',claude:'blast',gemini:'snipe',deepseek:'lunge',grok:'barrier'}[id]))?.id||v.pool[0].id};
      const picks=[...preferences,...v.pool.map(m=>m.id)].filter((m,i,a)=>a.indexOf(m)===i&&v.pool.some(p=>p.id===m)).slice(0,4);
      const ultimate=rng()<.5?(id==='deepseek'?'sky':id==='gemini'?'prison':'nova'):['nova','sky','prison'][Math.floor(rng()*3)];
      return {picks,ultimate,custom:{...defaultCustom,name:'破阵拳',damage:2,speed:3},reason:'依据射程选择攻防组合'};
    },
    async decide(v) {
      const legal=v.legalMoves,has=m=>legal.some(x=>x.id===m),counts={};
      for(const b of v.recentMoves) {const m=b.moves[1-(v.you.cell<v.opponent.cell?0:1)];counts[m]=(counts[m]||0)+1;}
      const predict=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'step_in';
      let choice,reason;
      const choose=(m,r)=>{if(!choice&&has(m)){choice=m;reason=r;}};
      if(v.turnsLeft<13&&v.you.hp>v.opponent.hp+8&&rng()<(id==='deepseek'?.85:.35)) choose('step_back','血量领先，拉开距离守住优势');
      if(v.you.stamina<20) choose('rest','体力不足，休息等待反击');
      if(v.turn===2 && ['deepseek','gpt'].includes(id)) choose('scout','先侦察底牌，再制定攻势');
      if(moveCategory(predict)==='defend') {
        if(v.reviewNotes.some(n=>n.adjust==='punish-defense')&&v.you.energy>=50) choose('throw','能量充足，复盘后用投技惩罚防守');
        if(rng()<.55) choose('throw','预判对手防守，用投技破防');
        if(rng()<.65) choose('feint','对手偏爱防守，佯攻诱出破绽');
      }
      if(id==='grok'&&rng()<.06) choose('feint','用虚招扰乱对方的出招节奏');
      if(id==='claude'&&['jab','strike','heavy','custom','lunge'].includes(predict)&&rng()<.65) choose('parry','预判近身打击，以招架反击');
      if(id!=='claude'&&['strike','heavy','custom'].includes(predict)&&rng()<.35) choose('parry','识别打击习惯，以招架化解攻势');
      if(predict==='throw') choose('jab','预判投技，用快拳截断近身抓取');
      if(id==='deepseek'&&v.band==='near'&&rng()<.08) choose('step_back','拉开距离，建立远程优势');
      if(v.reviewNotes.some(n=>n.adjust==='take-initiative')&&predict==='heavy') choose('jab','复盘后抢快，以刺拳打断重招');
      for(const m of ['prison','nova','sky']) choose(m,'能量已满，以终结技争取胜局');
      if(v.band==='far'&&id!=='deepseek') choose('dash','远距离难命中，突进争夺主动');
      if(id==='deepseek') {choose('snipe','保持远距，用狙击压低血线');choose('blast','在安全距离用气弹消耗');}
      const attacks=legal.filter(m=>m.damage>0);
      if(!choice&&attacks.length) {
        const scored=attacks.map(m=>({m,score:m.damage/(m.startup+v.you.lag+1)+(rng()-.5)*6+(m.id==='custom'?-1:0)+(predict==='jab'&&m.id==='heavy'?5:0)+(preferences.includes(m.id)?1:0)})).sort((a,b)=>b.score-a.score);
        choice=scored[0].m.id;reason=`预判${predict==='rest'?'休息':'对手出招'}，以${scored[0].m.name}抢占先手`;
      }
      choose('step_in','接近对手，把战斗带入有效射程');
      choose('guard','暂时格挡，观察下一次机会');
      const followups=attacks.filter(m=>m.id!=='jab'&&m.energy===0);
      const plan=rng()<.8&&followups.length?Array.from({length:3},()=>({if:v.band,then:rng()<.25?'guard':followups[Math.floor(rng()*followups.length)].id})):undefined;
      return {move:choice,reason,predict,plan};
    },
    async review(v) {
      const guards=v.beats.filter(b=>['guard','parry'].includes(b.moves[1-(v.you.cell<v.opponent.cell?0:1)])).length;
      return guards>3?{notes:'对手常防守，下一局增加投技与佯攻',adjust:'punish-defense'}:{notes:'对手主动进攻，下一局争取先手与射程',adjust:'take-initiative'};
    },
  };
}
export const createBuiltinControllers = (options={}) => Object.fromEntries(personalities.map(id=>[id,createBuiltinController(id,options)]));

export function parseControllerReply(content) {
  if(typeof content!=='string') return {};
  for(let start=0;start<content.length;start++) {
    if(content[start]!=='{') continue;
    let depth=0,quoted=false,escaped=false;
    for(let end=start;end<content.length;end++) {
      const c=content[end];
      if(quoted) {if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}
      else if(c==='"')quoted=true;
      else if(c==='{')depth++;
      else if(c==='}'&&--depth===0) {try{return JSON.parse(content.slice(start,end+1));}catch{break;}}
    }
  }
  return {};
}

function providerReason(status,model) {
  if(status===401||status===403) return `API 密钥无效或无权访问（HTTP ${status}），请检查 ${model.description} 密钥`;
  if(status===404) return `找不到模型「${model.name}」，请检查模型 ID`;
  if(status===429) return '请求过于频繁或额度不足（HTTP 429）';
  if(status===400) return '请求被拒绝（HTTP 400），请确认模型支持文本对话';
  return `服务商暂时不可用（HTTP ${status}）`;
}
const englishRules='Simultaneous hidden actions on cells 0..8. Near=1, mid=2..3, far>=4. Throw beats guard/parry; faster attacks interrupt slower attacks; equal startup trades. Feint baits defense, scout reveals hidden energy/loadout. Best of three rounds, 30 turns each. 24 deep decisions per game; plans are free; at zero budget only quick legal moves. Custom budget: 2*damage + speed + 2 for mid + 3 for far <=10, near required; damage=4+3*damage, startup=5-speed, stamina=14+4*damage. Never invent hidden information.';
export function liveController(id,model,{request=fetch}={}) {
  if(model?.mode!=='live'||!['openai','anthropic'].includes(model.provider)) throw new Error('Configured live model required');
  async function ask(method,view,{signal:parentSignal}={}) {
    const quick=method==='decide'&&view.you?.budgetLeft===0;
    const schema=method==='decide'?'{"move":"legal move id","reason":"中文一句话，最多40字","predict":"opponent move id or category","plan":[{"if":"always|opponent_guarded|hit|missed|was_hit|near|mid|far","then":"move id"}]}':method==='review'?'{"notes":"中文复盘一句话","adjust":"strategy adjustment"}':view.phase==='ban'?'{"ban":"pool move id"}':'{"picks":["four distinct available pool ids"],"ultimate":"one ultimate id","custom":{"name":"中文名","damage":2,"range":["near","mid"],"speed":3},"reason":"中文一句话"}';
    const prompt=[quick?'快速决策 Quick turn: choose ONLY a legal quick move. Reply terse JSON.':`策略格斗：${view.rulesSummary||'同时出招，投技破防，快招打断慢招，侦察揭示底牌。'}\n${englishRules}`,`Phase: ${method}${view.phase?`/${view.phase}`:''}`,`Required JSON schema (plan optional, max 3): ${schema}`, 'Prediction categories: attack/throw/defend/move/feint/scout/rest; defend includes guard/parry/evade/barrier.',`View JSON: ${JSON.stringify(view)}`].join('\n');
    const openai=model.provider==='openai',ms=Math.min(model.timeout??30000,quick?5000:15000),timeout=AbortSignal.timeout(ms),signal=parentSignal?AbortSignal.any([parentSignal,timeout]):timeout;
    let response,data;
    try {
      response=await request(openai?'https://api.openai.com/v1/responses':'https://api.anthropic.com/v1/messages',{
        method:'POST',headers:{'Content-Type':'application/json',...(openai?{Authorization:`Bearer ${model.key}`}:{'x-api-key':model.key,'anthropic-version':'2023-06-01'})},
        body:JSON.stringify(openai?{model:model.name,input:prompt,max_output_tokens:quick?256:2048,store:false}:{model:model.name,max_tokens:quick?256:2048,messages:[{role:'user',content:prompt}]}),signal,
      });
      if(!response.ok) throw new ModelError(providerReason(response.status,model),`HTTP ${response.status}`);
      data=await response.json();
    } catch(error) {
      if(error instanceof ModelError) throw error;
      if(signal.aborted) throw new ModelError(`${ms/1000} 秒内未响应`,'timeout');
      throw new ModelError(response?'返回了无法解析的响应':`无法连接 ${model.description} 服务`);
    }
    const content=openai?data.output?.filter(p=>p.type==='message').flatMap(p=>p.content||[]).filter(p=>p.type==='output_text').map(p=>p.text).join(''):data.content?.filter(p=>p.type==='text').map(p=>p.text).join('');
    return parseControllerReply(content);
  }
  return {id,label:`${model.description} ${model.name}`,mode:'live',draft:(v,options)=>ask('draft',v,options),decide:(v,options)=>ask('decide',v,options),review:(v,options)=>ask('review',v,options)};
}
