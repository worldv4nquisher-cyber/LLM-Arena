import * as T from "/vendor/three.module.js";

// Character-only geometry. Keep the replay choreography and broadcast cameras
// independent of the cast's costumes, faces, and hand-held props.
const material = (color, extra = {}) =>
  new T.MeshStandardMaterial({ color, roughness: 0.72, ...extra });
function mesh(parent, geometry, mat, x = 0, y = 0, z = 0) {
  const object = new T.Mesh(geometry, mat);
  object.position.set(x, y, z);
  object.castShadow = object.receiveShadow = true;
  parent.add(object);
  return object;
}
function ball(p, m, x, y, z, sx, sy = sx, sz = sx) {
  const o = mesh(p, new T.SphereGeometry(1, 18, 12), m, x, y, z);
  o.scale.set(sx, sy, sz);
  return o;
}
const box = (p, m, x, y, z, w, h, d) =>
  mesh(p, new T.BoxGeometry(w, h, d), m, x, y, z);
const cylinder = (p, m, x, y, z, top, bottom, height) =>
  mesh(p, new T.CylinderGeometry(top, bottom, height, 32), m, x, y, z);
function tube(parent, points, mat, radius = 0.025) {
  const curve = new T.CatmullRomCurve3(points.map((p) => new T.Vector3(...p)));
  return mesh(parent, new T.TubeGeometry(curve, 20, radius, 6, false), mat);
}
function group(parent, name, x = 0, y = 0, z = 0) {
  const g = new T.Group();
  g.name = name;
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
function shape(parent, points, mat, x = 0, y = 0, z = 0, depth = 0.035) {
  const path = new T.Shape();
  path.moveTo(...points[0]);
  points.slice(1).forEach((p) => path.lineTo(...p));
  path.closePath();
  return mesh(parent, new T.ExtrudeGeometry(path, {
    depth, bevelEnabled: false, curveSegments: 8,
  }), mat, x, y, z);
}
function star(parent, mat, x, y, z, radius = 0.1) {
  const points = Array.from({ length: 8 }, (_, i) => {
    const a = i * Math.PI / 4, r = i % 2 ? radius * 0.3 : radius;
    return [Math.sin(a) * r, Math.cos(a) * r];
  });
  return shape(parent, points, mat, x, y, z, 0.025);
}
function bow(parent, mat, x, y, z, size = 1) {
  const g = group(parent, "ribbon", x, y, z);
  for (const side of [-1, 1]) {
    const loop = ball(g, mat, side * 0.09, 0.02, 0, 0.11, 0.065, 0.04);
    loop.rotation.z = side * 0.35;
    shape(g, [[0, 0], [side * 0.05, -0.2], [side * 0.13, -0.16], [side * 0.07, 0]], mat);
  }
  ball(g, mat, 0, 0, 0.035, 0.045);
  g.scale.setScalar(size);
  return g;
}
function flower(parent, petals, center, x, y, z, size = 1) {
  const g = group(parent, "flower", x, y, z);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const p = ball(g, petals, Math.sin(a) * 0.105, Math.cos(a) * 0.105, 0, 0.047, 0.09, 0.035);
    p.rotation.z = -a;
  }
  ball(g, center, 0, 0, 0.04, 0.065, 0.065, 0.04);
  g.scale.setScalar(size);
  return g;
}

