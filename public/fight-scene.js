import * as T from '/vendor/three.module.js';

const mat = (color, extra = {}) => new T.MeshStandardMaterial({ color, roughness: .73, ...extra });
const glow = color => mat(color, { emissive: color, emissiveIntensity: 1.6 });
function mesh(parent, geometry, material, x = 0, y = 0, z = 0) {
  const object = new T.Mesh(geometry, material);
  object.position.set(x, y, z); object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
}
const ball = (p, m, x, y, z, sx, sy = sx, sz = sx) => { const o = mesh(p, new T.SphereGeometry(1, 24, 16), m, x, y, z); o.scale.set(sx, sy, sz); return o; };
const box = (p, m, x, y, z, sx, sy, sz) => mesh(p, new T.BoxGeometry(sx, sy, sz), m, x, y, z);
const cylinder = (p, m, x, y, z, r1, r2, h, segments = 48) => mesh(p, new T.CylinderGeometry(r1, r2, h, segments), m, x, y, z);
function ring(p, color, radius, y, tube = .025) { const o = mesh(p, new T.TorusGeometry(radius, tube, 8, 100), glow(color), 0, y, 0); o.rotation.x = Math.PI / 2; return o; }
function line(p, points, color, width = .035) {
  const curve = new T.CatmullRomCurve3(points.map(v => new T.Vector3(...v)));
  return mesh(p, new T.TubeGeometry(curve, 20, width, 7, false), mat(color));
}
function faceTexture(color) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  for (const x of [150, 362]) {
    ctx.fillStyle = '#41283e'; ctx.beginPath(); ctx.ellipse(x, 105, 51, 64, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fffdf8'; ctx.beginPath(); ctx.ellipse(x, 110, 46, 57, 0, 0, Math.PI * 2); ctx.fill();
    const iris = ctx.createLinearGradient(0, 70, 0, 165); iris.addColorStop(0, '#3d3069'); iris.addColorStop(.5, color); iris.addColorStop(1, '#fff0cb');
    ctx.fillStyle = iris; ctx.beginPath(); ctx.ellipse(x, 115, 31, 46, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#30273f'; ctx.beginPath(); ctx.ellipse(x, 103, 13, 29, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(x - 12, 84, 13, 16, .3, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(x + 13, 131, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#413045'; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(x - 51, 89); ctx.quadraticCurveTo(x, 26, x + 48, 79); ctx.stroke();
    ctx.strokeStyle = '#6a4552'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x - 34, 23); ctx.lineTo(x + 29, 18); ctx.stroke();
    const blush = ctx.createRadialGradient(x, 179, 2, x, 179, 38); blush.addColorStop(0, '#ee9ca380'); blush.addColorStop(1, '#ee9ca300'); ctx.fillStyle = blush; ctx.fillRect(x - 40, 155, 80, 48);
  }
  ctx.strokeStyle = '#a8666d'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(240, 191); ctx.quadraticCurveTo(256, 204, 272, 191); ctx.stroke();
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; return texture;
}

