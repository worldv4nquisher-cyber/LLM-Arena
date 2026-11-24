import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {addRoyaleResult,royaleStandings} from './royale-standings.js';

const empty=()=>({games:0,wins:0,losses:0,draws:0,mistakes:0,decisions:0,predictionsCorrect:0,predictions:0,predictionsScored:0,predictionsCategoryCorrect:0,predictionsExactCorrect:0,feintsSuccessful:0,feintsAttempted:0,improvements:0,damageImprovement:0,predictionImprovement:0});
const pairKey=ids=>JSON.stringify([...ids].sort());
export function createLadder({path=new URL('./data/ladder.json',import.meta.url)}={}) {
  let entries={},pairs={},royale={},queue=Promise.resolve();
  const ready=(async()=>{if(path===null)return;try{const data=JSON.parse(await readFile(path,'utf8'));if(data.version===1&&data.entries&&data.pairs){entries=data.entries;pairs=data.pairs;royale=data.royale??{};}}catch{/* Persistence is best effort. */}})();
  async function persist() {
    if(path===null)return;
    try {
      const file=path instanceof URL?path:pathToFileURL(resolve(path));
      await mkdir(dirname(fileURLToPath(file)),{recursive:true});
      const temporary=new URL(`${file.href}.tmp`);
      await writeFile(temporary,JSON.stringify({version:1,entries,pairs,royale}));await rename(temporary,file);
    } catch {/* In-memory results remain available. */}
  }
  return {
    async reset(){await ready;entries={};pairs={};royale={};queue=queue.then(persist);await queue;},
    async royaleSnapshot(){await ready;return royaleStandings(royale);},
    async recordRoyale(ranking){await ready;addRoyaleResult(royale,ranking,'controller');queue=queue.then(persist);await queue;},
    async snapshot(){await ready;return Object.entries(entries).map(([id,s])=>({id,games:s.games,wins:s.wins,losses:s.losses,draws:s.draws,winRate:s.wins/Math.max(1,s.games),mistakeRate:s.mistakes/Math.max(1,s.decisions),predictionHitRate:(s.predictionsCategoryCorrect||0)/Math.max(1,s.predictionsScored||0),predictionCategoryHitRate:(s.predictionsCategoryCorrect||0)/Math.max(1,s.predictionsScored||0),predictionExactHitRate:(s.predictionsExactCorrect||0)/Math.max(1,s.predictionsScored||0),feintSuccessRate:s.feintsSuccessful/Math.max(1,s.feintsAttempted),betweenRoundImprovement:{damageShare:s.damageImprovement/Math.max(1,s.improvements),predictionRate:s.predictionImprovement/Math.max(1,s.improvements)}})).sort((a,b)=>b.winRate-a.winRate||a.id.localeCompare(b.id));},
    async memory(ids){await ready;const saved=pairs[pairKey(ids)]||[];return structuredClone(saved.map(s=>({...s,sides:ids[0]===ids[1]?s.sides:s.controllerSides.map(id=>ids.indexOf(id))})));},
    async record(replay){
      await ready;
      for(const game of replay.games)for(let side=0;side<2;side++) {
        const id=replay.controllers[game.sides[side]],s=entries[id]??=empty(),t=game.stats[side];
        s.games++;if(game.winner===null)s.draws++;else if(game.winner===side)s.wins++;else s.losses++;
        for(const key of ['mistakes','decisions','predictionsCorrect','predictions','feintsSuccessful','feintsAttempted'])s[key]+=t[key];
        if(t.predictionCategoryHitRate!==undefined) {
          s.predictionsScored=(s.predictionsScored||0)+t.predictions;
          s.predictionsCategoryCorrect=(s.predictionsCategoryCorrect||0)+t.predictionsCorrect;
          s.predictionsExactCorrect=(s.predictionsExactCorrect||0)+t.predictionsExactCorrect;
        }
        for(const improvement of t.betweenRoundImprovement){s.improvements++;s.damageImprovement+=improvement.damageShare;s.predictionImprovement+=improvement.predictionRate;}
      }
      const key=pairKey(replay.controllers);
      const summaries=(replay.memory||[]).map(s=>({...s,controllerSides:s.sides.map(i=>replay.controllers[i])}));
      pairs[key]=[...(pairs[key]||[]),...summaries].slice(-12);
      queue=queue.then(persist);await queue;
    },
  };
}
