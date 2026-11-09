// Clubhouse integration (phattbeats/clubhouse-billiards): the three.js pool table. It draws the server's view of the table, plays
// back every shot exactly as the server rolled it (so every screen sees the same break), and lets the player aim, place the cue ball,
// set spin and power, and shoot. It only draws and asks: all rules and physics are on the server (game.ts). GPL-3.0.
//
// create(parent, THREE, hooks) -> { update(view, ctx), dispose() }
//   hooks: { send(move), sound(kind, vol), felt() -> {a, b} css colours, seatName(seat) -> string, size() -> {w, h} the table's logical size }
// World: engine (x, y) metres -> three (x, R, -y). The table's long axis is x.

const CSS = `
.bq { position:absolute; inset:0; overflow:hidden; touch-action:none; user-select:none; -webkit-user-select:none; font-family:inherit; }
.bq canvas.bq-gl { position:absolute; inset:0; width:100%; height:100%; display:block; }
.bq-tray { position:absolute; top:8px; left:50%; transform:translateX(-50%); display:flex; gap:5px; padding:5px 9px; border-radius:20px; background:#0009; pointer-events:none; }
.bq-tray i { width:22px; height:22px; border-radius:50%; box-shadow:inset -3px -3px 5px #0006, inset 2px 2px 3px #fff5; display:grid; place-items:center; font:700 11px/1 system-ui,sans-serif; color:#111; font-style:normal; }
.bq-tray i.gone { opacity:.18; } .bq-tray i.next { outline:2px solid #ffe08a; outline-offset:2px; }
.bq-banner { position:absolute; left:50%; top:22%; transform:translate(-50%,0); padding:10px 22px; border-radius:12px; background:#000b; color:#fff; font:700 22px/1.2 system-ui,sans-serif; letter-spacing:.04em; opacity:0; transition:opacity .25s; pointer-events:none; text-align:center; }
.bq-banner.on { opacity:1; } .bq-banner.foul { color:#ffb4a8; } .bq-banner.good { color:#bff0b0; }
.bq-hint { position:absolute; left:50%; bottom:74px; transform:translateX(-50%); padding:5px 12px; border-radius:14px; background:#0008; color:#fff; font:600 13px/1.2 system-ui,sans-serif; pointer-events:none; white-space:nowrap; }
.bq-ctl { position:absolute; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; gap:14px; padding:8px 12px 10px; background:linear-gradient(#0000,#000a); }
.bq-ctl[hidden] { display:none; }
.bq-ctl label { color:#fff; font:600 12px system-ui,sans-serif; display:flex; align-items:center; gap:7px; }
.bq-ctl input[type=range] { width:min(34vw,240px); accent-color:#e8b84a; height:28px; }
.bq-ctl button { border:0; border-radius:9px; padding:9px 14px; font:700 14px system-ui,sans-serif; background:#ffffff26; color:#fff; cursor:pointer; touch-action:manipulation; }
.bq-ctl button.go { background:#e8b84a; color:#2a1a05; padding:10px 22px; font-size:16px; }
.bq-ctl button:disabled { opacity:.4; }
.bq-spin { width:46px; height:46px; border-radius:50%; background:radial-gradient(circle at 38% 34%, #fff, #d8d8d8 70%); position:relative; box-shadow:0 0 0 2px #fff6, inset -4px -4px 8px #0003; touch-action:none; cursor:crosshair; flex:none; }
.bq-spin b { position:absolute; width:9px; height:9px; margin:-4.5px 0 0 -4.5px; border-radius:50%; background:#c4262c; box-shadow:0 0 0 1px #fff; pointer-events:none; }
@media (max-width:640px) { .bq-ctl { gap:8px; padding:6px 8px 8px; } .bq-ctl input[type=range] { width:30vw; } .bq-ctl button { padding:8px 10px; } .bq-tray i { width:18px; height:18px; font-size:10px; } }
`;

const COLORS = ['#f4f1e8', '#f1c40f', '#1f4fd8', '#d81e1e', '#7b2fa8', '#f06a10', '#12873a', '#7b1b1b', '#161616', '#f1c40f'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
export const SPEED = 1.3; // replays run a little faster than the physics clock: the last slow roll-outs do not need to be watched in full

function ballTexture(n) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  if (n === 0) { g.fillStyle = COLORS[0]; g.fillRect(0, 0, 256, 128); g.fillStyle = '#c4262c'; for (const x of [64, 192]) { g.beginPath(); g.arc(x, 64, 7, 0, TAU); g.fill(); } return c; }
  g.fillStyle = n === 9 ? '#f4f1e8' : COLORS[n]; g.fillRect(0, 0, 256, 128);
  if (n === 9) { g.fillStyle = COLORS[9]; g.fillRect(0, 30, 256, 68); }
  for (const x of [64, 192]) {
    g.fillStyle = '#f7f4ea'; g.beginPath(); g.arc(x, 64, 25, 0, TAU); g.fill();
    g.fillStyle = '#111'; g.font = 'bold 32px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), x, 66);
  }
  return c;
}

function clothTexture(a, b) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, 256, 256);
  let s = 11; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 5200; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.05)'; g.fillRect(rnd() * 256, rnd() * 256, 1.4, 1.4); }
  const gr = g.createRadialGradient(128, 128, 20, 128, 128, 190); gr.addColorStop(0, 'rgba(255,255,255,.08)'); gr.addColorStop(1, b + '55'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return c;
}

