import * as T from "/vendor/three.module.js";
import { makeFighter } from "./fight-models.js";

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
    this.scene.fog = new T.Fog("#be90b9", 23, 65);
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
    this.renderer.toneMappingExposure = 1.25;
    container.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "3D 星穹擂台，双方 AI 拟人选手在场内对战",
    );
    this.scene.add(new T.HemisphereLight("#dfdeff", "#735369", 2.6));
    const sun = new T.DirectionalLight("#ffddbd", 4);
    sun.position.set(-6, 12, 6);
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
    const rim = new T.DirectionalLight("#aaa6ff", 3);
    rim.position.set(5, 6, -5);
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
    const s = this.scene;
    const skyCanvas = document.createElement("canvas");
    skyCanvas.width = 16;
    skyCanvas.height = 512;
    const ctx = skyCanvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, "#4d448c");
    gradient.addColorStop(0.4, "#bd85b0");
    gradient.addColorStop(0.66, "#fac2a6");
    gradient.addColorStop(1, "#e9aec1");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 16, 512);
    const skyTexture = new T.CanvasTexture(skyCanvas);
    skyTexture.colorSpace = T.SRGBColorSpace;
    mesh(
      s,
      new T.SphereGeometry(85, 32, 24),
      new T.MeshBasicMaterial({ map: skyTexture, side: T.BackSide }),
    );
    ball(s, new T.MeshBasicMaterial({ color: "#ffdbc0" }), -11, 10, -32, 4);
    const stone = mat("#a394bc"),
      edge = mat("#504c77", { metalness: 0.35 }),
      floor = mat("#dbcee0", { roughness: 0.4, metalness: 0.15 }),
      gold = mat("#deb98a", { metalness: 0.45 });
    cylinder(s, edge, 0, -0.47, 0, 5.6, 5.75, 0.5, 80);
    cylinder(s, stone, 0, -0.18, 0, 5.5, 5.6, 0.25, 80);
    cylinder(s, floor, 0, -0.025, 0, 5.3, 5.3, 0.12, 80);
    ring(s, "#b1a0ff", 5.5, -0.2, 0.05);
    ring(s, "#ffdebd", 5.25, 0.045, 0.025);
    ring(s, "#ae9ac9", 4.65, 0.045, 0.02);
    ring(s, "#b8a4d0", 2, 0.045, 0.018);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const lineMesh = box(
        s,
        mat("#c1b0cf"),
        Math.sin(a) * 3.7,
        0.043,
        Math.cos(a) * 3.7,
        0.025,
        0.008,
        2.9,
      );
      lineMesh.rotation.y = a;
      const inset = box(
        s,
        gold,
        Math.sin(a) * 4.95,
        0.05,
        Math.cos(a) * 4.95,
        0.12,
        0.018,
        0.2,
      );
      inset.rotation.y = a;
    }
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const emblem = mesh(
        s,
        new T.TorusGeometry(0.65, 0.045, 8, 60, Math.PI * 1.6),
        mat("#b49dce"),
        Math.sin(a) * 0.65,
        0.052,
        Math.cos(a) * 0.65,
      );
      emblem.rotation.set(Math.PI / 2, 0, a);
    }
    // Floating spectator terraces and hundreds of little spectators.
    for (let tier = 0; tier < 3; tier++) {
      const radius = 9.2 + tier * 1.5;
      const terrace = mesh(
        s,
        new T.TorusGeometry(radius, 0.24, 4, 90, Math.PI * 1.32),
        edge,
        0,
        -0.3 + tier * 0.65,
        -1,
      );
      terrace.rotation.x = Math.PI / 2;
      terrace.rotation.z = -0.5;
      for (let i = 0; i < 90; i++) {
        const a = (i / 90) * Math.PI * 1.25 + 2.15;
        const x = Math.sin(a) * radius,
          z = Math.cos(a) * radius - 1;
        if (z > 3) continue;
        const clothing = mat(
          ["#8770ac", "#de93af", "#6c80ae", "#f1c89c", "#8ac9cb"][i % 5],
        );
        cylinder(s, clothing, x, 0.12 + tier * 0.65, z, 0.11, 0.16, 0.37, 6);
        ball(s, mat("#f3d3c3"), x, 0.42 + tier * 0.65, z, 0.115, 0.13, 0.115);
        if (i % 7 === 0) {
          const stick = box(
            s,
            glow(i % 2 ? "#c9abff" : "#ffb18a"),
            x + 0.2,
            0.5 + tier * 0.65,
            z,
            0.035,
            0.3,
            0.035,
          );
          stick.rotation.z = 0.3;
        }
      }
    }
    // An original, stylized celestial courtyard. All meshes are generated locally.
    for (const x of [-7.4, 7.4]) {
      cylinder(s, edge, x, -0.4, -4.3, 1.1, 1.4, 0.5, 6);
      cylinder(s, gold, x, 1.7, -4.3, 0.13, 0.18, 4, 8);
      for (const dx of [-0.47, 0.47])
        cylinder(s, gold, x + dx, 1.9, -4.3, 0.035, 0.035, 3.2, 8);
      const banner = box(
        s,
        mat("#7269b3", { metalness: 0.2 }),
        x,
        2.2,
        -4.3,
        0.72,
        2.4,
        0.045,
      );
      banner.rotation.y = x > 0 ? -0.25 : 0.25;
      box(s, glow("#d2c4ff"), x, 2.2, -4.25, 0.05, 1.8, 0.04);
      for (const y of [1.35, 3.2]) box(s, gold, x, y, -4.3, 1.1, 0.09, 0.16);
      ball(s, glow("#ffd6a2"), x, 4.03, -4.3, 0.23);
    }
    for (const [x, z, size] of [
      [-10, -9, 1.2],
      [9, -12, 1.4],
      [-4, -20, 1.7],
      [16, -22, 1.6],
    ]) {
      const building = new T.Group();
      building.position.set(x, -0.4, z);
      building.scale.setScalar(size);
      s.add(building);
      for (let level = 0; level < 3; level++) {
        const w = 2.5 - level * 0.45,
          y = level * 1.4;
        box(building, mat("#97759d"), 0, y + 0.5, 0, w, 1.3, w);
        for (const side of [-1, 1]) {
          box(
            building,
            glow("#ffc992"),
            side * w * 0.3,
            y + 0.55,
            w / 2 + 0.01,
            0.24,
            0.55,
            0.02,
          );
          cylinder(
            building,
            gold,
            (side * w) / 2,
            y + 0.55,
            w / 2,
            0.055,
            0.055,
            1.3,
            8,
          );
        }
        const roof = mesh(
          building,
          new T.ConeGeometry(w * 0.95, 0.7, 4),
          mat("#4e577d"),
          0,
          y + 1.4,
          0,
        );
        roof.rotation.y = Math.PI / 4;
      }
      cylinder(building, gold, 0, 4.3, 0, 0.03, 0.07, 0.7, 8);
    }
    for (const [x, z] of [
      [-8, -3],
      [8, -7],
      [-13, -12],
      [13, -15],
    ])
      this.tree(x, z);
    // Camera drones, lanterns, stars and drifting petals animate with the world clock.
    this.drones = [];
    for (const side of [-1, 1]) {
      const drone = new T.Group();
      drone.userData.dynamic = true;
      drone.position.set(side * 5.3, 5.5, -3);
      s.add(drone);
      ball(
        drone,
        mat("#4c516f", { metalness: 0.6 }),
        0,
        0,
        0,
        0.32,
        0.18,
        0.22,
      );
      ball(drone, glow("#98e9ff"), 0, 0, 0.2, 0.1);
      for (const dx of [-0.48, 0.48]) {
        const rotor = mesh(
          drone,
          new T.TorusGeometry(0.27, 0.022, 6, 30),
          glow("#bdb1ff"),
          dx,
          0.12,
          0,
        );
        rotor.rotation.x = Math.PI / 2;
        box(drone, edge, dx * 0.6, 0, 0, 0.4, 0.04, 0.05);
      }
      this.drones.push(drone);
    }
    this.petals = [];
    const petalGeo = new T.SphereGeometry(1, 5, 3),
      petalMat = mat("#ffd2e4", { side: T.DoubleSide });
    for (let i = 0; i < (this.software ? 18 : 36); i++) {
      const p = mesh(
        s,
        petalGeo,
        petalMat,
        Math.sin(i * 17) * 11,
        1 + (i % 11) * 0.6,
        Math.cos(i * 31) * 9,
      );
      p.userData.dynamic = true;
      p.scale.set(0.055, 0.012, 0.035);
      this.petals.push(p);
    }
  }
  tree(x, z) {
    const group = new T.Group();
    group.position.set(x, 0, z);
    this.scene.add(group);
    line(
      group,
      [
        [0, -0.5, 0],
        [0.1, 1.4, 0],
        [-0.4, 2.7, 0],
        [0.1, 3.7, 0],
      ],
      "#6b4b71",
      0.17,
    );
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4;
      const px = Math.sin(a) * 1.4,
        py = 3 + Math.sin(i * 7) * 0.7,
        pz = Math.cos(a) * 1.1;
      line(
        group,
        [
          [0, 1.7, 0],
          [px * 0.5, 2.5, pz * 0.5],
          [px, py, pz],
        ],
        "#6b4b71",
        0.06,
      );
      ball(
        group,
        mat(["#f3b4d1", "#e5a0c7", "#ffd0e0"][i % 3]),
        px,
        py,
        pz,
        0.9,
        0.55,
        0.75,
      );
    }
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
      batchMeshes(fighter.body, true);
      return fighter;
    });
    this.fighters.forEach((f, i) => {
      this.scene.add(f.root);
      f.root.position.set(i ? 2 : -2, 0.07, 0);
    });
    this.pose = null;
  }
  setPose(previous, beat, progress, key) {
    this.pose = { previous, beat, progress };
    if (key !== this.lastImpact && progress > 0.36) {
      this.lastImpact = key;
      for (const event of beat.events)
        if (event.damage > 0)
          this.impact(
            1 - event.player,
            event.action === "ultimate" ? 36 : 14,
            event.action === "ultimate",
          );
    }
  }
  impact(side, count, ultimate) {
    const target = this.fighters[side];
    for (let i = 0; i < count; i++) {
      const p = ball(
        this.scene,
        glow(target.config.color),
        target.root.position.x,
        1.4,
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
    this.shake = ultimate ? 0.14 : 0.045;
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
    const dt = Math.min(0.05, (now - (this.lastTime ?? now)) / 1000);
    this.lastTime = now;
    this.time += dt;
    const t = this.time,
      pose = this.pose;
    this.fighters.forEach((f, i) => {
      const action = pose?.beat.actions[i] ?? "idle",
        p = pose?.progress ?? 0;
      const pulse = Math.sin(Math.min(1, p) * Math.PI);
      const x = pose
        ? T.MathUtils.lerp(
            pose.previous[i].x,
            pose.beat.states[i].x,
            Math.min(1, p * 2),
          )
        : i
          ? 2.1
          : -2.1;
      const attack = ["strike", "heavy", "ultimate", "blast"].includes(action);
      const hit = pose?.beat.events.some((e) => e.player !== i && e.damage > 0);
      f.root.position.x =
        x +
        (attack
          ? (i ? -0.16 : 0.16) * pulse
          : action === "evade"
            ? (i ? 0.25 : -0.25) * pulse
            : 0);
      f.root.position.y =
        0.07 +
        (action === "evade" ? 0.45 * pulse : Math.sin(t * 3 + i) * 0.025);
      f.root.position.z = action === "evade" ? 0.55 * pulse : 0;
      f.root.rotation.y = (i ? -1 : 1) * 0.63;
      f.body.rotation.z = hit
        ? (i ? 0.12 : -0.12) * pulse
        : attack
          ? (i ? 0.12 : -0.12) * pulse
          : Math.sin(t * 2) * 0.015;
      f.body.rotation.x = action === "guard" ? -0.1 * pulse : 0;
      f.arms.forEach((a, j) => {
        a.rotation.x = attack
          ? -0.4 - pulse * (j === i ? 1.6 : 0.5)
          : action === "guard"
            ? -1.1
            : Math.sin(t * 2 + j) * 0.07 - 0.12;
        a.rotation.z =
          (j ? 1 : -1) * (0.15 + (action === "ultimate" ? 0.6 * pulse : 0));
      });
      f.legs.forEach((l, j) => {
        l.rotation.x =
          action === "advance"
            ? Math.sin(p * Math.PI * 2 + j * Math.PI) * 0.4
            : 0;
      });
      f.head.rotation.z = Math.sin(t * 1.2 + i) * 0.025;
      f.shield.visible = action === "guard";
      f.shield.rotation.y = t * 0.4;
      f.base.material.emissiveIntensity = 1 + Math.sin(t * 2) * 0.5;
    });
    if (pose) {
      for (let i = 0; i < 2; i++) {
        const action = pose.beat.actions[i],
          p = pose.progress;
        if (!this.projectiles) this.projectiles = [null, null];
        if (["blast", "ultimate"].includes(action) && p > 0.12 && p < 0.65) {
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
          orb.position.x = T.MathUtils.lerp(
            this.fighters[i].root.position.x,
            this.fighters[1 - i].root.position.x,
            Math.min(1, (p - 0.12) / 0.5),
          );
          orb.scale.setScalar(action === "ultimate" ? 0.45 : 0.22);
        } else if (this.projectiles[i]) this.projectiles[i].visible = false;
      }
    } else
      this.projectiles?.forEach((p) => {
        if (p) p.visible = false;
      });
    this.particles = this.particles.filter((p) => {
      p.life += dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.velocity.y -= dt * 4;
      p.mesh.scale.multiplyScalar(0.96);
      if (p.life > 0.65) {
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
    if (this.cameraMode === "overhead") this.camera.position.set(0, 13, 8);
    else if (this.cameraMode === "ringside")
      this.camera.position.set(0, 3.5, wide ? 15 : 11.5);
    else
      this.camera.position.set(
        Math.sin(t * 0.035) * 1.7,
        wide ? 7.5 : 4.8,
        wide ? 19 : 12.8,
      );
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.shake *= 0.85;
    }
    this.camera.lookAt(0, this.cameraMode === "overhead" ? 0 : 0.9, 0);
    this.renderer.render(this.scene, this.camera);
    this.animation = requestAnimationFrame(this.animate);
  }
}
