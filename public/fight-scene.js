import * as T from "/vendor/three.module.js";
import { CONTACT, RELEASE, motion, reaction, sidestep, combatPositions, isMelee, isRanged, stunPose } from "./fight-choreography.js";
import { buildArenaStage } from "./fight-stage.js";
import { makeFighter } from "./fight-models.js";
import { eventTarget, cellPositions } from './strategy-rules.js';

const startingPositions=cellPositions([2,6]);

const mat = (color, extra = {}) =>
  new T.MeshStandardMaterial({ color, roughness: 0.73, ...extra });
const glow = (color) => mat(color, { emissive: color, emissiveIntensity: 1.6 });
function mesh(parent, geometry, material, x = 0, y = 0, z = 0) {
  const object = new T.Mesh(geometry, material);
  object.position.set(x, y, z);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}
const ball = (p, m, x, y, z, sx, sy = sx, sz = sx) => {
  const o = mesh(p, new T.SphereGeometry(1, 24, 16), m, x, y, z);
  o.scale.set(sx, sy, sz);
  return o;
};
const box = (p, m, x, y, z, sx, sy, sz) =>
  mesh(p, new T.BoxGeometry(sx, sy, sz), m, x, y, z);
const cylinder = (p, m, x, y, z, r1, r2, h, segments = 48) =>
  mesh(p, new T.CylinderGeometry(r1, r2, h, segments), m, x, y, z);
function ring(p, color, radius, y, tube = 0.025) {
  const o = mesh(
    p,
    new T.TorusGeometry(radius, tube, 8, 100),
    glow(color),
    0,
    y,
    0,
  );
  o.rotation.x = Math.PI / 2;
  return o;
}
function line(p, points, color, width = 0.035) {
  const curve = new T.CatmullRomCurve3(points.map((v) => new T.Vector3(...v)));
  return mesh(p, new T.TubeGeometry(curve, 20, width, 7, false), mat(color));
}

// Merge by material without flattening animated joints. A crowd of hundreds of
// separate little meshes otherwise costs hundreds of draw calls per shadow pass.
function batchMeshes(parent, recursive = false) {
  if (recursive)
    [...parent.children].forEach((child) => {
      if (!child.userData.dynamic) batchMeshes(child, true);
    });
  const batches = new Map();
  for (const child of parent.children) {
    if (
      !child.isMesh ||
      child.isInstancedMesh ||
      child.children.length ||
      child.userData.dynamic ||
      child.material.map ||
      child.material.transparent
    )
      continue;
    const m = child.material;
    const key = [
      m.type,
      m.color?.getHex(),
      m.emissive?.getHex(),
      m.emissiveIntensity,
      m.roughness,
      m.metalness,
      m.side,
      m.wireframe,
    ].join(":");
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(child);
  }
  for (const objects of batches.values()) {
    if (objects.length < 2) continue;
    const geometries = objects.map((object) => {
      object.updateMatrix();
      return (
        object.geometry.index
          ? object.geometry.toNonIndexed()
          : object.geometry.clone()
      ).applyMatrix4(object.matrix);
    });
    const merged = new T.BufferGeometry();
    for (const name of ["position", "normal", "uv"]) {
      if (!geometries.every((g) => g.getAttribute(name))) continue;
      const data = new Float32Array(
        geometries.reduce(
          (count, g) => count + g.getAttribute(name).array.length,
          0,
        ),
      );
      let offset = 0;
      for (const geometry of geometries) {
        data.set(geometry.getAttribute(name).array, offset);
        offset += geometry.getAttribute(name).array.length;
      }
      merged.setAttribute(
        name,
        new T.BufferAttribute(data, geometries[0].getAttribute(name).itemSize),
      );
    }
    const combined = mesh(parent, merged, objects[0].material);
    combined.castShadow = objects.some((o) => o.castShadow);
    objects.forEach((object) => {
      parent.remove(object);
      object.geometry.dispose();
    });
    geometries.forEach((g) => g.dispose());
  }
}