// Where the cue tip is, in engine metres and height above the cloth, for a cue ball at c struck along angle a with the tip offset
// (ox sideways to the left of the aim, oy up) and the tip `gap` metres short of the ball. The tip touches the ball surface at gap 0.
export function cueTip(c, a, ox, oy, R, gap) {
  const dx = Math.cos(a), dy = Math.sin(a), lat = ox * R, dh = oy * R, depth = Math.sqrt(Math.max(0, R * R - lat * lat - dh * dh)), back = depth + gap;
  return { x: c.x - dx * back - dy * lat, y: c.y - dy * back + dx * lat, h: R + dh };
}

export async function create(parent, T, hooks) {
  let renderer;
  const el = document.createElement('canvas'); el.className = 'bq-gl';
  try { renderer = new T.WebGLRenderer({ canvas: el, antialias: true, powerPreference: 'high-performance' }); } catch { return null; }
  if (!renderer.getContext()) return null;
  if (!document.getElementById('bq-css')) { const st = document.createElement('style'); st.id = 'bq-css'; st.textContent = CSS; document.head.appendChild(st); }
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.setClearColor(0x0c0a08, 1);

  const root = document.createElement('div'); root.className = 'bq'; parent.appendChild(root); root.appendChild(el);
  root.insertAdjacentHTML('beforeend', `<div class="bq-tray"></div><div class="bq-banner"></div><div class="bq-hint" hidden></div>
    <div class="bq-ctl" hidden><label>Power <input class="bq-pow" type="range" min="6" max="100" value="55"></label>
    <label>Spin <span class="bq-spin"><b></b></span></label><button class="bq-view" title="Camera">Camera</button><button class="go">Shoot</button></div>`);
  const $ = (q) => root.querySelector(q);
  const tray = $('.bq-tray'), banner = $('.bq-banner'), hint = $('.bq-hint'), ctl = $('.bq-ctl'), pow = $('.bq-pow'), spinPad = $('.bq-spin'), spinDot = $('.bq-spin b'), goBtn = $('.go'), viewBtn = $('.bq-view');

  const scene = new T.Scene();
  scene.fog = new T.Fog(0x0c0a08, 6, 14);
  const cam = new T.PerspectiveCamera(38, 1, 0.05, 30);
  scene.add(new T.HemisphereLight(0xfff3e0, 0x1a1208, 0.75));
  const sun = new T.DirectionalLight(0xffffff, 1.5); sun.position.set(0.6, 3.2, 0.9); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 1.2, bottom: -1.2, near: 0.5, far: 7 }); sun.shadow.bias = -0.0004;
  scene.add(sun);
  const lamp = new T.PointLight(0xffe2b0, 0.7, 6); lamp.position.set(0, 1.6, 0); scene.add(lamp);

  const S = {
    v: null, ctx: null, geo: null, built: false, seen: undefined, queue: [], play: null, pending: false, banner: 0, last: 0,
    angle: 0, power: 0.55, ox: 0, oy: 0, cue: null, dragging: false, dragBall: false, camMode: 'table', portrait: false, gone: false, raf: 0,
    camPos: new T.Vector3(0, 3, 2), camLook: new T.Vector3(), yaw: 0, pitch: 0, zoom: 1, tip: null, felt: '', balls: [], quat: [], vis: [],
  };
  const W = (x, y, h = 0) => new T.Vector3(x, h, -y);

  // ---- the table ------------------------------------------------------------------------------------------------------
  const tableGroup = new T.Group(); scene.add(tableGroup);
  const ballsGroup = new T.Group(); scene.add(ballsGroup);
  let R = 0.03275;
  const geometry = new T.SphereGeometry(1, 40, 28);
  function buildTable(geo) {
    S.geo = geo; R = geo.R;
    while (tableGroup.children.length) { const o = tableGroup.children.pop(); o.geometry?.dispose(); }
    const fx = geo.halfX + R, fy = geo.halfY + R; // the playing surface edge (where the ball touches the cushion)
    const felt = hooks.felt?.() || { a: '#1f6b45', b: '#0e3a24' };
    S.felt = felt.a + felt.b;
    const cd = 0.045, rh = 0.052, ch = 0.042, ox = fx + cd + 0.14, oy = fy + cd + 0.14; // cushion depth, rail and cushion heights, outer edge of the rail
    const dark = new T.MeshBasicMaterial({ color: 0x050403 });
    const rm = (p) => p.r * 1.12; // the hole in the cloth is a little wider than the capture circle, so a ball over the edge visibly goes in
    // the deck: one sheet of cloth with a round hole cut at every pocket
    const tex = new T.CanvasTexture(clothTexture(felt.a, felt.b)); tex.colorSpace = T.SRGBColorSpace; tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(1.72, 1.72);
    const deck = new T.Shape(); deck.moveTo(-ox, -oy); deck.lineTo(ox, -oy); deck.lineTo(ox, oy); deck.lineTo(-ox, oy); deck.closePath();
    for (const p of geo.pockets) { const h = new T.Path(); h.absarc(p.x, p.y, rm(p), 0, TAU, true); deck.holes.push(h); }
    const cloth = new T.Mesh(new T.ShapeGeometry(deck, 48), new T.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    cloth.rotation.x = -Math.PI / 2; cloth.receiveShadow = true; tableGroup.add(cloth);
    // each pocket is a dark well under the hole, with a brass lip
    for (const p of geo.pockets) {
      const q = W(p.x, p.y, 0);
      const well = new T.Mesh(new T.CylinderGeometry(rm(p), rm(p) * 0.85, 0.12, 28, 1, true), new T.MeshBasicMaterial({ color: 0x070605, side: T.BackSide })); well.position.set(q.x, -0.06, q.z); tableGroup.add(well);
      const floorD = new T.Mesh(new T.CircleGeometry(rm(p) * 0.85, 24), dark); floorD.rotation.x = -Math.PI / 2; floorD.position.set(q.x, -0.12, q.z); tableGroup.add(floorD);
      const lip = new T.Mesh(new T.TorusGeometry(rm(p), 0.004, 8, 40), new T.MeshStandardMaterial({ color: 0xb59a5a, metalness: 0.8, roughness: 0.3 }));
      lip.rotation.x = -Math.PI / 2; lip.position.set(q.x, 0.002, q.z); tableGroup.add(lip);
    }
    // the wooden rail: its opening is the cushion rectangle plus a round bite at every pocket (the outline is traced by angle from the centre)
    const ix = fx + cd, iy = fy + cd, N = 1440, outline = [];
    for (let k = 0; k < N; k++) {
      const th = (k / N) * TAU, dx = Math.cos(th), dy = Math.sin(th);
      let r = Math.min(Math.abs(dx) > 1e-9 ? ix / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? iy / Math.abs(dy) : Infinity);
      for (const p of geo.pockets) {
        const R2 = rm(p) + 0.014, along = p.x * dx + p.y * dy, perp2 = p.x * p.x + p.y * p.y - along * along; if (along <= 0 || perp2 > R2 * R2) continue;
        r = Math.max(r, along + Math.sqrt(R2 * R2 - perp2));
      }
      outline.push([dx * r, dy * r]);
    }
    const railShape = new T.Shape(); railShape.moveTo(-ox, -oy); railShape.lineTo(ox, -oy); railShape.lineTo(ox, oy); railShape.lineTo(-ox, oy); railShape.closePath();
    const opening = new T.Path(); outline.slice().reverse().forEach(([x, y], k) => (k ? opening.lineTo(x, y) : opening.moveTo(x, y))); opening.closePath(); railShape.holes.push(opening);
    const woodC = document.createElement('canvas'); woodC.width = 256; woodC.height = 64; const wg = woodC.getContext('2d');
    wg.fillStyle = '#5a3418'; wg.fillRect(0, 0, 256, 64); let s = 5; const rr = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 34; i++) { wg.strokeStyle = `rgba(${rr() < 0.5 ? '20,8,0' : '150,100,55'},${0.08 + rr() * 0.16})`; wg.lineWidth = 0.6 + rr() * 1.8; wg.beginPath(); wg.moveTo(0, rr() * 64); wg.bezierCurveTo(80, rr() * 64, 170, rr() * 64, 256, rr() * 64); wg.stroke(); }
    const wood = new T.CanvasTexture(woodC); wood.colorSpace = T.SRGBColorSpace; wood.wrapS = wood.wrapT = T.RepeatWrapping; wood.repeat.set(0.4, 0.4);
    const rail = new T.Mesh(new T.ExtrudeGeometry(railShape, { depth: rh, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 12 }), new T.MeshStandardMaterial({ map: wood, roughness: 0.55, metalness: 0.05 }));
    rail.rotation.x = -Math.PI / 2; rail.position.y = -0.0005; rail.castShadow = rail.receiveShadow = true; tableGroup.add(rail);
    // cushions: felt-covered rubber, each ending at the knuckles of the jaws where the physics ends them
    const cmat = new T.MeshStandardMaterial({ color: felt.a, roughness: 0.9 });
    const cornerIn = geo.halfX - (R * 1.6) / 0.5, midIn = (R * 1.385) / 0.5, endIn = geo.halfY - (R * 1.6) / 0.5, fl = 0.03; // (knuckle positions, as in pocketgeometry.ts)
    const cushion = (x0, x1, y0, y1, horizontal) => { // x0..x1 along the rail, y0 = the face, y1 = the back; the back ends reach further toward the pocket
      const sh = new T.Shape();
      if (horizontal) { sh.moveTo(x0, y0); sh.lineTo(x1, y0); sh.lineTo(x1 + Math.sign(x1 - x0) * fl, y1); sh.lineTo(x0 - Math.sign(x1 - x0) * fl, y1); }
      else { sh.moveTo(y0, x0); sh.lineTo(y0, x1); sh.lineTo(y1, x1 + Math.sign(x1 - x0) * fl); sh.lineTo(y1, x0 - Math.sign(x1 - x0) * fl); }
      sh.closePath();
      const m = new T.Mesh(new T.ExtrudeGeometry(sh, { depth: ch, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.006, bevelSegments: 2 }), cmat);
      m.rotation.x = -Math.PI / 2; m.castShadow = m.receiveShadow = true; tableGroup.add(m);
    };
    for (const sy of [-1, 1]) for (const sx of [-1, 1]) { // the long rails: two cushions each, split at the side pocket
      const f = sy * fy, b = sy * (fy + cd), a0 = sx * midIn, a1 = sx * cornerIn;
      cushion(a0, a1, f, b, true);
    }
    for (const sx of [-1, 1]) cushion(-endIn, endIn, sx * fx, sx * (fx + cd), false);
    // diamonds on the rail top and the head and foot spots
    const dm = new T.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.4 });
    for (let i = 1; i < 8; i++) { if (i === 4) continue;
      for (const sgn of [-1, 1]) { const d = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 0.002, 12), dm); d.position.set(-fx + (i * fx * 2) / 8, rh + 0.0095, sgn * (fy + cd + 0.07)); tableGroup.add(d); }
    }
    for (let i = 1; i < 4; i++) for (const sgn of [-1, 1]) { const d = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 0.002, 12), dm); d.position.set(sgn * (fx + cd + 0.07), rh + 0.0095, -fy + (i * fy * 2) / 4); tableGroup.add(d); }
    const spot = new T.Mesh(new T.CircleGeometry(0.008, 16), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })); spot.rotation.x = -Math.PI / 2; spot.position.set(-geo.halfX / 2, 0.0008, 0); tableGroup.add(spot);
    const foot = spot.clone(); foot.position.x = geo.halfX / 2; tableGroup.add(foot);
    // the legs and floor keep the table from floating
    const leg = new T.MeshStandardMaterial({ color: 0x2a190b, roughness: 0.6 });
    for (const [x, z] of [[-ox + 0.12, -oy + 0.12], [ox - 0.12, -oy + 0.12], [-ox + 0.12, oy - 0.12], [ox - 0.12, oy - 0.12]]) { const l = new T.Mesh(new T.BoxGeometry(0.16, 0.67, 0.16), leg); l.position.set(x, -0.465, z); l.castShadow = true; tableGroup.add(l); }
    for (const [w, d, x, z] of [[ox * 2, 0.02, 0, -oy + 0.01], [ox * 2, 0.02, 0, oy - 0.01], [0.02, oy * 2, -ox + 0.01, 0], [0.02, oy * 2, ox - 0.01, 0]]) { const k = new T.Mesh(new T.BoxGeometry(w, 0.13, d), leg); k.position.set(x, -0.065, z); tableGroup.add(k); } // the skirt under the rail
    const floor = new T.Mesh(new T.PlaneGeometry(14, 14), new T.MeshStandardMaterial({ color: 0x1d130b, roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.8; floor.receiveShadow = true; tableGroup.add(floor);
    S.rail = { ox, oy, rh };
    // balls
    while (ballsGroup.children.length) ballsGroup.children.pop();
    S.balls = []; S.quat = [];
    for (let i = 0; i < 10; i++) {
      const tx = new T.CanvasTexture(ballTexture(i)); tx.colorSpace = T.SRGBColorSpace;
      const m = new T.Mesh(geometry, new T.MeshStandardMaterial({ map: tx, roughness: 0.18, metalness: 0.0 }));
      m.scale.setScalar(R); m.castShadow = true; m.receiveShadow = true; ballsGroup.add(m); S.balls.push(m); S.quat.push(new T.Quaternion());
    }
    S.built = true;
  }

  // ---- cue stick and aim guide ----------------------------------------------------------------------------------------------
  const cue = new T.Group();
  { const len = 1.45;
    const shaft = new T.Mesh(new T.CylinderGeometry(0.0065, 0.0125, len, 16), new T.MeshStandardMaterial({ color: 0xe6c690, roughness: 0.4 })); shaft.rotation.z = Math.PI / 2; shaft.position.x = -len / 2; shaft.castShadow = true;
    const butt = new T.Mesh(new T.CylinderGeometry(0.0125, 0.0165, len * 0.4, 16), new T.MeshStandardMaterial({ color: 0x2a1608, roughness: 0.35 })); butt.rotation.z = Math.PI / 2; butt.position.x = -len * 0.8; butt.castShadow = true;
    const tip = new T.Mesh(new T.CylinderGeometry(0.0062, 0.0065, 0.012, 14), new T.MeshStandardMaterial({ color: 0x4a7fb8, roughness: 0.8 })); tip.rotation.z = Math.PI / 2; tip.position.x = 0.004;
    cue.add(shaft, butt, tip); cue.visible = false; scene.add(cue); }
  const guideMat = new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const guide = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3(1, 0, 0)]), guideMat); guide.visible = false; scene.add(guide);
  const tgtLine = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3(1, 0, 0)]), new T.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 })); tgtLine.visible = false; scene.add(tgtLine);
  const ghost = new T.Mesh(new T.RingGeometry(1.0, 1.12, 40), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: T.DoubleSide })); ghost.rotation.x = -Math.PI / 2; ghost.visible = false; scene.add(ghost);

  function setLine(line, a, b) { const p = line.geometry.attributes.position; p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true; line.geometry.computeBoundingSphere(); }

  // ---- state helpers ------------------------------------------------------------------------------------------------------------
  const myTurn = () => !!(S.v && S.ctx && S.ctx.seat != null && !S.ctx.spectator && S.v.turn === S.ctx.seat && !S.v.over && !S.play && !S.queue.length && !S.pending);
  const cuePos = () => (S.v?.inHand && S.cue ? S.cue : S.v?.balls?.[0]);
  // where the cue ball is for the stick and the cue camera: during a replay the cue ball's start (the server's view is already the end of the shot)
  const stickBase = () => (S.play ? S.play.shot.from[0] : cuePos());
  const validSpot = (x, y) => {
    if (!S.geo) return false; const { halfX, halfY } = S.geo;
    if (Math.abs(x) > halfX - R * 0.3 || Math.abs(y) > halfY - R * 0.3) return false;
    if (S.v.breakShot && x > -halfX / 2) return false;
    return S.v.balls.every((b, i) => !b || i === 0 || Math.hypot(b.x - x, b.y - y) >= 2 * R * 1.002);
  };

  function aimGuide() {
    const cp = cuePos();
    if (!myTurn() || !cp) { guide.visible = tgtLine.visible = ghost.visible = false; return; }
    const dx = Math.cos(S.angle), dy = Math.sin(S.angle), balls = S.v.balls, { halfX, halfY } = S.geo;
    let tHit = Infinity, hitBall = -1;
    for (let i = 1; i < balls.length; i++) {
      const b = balls[i]; if (!b) continue;
      const fx = b.x - cp.x, fy = b.y - cp.y, along = fx * dx + fy * dy; if (along <= 0) continue;
      const perp2 = fx * fx + fy * fy - along * along, rr = 2 * R; if (perp2 > rr * rr) continue;
      const t = along - Math.sqrt(rr * rr - perp2); if (t < tHit) { tHit = t; hitBall = i; }
    }
    let tWall = Infinity;
    if (dx > 1e-6) tWall = Math.min(tWall, (halfX - cp.x) / dx); else if (dx < -1e-6) tWall = Math.min(tWall, (-halfX - cp.x) / dx);
    if (dy > 1e-6) tWall = Math.min(tWall, (halfY - cp.y) / dy); else if (dy < -1e-6) tWall = Math.min(tWall, (-halfY - cp.y) / dy);
    const t = Math.min(tHit, tWall), end = W(cp.x + dx * t, cp.y + dy * t, R);
    setLine(guide, W(cp.x, cp.y, R), end); guide.visible = true;
    ghost.position.copy(end); ghost.position.y = 0.002; ghost.scale.setScalar(R); ghost.visible = true;
    if (hitBall > 0 && tHit <= tWall) {
      const b = balls[hitBall], gx = cp.x + dx * tHit, gy = cp.y + dy * tHit, nx = b.x - gx, ny = b.y - gy, nl = Math.hypot(nx, ny) || 1;
      setLine(tgtLine, W(b.x, b.y, R), W(b.x + (nx / nl) * 0.3, b.y + (ny / nl) * 0.3, R)); tgtLine.visible = true;
    } else tgtLine.visible = false;
  }

  function placeCue(pull = 0, show = true) {
    const cp = stickBase();
    cue.visible = !!(show && cp && (myTurn() || S.play?.phase === 'stroke'));
    if (!cue.visible) return;
    const sh = S.play?.shot, a = sh ? sh.a : S.angle, ox = sh ? sh.ox || 0 : S.ox, oy = sh ? sh.oy || 0 : S.oy;
    const tip = cueTip(cp, a, ox, oy, R, 0.0008 + pull + (sh ? 0 : 0.012 + S.power * 0.04));
    cue.position.set(tip.x, tip.h, -tip.y);
    cue.rotation.set(0, a, -0.035); // heading a in the plane (three z = -y), a slight rise to the butt
    S.tip = tip;
  }

  // ---- layout, camera ------------------------------------------------------------------------------------------------------------------
  // where the table sits on screen, in real pixels. The stage scales the table to its box with CSS zoom, which browsers disagree about
  // when they report element rectangles, so work from the stage's own box and the table's logical size instead.
  function screenRect() {
    const stage = parent.closest('.stage') || parent.parentElement || parent, r = stage.getBoundingClientRect(), sz = hooks.size?.() || { w: r.width, h: r.height };
    const k = Math.min(r.width / sz.w, r.height / sz.h), w = sz.w * k, h = sz.h * k;
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
  }
  function resize() {
    const r = screenRect(); const w = Math.max(2, Math.round(r.width)), h = Math.max(2, Math.round(r.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) { renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    S.portrait = h > w * 1.08;
  }
  const corners = () => { const g = S.geo, x = (S.rail ? S.rail.ox : g.halfX + R + 0.2) + 0.03, y = (S.rail ? S.rail.oy : g.halfY + R + 0.2) + 0.03; return [[-x, -y], [x, -y], [x, y], [-x, y]].flatMap(([a, b]) => [W(a, b, 0), W(a, b, 0.1)]); };
  function fit(dir, up, target) {
    let lo = 0.8, hi = 9; const pts = corners(), v = new T.Vector3();
    for (let k = 0; k < 16; k++) {
      const d = (lo + hi) / 2; cam.position.copy(target).addScaledVector(dir, d); cam.up.copy(up); cam.lookAt(target); cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      let ok = true; for (const p of pts) { v.copy(p).project(cam); if (Math.abs(v.x) > 0.97 || Math.abs(v.y) > 0.9) { ok = false; break; } }
      if (ok) hi = d; else lo = d;
    }
    return hi;
  }
  // The cue camera sits behind the cue ball on the shot line. During a replay it uses the ball's start for the stroke, then follows the
  // cue ball as it rolls; afterwards it settles behind the ball's new spot on the next aim.
  const orbitQ = new T.Quaternion(), orbitE = new T.Euler(), yawAxis = new T.Vector3(0, 1, 0);
  function cameraTarget() {
    const tgt = new T.Vector3(), pos = new T.Vector3(), up = new T.Vector3(0, 1, 0);
    let cueCam = false;
    if (S.camMode === 'cue' && S.v && stickBase()) {
      cueCam = true;
      const a = S.play ? S.play.shot.a : S.angle, P = S.play, base = P && P.phase === 'roll' && S.balls[0].visible ? { x: S.balls[0].position.x, y: -S.balls[0].position.z } : stickBase();
      const back = S.portrait ? 1.3 : 1.05, hgt = S.portrait ? 0.78 : 0.6, ahead = S.portrait ? 0.7 : 0.3; // far enough back and high enough that the stick is in frame
      pos.copy(W(base.x - Math.cos(a) * back, base.y - Math.sin(a) * back, hgt)); tgt.copy(W(base.x + Math.cos(a) * ahead, base.y + Math.sin(a) * ahead, 0));
    } else {
      const dir = S.camMode === 'top' ? new T.Vector3(0, 1, 0.0001).normalize() : (S.portrait ? new T.Vector3(-0.62, 0.78, 0) : new T.Vector3(0, 0.78, 0.62)).normalize();
      if (S.camMode === 'top') up.copy(S.portrait ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 0, -1));
      const d = fit(dir, up, tgt); pos.copy(tgt).addScaledVector(dir, d);
    }
    if (S.yaw || S.pitch || S.zoom !== 1) { // the viewer's own orbit and zoom, about the point the camera looks at
      const off = pos.clone().sub(tgt), right = new T.Vector3().crossVectors(off, up).normalize();
      if (!right.lengthSq()) right.set(1, 0, 0);
      orbitQ.setFromAxisAngle(yawAxis, S.yaw); off.applyQuaternion(orbitQ); right.applyQuaternion(orbitQ);
      orbitQ.setFromAxisAngle(right, S.pitch); off.applyQuaternion(orbitQ);
      if (S.camMode === 'top') { up.applyQuaternion(orbitQ); }
      off.multiplyScalar(S.zoom); pos.copy(tgt).add(off); pos.y = Math.max(pos.y, cueCam ? 0.1 : 0.15);
    }
    return { pos, tgt, up };
  }
  let fitKey = '';
  function updateCamera(dt, snap) {
    const key = `${S.camMode}|${S.portrait}|${cam.aspect.toFixed(3)}|${S.geo ? S.geo.R : 0}|${S.yaw.toFixed(3)}|${S.pitch.toFixed(3)}|${S.zoom.toFixed(3)}`;
    if (S.camMode === 'cue' || key !== fitKey || snap) {
      fitKey = key; const c = cameraTarget(); S.camGoal = c;
      if (snap || !S.camPosSet) { S.camPos.copy(c.pos); S.camLook.copy(c.tgt); S.camPosSet = true; }
    }
    const k = 1 - Math.exp(-dt * (S.camMode === 'cue' && S.play?.phase === 'roll' ? 3 : 5)), c = S.camGoal; if (!c) return;
    S.camPos.lerp(c.pos, k); S.camLook.lerp(c.tgt, k);
    cam.position.copy(S.camPos); cam.up.lerp(c.up, k).normalize(); cam.lookAt(S.camLook);
  }

  // ---- drawing the balls --------------------------------------------------------------------------------------------------------------------
  const q = new T.Quaternion(), axis = new T.Vector3(), up3 = new T.Vector3(0, 1, 0), dv = new T.Vector3();
  function putBall(i, x, y, sink = 0) {
    const m = S.balls[i]; let z = R;
    if (sink > 0) { // a pocketed ball drops through the hole
      if (m.userData.pk === undefined) { let best = 0, bd = Infinity; S.geo.pockets.forEach((p, k) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = k; } }); m.userData.pk = best; }
      const p = S.geo.pockets[m.userData.pk], e = Math.min(1, sink * 1.6); x += (p.x - x) * e * 0.5; y += (p.y - y) * e * 0.5; z = R - sink * sink * (0.06 + R * 2);
    } else m.userData.pk = undefined;
    if (m.userData.px !== undefined) { // roll: turn the ball about the axis across its travel
      dv.set(x - m.userData.px, 0, -(y - m.userData.py)); const dist = dv.length();
      if (dist > 1e-6 && dist < 0.3) { axis.crossVectors(up3, dv).normalize(); q.setFromAxisAngle(axis, dist / R); S.quat[i].premultiply(q); }
    }
    m.userData.px = x; m.userData.py = y; m.position.set(x, z, -y); m.quaternion.copy(S.quat[i]);
    m.scale.setScalar(R); m.visible = sink < 1;
  }
  function resetBall(i, spot) { const m = S.balls[i]; m.userData.px = undefined; if (spot) putBall(i, spot.x, spot.y); m.visible = !!spot; m.userData.px = undefined; }
  function drawRest() {
    const v = S.v; if (!v) return;
    for (let i = 0; i < 10; i++) {
      let b = v.balls[i];
      if (i === 0 && v.inHand && S.cue && myTurn()) b = S.cue;
      if (b) { const m = S.balls[i]; if (!m.visible || m.userData.rest !== `${b.x},${b.y}`) { m.userData.px = undefined; putBall(i, b.x, b.y); m.userData.px = undefined; m.userData.rest = `${b.x},${b.y}`; } m.visible = true; m.scale.setScalar(R); m.position.y = R; } else S.balls[i].visible = false;
    }
  }

  // ---- replays ------------------------------------------------------------------------------------------------------------------------------------
  function startPlay(shot) {
    const from = shot.from.map((b) => b && { ...b });
    S.play = { shot, phase: 'stroke', t: 0, ev: 0, pot: {} };
    for (let i = 0; i < 10; i++) { S.balls[i].userData.rest = ''; S.balls[i].userData.px = undefined; resetBall(i, from[i]); S.balls[i].scale.setScalar(R); }
    guide.visible = tgtLine.visible = ghost.visible = false;
  }
  function stepPlay(dt) {
    const P = S.play, sh = P.shot;
    if (P.phase === 'stroke') {
      P.t += dt; if (S.holdAt != null) P.t = Math.min(P.t, S.holdAt); // (S.holdAt: a test freezes the replay here for a screenshot)
      const u = Math.min(1, P.t / 0.6), back = 0.1 + sh.p * 0.2, k = (u - 0.6) / 0.4, pull = u < 0.6 ? 0.012 + (u / 0.6) * (back - 0.012) : back * (1 - k * k); // draw back, then drive forward to touch the ball
      placeCue(Math.max(0, pull), true);
      if (u >= 1) { P.phase = 'roll'; P.t = 0; cue.visible = false; hooks.sound?.('cue', clamp(0.25 + sh.p, 0.2, 1)); }
      return;
    }
    P.t += dt * SPEED; if (S.holdAt != null) P.t = Math.min(P.t, S.holdAt);
    while (P.ev < sh.events.length && sh.events[P.ev].t <= P.t) {
      const e = sh.events[P.ev++];
      if (e.k === 'pot') { P.pot[e.a] = e.t; hooks.sound?.('pot', 0.8); } else if (e.k === 'hit') hooks.sound?.('hit', 0.45); else hooks.sound?.('rail', 0.35);
    }
    const f = P.t / sh.dt, i = Math.min(sh.frames.length - 1, Math.floor(f)), j = Math.min(sh.frames.length - 1, i + 1), u = f - i, A = sh.frames[i], B = sh.frames[j];
    for (let k = 0; k < 10; k++) {
      if (!S.balls[k].visible && P.pot[k] === undefined && !sh.from[k]) continue;
      const x = (A[k * 2] + (B[k * 2] - A[k * 2]) * u) / 1000, y = (A[k * 2 + 1] + (B[k * 2 + 1] - A[k * 2 + 1]) * u) / 1000;
      const pt = P.pot[k]; if (!sh.from[k] || (k === 0 && !sh.from[0])) continue;
      putBall(k, x, y, pt === undefined ? 0 : clamp((P.t - pt) / 0.35, 0, 1));
    }
    if (P.t >= sh.dur + 0.15) endPlay();
  }
  function endPlay() {
    const sh = S.play.shot; S.play = null;
    for (let i = 0; i < 10; i++) S.balls[i].userData.rest = '';
    drawRest();
    const txt = sh.win ? 'NINE BALL!' : sh.foul ? `FOUL · ${sh.foul}` : sh.potted.length ? (sh.potted.length > 1 ? `${sh.potted.length} BALLS DOWN` : 'POCKETED') : '';
    if (txt) showBanner(txt, sh.foul ? 'foul' : 'good');
    if (sh.foul) hooks.sound?.('foul', 0.6); else if (sh.win) hooks.sound?.('win', 0.8);
  }
  function showBanner(text, cls) { banner.textContent = text; banner.className = `bq-banner on ${cls || ''}`; clearTimeout(S.banner); S.banner = setTimeout(() => { banner.className = 'bq-banner'; }, 2200); }

  // ---- HUD ---------------------------------------------------------------------------------------------------------------------------------------------------
  let trayKey = '';
  function drawTray() {
    const v = S.v; if (!v) return;
    const key = v.balls.map((b, i) => (b ? i : '')).join('') + v.lowest; if (key === trayKey) return; trayKey = key;
    tray.innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<i class="${v.balls[n] ? (n === v.lowest ? 'next' : '') : 'gone'}" style="background:${n === 9 ? `linear-gradient(#f4f1e8 0 28%, ${COLORS[9]} 28% 72%, #f4f1e8 72%)` : COLORS[n]}">${n}</i>`).join('');
  }
  function drawCtl() {
    const mine = myTurn(); ctl.hidden = !mine;
    hint.hidden = !(mine && S.v.inHand);
    if (mine && S.v.inHand) hint.textContent = S.v.breakShot ? 'Drag the cue ball behind the head string, then aim' : 'Ball in hand: drag the cue ball anywhere, then aim';
    spinDot.style.left = `${50 + (S.ox / 0.5) * 38}%`; spinDot.style.top = `${50 - (S.oy / 0.5) * 38}%`;
    pow.value = Math.round(S.power * 100);
  }

  // ---- pointer input -----------------------------------------------------------------------------------------------------------------------------------------
  const ray = new T.Raycaster(), ndc = new T.Vector2(), plane = new T.Plane(new T.Vector3(0, 1, 0), -R), hit = new T.Vector3();
  function worldAt(e) {
    const r = screenRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    ray.setFromCamera(ndc, cam); if (!ray.ray.intersectPlane(plane, hit)) return null; return { x: hit.x, y: -hit.z };
  }
  function aimTo(p) { const cp = cuePos(); if (!cp || !p) return; const dx = p.x - cp.x, dy = p.y - cp.y; if (Math.hypot(dx, dy) > R * 0.5) S.angle = Math.atan2(dy, dx); }
  // Pointers: one finger or the left button aims (or moves the cue ball) on your turn; with nothing to aim it looks around. The right
  // button, or two fingers, always orbit (and pinch zooms); the wheel zooms, shift+wheel nudges the aim.
  const ptrs = new Map(); let orbiting = null, pinch = 0;
  const orbitBy = (dx, dy) => { S.yaw -= dx * 0.006; S.pitch = clamp(S.pitch + dy * 0.005, -1.2, 0.6); };
  const pinchDist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture?.(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) { S.dragging = S.dragBall = false; orbiting = 'pair'; pinch = pinchDist(); return; }
    if (e.button === 2 || !myTurn()) { orbiting = 'one'; return; }
    const p = worldAt(e); if (!p) return;
    const cp = cuePos();
    if (S.v.inHand && cp && Math.hypot(p.x - cp.x, p.y - cp.y) < R * 3) { S.dragBall = true; if (!S.cue) S.cue = { ...cp }; return; }
    S.dragging = true; aimTo(p);
  });
  el.addEventListener('pointermove', (e) => {
    const prev = ptrs.get(e.pointerId); if (prev) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (orbiting === 'pair' && ptrs.size === 2 && prev) {
      const d = pinchDist(); if (pinch > 0 && d > 0) S.zoom = clamp(S.zoom * (pinch / d), 0.35, 1.6); pinch = d;
      orbitBy((e.clientX - prev.x) / 2, (e.clientY - prev.y) / 2); return;
    }
    if (orbiting === 'one' && prev) { orbitBy(e.clientX - prev.x, e.clientY - prev.y); return; }
    if (!myTurn()) return; const p = worldAt(e); if (!p) return;
    if (S.dragBall) { if (validSpot(p.x, p.y)) S.cue = { x: p.x, y: p.y }; else { const g = S.geo; const cx = clamp(p.x, -g.halfX + R, S.v.breakShot ? -g.halfX / 2 : g.halfX - R), cy = clamp(p.y, -g.halfY + R, g.halfY - R); if (validSpot(cx, cy)) S.cue = { x: cx, y: cy }; } drawRest(); }
    else if (S.dragging) aimTo(p);
  });
  const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2 && orbiting === 'pair') orbiting = null; if (!ptrs.size) orbiting = null; S.dragging = S.dragBall = false; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => { e.preventDefault(); if (e.shiftKey && myTurn()) S.angle += Math.sign(e.deltaY || e.deltaX) * 0.0035; else S.zoom = clamp(S.zoom * Math.exp(Math.sign(e.deltaY) * 0.08), 0.35, 1.6); }, { passive: false });
  pow.addEventListener('input', () => { S.power = clamp(pow.value / 100, 0.06, 1); });
  // (the pad is inside the zoomed stage, so read the pointer as a fraction of the pad's own box, in the pad's own units)
  const spinAt = (e) => { let x = (e.offsetX / spinPad.offsetWidth - 0.5) * 2, y = -(e.offsetY / spinPad.offsetHeight - 0.5) * 2; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } S.ox = Math.round(x * 0.45 * 100) / 100; S.oy = Math.round(y * 0.45 * 100) / 100; };
  let spinDown = false;
  spinPad.addEventListener('pointerdown', (e) => { spinDown = true; spinPad.setPointerCapture?.(e.pointerId); spinAt(e); });
  spinPad.addEventListener('pointermove', (e) => { if (spinDown) spinAt(e); });
  spinPad.addEventListener('pointerup', () => { spinDown = false; });
  spinPad.addEventListener('dblclick', () => { S.ox = S.oy = 0; });
  viewBtn.addEventListener('click', () => { S.camMode = S.camMode === 'table' ? 'top' : S.camMode === 'top' ? 'cue' : 'table'; S.yaw = S.pitch = 0; S.zoom = 1; viewBtn.textContent = S.camMode === 'table' ? 'Camera: table' : S.camMode === 'top' ? 'Camera: top' : 'Camera: cue'; fitKey = ''; });
  viewBtn.textContent = 'Camera: table';
  goBtn.addEventListener('click', () => {
    if (!myTurn()) return;
    const mv = { t: 'shot', a: Math.round(S.angle * 1e4) / 1e4, p: Math.round(S.power * 1e3) / 1e3, ox: S.ox, oy: S.oy };
    if (S.v.inHand) { const c = S.cue || cuePos(); if (!c || !validSpot(c.x, c.y)) { showBanner('Place the cue ball first', 'foul'); return; } mv.cx = Math.round(c.x * 1e5) / 1e5; mv.cy = Math.round(c.y * 1e5) / 1e5; }
    S.pending = true; setTimeout(() => { S.pending = false; }, 4000); hooks.send(mv);
  });

  // ---- the loop -------------------------------------------------------------------------------------------------------------------------------------------------------
  function loop(now) {
    if (S.gone) return; S.raf = requestAnimationFrame(loop);
    if (!root.isConnected) { api.dispose(); return; }
    const dt = Math.min(0.1, (now - (S.last || now)) / 1000); S.last = now;
    resize();
    if (S.built) {
      if (!S.play && S.queue.length) { S.pending = false; startPlay(S.queue.shift()); }
      if (S.play) stepPlay(dt); else { drawRest(); placeCue(0); aimGuide(); }
      if (S.play && S.play.phase === 'stroke') aimGuide();
      drawCtl(); drawTray(); updateCamera(dt, false);
    }
    renderer.render(scene, cam);
  }

  const api = {
    update(view, ctx) {
      S.v = view; S.ctx = ctx;
      const fl = hooks.felt?.(); if (S.built && fl && fl.a + fl.b !== S.felt) S.built = false;
      if (!S.built) { buildTable(view.geo); S.built = true; for (let i = 0; i < 10; i++) S.balls[i].userData.rest = ''; fitKey = ''; }
      const sh = view.shot, key = sh ? `${sh.n}:${sh.seat}:${sh.a}:${sh.p}` : null;
      if (S.seen === undefined) { S.seen = key; if (!S.angle && view.balls[0] && view.balls[1]) S.angle = Math.atan2(view.balls[1].y - view.balls[0].y, view.balls[1].x - view.balls[0].x); }
      else if (key && key !== S.seen) { S.seen = key; S.queue.push(sh); }
      if (!S.play && !S.queue.length) { S.pending = false; if (!view.inHand) S.cue = null; }
      if (view.inHand && !S.cue && view.turn === ctx.seat) S.cue = view.breakShot ? { x: -view.geo.halfX / 2 - R * 2, y: 0 } : (view.balls[0] || { x: -view.geo.halfX / 2, y: 0 });
      if (view.over && !S.queue.length && !S.play) showBanner(view.winners?.length ? `${view.winners.map((s) => hooks.seatName(s)).join(' & ')} win${view.winners.length > 1 ? '' : 's'}` : 'Game over', 'good');
      if (view.turn !== S.lastTurn) { S.lastTurn = view.turn; if (view.turn === ctx.seat && view.balls[0] && view.lowest) { const b = view.balls[view.lowest], c = view.balls[0]; if (b && c) S.angle = Math.atan2(b.y - c.y, b.x - c.x); } }
    },
    dispose() { S.gone = true; cancelAnimationFrame(S.raf); renderer.dispose(); root.remove(); },
  };
  if (typeof window !== 'undefined' && window.__bqDebug) { // test hooks: the camera, the state, the cue stick, a render-now, and a straight-down probe of the table
    S.cam = cam; window.__bqS = S; S.cueObj = cue; S.render = () => renderer.render(scene, cam); S.glEl = el;
    S.probe = (x, y) => { const h = new T.Raycaster(new T.Vector3(x, 2, -y), new T.Vector3(0, -1, 0)).intersectObjects(tableGroup.children, false)[0]; return h ? h.point.y : null; };
  }
  S.raf = requestAnimationFrame(loop);
  return api;
}
