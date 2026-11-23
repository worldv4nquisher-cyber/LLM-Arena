let identity;
export function browserSpectator() {
  if(identity)return identity;
  const key='celestial-spectator';
  try{identity=localStorage.getItem(key);}catch{/* Storage may be unavailable. */}
  if(!/^[a-f0-9]{32}$/.test(identity)){
    identity=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
    try{localStorage.setItem(key,identity);}catch{/* This tab can still participate. */}
  }
  return identity;
}

export function mountDanmaku({overlay,toggle,form,input,status}) {
  let match=null,source=null,connected=false,sending=false,visible=true,lane=0;
  const button=form.querySelector('button');
  const sync=()=>{button.disabled=!connected||sending;};
  function display(text) {
    if(!visible||overlay.children.length>=12)return;
    const comment=document.createElement('span');
    comment.className='danmaku-comment';
    comment.dataset.lane=String(lane++%4);
    comment.textContent=text;
    overlay.append(comment);
    comment.addEventListener('animationend',()=>comment.remove(),{once:true});
  }
  toggle.addEventListener('click',()=>{
    visible=!visible;
    toggle.setAttribute('aria-pressed',String(visible));
    toggle.textContent=visible?'弹幕显示':'弹幕隐藏';
    if(!visible)overlay.replaceChildren();
  });
  function watch(id) {
    if(match===id)return;
    source?.close();source=null;overlay.replaceChildren();
    match=id;connected=false; sending=false;input.value='';form.hidden=!id;status.textContent='';sync();
    if(!id)return;
    status.textContent='正在连接直播…';
    const stream=new EventSource(`/api/league/matches/${id}/danmaku`);
    source=stream;
    stream.onopen=()=>{if(source===stream){connected=true;status.textContent='';sync();}};
    stream.onerror=()=>{if(source===stream){connected=false;status.textContent=stream.readyState===EventSource.CLOSED?'直播弹幕已关闭。':'弹幕连接中断，正在重连…';sync();}};
    stream.onmessage=e=>{if(source===stream)display(JSON.parse(e.data).text);};
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const text=input.value.trim(),stream=source;
    if(!connected||sending||!text)return;
    sending=true;sync();
    try {
      const r=await fetch(`/api/league/matches/${match}/danmaku`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({spectator:browserSpectator(),text})});
      const value=await r.json();if(!r.ok)throw new Error(value.error);
      if(source===stream){if(input.value.trim()===text)input.value='';status.textContent=visible?'弹幕已发送。':'弹幕已发送，当前已隐藏。';}
    }catch(error){if(source===stream)status.textContent=error.message||'发送失败，请重试。';}
    finally{if(source===stream){sending=false;sync();}}
  });
  return {watch};
}

export function mountVoice(button,host=globalThis) {
  const synth=host.speechSynthesis;
  let enabled=false;
  function unavailable(){
    enabled=false;button.disabled=true;button.textContent='仅文字解说';
    button.setAttribute('aria-pressed','false');
  }
  if(!synth||!host.SpeechSynthesisUtterance)unavailable();
  function say(text,priority=false) {
    if(!enabled||(!priority&&(synth.speaking||synth.pending)))return;
    try{
      if(priority)synth.cancel();
      const utterance=new host.SpeechSynthesisUtterance(text);
      utterance.lang='zh-CN';
      utterance.voice=synth.getVoices().find(v=>v.localService&&/^zh[-_]CN$/i.test(v.lang))??null;
      utterance.onerror=e=>{if(e.error!=='interrupted'&&e.error!=='canceled')unavailable();};
      synth.speak(utterance);
    }catch{unavailable();}
  }
  function stop(){if(enabled)synth.cancel();}
  button.addEventListener('click',()=>{
    if(button.disabled)return;
    if(enabled)stop();enabled=!enabled;
    button.textContent=enabled?'语音解说开':'语音解说关';
    button.setAttribute('aria-pressed',String(enabled));
    if(enabled)say('星穹格斗场，语音解说已开启。');
  });
  return {say,stop};
}
