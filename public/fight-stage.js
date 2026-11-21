import * as T from "/vendor/three.module.js";

// The venue is independent of the fighters and replay rules. Static geometry is
// batched by FightScene; the crowd uses five instanced draws on either GPU path.
export function buildArenaStage(scene, software, h) {
  const { mat, glow, mesh, ball, box, cylinder, line } = h;
  const slate = mat("#39364e"), stone = mat("#68556d"),
    brass = mat("#bd8658", { metalness: 0.55, roughness: 0.35 }),
    roof = mat("#3c4b61"), wall = mat("#927f8a");
  const sky = document.createElement("canvas");
  sky.width = 1024; sky.height = 512;
  const skyCtx = sky.getContext("2d"), gradient = skyCtx.createLinearGradient(0, 0, 0, 512);
  for (const [at, color] of [[0, "#34315f"], [0.36, "#ad6487"], [0.49, "#fa9870"], [0.58, "#edb080"], [1, "#665174"]])
    gradient.addColorStop(at, color);
  skyCtx.fillStyle = gradient; skyCtx.fillRect(0, 0, 1024, 512);
  // Soft, painted cloud banks add depth without translucent meshes or a pass.
  for (let i = 0; i < 18; i++) {
    const x = 65 + (i * 173) % 900, y = 155 + (i * 43) % 85;
    const cloud = skyCtx.createRadialGradient(x, y, 0, x, y, 85);
    cloud.addColorStop(0, i % 2 ? "#ffd4ae38" : "#7b5e8840");
    cloud.addColorStop(1, "#ffd4ae00");
    skyCtx.save(); skyCtx.translate(x, y); skyCtx.scale(1, 0.13);
    skyCtx.translate(-x, -y); skyCtx.fillStyle = cloud;
    skyCtx.fillRect(x - 85, y - 85, 170, 170); skyCtx.restore();
  }
  const skyTexture = new T.CanvasTexture(sky); skyTexture.colorSpace = T.SRGBColorSpace;
  mesh(scene, new T.SphereGeometry(85, 32, 20), new T.MeshBasicMaterial({ map: skyTexture, side: T.BackSide, fog: false }));
  ball(scene, new T.MeshBasicMaterial({ color: "#ffd1a0" }), -13, 9, -38, 4.3);

  // Painted ridge silhouettes separate the palace from the sunset horizon.
  for (const [z, color, lift] of [[-68, "#a18caa", 3], [-56, "#817c99", 0]]) {
    const ridge = new T.Shape(); ridge.moveTo(-85, -8);
    for (let i = 0; i <= 18; i++) ridge.lineTo(-85 + i * 9.5, 2 + lift + Math.sin(i * 2.1) * 3 + Math.sin(i * 0.7) * 2);
    ridge.lineTo(86, -8); ridge.closePath();
    const mountain = mesh(scene, new T.ShapeGeometry(ridge), new T.MeshBasicMaterial({ color }), 0, 0, z);
    mountain.castShadow = mountain.receiveShadow = false;
  }

  // A baked sunset sheen gives the ring depth even when real-time shadows and
  // reflections are disabled on a software renderer. No extra render pass.
  const floor = document.createElement("canvas"); floor.width = floor.height = 1024;
  const ctx = floor.getContext("2d");
  ctx.fillStyle = "#454c5d"; ctx.fillRect(0, 0, 1024, 1024);
  // Nearly square, staggered slabs; both joints have the same quiet contrast.
  for (let row = 0; row < 8; row++) {
    for (let column = -1; column < 9; column++) {
      const x = column * 144 + (row % 2) * 72, y = row * 128;
      const light = 39 + Math.sin(row * 13 + column * 7) * 2;
      ctx.fillStyle = `hsl(225 10% ${light}%)`; ctx.fillRect(x + 1, y + 1, 142, 126);
      ctx.fillStyle = "#ddd8cb20"; ctx.fillRect(x + 2, y + 2, 140, 1); ctx.fillRect(x + 2, y + 2, 1, 124);
    }
  }
  // Small mineral flecks are baked, not individual scene objects.
  for (let i = 0; i < 1700; i++) {
    ctx.fillStyle = i % 2 ? "#dedcce0b" : "#252d4012";
    ctx.fillRect((i * 139.3) % 1024, (i * 317.7) % 1024, 1 + i % 3, 1);
  }
  ctx.save(); ctx.translate(300, 260); ctx.rotate(-0.35); ctx.scale(0.5, 1.6);
  const sheen = ctx.createRadialGradient(0, 0, 5, 0, 0, 430);
  sheen.addColorStop(0, "#ffc49388"); sheen.addColorStop(0.3, "#e8ba9838"); sheen.addColorStop(1, "#edb28c00");
  ctx.fillStyle = sheen; ctx.fillRect(-430, -430, 860, 860); ctx.restore();
  // A restrained engraved border leaves the center clear for combat cues.
  ctx.strokeStyle = "#c7a98470"; ctx.lineWidth = 1.5;
  for (const r of [451, 460]) { ctx.beginPath(); ctx.arc(512, 512, r, 0, Math.PI * 2); ctx.stroke(); }
  for (let i = 0; i < 24; i++) {
    ctx.save(); ctx.translate(512, 512); ctx.rotate(i * Math.PI / 12);
    ctx.beginPath(); ctx.moveTo(-5, 456); ctx.lineTo(0, 448); ctx.lineTo(5, 456); ctx.lineTo(0, 464); ctx.closePath(); ctx.stroke(); ctx.restore();
  }
  const floorTexture = new T.CanvasTexture(floor); floorTexture.colorSpace = T.SRGBColorSpace;
  cylinder(scene, slate, 0, -0.6, 0, 5.65, 5.9, 0.55, 80);
  cylinder(scene, brass, 0, -0.28, 0, 5.55, 5.65, 0.12, 80);
  cylinder(scene, stone, 0, -0.15, 0, 5.45, 5.55, 0.2, 80);
  const surface = mesh(scene, new T.CircleGeometry(5.4, 96), mat("#ffffff", { map: floorTexture, roughness: 0.3, metalness: 0.25 }), 0, -0.035, 0);
  surface.rotation.x = -Math.PI / 2;
  function inlayRing(color, radius, y, tube) {
    const inset = mesh(scene, new T.TorusGeometry(radius, tube, 6, 96), mat(color, { emissive: color, emissiveIntensity: 0.35 }), 0, y, 0);
    inset.rotation.x = -Math.PI / 2;
  }
  inlayRing("#58b6c8", 5.42, -0.1, 0.04);
  inlayRing("#c8a47c", 5.2, -0.025, 0.02);
  inlayRing("#66abb9", 4.65, -0.022, 0.014);
  inlayRing("#78a8af", 1.8, -0.02, 0.012);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    const inset = box(scene, brass, Math.sin(a) * 4.92, -0.015, Math.cos(a) * 4.92, 0.16, 0.012, 0.34);
    inset.rotation.y = a;
  }
  // A star inlay replaces the raised, pale emblem that hid contact shadows.
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const inlay = box(scene, brass, Math.sin(a) * 0.52, -0.019, Math.cos(a) * 0.52, 0.04, 0.012, 1);
    inlay.rotation.y = a;
  }
  cylinder(scene, slate, 0, -1.2, -1, 15, 14.5, 0.7, 80);

  // Radial sectors keep terrace floors, audience feet and rails aligned.
  function arc(radius, y, thickness, material, start, end, tube = 0.035) {
    const points = [];
    for (let j = 0; j <= 20; j++) {
      const a = start + j / 20 * (end - start);
      points.push(new T.Vector3(Math.sin(a) * radius, y, -Math.cos(a) * radius - 0.6));
    }
    return mesh(scene, new T.TubeGeometry(new T.CatmullRomCurve3(points), 20, tube, thickness, false), material);
  }
  const sections = [[-2.05, -1.3], [-1.18, -0.44], [-0.32, 0.32], [0.44, 1.18], [1.3, 2.05]];
  const fascia = mat("#956b57", { emissive: "#d29b64", emissiveIntensity: 0.22 });
  const spectators = [];
  for (let tier = 0; tier < 3; tier++) {
    const radius = 8 + tier * 1.25, level = -0.25 + tier * 0.85;
    for (const [start, end] of sections) {
    const shape = new T.Shape();
    for (let j = 0; j <= 20; j++) {
      const a = start + j / 20 * (end - start), x = Math.sin(a) * (radius + 0.6), z = -Math.cos(a) * (radius + 0.6) - 0.6;
      if (!j) shape.moveTo(x, -z); else shape.lineTo(x, -z);
    }
    for (let j = 20; j >= 0; j--) {
      const a = start + j / 20 * (end - start);
      shape.lineTo(Math.sin(a) * (radius - 0.6), Math.cos(a) * (radius - 0.6) + 0.6);
    }
    const terrace = mesh(scene, new T.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false }), tier % 2 ? stone : slate, 0, level - 0.5, 0);
    terrace.rotation.x = -Math.PI / 2;
    arc(radius - 0.55, level + 0.24, 5, brass, start, end);
    arc(radius - 0.55, level - 0.16, 5, fascia, start, end, 0.045);
    for (let j = 0; j < 12; j++) {
      const a = start + 0.045 + j / 11 * (end - start - 0.09);
      const r = radius + Math.sin(j * 9 + tier) * 0.16;
      spectators.push({ x: Math.sin(a) * r, z: -Math.cos(a) * r - 0.6, y: level, a, height: 0.36 + (Math.sin(j * 27 + tier) + 1) * 0.09 });
      if (j % 4 === 0 || j === 11) cylinder(scene, brass, Math.sin(a) * (radius - 0.55), level + 0.1, -Math.cos(a) * (radius - 0.55) - 0.6, 0.025, 0.025, 0.65, 6);
    }
    }
  }
  // Clear radial aisles, with shallow treads and warm edge markers.
  for (const a of [-1.24, -0.38, 0.38, 1.24]) {
    const stairs = new T.Group(); stairs.rotation.y = -a; stairs.position.z = -0.6; scene.add(stairs);
    for (let step = 0; step < 15; step++) {
      const r = 7.45 + step * 0.25, top = -0.25 + step * 0.17;
      box(stairs, stone, 0, top - 0.16, -r, 0.78, 0.28, 0.27);
      if (step % 3 === 0) box(stairs, fascia, 0, top - 0.01, -r + 0.13, 0.64, 0.025, 0.025);
    }
  }
  const count = spectators.length;
  function instances(geometry, material, n) {
    const objects = new T.InstancedMesh(geometry, material, n);
    objects.userData.dynamic = true; scene.add(objects); return objects;
  }
  const bodies = instances(new T.CylinderGeometry(0.095, 0.17, 1, 6), mat("#ffffff"), count),
    heads = instances(new T.SphereGeometry(0.12, 8, 6), mat("#ffffff"), count),
    hair = instances(new T.SphereGeometry(0.125, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.54), mat("#40334e"), count),
    arms = instances(new T.CylinderGeometry(0.035, 0.045, 0.28, 5), mat("#b698a4"), count * 2),
    sticks = instances(new T.BoxGeometry(0.025, 0.24, 0.025), glow("#89e0eb"), count);
  const dummy = new T.Object3D(), palette = ["#58649d", "#ab617f", "#499393", "#be8d5e", "#7965a2", "#b4a3bb"];
  spectators.forEach((p, i) => {
    dummy.position.set(p.x, p.y + p.height / 2, p.z); dummy.scale.set(1, p.height, 1); dummy.updateMatrix(); bodies.setMatrixAt(i, dummy.matrix);
    bodies.setColorAt(i, new T.Color(palette[(i * 7 + Math.floor(i / 5)) % palette.length]));
    dummy.position.y = p.y + p.height + 0.1; dummy.scale.setScalar(1); dummy.updateMatrix(); heads.setMatrixAt(i, dummy.matrix);
    heads.setColorAt(i, new T.Color(["#e8bea5", "#b78674", "#d9a88c"][i % 3]));
    dummy.position.y += 0.035; dummy.updateMatrix(); hair.setMatrixAt(i, dummy.matrix);
  });

  // Lantern/banner towers frame the fighters instead of filling the skyline.
  for (const x of [-6.8, 6.8]) {
    const z = -3.8;
    cylinder(scene, slate, x, -0.35, z, 0.65, 0.9, 0.5, 6);
    for (const dx of [-0.45, 0.45]) cylinder(scene, brass, x + dx, 1.9, z, 0.045, 0.055, 4.4, 8);
    box(scene, mat("#32627d", { emissive: "#235c85", emissiveIntensity: 0.3 }), x, 1.9, z, 0.72, 2.7, 0.06);
    for (const dx of [-0.36, 0.36]) box(scene, glow("#73cddd"), x + dx, 1.9, z + 0.05, 0.023, 2.7, 0.02);
    const symbol = mesh(scene, new T.TorusGeometry(0.22, 0.035, 6, 20), glow("#9ddbea"), x, 1.9, z + 0.06);
    symbol.rotation.z = Math.PI / 4;
    for (const y of [0.52, 3.3, 3.65, 4.4]) box(scene, brass, x, y, z, 1.1, 0.09, 0.9);
    box(scene, glow("#ffbe76"), x, 3.99, z, 0.63, 0.65, 0.58);
    for (const dx of [-0.36, 0.36]) for (const dz of [-0.33, 0.33]) box(scene, brass, x + dx, 3.99, z + dz, 0.06, 0.68, 0.06);
    const cap = mesh(scene, new T.ConeGeometry(0.9, 0.45, 4), roof, x, 4.65, z); cap.rotation.y = Math.PI / 4;
  }
  // Broad hip roofs with lifted corners, instead of repeated pointed towers.
  function hipRoof(parent, w, depth, y, material) {
    const edge = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
    const positions = [], indices = [];
    for (const [scale, lift] of [[1, 0], [0.72, 0.16], [0.22, 0.8]]) {
      for (const [x, z] of edge) positions.push(x * w / 2 * scale, y + lift + (scale === 1 && x && z ? 0.2 : 0), z * depth / 2 * scale);
    }
    for (let layer = 0; layer < 2; layer++) for (let i = 0; i < 8; i++) {
      const a = layer * 8 + i, b = layer * 8 + (i + 1) % 8, c = a + 8, d = b + 8;
      indices.push(a, c, b, b, c, d);
    }
    // Close the small upper plateau; it is visible from the overhead camera.
    for (let i = 1; i < 7; i++) indices.push(16, 16 + i + 1, 16 + i);
    const geometry = new T.BufferGeometry(); geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    mesh(parent, geometry, material);
    for (const z of [-depth / 2, depth / 2]) line(parent, [[-w / 2, y + 0.2, z], [-w * 0.35, y, z], [0, y, z], [w * 0.35, y, z], [w / 2, y + 0.2, z]], "#b79573", 0.035);
  }
  const timber = mat("#5c4655"), paper = mat("#e9b686", { emissive: "#dc995a", emissiveIntensity: 0.25 });
  function pavilion(parent, x, y, z, w, depth, height, material = wall) {
    const group = new T.Group(); group.position.set(x, y, z); parent.add(group);
    box(group, material, 0, height / 2, 0, w, height, depth);
    box(group, timber, 0, 0.08, depth / 2 + 0.06, w + 0.25, 0.16, 0.2);
    for (let i = 0; i < 5; i++) {
      const px = (i - 2) * w / 5;
      box(group, paper, px, height * 0.55, depth / 2 + 0.02, w * 0.13, height * 0.52, 0.03);
      box(group, timber, px, height * 0.55, depth / 2 + 0.045, 0.04, height * 0.55, 0.04);
      box(group, timber, px, height * 0.55, depth / 2 + 0.045, w * 0.14, 0.04, 0.04);
    }
    for (const side of [-1, 1]) box(group, timber, side * (w / 2 - 0.08), height / 2, depth / 2 + 0.07, 0.16, height, 0.16);
    box(group, timber, 0, height - 0.12, depth / 2 + 0.08, w, 0.16, 0.18);
    hipRoof(group, w * 1.35, depth * 1.4, height, roof);
    return group;
  }
  const palace = new T.Group(); palace.position.set(0, -1.8, -31); scene.add(palace);
  box(palace, slate, 0, 0, 0, 15, 0.8, 6);
  pavilion(palace, 0, 0.4, 0, 8, 4.3, 1.7);
  pavilion(palace, 0, 2.9, -0.3, 5.8, 3.4, 1.65);
  pavilion(palace, 0, 5.35, -0.5, 3.7, 2.5, 1.4);
  for (const side of [-1, 1]) pavilion(palace, side * 6.1, 0.4, -0.7, 4, 3.4, 1.4);
  cylinder(palace, brass, 0, 8, -0.5, 0.025, 0.1, 1.2, 8);
  ball(palace, brass, 0, 8.55, -0.5, 0.13);
  // Lower, desaturated side buildings leave breathing room around the palace.
  for (const [x, z, size] of [[-17, -34, 1.1], [17, -37, 1.15], [-27, -45, 1.25], [29, -48, 1.3]]) {
    const building = new T.Group(); building.position.set(x, -1.6, z); building.scale.setScalar(size); scene.add(building);
    const distantWall = mat("#8b8399");
    pavilion(building, 0, 0, 0, 4.5, 3.2, 1.6, distantWall);
    pavilion(building, 0, 2.4, -0.3, 3, 2.5, 1.4, distantWall);
  }
  // Blossom clusters use low-poly geometry; layered pinks remain legible at dusk.
  for (const [x, z, scale] of [[-8.8, -5, 1], [8.7, -7, 1.1], [-13, -13, 1.3], [13, -17, 1.3]]) {
    const tree = new T.Group(); tree.position.set(x, 0, z); tree.scale.setScalar(scale); scene.add(tree);
    line(tree, [[0, -0.7, 0], [0.12, 1.4, 0], [-0.3, 2.8, 0], [0.1, 3.8, 0]], "#553a50", 0.16);
    for (let i = 0; i < 11; i++) {
      const a = i * 2.4, px = Math.sin(a) * 1.45, py = 3.3 + Math.sin(i * 7) * 0.65, pz = Math.cos(a) * 1.1;
      line(tree, [[0, 1.7, 0], [px * 0.5, 2.5, pz * 0.5], [px, py, pz]], "#553a50", 0.055);
      const blossom = mesh(tree, new T.IcosahedronGeometry(1, 1), mat(["#c96c9b", "#df91b3", "#edb1c7"][i % 3]), px, py, pz); blossom.scale.set(0.95, 0.52, 0.8);
    }
  }
  const drones = [];
  for (const side of [-1, 1]) {
    const drone = new T.Group(); drone.userData.dynamic = true; drone.position.set(side * 5.3, 5, -3); scene.add(drone);
    ball(drone, slate, 0, 0, 0, 0.32, 0.18, 0.22); ball(drone, glow("#89d9ee"), 0, 0, 0.2, 0.1);
    for (const dx of [-0.48, 0.48]) { const rotor = mesh(drone, new T.TorusGeometry(0.27, 0.022, 6, 24), glow("#8cc9e0"), dx, 0.12, 0); rotor.rotation.x = Math.PI / 2; box(drone, slate, dx * 0.6, 0, 0, 0.4, 0.04, 0.05); }
    drones.push(drone);
  }
  const petals = [], petalGeo = new T.SphereGeometry(1, 5, 3), petalMat = mat("#eea1bf");
  for (let i = 0; i < (software ? 18 : 36); i++) { const p = mesh(scene, petalGeo, petalMat, Math.sin(i * 17) * 11, 1 + i % 11 * 0.6, Math.cos(i * 31) * 9); p.userData.dynamic = true; p.scale.set(0.055, 0.012, 0.035); petals.push(p); }
  let excitement = 0, lastUpdate = -1;
  return {
    drones, petals,
    react(strength = 1) { excitement = Math.max(excitement, strength); },
    update(t, dt) {
      excitement = Math.max(0, excitement - dt * 0.4);
      if (t - lastUpdate < 0.1) return; lastUpdate = t;
      spectators.forEach((p, i) => {
        const cheering = (i % 7 === 0 ? 0.28 : 0) + excitement;
        for (const side of [-1, 1]) {
          dummy.position.set(p.x + side * 0.16, p.y + p.height * 0.72 + cheering * 0.12, p.z + 0.03);
          dummy.scale.setScalar(1); dummy.rotation.set(0, -p.a, side * (0.18 + cheering * (1.4 + Math.sin(t * 5 + i) * 0.35))); dummy.updateMatrix(); arms.setMatrixAt(i * 2 + (side + 1) / 2, dummy.matrix);
        }
        dummy.position.set(p.x + 0.22, p.y + p.height + 0.24 + cheering * 0.2, p.z);
        dummy.rotation.set(0, 0, 0.25 + Math.sin(t * 3 + i) * cheering * 0.6); dummy.scale.setScalar(i % 6 === 0 ? 1 : 0); dummy.updateMatrix(); sticks.setMatrixAt(i, dummy.matrix);
      });
      arms.instanceMatrix.needsUpdate = sticks.instanceMatrix.needsUpdate = true;
    },
  };
}