export class FightScene {
  constructor(container, configs) {
    this.container = container;
    this.cameraMode = "broadcast";
    this.particles = [];
    this.time = 0;
    this.lastImpact = "";
    this.scene = new T.Scene();
    this.scene.fog = new T.Fog("#c38894", 30, 85);
    this.camera = new T.PerspectiveCamera(39, 1, 0.1, 120);
    this.renderer = new T.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    const gl = this.renderer.getContext(),
      debug = gl.getExtension("WEBGL_debug_renderer_info");
    this.software = /swiftshader|llvmpipe|software/i.test(
      debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "",
    );
    this.renderer.setPixelRatio(
      this.software ? 0.8 : Math.min(devicePixelRatio, 1.5),
    );
    this.renderer.shadowMap.enabled = !this.software;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "3D 星穹擂台，双方 AI 拟人选手在场内对战",
    );
    this.scene.add(new T.HemisphereLight("#ccc5ef", "#51405d", 1.5));
    const sun = new T.DirectionalLight("#ffbd8c", 2.8);
    sun.position.set(-8, 8, -5);
    sun.castShadow = !this.software;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, {
      left: -9,
      right: 9,
      top: 9,
      bottom: -9,
    });
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);
    const rim = new T.DirectionalLight("#bfc7ff", 1.8);
    rim.position.set(3, 6, 8);
    this.scene.add(rim);
    this.buildWorld();
    batchMeshes(this.scene, true);
    this.setFighters(configs);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.animate = this.animate.bind(this);
    this.animation = requestAnimationFrame(this.animate);
    this.renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      container.dispatchEvent(new CustomEvent("rendererror"));
    });
  }
  buildWorld() {
    this.stage = buildArenaStage(this.scene, this.software, {
      mat, glow, mesh, ball, box, cylinder, ring, line,
    });
    this.drones = this.stage.drones;
    this.petals = this.stage.petals;
  }
  setFighters(configs) {
    if (this.fighters)
      this.fighters.forEach((f) => {
        this.scene.remove(f.root);
        f.root.traverse((o) => {
          o.geometry?.dispose();
          if (o.material) {
            o.material.map?.dispose();
            o.material.dispose();
          }
        });
      });
    this.fighters = configs.map((config) => {
      const fighter = makeFighter(config);
      fighter.shield.material.depthWrite = false;
      batchMeshes(fighter.body, true);
      return fighter;
    });
    this.fighters.forEach((f, i) => {
      this.scene.add(f.root);
      f.root.position.set(i ? 2 : -2, 0.07, 0);
    });
    this.pose = null;
    this.presentation = null;
    this.clearEffects();
  }
  clearEffects() {
    this.projectiles?.forEach((orb) => { if (orb) orb.visible = false; });
    this.particles.forEach((p) => {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    });
    this.particles = [];
    this.shake = 0;
    this.lastImpact = "";
  }
  resetPose() {
    this.pose = null;
    this.presentation = null;
    this.clearEffects();
  }
  setPose(previous, beat, progress, key) {
    this.pose = { previous, beat, progress };
    if (key !== this.lastImpact && progress >= CONTACT) {
      this.lastImpact = key;
      const positions = combatPositions(previous, beat, CONTACT);
      for (const event of beat.events)
        if (event.damage > 0)
          this.impact(event, positions[eventTarget(event)]);
    }
  }
  impact(event, x) {
    const side = eventTarget(event);
    const target = this.fighters[side];
    const ultimate = event.action === "ultimate";
    const blocked = event.outcome === "block";
    this.stage.react(blocked ? 0.2 : ultimate ? 1.4 : 0.45);
    const count = blocked ? 9 : ultimate ? 30 : event.action === "heavy" ? 20 : 12;
    const color = blocked ? "#a6efff" : "#ffe9ac";
    x += side ? -0.45 : 0.45;
    const flash = mesh(this.scene, new T.TorusGeometry(0.19, 0.045, 6, 24),
      new T.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false }), x, 1.5, 0.4);
    this.particles.push({ mesh: flash, life: 0, velocity: new T.Vector3(), flash: true });
    for (let i = 0; i < count; i++) {
      const p = ball(
        this.scene,
        glow(i % 3 ? color : target.config.color),
        x,
        1.5,
        0.3,
        0.03 + Math.random() * 0.04,
      );
      this.particles.push({
        mesh: p,
        life: 0,
        velocity: new T.Vector3(
          (Math.random() - 0.5) * 7,
          Math.random() * 4,
          (Math.random() - 0.5) * 5,
        ),
        ultimate,
      });
    }
    // Blocks get a small tap; clean heavy blows get the stronger camera cue.
    this.shake = Math.max(this.shake || 0, blocked ? 0.025 : ultimate ? 0.23 : event.action === "heavy" ? 0.13 : 0.065);
  }
  resize() {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  animate(now) {
    const dt = this.paused
      ? 0
      : Math.min(0.05, (now - (this.lastTime ?? now)) / 1000);
    this.lastTime = now;
    const presentation = this.presentation;
    const effectDt = dt * (presentation?.slowMotion ? 0.28 : 1);
    this.time += effectDt;
    const t = this.time,
      pose = this.pose;
    const positions = pose ? combatPositions(pose.previous, pose.beat, pose.progress) : null;
    this.stage.update(t, dt);
    this.fighters.forEach((f, i) => {
      const action = pose?.beat.actions[i] ?? "idle",
        p = pose?.progress ?? 0;
      const direction = i ? -1 : 1;
      const { extension, windup } = motion(action, p);
      const {droop,sway}=stunPose(action,p);
      const { recoil, blocked, down: falling } = pose
        ? reaction(pose.beat, i, p)
        : { recoil: 0, blocked: false, down: 0 };
      const entering = presentation?.type === "entrance" && presentation.player === i;
      const staged = ["outro", "result"].includes(presentation?.type);
      const down = staged && presentation.states[i].hp === 0 ? 1 : falling;
      const victory = staged && presentation.winner === i && !down;
      f.root.visible = presentation?.type !== "entrance" || i <= presentation.player;
      const evade = pose ? sidestep(pose.beat, i, p) : 0;
      const melee = isMelee(action), ranged = isRanged(action);
      const attack = melee || ranged;
      const x = positions?.[i] ?? (staged ? presentation.states[i].x : entering
        ? T.MathUtils.lerp(i ? 4.5 : -4.5, startingPositions[i],
            T.MathUtils.smoothstep(presentation.progress, 0, 0.65))
        : startingPositions[i]);
      f.root.position.set(x - direction * (recoil * (blocked ? 0.06 : 0.18) + down * 0.3),
        0.07, -evade * 0.95);
      // Keep floor rings grounded: only the jointed body crouches, recoils or falls.
      f.root.rotation.y = direction * 0.98 * (1 - down) * (victory ? 0.25 : 1);
      f.body.position.y = down * 0.15 - evade * 0.2 - droop * 0.1 + (victory ? 0.04 + Math.sin(t * 4) * 0.025 : 0);
      f.body.rotation.set(
        evade * 0.32 + droop * 0.28 + (action === "guard" ? 0.12 : 0),
        attack ? -direction * windup * 0.38 : 0,
        direction * (-extension * 0.12 + windup * 0.15 + recoil * (blocked ? 0.1 : 0.34) + down * 1.34 - evade * 0.24 + sway),
      );
      f.arms.forEach((a, j) => {
        const lead = j === (i ? 0 : 1);
        a.position.z = melee && lead ? extension * 0.13 : 0;
        a.rotation.x = down ? -0.25 : victory ? (j === i ? -2.8 : -0.7)
          : action === "guard" ? -1.35 - recoil * 0.15
          : attack ? -0.35 + windup * (action === "heavy" ? 0.9 : 0.3) - extension * (lead || ranged ? 1.18 : 0.4)
          : -0.4 - evade * 0.65 + Math.sin(t * 2 + j) * 0.05;
        a.rotation.z = (j ? 1 : -1) * (down ? 0.6 : victory ? 0.45 : action === "guard" ? -0.22 : 0.15 + (action === "ultimate" ? windup * 0.7 : 0));
      });
      f.legs.forEach((l, j) => {
        l.rotation.x = down ? (j ? 0.3 : -0.25) : evade ? (j ? -0.65 : 0.65) * evade
          : action === "advance" ? Math.sin(p * Math.PI * 2 + j * Math.PI) * 0.4
          : melee ? (j ? -0.25 : 0.3) * extension : 0;
      });
      f.head.rotation.z = down ? direction * 0.18 : direction * (recoil * 0.12 + droop * 0.25) + Math.sin(t * 1.2 + i) * 0.025;
      f.head.rotation.x = down ? 0.15 : evade * 0.18;
      if (entering) {
        f.root.position.y = 0.07 + Math.abs(Math.sin(presentation.progress * 20)) * 0.08;
        f.legs.forEach((leg, j) => {
          leg.rotation.x = presentation.progress < 0.65
            ? Math.sin(presentation.progress * 25 + j * Math.PI) * 0.4 : 0;
        });
      }
      f.shield.visible = action === "guard" && !down;
      f.shield.material.opacity = 0.22 + recoil * 0.28;
      f.shield.scale.set(0.83 + recoil * 0.1, 1.28, 0.83 + recoil * 0.1);
      f.shield.rotation.y = t * 0.4;
      f.base.material.emissiveIntensity = 1 + Math.sin(t * 2) * 0.5;
    });
    if (pose) {
      for (let i = 0; i < 2; i++) {
        const action = pose.beat.actions[i],
          p = pose.progress;
        if (!this.projectiles) this.projectiles = [null, null];
        if (isRanged(action) && p > RELEASE && p < CONTACT) {
          if (!this.projectiles[i]) {
            this.projectiles[i] = ball(
              this.scene,
              glow(this.fighters[i].config.color),
              0,
              1.5,
              0.15,
              0.2,
            );
          }
          const orb = this.projectiles[i];
          orb.visible = true;
          const travel = (p - RELEASE) / (CONTACT - RELEASE);
          orb.position.set(T.MathUtils.lerp(
            this.fighters[i].root.position.x + (i ? -0.5 : 0.5),
            this.fighters[1 - i].root.position.x + (i ? 0.4 : -0.4), travel),
            1.5, this.fighters[i].root.position.z);
          orb.scale.setScalar(action === "ultimate" ? 0.45 : 0.22);
        } else if (this.projectiles[i]) this.projectiles[i].visible = false;
      }
    } else
      this.projectiles?.forEach((p) => {
        if (p) p.visible = false;
      });
    this.particles = this.particles.filter((p) => {
      p.life += effectDt;
      p.mesh.position.addScaledVector(p.velocity, effectDt);
      p.velocity.y -= effectDt * 4;
      if (p.flash) {
        p.mesh.scale.setScalar(1 + p.life * 6);
        p.mesh.material.opacity = Math.max(0, 1 - p.life / 0.22);
      } else p.mesh.scale.multiplyScalar(Math.exp(-effectDt * 7));
      if (p.life > (p.flash ? 0.22 : 0.5)) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        return false;
      }
      return true;
    });
    this.drones.forEach((d, i) => {
      d.position.y = 5 + Math.sin(t + i) * 0.2;
      d.rotation.y = Math.sin(t * 0.5) * 0.1;
    });
    this.petals.forEach((p, i) => {
      p.position.x += dt * 0.22;
      p.position.y -= dt * 0.09;
      p.rotation.z += dt;
      if (p.position.y < 0.2) p.position.y = 7;
      if (p.position.x > 12) p.position.x = -12;
    });
    const wide = this.camera.aspect < 1.25;
    let focusX = 0;
    if (this.cameraMode === "overhead") this.camera.position.set(0, 13, 8);
    else if (this.cameraMode === "ringside")
      this.camera.position.set(0, 3.5, wide ? 15 : 11.5);
    else {
      const entrance = presentation?.type === "entrance";
      const highlight = presentation?.slowMotion;
      if (entrance) focusX = presentation.player ? 1.6 : -1.6;
      const target = new T.Vector3(
        entrance ? focusX + (presentation.player ? 0.7 : -0.7) : Math.sin(t * 0.035) * 1.7,
        entrance || highlight ? (wide ? 5.8 : 3.3) : (wide ? 7.5 : 4.8),
        entrance || highlight ? (wide ? 16.5 : 10.4) : (wide ? 19 : 12.8),
      );
      // A push-in, not a random camera cut. Manual camera choices are never
      // overridden by the director, even during a key-hit slow-motion beat.
      if (!this.camera.position.lengthSq()) this.camera.position.copy(target);
      else this.camera.position.lerp(target, 1 - Math.exp(-dt * 7));
    }
    if (this.shake > 0 && !this.paused) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
      this.shake *= Math.exp(-dt * 22);
    }
    this.camera.lookAt(focusX, this.cameraMode === "overhead" ? 0 : 1.1, 0);
    this.renderer.render(this.scene, this.camera);
    this.animation = requestAnimationFrame(this.animate);
  }
}
