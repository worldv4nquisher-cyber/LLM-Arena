import * as T from '/vendor/three.module.js';
import { makeFighter } from './fight-models.js';
import { batchMeshes } from './fight-scene.js';

export const lootColors = { weapon: '#ffc375', shield: '#7ed6ff', supply: '#a8f083' };
const mint = '#91f3d0', pink = '#ffa2d7';
const point = (r, a, y = 0) => new T.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
const material = (color, opts = {}) => new T.MeshStandardMaterial({ color, roughness: 0.82, ...opts });
const glow = (color, opts = {}) => new T.MeshBasicMaterial({ color, ...opts });
const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const ease = v => v * v * (3 - 2 * v);
const lerp = T.MathUtils.lerp;
function mesh(parent, geometry, mat, x = 0, y = 0, z = 0) {
  const m = new T.Mesh(geometry, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function flat(parent, geometry, mat, y) {
  const m = mesh(parent, geometry, mat, 0, y);
  m.rotation.x = -Math.PI / 2;
  return m;
}
const ring = (parent, r, w, color, y) => flat(parent, new T.RingGeometry(r - w, r, 80), glow(color, { side: T.DoubleSide }), y);

function buildSky(scene) {
  const canopy = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 direction; void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: [
      'varying vec3 direction;',
      'void main(){vec3 d=normalize(direction);',
      'vec3 navy=vec3(.035,.031,.105), plum=vec3(.23,.115,.34), teal=vec3(.085,.26,.29);',
      'float horizon=1.0-smoothstep(.04,.59,abs(d.y+.07));',
      'vec3 col=mix(navy,mix(plum,teal,smoothstep(-.4,.72,d.x)),horizon);',
      'float cloud=pow(max(0.0,sin(d.y*24.0+d.x*3.4+sin(d.z*6.0)*.5)),6.0)*horizon;',
      'col+=cloud*vec3(.13,.09,.16)*(.4+.6*sin(d.x*4.0+d.z*8.0)*sin(d.x*4.0+d.z*8.0));',
      'gl_FragColor=vec4(col,1.0);}',
    ].join('\n'),
  });
  mesh(scene, new T.SphereGeometry(105, 40, 24), canopy);
  const stars = [];
  for (let i = 0; i < 600; i++) {
    const v = point(70 + 12 * Math.sin(i * 0.44), i * 2.39996, 11 + 57 * Math.sin(i * 4.217));
    stars.push(v.x, v.y, v.z);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(stars, 3));
  scene.add(new T.Points(geometry, new T.PointsMaterial({ color: '#d5d6ff', size: 0.12, opacity: 0.65, transparent: true })));
  const planet = new T.Group();
  planet.position.set(-33, 1.8, -44);
  scene.add(planet);
  mesh(planet, new T.SphereGeometry(4.2, 32, 20), material('#a18cae', { emissive: '#715a96', emissiveIntensity: 0.4 }));
  const orbit = new T.Group();
  orbit.rotation.set(0.18, 0.4, 0.26);
  planet.add(orbit);
  ring(orbit, 6.2, 0.27, '#aa7faa', 0);
  ring(orbit, 6.85, 0.12, '#c5a3c0', 0);
}