function makeFighter(config) {
  const root = new T.Group(), body = new T.Group(); root.add(body);
  const skin = mat('#ffe0cf'), hair = mat(config.hair), dress = mat(config.dress), dark = mat(config.dark), white = mat('#fff2e6'), gold = mat('#e5bd7d', { metalness: .5, roughness: .35 });
  const aura = glow(config.color);
  // A jointed chibi silhouette: long hair, layered skirt, sleeves and boots.
  const legs = [-1, 1].map(side => {
    const leg = new T.Group(); leg.position.set(side * .19, .7, 0); body.add(leg);
    cylinder(leg, white, 0, -.2, 0, .095, .08, .45, 16);
    ball(leg, dark, 0, -.49, .065, .13, .19, .2);
    cylinder(leg, gold, 0, -.38, 0, .114, .114, .035, 16); return leg;
  });
  cylinder(body, dress, 0, 1, 0, .23, .56, .63, 40);
  cylinder(body, white, 0, .72, 0, .5, .59, .1, 40);
  cylinder(body, dark, 0, 1.15, 0, .22, .42, .35, 40);
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * Math.PI * 2;
    ball(body, white, Math.sin(a) * .535, .69, Math.cos(a) * .535, .085, .055, .07);
    if (i % 2 === 0) ball(body, gold, Math.sin(a) * .45, .83, Math.cos(a) * .45, .025);
  }
  ball(body, dress, 0, 1.43, 0, .28, .32, .2);
  cylinder(body, gold, 0, 1.2, 0, .245, .245, .05, 24);
  ball(body, white, 0, 1.63, .15, .19, .075, .09);
  ball(body, aura, 0, 1.47, .205, .067, .08, .035);
  const arms = [-1, 1].map(side => {
    const arm = new T.Group(); arm.position.set(side * .29, 1.57, 0); arm.rotation.z = side * .2; body.add(arm);
    ball(arm, dress, side * .07, -.12, 0, .16, .2, .16);
    cylinder(arm, white, side * .1, -.31, .035, .12, .16, .3, 20);
    ball(arm, skin, side * .1, -.5, .06, .115); return arm;
  });
  const head = new T.Group(); head.position.y = 2.02; body.add(head);
  ball(head, hair, 0, .05, -.12, .54, .61, .47);
  ball(head, skin, 0, 0, .035, .48, .48, .405);
  const face = mesh(head, new T.PlaneGeometry(.76, .4), new T.MeshBasicMaterial({ map: faceTexture(config.color), transparent: true, depthWrite: false }), 0, -.035, .42);
  face.renderOrder = 2;
  // Individually shaped fringe and flowing locks, not a painted billboard.
  for (let i = -3; i <= 3; i++) {
    const fringe = ball(head, hair, i * .126, .33 - Math.abs(i) * .035, .29, .14, .27 - Math.abs(i) * .02, .145);
    fringe.rotation.z = -i * .12;
  }
  for (const side of [-1, 1]) {
    for (let j = 0; j < 3; j++) {
      const lock = ball(body, hair, side * (.37 + j * .025), 1.65 - j * .09, -.17 - j * .09, .155, .64, .17);
      lock.rotation.z = side * (.11 + j * .1);
    }
    ball(head, skin, side * .465, -.02, .01, .09, .13, .07);
  }
  if (config.feature === 'dragon') {
    for (const side of [-1, 1]) {
      const horn = mesh(head, new T.ConeGeometry(.12, .43, 12), white, side * .38, .57, 0); horn.rotation.z = -side * .4;
      for (let k = 0; k < 4; k++) { const h = mesh(head, new T.TorusGeometry(.095 - k * .018, .012, 6, 16), gold, side * (.38 + k * .022), .43 + k * .077, 0); h.rotation.z = -side * .4; h.rotation.x = Math.PI / 2; }
      const shape = new T.Shape(); shape.moveTo(0, 0); shape.quadraticCurveTo(side * .7, .8, side * 1.03, .15); shape.quadraticCurveTo(side * .65, .25, side * .8, -.24); shape.quadraticCurveTo(side * .43, -.07, side * .3, -.43); shape.lineTo(0, 0);
      const wing = mesh(body, new T.ShapeGeometry(shape), mat('#ceb5ef', { side: T.DoubleSide }), side * .25, 1.5, -.28); wing.rotation.y = side * .35;
      line(wing, [[0,0,.01],[side*.45,.35,.01],[side*1.03,.15,.01]], '#f3deff', .025);
    }
    line(body, [[0,.86,-.3],[.4,.5,-.7],[.8,.4,-.85],[.85,.66,-.85]], config.hair, .07);
  } else if (config.feature === 'cat' || config.feature === 'devil') {
    for (const side of [-1, 1]) {
      const ear = mesh(head, new T.ConeGeometry(.19, .42, config.feature === 'cat' ? 3 : 10), config.feature === 'cat' ? hair : dark, side * .35, .56, 0); ear.rotation.z = -side * .25;
      if (config.feature === 'cat') { const inner = mesh(head, new T.ConeGeometry(.1, .25, 3), mat('#eda7c8'), side * .35, .57, .09); inner.rotation.z = -side * .25; }
      if (config.feature === 'devil') { ball(body, hair, side * .63, 1.68, -.2, .2, .67, .19); ball(head, dark, side * .5, .17, -.03, .16, .09, .1); }
    }
  } else if (config.feature === 'flower') {
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ball(head, dress, .41 + Math.sin(a) * .12, .32 + Math.cos(a) * .12, .2, .07, .08, .05); }
    ball(head, gold, .41, .32, .25, .065);
    const book = new T.Group(); arms[0].add(book); book.position.set(-.12, -.4, .2); book.rotation.y = -.3; book.rotation.x = -.4;
    box(book, dark, 0, 0, 0, .33, .43, .1); box(book, gold, 0, 0, .057, .23, .32, .015); box(book, dark, 0, 0, .07, .2, .29, .015); ball(book, aura, 0, 0, .09, .05);
  } else if (config.feature === 'maid') {
    for (let i = 0; i < 9; i++) { const a = (i - 4) * .2; ball(head, white, Math.sin(a) * .51, Math.cos(a) * .53, .015, .1, .12, .09); }
    const apron = ball(body, white, 0, .99, .33, .29, .3, .16); apron.rotation.x = -.2;
    ball(body, white, -.14, 1.53, .21, .13, .06, .035); ball(body, white, .14, 1.53, .21, .13, .06, .035);
  }
  if (config.feature === 'devil') {
    cylinder(arms[1], gold, .16, -.1, .1, .025, .025, 1.9, 8);
    const blade = mesh(arms[1], new T.ConeGeometry(.21, .5, 4), gold, .16, .98, .1); blade.rotation.y = .8;
    for (const side of [-1, 1]) { const blade = mesh(arms[1], new T.ConeGeometry(.14, .45, 3), gold, .16 + side * .2, .83, .1); blade.rotation.z = -side * .5; }
  }
  const shadow = mesh(root, new T.CircleGeometry(.64, 40), new T.MeshBasicMaterial({ color: '#261e48', transparent: true, opacity: .21, depthWrite: false }), 0, .015, 0); shadow.rotation.x = -Math.PI / 2;
  const base = ring(root, config.color, .64, .035, .018);
  const shield = ball(root, new T.MeshBasicMaterial({ color: config.color, transparent: true, opacity: .13, wireframe: true }), 0, 1.3, 0, .95, 1.4, .95); shield.visible = false;
  return { root, body, arms, legs, head, base, shield, config };
}

