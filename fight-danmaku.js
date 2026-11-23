const failure=(status,error)=>({status,data:{error}});
const maxLength=60, cooldown=2000, windowMs=10000;
const maxViewers=128, maxViewersPerAddress=8;

export function createDanmaku(league,now=Date.now) {
  const viewers=new Set(),senders=new Map(),addresses=new Map();
  async function stream(id,address,res) {
    if(!await league.isLive(id)){res.writeHead(204);res.end();return;}
    if([...viewers].filter(viewer=>viewer.address===address).length>=maxViewersPerAddress){res.writeHead(429);res.end();return;}
    if(viewers.size>=maxViewers){res.writeHead(503);res.end();return;}
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','X-Accel-Buffering':'no'});
    res.write('retry: 3000\n\n');
    const viewer={id,address,res};
    viewers.add(viewer);
    const heartbeat=setInterval(async()=>{
      if(!await league.isLive(id)||res.writableNeedDrain)res.end();
      else if(!res.destroyed)res.write(': heartbeat\n\n');
    },15000);
    heartbeat.unref();
    res.on('close',()=>{clearInterval(heartbeat);viewers.delete(viewer);});
  }
  async function send(id,spectator,address,text) {
    const clean=typeof text==='string'?text.replace(/[<>]/g,'').replace(/[\p{Cc}\p{Bidi_Control}]/gu,' ').replace(/\s+/g,' ').trim():'';
    if(!clean||[...clean].length>maxLength)return failure(400,`请输入 1–${maxLength} 个字符的弹幕。`);
    if(!await league.isLive(id))return failure(409,'本场直播弹幕已关闭。');
    const at=now();
    for(const [key,until] of senders)if(until<=at)senders.delete(key);
    for(const [key,bucket] of addresses)if(bucket.until<=at)addresses.delete(key);
    const bucket=addresses.get(address)??{until:at+windowMs,count:0};
    if(senders.has(spectator)||bucket.count>=15||addresses.size>=2048&&!addresses.has(address))return failure(429,'发送太快，请稍后再试。');
    senders.set(spectator,at+cooldown);bucket.count++;addresses.set(address,bucket);
    const data={text:clean},chunk=`data: ${JSON.stringify(data)}\n\n`;
    for(const viewer of viewers)if(viewer.id===id&&!viewer.res.writableEnded){
      if(viewer.res.writableNeedDrain)viewer.res.end();else viewer.res.write(chunk);
    }
    return {status:200,data};
  }
  return {stream,send};
}