function buildTerrain(scene) {
  const terrain = new T.Group();
  scene.add(terrain);
  const N = 48, heights = [0.025, -0.55, -2.35, -4.65, -6.7], radii = [10, 10.16, 8.65, 6.15, 2.4];
  const layers = heights.map((h, j) => Array.from({ length: N }, (_, i) => {
    const a = i * 2 * Math.PI / N;
    return point(radii[j] + (j < 2 ? 0 : Math.sin(i * 6.53 + j) * 0.75), a + (j < 2 ? 0 : Math.sin(j + i * 0.8) * 0.08), h + (j < 2 ? 0 : Math.cos(i * 3.6 + j) * 0.63));
  }));
  const points = [], colors = [];
  const palettes = ['#292440', '#433653', '#392c4d', '#281d40'];
  for (let j = 0; j < layers.length - 1; j++) {
    for (let i = 0; i < N; i++) {
      const k = (i + 1) % N;
      const faces = [[layers[j][i], layers[j + 1][i], layers[j][k]], [layers[j][k], layers[j + 1][i], layers[j + 1][k]]];
      faces.forEach((face, k) => {
        const c = new T.Color(palettes[j]).multiplyScalar(0.72 + 0.55 * (0.5 + 0.5 * Math.sin(i * 8.3 + j * 4 + k * 2)));
        for (const v of face) { points.push(v.x, v.y, v.z); colors.push(c.r, c.g, c.b); }
      });
    }
  }
  const rock = new T.BufferGeometry();
  rock.setAttribute('position', new T.Float32BufferAttribute(points, 3));
  rock.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  rock.computeVertexNormals();
  mesh(scene, rock, material('#ffffff', { vertexColors: true, side: T.DoubleSide }));

  const floor = new T.BufferGeometry(), tris = [], tones = [];
  const floorRadii = [0, 2.5, 5.15, 7.5, 10];
  const tiles = ['#30575a', '#34585f', '#3b5b63', '#34535f', '#3d585e', '#31505c'];
  for (let j = 0; j < floorRadii.length - 1; j++) {
    for (let i = 0; i < N; i++) {
      const a = i * Math.PI * 2 / N, b = (i + 1) * Math.PI * 2 / N;
      const v = [point(floorRadii[j], a), point(floorRadii[j], b), point(floorRadii[j + 1], a), point(floorRadii[j + 1], b)];
      for (const [k, ps] of [[0, [v[0], v[3], v[2]]], [1, [v[0], v[1], v[3]]]]) {
        if (j === 0 && k === 1) continue;
        const c = new T.Color(tiles[(i * 5 + j * 13 + k * 3 + Math.floor(i / 4)) % tiles.length]);
        for (const p of ps) { tris.push(p.x, p.y, p.z); tones.push(c.r, c.g, c.b); }
      }
    }
  }
  floor.setAttribute('position', new T.Float32BufferAttribute(tris, 3));
  floor.setAttribute('color', new T.Float32BufferAttribute(tones, 3));
  floor.computeVertexNormals();
  mesh(scene, floor, material('#ffffff', { vertexColors: true, side: T.DoubleSide }));
  ring(terrain, 9.96, 0.1, '#78ccbd', 0.035);
  ring(terrain, 9.71, 0.03, '#4c9292', 0.04);
  ring(terrain, 7.48, 0.036, '#88a8a7', 0.04);
  ring(terrain, 5.15, 0.03, '#648e94', 0.04);
  ring(terrain, 2.5, 0.045, '#9abeb0', 0.045);
  ring(terrain, 1.03, 0.055, '#a0e8c4', 0.05);
  const runway = glow('#aaccc0', { transparent: true, opacity: 0.55 });
  const outerRim = material('#26233d', { metalness: 0.48 });
  const crystal = material('#9ae5d5', { emissive: '#3ccdb3', emissiveIntensity: 0.55, roughness: 0.27, flatShading: true });
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6, p = point(9.1, a);
    const line = mesh(terrain, new T.BoxGeometry(0.59, 0.013, 0.075), runway, p.x, 0.05, p.z);
    line.rotation.y = -a;
    const step = point(9.85, a);
    mesh(terrain, new T.CylinderGeometry(0.34, 0.43, 0.19, 6), outerRim, step.x, 0.04, step.z);
    if (i % 2 === 0) {
      const fin = mesh(terrain, new T.OctahedronGeometry(0.51), crystal, step.x, 0.55, step.z);
      fin.scale.set(0.46, 1.23, 0.46);
      fin.rotation.y = i;
    }
    const orbit = point(13.8 + Math.sin(i * 2.1) * 3.1, a, -4.4 + Math.sin(i * 0.92) * 2);
    const fragment = mesh(terrain, new T.IcosahedronGeometry(0.38 + (i % 4) * 0.21), material('#67527e', { flatShading: true }), orbit.x, orbit.y, orbit.z);
    fragment.scale.set(1.18, 1.7, 0.75);
    fragment.rotation.set(i * 0.4, i * 0.7, i * 0.25);
  }
  for (let i = 0; i < 4; i++) {
    const p = point(0.58, i * Math.PI / 2 + Math.PI / 4);
    const dot = mesh(terrain, new T.BoxGeometry(0.55, 0.02, 0.12), glow(mint), p.x, 0.06, p.z);
    dot.rotation.y = -i * Math.PI / 2 - Math.PI / 4;
  }
  batchMeshes(terrain, true);
}