export class FightScene {
  constructor(container, configs) {
    this.container = container; this.cameraMode = 'broadcast'; this.particles = []; this.time = 0; this.lastImpact = '';
    this.scene = new T.Scene(); this.scene.fog = new T.Fog('#be90b9', 23, 65);
    this.camera = new T.PerspectiveCamera(39, 1, .1, 120);
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6)); this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.outputColorSpace = T.SRGBColorSpace; this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.25;
    container.append(this.renderer.domElement); this.renderer.domElement.setAttribute('aria-label', '3D 星穹擂台，双方 AI 拟人选手在场内对战');
    this.scene.add(new T.HemisphereLight('#dfdeff', '#735369', 2.6));
    const sun = new T.DirectionalLight('#ffddbd', 4); sun.position.set(-6, 12, 6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9 }); sun.shadow.normalBias = .035; this.scene.add(sun);
    const rim = new T.DirectionalLight('#aaa6ff', 3); rim.position.set(5, 6, -5); this.scene.add(rim);
    this.buildWorld(); this.setFighters(configs);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container); this.resize();
    this.animate = this.animate.bind(this); this.animation = requestAnimationFrame(this.animate);
    this.renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); container.dispatchEvent(new CustomEvent('rendererror')); });
  }
  buildWorld() {
    const s = this.scene;
    const skyCanvas = document.createElement('canvas'); skyCanvas.width = 16; skyCanvas.height = 512; const ctx = skyCanvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 512); gradient.addColorStop(0, '#4d448c'); gradient.addColorStop(.4, '#bd85b0'); gradient.addColorStop(.66, '#fac2a6'); gradient.addColorStop(1, '#e9aec1'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 16, 512);
    const skyTexture = new T.CanvasTexture(skyCanvas); skyTexture.colorSpace = T.SRGBColorSpace;
    mesh(s, new T.SphereGeometry(85, 32, 24), new T.MeshBasicMaterial({ map: skyTexture, side: T.BackSide }));
    ball(s, new T.MeshBasicMaterial({ color: '#ffdbc0' }), -11, 10, -32, 4);
    const stone = mat('#a394bc'), edge = mat('#504c77', { metalness: .35 }), floor = mat('#dbcee0', { roughness: .4, metalness: .15 }), gold = mat('#deb98a', { metalness: .45 });
    cylinder(s, edge, 0, -.47, 0, 5.6, 5.75, .5, 80); cylinder(s, stone, 0, -.18, 0, 5.5, 5.6, .25, 80); cylinder(s, floor, 0, -.025, 0, 5.3, 5.3, .12, 80);
    ring(s, '#b1a0ff', 5.5, -.2, .05); ring(s, '#ffdebd', 5.25, .045, .025); ring(s, '#ae9ac9', 4.65, .045, .02); ring(s, '#b8a4d0', 2, .045, .018);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      const lineMesh = box(s, mat('#c1b0cf'), Math.sin(a) * 3.7, .043, Math.cos(a) * 3.7, .025, .008, 2.9); lineMesh.rotation.y = a;
      const inset = box(s, gold, Math.sin(a) * 4.95, .05, Math.cos(a) * 4.95, .12, .018, .2); inset.rotation.y = a;
    }
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; const emblem = mesh(s, new T.TorusGeometry(.65, .045, 8, 60, Math.PI * 1.6), mat('#b49dce'), Math.sin(a) * .65, .052, Math.cos(a) * .65); emblem.rotation.set(Math.PI / 2, 0, a); }
    // Floating spectator terraces and hundreds of little spectators.
    for (let tier = 0; tier < 3; tier++) {
      const radius = 9.2 + tier * 1.5;
      const terrace = mesh(s, new T.TorusGeometry(radius, .24, 4, 90, Math.PI * 1.32), edge, 0, -.3 + tier * .65, -1); terrace.rotation.x = Math.PI / 2; terrace.rotation.z = -.5;
      for (let i = 0; i < 90; i++) {
        const a = i / 90 * Math.PI * 1.25 + 2.15;
        const x = Math.sin(a) * radius, z = Math.cos(a) * radius - 1;
        if (z > 3) continue;
        const clothing = mat(['#8770ac','#de93af','#6c80ae','#f1c89c','#8ac9cb'][i % 5]);
        cylinder(s, clothing, x, .12 + tier * .65, z, .11, .16, .37, 6); ball(s, mat('#f3d3c3'), x, .42 + tier * .65, z, .115, .13, .115);
        if (i % 7 === 0) { const stick = box(s, glow(i % 2 ? '#c9abff' : '#ffb18a'), x + .2, .5 + tier * .65, z, .035, .3, .035); stick.rotation.z = .3; }
      }
    }
    // An original, stylized celestial courtyard. All meshes are generated locally.
    for (const x of [-7.4, 7.4]) {
      cylinder(s, edge, x, -.4, -4.3, 1.1, 1.4, .5, 6);
      cylinder(s, gold, x, 1.7, -4.3, .13, .18, 4, 8);
      for (const dx of [-.47, .47]) cylinder(s, gold, x + dx, 1.9, -4.3, .035, .035, 3.2, 8);
      const banner = box(s, mat('#7269b3', { metalness: .2 }), x, 2.2, -4.3, .72, 2.4, .045); banner.rotation.y = x > 0 ? -.25 : .25;
      box(s, glow('#d2c4ff'), x, 2.2, -4.25, .05, 1.8, .04);
      for (const y of [1.35, 3.2]) box(s, gold, x, y, -4.3, 1.1, .09, .16);
      ball(s, glow('#ffd6a2'), x, 4.03, -4.3, .23);
    }
    for (const [x, z, size] of [[-10,-9,1.2],[9,-12,1.4],[-4,-20,1.7],[16,-22,1.6]]) {
      const building = new T.Group(); building.position.set(x, -.4, z); building.scale.setScalar(size); s.add(building);
      for (let level = 0; level < 3; level++) {
        const w = 2.5 - level * .45, y = level * 1.4;
        box(building, mat('#97759d'), 0, y + .5, 0, w, 1.3, w);
        for (const side of [-1,1]) { box(building, glow('#ffc992'), side * w * .3, y + .55, w / 2 + .01, .24, .55, .02); cylinder(building, gold, side * w / 2, y + .55, w / 2, .055, .055, 1.3, 8); }
        const roof = mesh(building, new T.ConeGeometry(w * .95, .7, 4), mat('#4e577d'), 0, y + 1.4, 0); roof.rotation.y = Math.PI / 4;
      }
      cylinder(building, gold, 0, 4.3, 0, .03, .07, .7, 8);
    }
    for (const [x,z] of [[-8,-3],[8,-7],[-13,-12],[13,-15]]) this.tree(x,z);
    // Camera drones, lanterns, stars and drifting petals animate with the world clock.
    this.drones = [];
    for (const side of [-1,1]) {
      const drone = new T.Group(); drone.position.set(side * 5.3, 5.5, -3); s.add(drone);
      ball(drone, mat('#4c516f', { metalness: .6 }), 0,0,0,.32,.18,.22); ball(drone, glow('#98e9ff'),0,0,.2,.1);
      for (const dx of [-.48,.48]) { const rotor=mesh(drone,new T.TorusGeometry(.27,.022,6,30),glow('#bdb1ff'),dx,.12,0); rotor.rotation.x=Math.PI/2; box(drone,edge,dx*.6,0,0,.4,.04,.05); }
      this.drones.push(drone);
    }
    this.petals = [];
    const petalGeo = new T.SphereGeometry(1, 5, 3), petalMat = mat('#ffd2e4', { side: T.DoubleSide });
    for (let i=0;i<45;i++) { const p=mesh(s,petalGeo,petalMat,Math.sin(i*17)*11,1+(i%11)*.6,Math.cos(i*31)*9); p.scale.set(.055,.012,.035); this.petals.push(p); }
  }
  tree(x,z) {
    const group=new T.Group(); group.position.set(x,0,z); this.scene.add(group);
    line(group, [[0,-.5,0],[.1,1.4,0],[-.4,2.7,0],[.1,3.7,0]], '#6b4b71', .17);
    for(let i=0;i<9;i++) { const a=i*2.4; const px=Math.sin(a)*1.4, py=3+Math.sin(i*7)*.7, pz=Math.cos(a)*1.1; line(group,[[0,1.7,0],[px*.5,2.5,pz*.5],[px,py,pz]],'#6b4b71',.06); ball(group,mat(['#f3b4d1','#e5a0c7','#ffd0e0'][i%3]),px,py,pz,.9,.55,.75); }
  }
  setFighters(configs) {
    if(this.fighters) this.fighters.forEach(f=> { this.scene.remove(f.root); f.root.traverse(o=> { o.geometry?.dispose(); if(o.material) { o.material.map?.dispose(); o.material.dispose(); } }); });
    this.fighters=configs.map(makeFighter); this.fighters.forEach((f,i)=> { this.scene.add(f.root); f.root.position.set(i?2:-2,.07,0); }); this.pose=null;
  }
  setPose(previous, beat, progress, key) {
    this.pose={previous,beat,progress};
    if(key!==this.lastImpact && progress>.36) {
      this.lastImpact=key;
      for(const event of beat.events) if(event.damage>0) this.impact(1-event.player,event.action==='ultimate'?36:14,event.action==='ultimate');
    }
  }
  impact(side,count,ultimate) {
    const target=this.fighters[side];
    for(let i=0;i<count;i++) {
      const p=ball(this.scene,glow(target.config.color),target.root.position.x,1.4,.3,.03+Math.random()*.04);
      this.particles.push({mesh:p, life:0, velocity:new T.Vector3((Math.random()-.5)*7,Math.random()*4,(Math.random()-.5)*5),ultimate});
    }
    this.shake=ultimate?.14:.045;
  }
  resize() { const w=this.container.clientWidth,h=this.container.clientHeight; if(!w||!h)return; this.renderer.setSize(w,h); this.camera.aspect=w/h; this.camera.updateProjectionMatrix(); }
  animate(now) {
    const dt=Math.min(.05,(now-(this.lastTime??now))/1000); this.lastTime=now; this.time+=dt;
    const t=this.time, pose=this.pose;
    this.fighters.forEach((f,i)=> {
      const action=pose?.beat.actions[i]??'idle', p=pose?.progress??0;
      const pulse=Math.sin(Math.min(1,p)*Math.PI);
      const x=pose?T.MathUtils.lerp(pose.previous[i].x,pose.beat.states[i].x,Math.min(1,p*2)):i?2.1:-2.1;
      const attack=['strike','heavy','ultimate','blast'].includes(action);
      const hit=pose?.beat.events.some(e=>e.player!==i&&e.damage>0);
      f.root.position.x=x+(attack?(i?-.27:.27)*pulse:action==='evade'?(i?.25:-.25)*pulse:0);
      f.root.position.y=.07+(action==='evade'?.45*pulse:Math.sin(t*3+i)*.025);
      f.root.position.z=action==='evade'?.55*pulse:0;
      f.root.rotation.y=(i?-1:1)*.63;
      f.body.rotation.z=hit?(i?.12:-.12)*pulse:attack?(i?.12:-.12)*pulse:Math.sin(t*2)*.015;
      f.body.rotation.x=action==='guard'?-.1*pulse:0;
      f.arms.forEach((a,j)=> { a.rotation.x=attack?-.4-pulse*(j===i?1.6:.5):action==='guard'?-1.1:Math.sin(t*2+j)*.07-.12; a.rotation.z=(j?1:-1)*(.15+(action==='ultimate'?.6*pulse:0)); });
      f.legs.forEach((l,j)=>{l.rotation.x=action==='advance'?Math.sin(p*Math.PI*2+j*Math.PI)*.4:0;});
      f.head.rotation.z=Math.sin(t*1.2+i)*.025; f.shield.visible=action==='guard'; f.shield.rotation.y=t*.4; f.base.material.emissiveIntensity=1+Math.sin(t*2)*.5;
    });
    if(pose) {
      for(let i=0;i<2;i++) {
        const action=pose.beat.actions[i], p=pose.progress;
        if(!this.projectiles) this.projectiles=[null,null];
        if(['blast','ultimate'].includes(action)&&p>.12&&p<.65) {
          if(!this.projectiles[i]) { this.projectiles[i]=ball(this.scene,glow(this.fighters[i].config.color),0,1.5,.15,.2); }
          const orb=this.projectiles[i]; orb.visible=true; orb.position.x=T.MathUtils.lerp(this.fighters[i].root.position.x,this.fighters[1-i].root.position.x,Math.min(1,(p-.12)/.5)); orb.scale.setScalar(action==='ultimate'?.45:.22);
        } else if(this.projectiles[i]) this.projectiles[i].visible=false;
      }
    } else this.projectiles?.forEach(p=>{if(p)p.visible=false;});
    this.particles=this.particles.filter(p=> {p.life+=dt; p.mesh.position.addScaledVector(p.velocity,dt); p.velocity.y-=dt*4; p.mesh.scale.multiplyScalar(.96); if(p.life>.65){this.scene.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();return false;} return true;});
    this.drones.forEach((d,i)=>{d.position.y=5+Math.sin(t+i)*.2;d.rotation.y=Math.sin(t*.5)*.1;});
    this.petals.forEach((p,i)=>{p.position.x+=dt*.22;p.position.y-=dt*.09;p.rotation.z+=dt;if(p.position.y<.2)p.position.y=7;if(p.position.x>12)p.position.x=-12;});
    const wide=this.camera.aspect<1.25;
    if(this.cameraMode==='overhead') this.camera.position.set(0,13,8);
    else if(this.cameraMode==='ringside') this.camera.position.set(0,3.5,wide?15:11.5);
    else this.camera.position.set(Math.sin(t*.035)*1.7,wide?7.5:6,wide?19:14.5);
    if(this.shake>0){this.camera.position.x+=(Math.random()-.5)*this.shake;this.shake*=.85;}
    this.camera.lookAt(0,this.cameraMode==='overhead'?0:.9,0);
    this.renderer.render(this.scene,this.camera); this.animation=requestAnimationFrame(this.animate);
  }
}