// A tapered, curved solid lock has a pointed tip instead of a row of hair beads.
function lock(parent, mat, points, width = 0.12, depth = 0.07) {
  const curve = new T.CatmullRomCurve3(points.map((p) => new T.Vector3(...p)));
  const positions = [], indices = [], rows = 16, sides = 8;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, p = curve.getPoint(t);
    const taper = Math.max(0.025, Math.sin((0.18 + t * 0.82) * Math.PI) ** 0.6);
    for (let j = 0; j < sides; j++) {
      const a = j / sides * Math.PI * 2;
      positions.push(p.x + Math.cos(a) * width * taper, p.y, p.z + Math.sin(a) * depth * taper);
      if (i < rows) {
        const n = i * sides + j, next = i * sides + (j + 1) % sides;
        indices.push(n, next, n + sides, next, next + sides, n + sides);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return mesh(parent, geometry, mat);
}

function faceTexture(id) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 320;
  const c = canvas.getContext("2d");
  const eyes = { gpt: ["#8058c8", "#8058c8"], claude: ["#c16818", "#c16818"], gemini: ["#8156d8", "#e5a21c"], deepseek: ["#167ed1", "#167ed1"], grok: ["#218ac4", "#218ac4"] }[id];
  [145, 367].forEach((x, i) => {
    c.fillStyle = "#31223e";
    c.beginPath(); c.ellipse(x, 115, 59, 72, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#fffaf7";
    c.beginPath(); c.ellipse(x, 121, 53, 63, 0, 0, Math.PI * 2); c.fill();
    const iris = c.createLinearGradient(0, 65, 0, 180);
    iris.addColorStop(0, "#29213f"); iris.addColorStop(0.5, eyes[i]); iris.addColorStop(1, eyes[i]);
    c.fillStyle = iris;
    c.beginPath(); c.ellipse(x + 4, 123, 36, 55, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#211b36";
    c.beginPath(); c.ellipse(x + 4, 112, 15, 35, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#fff";
    c.beginPath(); c.ellipse(x - 9, 89, 13, 17, 0.3, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(x + 18, 148, 6, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#31223e"; c.lineWidth = 12; c.lineCap = "round";
    c.beginPath(); c.moveTo(x - 58, 90); c.quadraticCurveTo(x, 23, x + 55, 78); c.stroke();
    c.beginPath(); c.moveTo(x + (i ? 52 : -52), 76); c.lineTo(x + (i ? 67 : -67), 62); c.stroke();
    c.strokeStyle = "#72506a"; c.lineWidth = 5;
    c.beginPath(); c.moveTo(x - 30, 17); c.quadraticCurveTo(x, 8, x + 28, id === "grok" ? 28 : 16); c.stroke();
    const blush = c.createRadialGradient(x, 213, 3, x, 213, 35);
    blush.addColorStop(0, "#ed8caa99"); blush.addColorStop(1, "#ed8caa00");
    c.fillStyle = blush; c.fillRect(x - 40, 178, 80, 70);
  });
  c.strokeStyle = "#9b4e67"; c.lineWidth = 5;
  c.beginPath(); c.moveTo(232, 247); c.quadraticCurveTo(256, id === "grok" ? 277 : 263, 280, 247); c.stroke();
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

function skirt(body, cloth, trim, { bottom, radius, top = 1.23, waist = 0.25, scallops = 20 }) {
  const g = group(body, "skirt");
  cylinder(g, cloth, 0, (top + bottom) / 2, 0, waist, radius, top - bottom);
  for (let i = 0; i < scallops; i++) {
    const a = i / scallops * Math.PI * 2;
    ball(g, trim, Math.sin(a) * radius, bottom, Math.cos(a) * radius, 0.075, 0.045, 0.065);
  }
  return g;
}

export function makeFighter(config) {
  const root = new T.Group(), body = group(root, "body");
  root.name = config.id;
  const skin = material("#ffddcd"), hair = material(config.hair);
  const cloth = material(config.dress), dark = material(config.id === "grok" ? "#231b32" : config.dark);
  const white = material("#fff4e7"), gold = material("#dca64d", { metalness: 0.45, roughness: 0.4 });
  const accent = material(config.color);
  const luminous = material(config.color, { emissive: config.color, emissiveIntensity: 0.7 });
  const legs = [-1, 1].map((side) => {
    const leg = group(body, "leg", side * 0.18, 0.72, 0);
    cylinder(leg, config.id === "gemini" ? skin : white, 0, -0.22, 0, 0.075, 0.085, 0.43);
    cylinder(leg, config.id === "grok" ? dark : white, 0, -0.43, 0.015, 0.09, 0.1, 0.22);
    ball(leg, config.id === "gemini" ? cloth : dark, 0, -0.57, 0.08, 0.115, 0.11, 0.19);
    bow(leg, config.id === "grok" ? gold : cloth, 0, -0.45, 0.12, 0.6);
    return leg;
  });
  if (config.id === "gpt") {
    skirt(body, cloth, white, { bottom: 0.16, radius: 0.7 });
    for (const [bottom, radius] of [[0.38, 0.64], [0.64, 0.52]])
      skirt(body, cloth, white, { bottom, radius });
    for (const side of [-1, 1]) {
      shape(body, [[0, 1.23], [side * 0.24, 1.05], [side * 0.48, 0.28], [side * 0.1, 0.16]], white, 0, 0, 0.36);
      flower(body, material("#a78abf"), white, side * 0.3, 0.66, 0.47, 0.6);
    }
  } else if (config.id === "claude") {
    skirt(body, cloth, white, { bottom: 0.35, radius: 0.64 });
    skirt(body, dark, gold, { bottom: 0.48, radius: 0.63 });
    skirt(body, cloth, gold, { bottom: 0.6, radius: 0.56 });
    shape(body, [[-0.09, 1.23], [-0.26, 0.42], [0.26, 0.42], [0.09, 1.23]], white, 0, 0, 0.45);
    for (const side of [-1, 1]) flower(body, cloth, gold, side * 0.36, 0.65, 0.43, 0.65);
  } else if (config.id === "grok") {
    const crimson = material("#9e1546");
    skirt(body, crimson, crimson, { bottom: 0.25, radius: 0.6 });
    skirt(body, crimson, crimson, { bottom: 0.46, radius: 0.55 });
    skirt(body, dark, gold, { bottom: 0.64, radius: 0.52 });
    for (const side of [-1, 1]) shape(body, [[side * 0.15, 1.18], [side * 0.66, 0.3], [side * 0.4, 0.35]], dark, 0, 0, 0.12);
  } else {
    skirt(body, cloth, white, { bottom: config.id === "gemini" ? 0.77 : 0.51, radius: 0.52 });
    skirt(body, cloth, gold, { bottom: config.id === "gemini" ? 0.87 : 0.64, radius: 0.5 });
  }
  ball(body, config.id === "grok" ? dark : cloth, 0, 1.43, 0, 0.245, 0.31, 0.19);
  cylinder(body, config.id === "deepseek" ? dark : gold, 0, 1.23, 0, 0.25, 0.25, 0.065);
  shape(body, [[-0.15, 1.67], [0, 1.42], [0.15, 1.67]], white, 0, 0, 0.18);
  bow(body, config.id === "gpt" ? accent : dark, 0, 1.55, 0.235, 0.65);
  star(body, gold, 0, 1.45, 0.235, 0.065);
  for (let i = 0; i < 3; i++) ball(body, gold, 0, 1.36 - i * 0.065, 0.2, 0.018);
  const arms = [-1, 1].map((side) => {
    const arm = group(body, "arm", side * 0.29, 1.57, 0);
    const sleeve = config.id === "grok" ? dark : config.id === "gemini" ? cloth : white;
    ball(arm, sleeve, side * 0.04, -0.09, 0, 0.135, 0.15, 0.14);
    cylinder(arm, sleeve, side * 0.085, -0.27, 0.025, 0.095, 0.135, 0.26);
    cylinder(arm, config.id === "deepseek" ? white : gold, side * 0.085, -0.4, 0.025, 0.14, 0.14, 0.045);
    ball(arm, skin, side * 0.085, -0.48, 0.06, 0.095, 0.1, 0.08);
    return arm;
  });
  const head = group(body, "head", 0, 2.03, 0);
  ball(head, hair, 0, 0.07, -0.1, 0.49, 0.54, 0.42);
  ball(head, skin, 0, 0, 0.035, 0.44, 0.46, 0.38);
  // Conform the eyes AND mouth to the head surface: the old flat plane was
  // buried inside the cheeks, leaving pale, almost pupil-less faces.
  const faceGeometry = new T.PlaneGeometry(0.7, 0.45, 24, 16);
  const vertices = faceGeometry.getAttribute("position");
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i) - 0.035;
    vertices.setXYZ(i, x, y, 0.035 + 0.38 * Math.sqrt(Math.max(0, 1 - (x / 0.44) ** 2 - (y / 0.46) ** 2)) + 0.012);
  }
  faceGeometry.computeVertexNormals();
  const face = mesh(head, faceGeometry, new T.MeshBasicMaterial({ map: faceTexture(config.id), transparent: true, depthWrite: false }));
  face.name = "face";
  // Swept fringe leaves the brows/irises visible and creates a smooth hair cap.
  for (let i = -2; i <= 2; i++) lock(head, hair, [[i * 0.1, 0.5 - Math.abs(i) * 0.025, 0.03], [i * 0.14, 0.36, 0.29], [i * 0.15 + 0.055, 0.12 + Math.abs(i) * 0.015, 0.37]], 0.115, 0.07);
  const hairTips = material(config.id === "gemini" ? "#bf5edf" : config.hair);
  for (const side of [-1, 1]) {
    ball(head, skin, side * 0.43, -0.015, 0, 0.065, 0.1, 0.06);
    lock(head, hair, [[side * 0.39, 0.31, 0.08], [side * 0.47, -0.05, 0.12], [side * 0.4, -0.38, 0.15]], 0.1, 0.095);
    if (config.id !== "grok") for (let j = 0; j < 3; j++) {
      lock(body, j === 2 ? hairTips : hair, [[side * (0.29 + j * 0.07), 2.25, -0.22], [side * (0.43 + j * 0.055), 1.72, -0.27 - j * 0.055], [side * (0.52 + j * 0.07), config.id === "deepseek" ? 1.02 : 0.9, -0.25], [side * (0.38 + j * 0.12), config.id === "deepseek" ? 1 : 0.75, -0.14]], 0.13, 0.09);
    }
  }
  if (config.id === "gpt") dragon(body, head, hair, white, accent, luminous);
  if (config.id === "claude") {
    flower(head, material("#ec7625"), gold, 0.37, 0.37, 0.24, 1.1);
    bow(head, dark, 0.46, 0.19, 0.04, 0.65);
    const book = group(arms[0], "spellbook", -0.14, -0.36, 0.25);
    book.rotation.set(-0.3, -0.2, -0.15);
    for (const side of [-1, 1]) {
      const page = group(book, "open-book-page");
      page.rotation.y = side * 0.35;
      box(page, dark, side * 0.145, 0, 0, 0.29, 0.4, 0.045);
      box(page, gold, side * 0.145, 0, 0.03, 0.27, 0.38, 0.012);
      box(page, white, side * 0.145, 0, 0.04, 0.235, 0.345, 0.018);
      for (let row = 0; row < 4; row++) box(page, material("#a27a60"), side * 0.145, 0.09 - row * 0.06, 0.052, 0.17, 0.008, 0.006);
    }
    star(book, luminous, 0, 0.29, 0.04, 0.1);
  }
  if (config.id === "gemini") {
    for (const side of [-1, 1]) {
      const ear = group(head, "cat-ear", side * 0.34, 0.4, 0);
      shape(ear, [[-0.17, 0], [side * 0.07, 0.4], [0.17, 0]], hair);
      shape(ear, [[-0.09, 0.04], [side * 0.045, 0.29], [0.09, 0.04]], material("#ef9cc9"), 0, 0, 0.04);
      star(body, gold, side * 0.27, 0.98, 0.43, 0.07);
      star(head, luminous, side * 0.68, 0.07, 0, 0.13);
    }
    star(body, gold, 0, 1.25, 0.26, 0.1);
  }
  if (config.id === "deepseek") maid(body, head, white, cloth, accent);
  if (config.id === "grok") devil(body, head, arms, hair, dark, gold, accent);

  const shadow = mesh(root, new T.CircleGeometry(0.72, 32), new T.MeshBasicMaterial({ color: "#261e48", transparent: true, opacity: 0.21, depthWrite: false }), 0, 0.015, 0);
  shadow.rotation.x = -Math.PI / 2;
  const base = mesh(root, new T.TorusGeometry(0.72, 0.018, 8, 64), material(config.color, { emissive: config.color, emissiveIntensity: 1 }), 0, 0.035, 0);
  base.rotation.x = Math.PI / 2;
  const shield = ball(root, new T.MeshBasicMaterial({ color: config.color, transparent: true, opacity: 0.13, wireframe: true }), 0, 1.3, 0, 0.95, 1.4, 0.95);
  shield.visible = false;
  return { root, body, arms, legs, head, base, shield, config };
}

function dragon(body, head, hair, white, accent, luminous) {
  for (const side of [-1, 1]) {
    const horn = group(head, "dragon-horn");
    lock(horn, white, [[side * 0.34, 0.37, 0], [side * 0.47, 0.64, 0], [side * 0.41, 0.84, 0.02]], 0.1, 0.1);
    flower(head, accent, white, side * 0.44, 0.1, 0.12, 0.6);
    const wing = group(body, "dragon-wing", side * 0.25, 1.54, -0.28);
    const points = [[0, 0], [side * 0.46, 0.54], [side * 0.99, 0.31], [side * 0.84, -0.03], [side * 0.56, 0.04], [side * 0.48, -0.37], [side * 0.21, -0.14]];
    shape(wing, points, accent);
    for (const end of [[side * 0.99, 0.31, 0.04], [side * 0.48, -0.37, 0.04]]) tube(wing, [[0, 0, 0.04], [side * 0.46, 0.5, 0.04], end], white, 0.025);
  }
  const tail = group(body, "dragon-tail");
  lock(tail, hair, [[0, 0.9, -0.25], [-0.52, 0.38, -0.47], [-0.92, 0.37, -0.2], [-0.99, 0.66, 0.04]], 0.16, 0.15);
  for (let i = 0; i < 4; i++) star(tail, accent, -0.48 - i * 0.12, 0.54, -0.22, 0.055);
  const pet = group(body, "star-companion", -0.85, 2.37, -0.02);
  ball(pet, material("#a7ccf6"), 0, 0, 0, 0.16, 0.18, 0.14);
  for (const s of [-1, 1]) {
    ball(pet, white, s * 0.17, -0.015, 0, 0.07, 0.035, 0.04);
    ball(pet, material("#284878"), s * 0.055, 0.02, 0.13, 0.023, 0.05, 0.015);
  }
  star(pet, luminous, 0, 0.21, 0, 0.06);
}

function maid(body, head, white, blue, accent) {
  const cap = group(head, "maid-headband");
  for (let i = 0; i < 11; i++) {
    const a = (i - 5) * 0.19;
    ball(cap, white, Math.sin(a) * 0.49, Math.cos(a) * 0.53, -0.025, 0.085, 0.1, 0.075);
  }
  const apron = group(body, "maid-apron");
  ball(apron, white, 0, 0.92, 0.36, 0.35, 0.3, 0.17);
  box(apron, white, 0, 1.43, 0.188, 0.2, 0.29, 0.03);
  for (const side of [-1, 1]) {
    box(apron, white, side * 0.14, 1.48, 0.19, 0.05, 0.32, 0.04);
    bow(body, blue, side * 0.29, 1.17, 0.27, 0.7);
  }
  for (let i = 0; i < 11; i++) {
    const a = Math.PI * (0.12 + i * 0.076);
    ball(apron, white, Math.cos(a) * 0.36, 0.95 - Math.sin(a) * 0.29, 0.42, 0.055, 0.055, 0.04);
  }
  const tail = group(body, "whale-tail", 0, 0.9, -0.31);
  tube(tail, [[0, 0, 0], [0.53, -0.3, -0.22], [0.9, -0.15, -0.15], [1.03, 0.08, -0.1]], accent, 0.09);
  shape(tail, [[1.03, 0.04], [0.79, 0.35], [0.74, 0.43], [0.98, 0.36], [1.04, 0.23], [1.2, 0.36], [1.39, 0.37], [1.3, 0.2]], blue, 0, 0, -0.1);
  shape(tail, [[1.03, 0.1], [0.85, 0.34], [1.03, 0.21], [1.25, 0.32]], accent, 0, 0, -0.06);
}

function devil(body, head, arms, hair, dark, gold, accent) {
  for (const side of [-1, 1]) {
    const ponytail = group(body, "twin-tail");
    lock(ponytail, hair, [[side * 0.45, 2.25, -0.11], [side * 0.67, 1.88, -0.2], [side * 0.82, 1.35, -0.2], [side * 0.65, 0.99, -0.05], [side * 0.85, 0.85, 0.08], [side * 0.9, 1.04, 0.12]], 0.18, 0.13);
    bow(head, dark, side * 0.47, 0.3, 0.1, 0.85);
  }
  const crown = group(head, "crown", 0, 0.49, 0.01);
  for (let i = -1; i <= 1; i++) shape(crown, [[i * 0.13 - 0.06, 0], [i * 0.13, i ? 0.18 : 0.26], [i * 0.13 + 0.06, 0]], gold);
  // The polearm lives OUTSIDE the right sleeve and extends above the hair.
  // Its axe blades face the spectator; it is not a tiny trident behind the head.
  const weapon = group(arms[1], "halberd", 0.4, -0.38, 0.21);
  cylinder(weapon, dark, 0, 0.35, 0, 0.028, 0.028, 2.55);
  for (const y of [-0.55, 0.08, 0.75, 1.26]) cylinder(weapon, gold, 0, y, 0, 0.045, 0.045, 0.07);
  shape(weapon, [[-0.07, 1.5], [0, 1.91], [0.07, 1.5]], gold, 0, 0, -0.015);
  for (const side of [-1, 1]) {
    const blade = [[side * 0.04, 1.48], [side * 0.28, 1.66], [side * 0.45, 1.9], [side * 0.48, 1.55], [side * 0.34, 1.24], [side * 0.09, 1.04], [side * 0.18, 1.33]];
    shape(weapon, blade, gold, 0, 0, -0.025, 0.055);
    shape(weapon, [[side * 0.15, 1.45], [side * 0.37, 1.68], [side * 0.31, 1.39], [side * 0.17, 1.22]], dark, 0, 0, 0.035, 0.012);
  }
  star(weapon, accent, 0, 1.47, 0.06, 0.1);
}