export class RoyaleScene {
  constructor(container, configs, onLost) {
    this.container = container;
    this.cameraMode = 'broadcast';
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(44, 1, 0.1, 175);
    this.camera.position.set(10, 16, 22);
    this.target = new T.Vector3(0, -0.6, 0);
    this.desired = new T.Vector3();
    this.projected = new T.Vector3();
    this.renderer = new T.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6));
    this.renderer.setClearColor('#211936');
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.42;
    container.append(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', onLost);
    this.resize = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = container;
      this.camera.aspect = Math.max(1, w) / Math.max(1, h);
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    });
    this.resize.observe(container);
    const light = new T.DirectionalLight('#ffe1ce', 3.2);
    light.position.set(-7, 12, 4);
    const rim = new T.DirectionalLight('#a0c9ff', 2.25);
    rim.position.set(2, 7, -9);
    this.scene.add(new T.HemisphereLight('#f4edff', '#61507e', 2.25), light, rim);
    buildSky(this.scene);
    buildTerrain(this.scene);

    this.fighters = new Map(configs.map(config => {
      const f = makeFighter(config);
      batchMeshes(f.body, true);
      f.root.scale.setScalar(0.79);
      this.scene.add(f.root);
      return [config.id, f];
    }));
    this.zone = new T.Group();
    this.scene.add(this.zone);
    ring(this.zone, 1.02, 0.024, mint, 0.09);
    ring(this.zone, 1.07, 0.009, mint, 0.09);
    const screen = glow(mint, { opacity: 0.125, transparent: true, depthWrite: false, side: T.DoubleSide });
    this.wall = mesh(this.zone, new T.CylinderGeometry(1.02, 1.02, 1.07, 80, 1, true), screen, 0, 0.62);
    this.hazard = flat(this.scene, new T.RingGeometry(0.01, 1, 80), glow(pink, { opacity: 0, transparent: true, depthWrite: false, side: T.DoubleSide }), 0.071);
    this.hazard.scale.setScalar(9.96);
    this.radius = 10;
    this.items = new Map();
    this.beam = mesh(this.scene, new T.CylinderGeometry(0.09, 0.19, 1, 10), glow('#fff0a7', { transparent: true, opacity: 0, depthWrite: false }));
    this.shock = ring(this.scene, 1, 0.08, pink, 0.12);
    this.shock.material.transparent = true;
    this.shock.material.depthWrite = false;
    this.shock.visible = false;
    this.up = new T.Vector3(0, 1, 0);
  }

  syncLoot(items, time) {
    const needed = new Set(items.map(item => item.id));
    for (const [id, model] of this.items) {
      if (!needed.has(id)) {
        this.scene.remove(model);
        model.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
        this.items.delete(id);
      }
    }
    for (const item of items) {
      if (!this.items.has(item.id)) {
        const group = new T.Group(), color = lootColors[item.kind];
        const stand = mesh(group, new T.CylinderGeometry(0.42, 0.52, 0.13, 6), material('#252636'), 0, 0.06);
        stand.rotation.y = Math.PI / 6;
        ring(group, 0.55, 0.061, color, 0.14);
        const shapes = { weapon: new T.OctahedronGeometry(0.27), shield: new T.IcosahedronGeometry(0.24), supply: new T.BoxGeometry(0.34, 0.34, 0.34) };
        const core = mesh(group, shapes[item.kind], material(color, { emissive: color, emissiveIntensity: 0.72, flatShading: true }), 0, 0.57);
        for (const [kind, shape] of Object.entries(shapes)) if (kind !== item.kind) shape.dispose();
        if (item.kind === 'weapon') core.scale.y = 1.6;
        group.userData.core = core;
        group.position.set(item.x, 0, item.z);
        this.scene.add(group);
        this.items.set(item.id, group);
      }
      const core = this.items.get(item.id).userData.core;
      core.position.y = 0.56 + Math.sin(time * 3.2 + item.x) * 0.11;
      core.rotation.set(time * 0.64, time * 1.5 + item.z, time * 0.47);
    }
  }

  render({ state, before = state, beat, progress = 1, time, winner, tags }) {
    const impact = clamp((progress - 0.32) / 0.68);
    const hit = beat?.events.find(e => e.type === 'hit');
    const storm = beat?.events.find(e => e.type === 'storm');
    const byId = (snapshot, id) => snapshot.entrants.find(p => p.id === id);
    const actorState = beat && byId(state, beat.actor);
    for (const [i, p] of state.entrants.entries()) {
      const f = this.fighters.get(p.id), old = byId(before, p.id);
      const moving = beat?.actor === p.id && beat.move.type === 'move';
      const acting = beat?.actor === p.id && beat.move.type === 'attack';
      const hurt = hit?.target === p.id || storm?.target === p.id;
      const walk = moving ? ease(clamp(progress / 0.72)) : 1;
      const down = !p.hp && old.hp ? ease(clamp((progress - 0.34) / 0.53)) : p.hp ? 0 : 1;
      f.root.visible = down < 1;
      if (f.root.visible) {
        f.root.position.set(lerp(old.x, p.x, walk), moving ? Math.sin(walk * Math.PI) * 0.28 : 0, lerp(old.z, p.z, walk));
        const enemy = acting ? byId(state, beat.move.target) : null;
        const heading = winner === p.id ? this.camera.position : enemy || (moving ? { x: p.x + (p.x - old.x), z: p.z + (p.z - old.z) } : { x: 0, z: 0 });
        const angle = Math.atan2(heading.x - f.root.position.x, heading.z - f.root.position.z);
        const spin = Math.atan2(Math.sin(angle - f.root.rotation.y), Math.cos(angle - f.root.rotation.y));
        f.root.rotation.y += spin * 0.16;
        f.body.position.y = Math.sin(time * 4 + i) * 0.035 - down * 0.28;
        f.body.rotation.x = down * 1.42 - (acting ? Math.sin(progress * Math.PI) * 0.22 : 0);
        f.body.rotation.z = hurt ? Math.sin(impact * Math.PI) * 0.19 : 0;
        for (let a = 0; a < f.arms.length; a++) {
          f.arms[a].rotation.x = acting ? -Math.sin(progress * Math.PI) * 1.65 : winner === p.id ? -Math.PI * (0.52 + 0.16 * Math.sin(time * 4 + a)) : 0;
        }
        for (let l = 0; l < f.legs.length; l++) f.legs[l].rotation.x = moving ? Math.sin(walk * 4 * Math.PI + l * Math.PI) * 0.41 : 0;
        f.base.scale.setScalar(acting || moving ? 1.18 : 1);
        f.shield.visible = p.guard || p.shield > 0;
      }
    }
    const attackTarget = hit && byId(state, hit.target);
    this.beam.visible = Boolean(attackTarget && progress > 0.13 && progress < 0.57);
    if (this.beam.visible) {
      const a = new T.Vector3(actorState.x, 1.24, actorState.z), b = new T.Vector3(attackTarget.x, 1.1, attackTarget.z);
      const dir = b.clone().sub(a);
      this.beam.position.copy(a).lerp(b, clamp(progress * 2.5));
      this.beam.scale.y = Math.min(1.75, dir.length());
      this.beam.quaternion.setFromUnitVectors(this.up, dir.normalize());
      this.beam.material.opacity = 0.9 * Math.sin(clamp((progress - 0.13) / 0.44) * Math.PI);
      this.beam.material.color.set(this.fighters.get(beat.actor).config.color);
    }
    const burst = attackTarget || (storm && byId(state, storm.target)) || (beat?.move.type === 'pickup' && actorState);
    this.shock.visible = Boolean(burst && impact > 0 && impact < 0.86);
    if (this.shock.visible) {
      this.shock.position.set(burst.x, 0.12, burst.z);
      this.shock.scale.setScalar(0.35 + impact * 2.3);
      this.shock.material.opacity = 1 - impact;
      this.shock.material.color.set(storm && !hit ? pink : attackTarget ? '#ffe2a3' : lootColors[beat.move.kind]);
    }
    this.radius += (state.zone.radius - this.radius) * 0.12;
    this.zone.scale.set(this.radius, 1, this.radius);
    this.zone.visible = !state.zone.overtime;
    this.wall.material.opacity = 0.12 + 0.045 * Math.sin(time * 4);
    if (Math.abs(this.hazard.userData.radius - this.radius) > 0.026 || !this.hazard.userData.radius) {
      this.hazard.geometry.dispose();
      this.hazard.geometry = new T.RingGeometry(Math.min(0.998, this.radius / 9.96), 1, 80);
      this.hazard.userData.radius = this.radius;
    }
    this.hazard.material.opacity = state.zone.phase ? 0.17 + 0.025 * Math.sin(time * 4) : 0;
    this.syncLoot(progress < 0.32 ? before.loot : state.loot, time);

    const zoom = this.camera.aspect < 1.3 ? 1.19 : 1;
    const subject = winner ? byId(state, winner) : actorState;
    const x = subject?.x ?? 0, z = subject?.z ?? 0;
    if (this.cameraMode === 'overhead') {
      this.desired.set(0, 28.5 * zoom, 0.03);
      this.target.lerp(new T.Vector3(0, 0, 0), 0.075);
    } else {
      const tight = winner || state.zone.phase > 2;
      const swing = Math.sin(time * 0.22) * (tight ? 1.8 : 0.8);
      this.desired.set((10 + swing) * zoom + x * 0.27, (tight ? 12.5 : 16) * zoom, (tight ? 17 : 22) * zoom + z * 0.27);
      this.target.lerp(new T.Vector3(x * 0.38, tight ? 0.55 : -0.65, z * 0.38), 0.055);
    }
    this.camera.position.lerp(this.desired, 0.055);
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
    for (const p of state.entrants) {
      const f = this.fighters.get(p.id), tag = tags.get(p.id);
      tag.hidden = !f.root.visible;
      if (tag.hidden) continue;
      this.projected.copy(f.root.position).y += 2.35;
      this.projected.project(this.camera);
      const x = (this.projected.x * 0.5 + 0.5) * this.container.clientWidth;
      const y = (-this.projected.y * 0.5 + 0.5) * this.container.clientHeight;
      tag.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px) translate(-50%, -50%)';
    }
  }
}
