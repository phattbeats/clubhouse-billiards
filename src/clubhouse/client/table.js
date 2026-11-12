// Clubhouse integration (phattbeats/clubhouse-billiards): the three.js pool table. It draws the server's view of the table, plays
// back every shot exactly as the server rolled it (positions and each ball's spin, so every screen sees the same break and the
// numbers turn the way the ball really spins), and lets the player aim, place the cue ball, set spin, power and cue elevation, call
// the pocket, and shoot. All rules and physics that count are on the server (game.ts); the browser copy of the engine (engine.js)
// only draws the casual "full" guide. GPL-3.0.
//
// create(parent, THREE, hooks) -> { update(view, ctx), dispose() }
//   hooks: { send(move), sound(kind, v), theme() -> {felt1, felt2, rail1, rail2, trim, railTex, feltTex}, felt() (older shells),
//            seatName(seat) -> string, size() -> {w, h} the table's logical size }
// World: engine (x, y, z) metres -> three (x, z, -y). The table's long axis is x; the head (the break) is -x.
import { simulate as engineSimulate } from './engine.js';

const CSS = `
.bq [hidden] { display:none !important; }
.bq { position:absolute; inset:0; overflow:hidden; touch-action:none; user-select:none; -webkit-user-select:none; font-family:inherit; color:#fff; }
.bq canvas.bq-gl { position:absolute; inset:0; width:100%; height:100%; display:block; }
.bq-top { position:absolute; top:6px; left:50%; transform:translateX(-50%); display:flex; gap:6px; pointer-events:none; max-width:calc(100% - 12px); flex-wrap:wrap; justify-content:center; }
.bq-side { display:flex; align-items:center; gap:6px; padding:4px 9px 4px 7px; border-radius:16px; background:#000a; box-shadow:0 1px 0 #fff2 inset; font:600 12px/1.1 system-ui,sans-serif; white-space:nowrap; transition:box-shadow .2s, background .2s; }
.bq-side.on { background:#1c1206e6; box-shadow:0 0 0 2px #e8b84a, 0 0 14px #e8b84a66; }
.bq-side.out { opacity:.45; text-decoration:line-through; }
.bq-side .nm { max-width:96px; overflow:hidden; text-overflow:ellipsis; }
.bq-side .gp { opacity:.75; font-weight:500; font-size:11px; }
.bq-side .fl { color:#ffb4a8; font-size:11px; }
.bq-mini { display:flex; gap:2px; }
.bq-mini i, .bq-tray i { width:15px; height:15px; border-radius:50%; display:grid; place-items:center; font:700 8px/1 system-ui,sans-serif; color:#111; font-style:normal; box-shadow:inset -2px -2px 3px #0006, inset 1px 1px 2px #fff6; position:relative; overflow:hidden; }
.bq-mini i b, .bq-tray i b { position:relative; z-index:1; background:#f7f4ea; border-radius:50%; width:9px; height:9px; display:grid; place-items:center; }
.bq-mini i.gone { opacity:.2; transform:scale(.8); }
.bq-mini i.next, .bq-tray i.next { outline:2px solid #ffe08a; outline-offset:1px; }
.bq-tray { position:absolute; right:8px; top:46px; display:flex; flex-direction:column; gap:3px; padding:5px; border-radius:12px; background:linear-gradient(90deg,#2a1708,#4a2a12); box-shadow:inset 0 2px 6px #000a, 0 0 0 1px #0008; pointer-events:none; }
.bq-tray:empty { display:none; }
.bq-tray i { animation:bq-roll .7s cubic-bezier(.2,.8,.3,1) both; }
@keyframes bq-roll { from { transform:translateY(-60px) rotate(-300deg); opacity:0 } to { transform:none; opacity:1 } }
.bq-banner { position:absolute; left:50%; top:24%; transform:translate(-50%,0) scale(.9); padding:10px 22px; border-radius:14px; background:#000c; color:#fff; font:800 22px/1.15 system-ui,sans-serif; letter-spacing:.05em; opacity:0; transition:opacity .25s, transform .25s; pointer-events:none; text-align:center; text-shadow:0 2px 8px #000; }
.bq-banner small { display:block; font-weight:600; font-size:13px; letter-spacing:.02em; opacity:.85; margin-top:3px; }
.bq-banner.on { opacity:1; transform:translate(-50%,0) scale(1); } .bq-banner.foul { color:#ffb4a8; } .bq-banner.good { color:#bff0b0; } .bq-banner.gold { color:#ffe08a; }
.bq-hint { position:absolute; left:50%; bottom:76px; transform:translateX(-50%); padding:5px 12px; border-radius:14px; background:#000a; color:#fff; font:600 12.5px/1.25 system-ui,sans-serif; pointer-events:none; text-align:center; max-width:calc(100% - 24px); }
.bq-hint[hidden], .bq-ctl[hidden], .bq-choice[hidden], .bq-spinpop[hidden] { display:none; }
.bq-ctl { position:absolute; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; gap:10px; padding:8px 10px 10px; background:linear-gradient(#0000,#000b); flex-wrap:wrap; }
.bq-ctl label { color:#fff; font:600 12px system-ui,sans-serif; display:flex; align-items:center; gap:7px; }
.bq-pow { width:min(30vw,220px); accent-color:#e8b84a; height:28px; }
.bq-ctl button, .bq-choice button, .bq-spinpop button { border:0; border-radius:10px; padding:9px 13px; font:700 13.5px system-ui,sans-serif; background:#ffffff26; color:#fff; cursor:pointer; touch-action:manipulation; }
.bq-ctl button.go { background:linear-gradient(#f3cd6a,#d9a53a); color:#2a1a05; padding:10px 22px; font-size:16px; box-shadow:0 2px 0 #7a5410; }
.bq-ctl button.bq-chip.on { background:#e8b84a; color:#2a1a05; }
.bq-ctl button:disabled { opacity:.4; }
.bq-spinbtn { width:46px; height:46px; padding:0 !important; border-radius:50% !important; background:radial-gradient(circle at 38% 34%, #fff, #dcdcdc 68%, #b8b8b8) !important; position:relative; box-shadow:0 0 0 2px #fff6, inset -4px -4px 8px #0003; flex:none; }
.bq-spinbtn b, .bq-dial b { position:absolute; width:9px; height:9px; margin:-4.5px 0 0 -4.5px; border-radius:50%; background:#2a6fd6; box-shadow:0 0 0 1.5px #fff; pointer-events:none; }
.bq-spinpop { position:absolute; left:50%; bottom:76px; transform:translateX(-50%); padding:14px; border-radius:18px; background:#120c06f2; box-shadow:0 10px 40px #000c, 0 0 0 1px #fff2; display:flex; gap:14px; align-items:center; }
.bq-dial { width:168px; height:168px; border-radius:50%; position:relative; background:radial-gradient(circle at 38% 32%, #fff, #e4e4e4 60%, #a9a9a9); box-shadow:inset -10px -12px 24px #0004, 0 0 0 3px #fff3; touch-action:none; cursor:crosshair; }
.bq-dial::before { content:''; position:absolute; inset:8.5%; border-radius:50%; box-shadow:0 0 0 2px #d22c2c88 inset; }
.bq-dial::after { content:''; position:absolute; left:50%; top:50%; width:1px; height:1px; box-shadow:0 -84px 0 0 #0002, 0 84px 0 0 #0002; }
.bq-dial i, .bq-dial b { pointer-events:none; }
.bq-dial i { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:4px; height:4px; border-radius:50%; background:#0004; }
.bq-dial b { width:16px; height:16px; margin:-8px 0 0 -8px; }
.bq-spinside { display:flex; flex-direction:column; gap:8px; font:600 12px system-ui,sans-serif; min-width:130px; }
.bq-spinside .lbl { opacity:.8; } .bq-spinside .val { font-size:15px; } .bq-spinside .warn { color:#ff8a7a; min-height:15px; }
.bq-spinside input { accent-color:#e8b84a; }
.bq-choice { position:absolute; left:50%; bottom:0; transform:translateX(-50%); width:min(440px,100%); padding:16px 16px 18px; border-radius:18px 18px 0 0; background:#160e07f4; box-shadow:0 -10px 40px #000a; display:flex; flex-direction:column; gap:9px; }
.bq-choice h3 { margin:0; font:800 16px system-ui,sans-serif; } .bq-choice p { margin:0 0 4px; font:500 13px/1.35 system-ui,sans-serif; opacity:.85; }
.bq-choice button { padding:12px 14px; text-align:left; font-size:14.5px; }
.bq-choice button:first-of-type { background:linear-gradient(#f3cd6a,#d9a53a); color:#2a1a05; }
@media (max-width:640px) { .bq-ctl { gap:7px; padding:6px 6px 8px; } .bq-pow { width:34vw; } .bq-ctl button { padding:8px 10px; font-size:12.5px; } .bq-ctl button.go { padding:9px 16px; } .bq-side { padding:3px 7px 3px 5px; font-size:11px; } .bq-mini i { width:12px; height:12px; } .bq-mini i b { width:7px; height:7px; font-size:6px; } .bq-hint { bottom:104px; font-size:12px; } .bq-spinpop { bottom:104px; flex-direction:column; } .bq-dial { width:150px; height:150px; } }
`;

// the balls: a standard set. 1-7 solids, 8 black, 9-15 the same colours as stripes on white
const COL = ['#f6f3ea', '#f2b705', '#1544b8', '#d31518', '#4b2290', '#f06312', '#0d7a3a', '#7d1717', '#121212'];
const colorOf = (n) => (n === 0 ? COL[0] : COL[n > 8 ? n - 8 : n]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
export const SPEED = 1.25; // replays run a little faster than the physics clock: the last slow roll-outs do not need to be watched in full
const POCKET_LABEL = ['top-left corner', 'bottom-left corner', 'top side', 'bottom side', 'top-right corner', 'bottom-right corner'];

function ballTexture(n) {
  const W = 1024, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (n === 0) { // the cue ball: plain white with six small red dots (a "measles"-light ball, so its spin shows)
    g.fillStyle = COL[0]; g.fillRect(0, 0, W, H); g.fillStyle = '#c4262c';
    for (const [u, v] of [[0.25, 0.5], [0.75, 0.5], [0, 0.5], [0.5, 0.5], [0.5, 0.06], [0.5, 0.94]]) { g.beginPath(); g.ellipse(u * W, v * H, 11 / Math.max(0.2, Math.sin(v * Math.PI)), 11, 0, 0, TAU); g.fill(); }
    return c;
  }
  const col = colorOf(n);
  if (n > 8) { g.fillStyle = COL[0]; g.fillRect(0, 0, W, H); g.fillStyle = col; g.fillRect(0, H * 0.27, W, H * 0.46); }
  else { g.fillStyle = col; g.fillRect(0, 0, W, H); }
  for (const x of [W * 0.25, W * 0.75]) { // the number in its white circle, twice
    g.fillStyle = '#f7f4ea'; g.beginPath(); g.ellipse(x, H / 2, 70, 74, 0, 0, TAU); g.fill();
    g.fillStyle = '#111'; g.font = `bold ${n > 9 ? 78 : 92}px Georgia, 'Times New Roman', serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), x, H / 2 + 6);
    if (n === 6 || n === 9) { g.fillRect(x - 22, H / 2 + 44, 44, 6); }
  }
  return c;
}
function cssBall(n, cls = '') {
  const c = colorOf(n), bg = n > 8 ? `linear-gradient(#f4f1e8 0 26%, ${c} 26% 74%, #f4f1e8 74%)` : c;
  return `<i class="${cls}" style="background:${bg}"><b>${n}</b></i>`;
}

function clothCanvas(a, b, fibre) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, 512, 512);
  if (fibre) { g.globalAlpha = 0.35; g.globalCompositeOperation = 'overlay'; for (let x = 0; x < 512; x += fibre.width) for (let y = 0; y < 512; y += fibre.height) g.drawImage(fibre, x, y); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
  let s = 11; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 16000; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.045)'; g.fillRect(rnd() * 512, rnd() * 512, 1.3, 1.3); }
  return c;
}
function woodCanvas(a, b, img) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
  if (img) { for (let x = 0; x < 512; x += img.width) for (let y = 0; y < 128; y += img.height) g.drawImage(img, x, y); g.globalCompositeOperation = 'multiply'; g.fillStyle = a; g.fillRect(0, 0, 512, 128); g.globalCompositeOperation = 'source-over'; return c; }
  const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, 512, 128);
  let s = 5; const rr = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(${rr() < 0.55 ? '25,10,0' : '255,220,170'},${0.05 + rr() * 0.12})`; g.lineWidth = 0.5 + rr() * 2.2; g.beginPath(); const y0 = rr() * 128; g.moveTo(0, y0); g.bezierCurveTo(150, y0 + (rr() - 0.5) * 30, 360, y0 + (rr() - 0.5) * 30, 512, y0 + (rr() - 0.5) * 12); g.stroke(); }
  return c;
}
const loadImg = (url) => new Promise((res) => { if (!url) return res(null); const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });

// Where the cue tip is, in engine metres and height above the cloth, for a cue ball at c struck along angle a with the tip offset
// (ox: + is the ball's RIGHT side as the shooter sees it, oy: + is up) and the tip `gap` metres short of the ball.
export function cueTip(c, a, ox, oy, R, gap) {
  const dx = Math.cos(a), dy = Math.sin(a), lat = ox * R, dh = oy * R, depth = Math.sqrt(Math.max(0, R * R - lat * lat - dh * dh)), back = depth + gap;
  return { x: c.x - dx * back + dy * lat, y: c.y - dy * back - dx * lat, h: R + dh };
}

// decode a replay: per frame, every ball's position (engine metres) and spin (rad/s), from the per-ball segments the server sends
export function decode(shot) {
  const n = shot.from.length, nf = Math.max(1, shot.nf || 1), pos = new Float32Array(nf * n * 3), w = new Float32Array(nf * n * 3);
  for (let i = 0; i < n; i++) {
    const s0 = shot.from[i]; let lx = s0 ? s0.x : 0, ly = s0 ? s0.y : 0, lz = s0 ? 0 : -1;
    const segs = (shot.tracks && shot.tracks[i]) || []; let k = 0, seg = segs[0], f0 = seg ? seg[0] : Infinity;
    for (let f = 0; f < nf; f++) {
      while (seg && f >= f0 + seg[1]) { k++; seg = segs[k]; f0 = seg ? seg[0] : Infinity; }
      const o = (f * n + i) * 3;
      if (seg && f >= f0) { const q = 2 + (f - f0) * 6; lx = seg[q] / 1000; ly = seg[q + 1] / 1000; lz = seg[q + 2] / 1000; w[o] = seg[q + 3]; w[o + 1] = seg[q + 4]; w[o + 2] = seg[q + 5]; }
      pos[o] = lx; pos[o + 1] = ly; pos[o + 2] = lz;
    }
  }
  return { n, nf, pos, w };
}

export async function create(parent, T, hooks) {
  let renderer;
  const el = document.createElement('canvas'); el.className = 'bq-gl';
  try { renderer = new T.WebGLRenderer({ canvas: el, antialias: true, powerPreference: 'high-performance' }); } catch { return null; }
  if (!renderer.getContext()) return null;
  if (!document.getElementById('bq-css2')) { const st = document.createElement('style'); st.id = 'bq-css2'; st.textContent = CSS; document.head.appendChild(st); }
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x0b0907, 1);

  const root = document.createElement('div'); root.className = 'bq'; parent.appendChild(root); root.appendChild(el);
  root.insertAdjacentHTML('beforeend', `<div class="bq-top"></div><div class="bq-tray"></div><div class="bq-banner"></div><div class="bq-hint" hidden></div>
    <div class="bq-spinpop" hidden><div class="bq-dial"><i></i><b></b></div><div class="bq-spinside"><span class="lbl">Tip on the cue ball</span><span class="val bq-spinval">Center</span><span class="warn bq-spinwarn"></span>
      <label class="lbl">Cue raised <span class="bq-elval">3°</span></label><input class="bq-el" type="range" min="0" max="55" value="3"><button class="bq-spinreset">Center ball</button><button class="bq-spinok">Done</button></div></div>
    <div class="bq-choice" hidden></div>
    <div class="bq-ctl" hidden><button class="bq-spinbtn" title="Spin and cue elevation"><b></b></button><label>Power <input class="bq-pow" type="range" min="4" max="100" value="45"></label>
      <button class="bq-chip bq-safe" hidden title="A safety: the turn ends whatever goes in">Safety</button><button class="bq-chip bq-push" hidden title="9-ball: after the break, any shot; the other player then chooses who shoots">Push out</button>
      <button class="bq-chip bq-place" hidden>Place ✓</button><button class="bq-view" title="Camera">Camera</button><button class="go">Shoot</button></div>`);
  const $ = (q) => root.querySelector(q);
  const top = $('.bq-top'), tray = $('.bq-tray'), banner = $('.bq-banner'), hint = $('.bq-hint'), ctl = $('.bq-ctl'), pow = $('.bq-pow'), spinBtn = $('.bq-spinbtn'), spinBtnDot = $('.bq-spinbtn b');
  const pop = $('.bq-spinpop'), dial = $('.bq-dial'), dialDot = $('.bq-dial b'), spinVal = $('.bq-spinval'), spinWarn = $('.bq-spinwarn'), elIn = $('.bq-el'), elVal = $('.bq-elval');
  const choiceEl = $('.bq-choice'), goBtn = $('.go'), viewBtn = $('.bq-view'), safeBtn = $('.bq-safe'), pushBtn = $('.bq-push'), placeBtn = $('.bq-place');

  const scene = new T.Scene();
  scene.fog = new T.Fog(0x0b0907, 5, 13);
  try { const { RoomEnvironment } = await import('../three-addons/RoomEnvironment.js'); const pm = new T.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.55; } catch { /* no reflections: still a table */ }
  const cam = new T.PerspectiveCamera(38, 1, 0.03, 30);
  scene.add(new T.HemisphereLight(0xfff3e0, 0x1a1208, 0.45));
  // the lamp over the table: a long shade with a warm key light that throws soft shadows
  const sun = new T.DirectionalLight(0xfff1dc, 2.1); sun.position.set(0.25, 3.0, 0.35); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -1.7, right: 1.7, top: 1.0, bottom: -1.0, near: 0.5, far: 6 }); sun.shadow.bias = -0.0003; sun.shadow.radius = 4;
  scene.add(sun);
  for (const x of [-0.7, 0, 0.7]) { const l = new T.PointLight(0xffe2b0, 0.55, 3.2, 1.6); l.position.set(x, 1.05, 0); scene.add(l); }

  const S = {
    v: null, ctx: null, geo: null, built: false, seen: undefined, queue: [], play: null, pending: false, banner: 0, last: 0,
    angle: 0, power: 0.45, ox: 0, oy: 0, el: 0.05, cue: null, dragging: false, dragBall: false, pulling: null, camMode: 'table', portrait: false, gone: false, raf: 0,
    camPos: new T.Vector3(0, 3, 2), camLook: new T.Vector3(), yaw: 0, pitch: 0, zoom: 1, tip: null, themeKey: '', balls: [], shadows: [], quat: [],
    safe: false, push: false, callB: null, callP: null, autoCall: null, placeLock: false, full: null, fullKey: '', fullAt: 0, trayKey: '', topKey: '',
  };
  const W = (x, y, h = 0) => new T.Vector3(x, h, -y);

  // ---- the table ------------------------------------------------------------------------------------------------------
  const tableGroup = new T.Group(); scene.add(tableGroup);
  const ballsGroup = new T.Group(); scene.add(ballsGroup);
  let R = 0.028575;
  const sphere = new T.SphereGeometry(1, 48, 32);
  const blob = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new T.CanvasTexture(c); return t; })();
  const theme = () => hooks.theme?.() || (() => { const f = hooks.felt?.() || {}; return { felt1: f.a || '#1f6b45', felt2: f.b || '#0e3a24', rail1: '#7a4a24', rail2: '#3d2210' }; })();
  async function buildTable(geo) {
    S.geo = geo; R = geo.R;
    const th = theme(); S.themeKey = JSON.stringify(th);
    const [fibre, railImg] = await Promise.all([loadImg(th.feltTex), loadImg(th.railTex)]);
    while (tableGroup.children.length) { const o = tableGroup.children.pop(); o.geometry?.dispose(); }
    const L = geo.L, Wd = geo.W, fx = L, fy = Wd; // the cushion noses
    const cd = 0.05, rh = 0.06, ch = 0.040, rw = 0.13, ox = fx + cd + rw, oy = fy + cd + rw; // cushion depth, rail height, cushion height, rail width
    const rm = (p) => p.r * 1.08; // the hole in the cloth is a little wider than the capture circle, so a ball over the edge visibly goes in
    // the bed: one sheet of cloth with a round hole at every pocket
    const tex = new T.CanvasTexture(clothCanvas(th.felt1, th.felt2, fibre)); tex.colorSpace = T.SRGBColorSpace; tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(3, 3);
    const deck = new T.Shape(); deck.moveTo(-ox, -oy); deck.lineTo(ox, -oy); deck.lineTo(ox, oy); deck.lineTo(-ox, oy); deck.closePath();
    for (const p of geo.pockets) { const h = new T.Path(); h.absarc(p.x, p.y, rm(p), 0, TAU, true); deck.holes.push(h); }
    const clothMat = new T.MeshStandardMaterial({ map: tex, roughness: 0.97, metalness: 0, envMapIntensity: 0.18 });
    const cloth = new T.Mesh(new T.ShapeGeometry(deck, 48), clothMat);
    cloth.rotation.x = -Math.PI / 2; cloth.receiveShadow = true; tableGroup.add(cloth);
    // a soft light pool from the lamp on the cloth
    { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(128, 64, 10, 128, 64, 140); gr.addColorStop(0, 'rgba(255,240,210,.10)'); gr.addColorStop(1, 'rgba(0,0,0,.28)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
      const m = new T.Mesh(new T.PlaneGeometry(fx * 2, fy * 2), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = 0.0004; tableGroup.add(m); }
    // each pocket: a leather-lined well under the hole, a dark chute, and a brass-capped leather lip
    const leather = new T.MeshStandardMaterial({ color: 0x2b1a10, roughness: 0.62, metalness: 0.05 });
    const brass = new T.MeshStandardMaterial({ color: 0xc9a65a, metalness: 0.85, roughness: 0.28 });
    for (const p of geo.pockets) {
      const q = W(p.x, p.y, 0);
      const well = new T.Mesh(new T.CylinderGeometry(rm(p), rm(p) * 0.82, 0.16, 32, 1, true), new T.MeshStandardMaterial({ color: 0x120b07, roughness: 0.9, side: T.BackSide })); well.position.set(q.x, -0.08, q.z); tableGroup.add(well);
      const floorD = new T.Mesh(new T.CircleGeometry(rm(p) * 0.85, 24), new T.MeshBasicMaterial({ color: 0x040302 })); floorD.rotation.x = -Math.PI / 2; floorD.position.set(q.x, -0.16, q.z); tableGroup.add(floorD);
      const lip = new T.Mesh(new T.TorusGeometry(rm(p) + 0.006, 0.0075, 10, 48), leather); lip.rotation.x = -Math.PI / 2; lip.position.set(q.x, rh * 0.15, q.z); lip.scale.z = 2.4; tableGroup.add(lip);
      const cap = new T.Mesh(new T.TorusGeometry(rm(p) + 0.018, 0.004, 8, 48, Math.PI), brass); cap.rotation.x = -Math.PI / 2; cap.position.set(q.x, rh + 0.002, q.z);
      cap.rotation.z = Math.atan2(-p.y, p.x) - Math.PI / 2 + Math.PI; tableGroup.add(cap);
    }
    // the wooden rail: its opening is the cushion rectangle plus a round bite at every pocket (traced by angle from the centre)
    const ix = fx + cd, iy = fy + cd, N = 1440, outline = [];
    for (let k = 0; k < N; k++) {
      const thA = (k / N) * TAU, dx = Math.cos(thA), dy = Math.sin(thA);
      let r = Math.min(Math.abs(dx) > 1e-9 ? ix / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? iy / Math.abs(dy) : Infinity);
      for (const p of geo.pockets) {
        const R2 = rm(p) + 0.016, along = p.x * dx + p.y * dy, perp2 = p.x * p.x + p.y * p.y - along * along; if (along <= 0 || perp2 > R2 * R2) continue;
        r = Math.max(r, along + Math.sqrt(R2 * R2 - perp2));
      }
      outline.push([dx * r, dy * r]);
    }
    const railShape = new T.Shape(); const corner = 0.05;
    railShape.moveTo(-ox + corner, -oy); railShape.lineTo(ox - corner, -oy); railShape.quadraticCurveTo(ox, -oy, ox, -oy + corner); railShape.lineTo(ox, oy - corner); railShape.quadraticCurveTo(ox, oy, ox - corner, oy);
    railShape.lineTo(-ox + corner, oy); railShape.quadraticCurveTo(-ox, oy, -ox, oy - corner); railShape.lineTo(-ox, -oy + corner); railShape.quadraticCurveTo(-ox, -oy, -ox + corner, -oy);
    const opening = new T.Path(); outline.slice().reverse().forEach(([x, y], k) => (k ? opening.lineTo(x, y) : opening.moveTo(x, y))); opening.closePath(); railShape.holes.push(opening);
    const wood = new T.CanvasTexture(woodCanvas(th.rail1 || '#7a4a24', th.rail2 || '#3d2210', railImg)); wood.colorSpace = T.SRGBColorSpace; wood.wrapS = wood.wrapT = T.RepeatWrapping; wood.repeat.set(0.35, 0.35); wood.anisotropy = 4;
    const woodMat = new T.MeshPhysicalMaterial({ map: wood, roughness: 0.42, metalness: 0.02, clearcoat: 0.7, clearcoatRoughness: 0.18 });
    const rail = new T.Mesh(new T.ExtrudeGeometry(railShape, { depth: rh, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.012, bevelSegments: 4, curveSegments: 16 }), woodMat);
    rail.rotation.x = -Math.PI / 2; rail.position.y = -0.0005; rail.castShadow = rail.receiveShadow = true; tableGroup.add(rail);
    // the apron and the legs: dark wood under the rail
    const apronMat = new T.MeshStandardMaterial({ map: wood, color: 0x8a6a50, roughness: 0.5 });
    for (const [w, d, x, z] of [[ox * 2, 0.04, 0, -oy + 0.02], [ox * 2, 0.04, 0, oy - 0.02], [0.04, oy * 2, -ox + 0.02, 0], [0.04, oy * 2, ox - 0.02, 0]]) { const k = new T.Mesh(new T.BoxGeometry(w, 0.2, d), apronMat); k.position.set(x, -0.1, z); k.castShadow = true; tableGroup.add(k); }
    for (const [x, z] of [[-ox + 0.14, -oy + 0.14], [ox - 0.14, -oy + 0.14], [-ox + 0.14, oy - 0.14], [ox - 0.14, oy - 0.14], [0, -oy + 0.14], [0, oy - 0.14]]) { const l = new T.Mesh(new T.CylinderGeometry(0.075, 0.06, 0.62, 16), apronMat); l.position.set(x, -0.5, z); l.castShadow = true; tableGroup.add(l); }
    // cushions: cloth-covered rubber, each ending at the jaws where the physics ends them; the nose sits above the ball's centre
    const cmat = new T.MeshStandardMaterial({ map: tex, color: 0xc4c4c4, roughness: 0.95, envMapIntensity: 0.18 });
    const cornerIn = geo.halfX - (R * 1.6) / 0.5, midIn = (R * 1.385) / 0.5, endIn = geo.halfY - (R * 1.6) / 0.5, fl = 0.034; // knuckle positions, as in pocketgeometry.ts
    const cushion = (x0, x1, y0, y1, horizontal) => {
      const sh = new T.Shape();
      if (horizontal) { sh.moveTo(x0, y0); sh.lineTo(x1, y0); sh.lineTo(x1 + Math.sign(x1 - x0) * fl, y1); sh.lineTo(x0 - Math.sign(x1 - x0) * fl, y1); }
      else { sh.moveTo(y0, x0); sh.lineTo(y0, x1); sh.lineTo(y1, x1 + Math.sign(x1 - x0) * fl); sh.lineTo(y1, x0 - Math.sign(x1 - x0) * fl); }
      sh.closePath();
      const m = new T.Mesh(new T.ExtrudeGeometry(sh, { depth: ch, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.006, bevelSegments: 3 }), cmat);
      m.rotation.x = -Math.PI / 2; m.castShadow = m.receiveShadow = true; tableGroup.add(m);
    };
    for (const sy of [-1, 1]) for (const sx of [-1, 1]) cushion(sx * midIn, sx * cornerIn, sy * fy, sy * (fy + cd), true);
    for (const sx of [-1, 1]) cushion(-endIn, endIn, sx * fx, sx * (fx + cd), false);
    // pearl diamonds on the rail top (WPA: three between pockets on each long rail half and each end rail), the head string and spots
    const pearl = new T.MeshPhysicalMaterial({ color: 0xf3ecdf, roughness: 0.25, metalness: 0.1, clearcoat: 1, iridescence: 0.6, iridescenceIOR: 1.3, sheen: 0.4 });
    const dGeo = new T.CylinderGeometry(0.009, 0.009, 0.002, 4); const rowY = (fy + cd + rw * 0.45), rowX = (fx + cd + rw * 0.45);
    for (let i = 1; i < 8; i++) { if (i === 4) continue; for (const sgn of [-1, 1]) { const d = new T.Mesh(dGeo, pearl); d.scale.set(0.7, 1, 1.25); d.position.set(-fx + (i * fx * 2) / 8, rh + 0.0125, sgn * rowY); tableGroup.add(d); } }
    for (let i = 1; i < 4; i++) for (const sgn of [-1, 1]) { const d = new T.Mesh(dGeo, pearl); d.scale.set(1.25, 1, 0.7); d.position.set(sgn * rowX, rh + 0.0125, -fy + (i * fy * 2) / 4); tableGroup.add(d); }
    const spotM = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
    for (const x of [geo.headX, geo.footX]) { const s = new T.Mesh(new T.CircleGeometry(0.006, 16), spotM); s.rotation.x = -Math.PI / 2; s.position.set(x, 0.0008, 0); tableGroup.add(s); }
    // the kitchen (behind the head string): shaded only while the cue ball goes there
    S.kitchen = new T.Mesh(new T.PlaneGeometry(fx + geo.headX, fy * 2), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, depthWrite: false }));
    S.kitchen.rotation.x = -Math.PI / 2; S.kitchen.position.set((-fx + geo.headX) / 2, 0.0009, 0); S.kitchen.visible = false; tableGroup.add(S.kitchen);
    const floor = new T.Mesh(new T.PlaneGeometry(16, 16), new T.MeshStandardMaterial({ color: 0x1d130b, roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.81; floor.receiveShadow = true; tableGroup.add(floor);
    S.rail = { ox, oy, rh };
    // the balls
    if (!S.balls.length) {
      for (let i = 0; i < 16; i++) {
        const tx = new T.CanvasTexture(ballTexture(i)); tx.colorSpace = T.SRGBColorSpace; tx.anisotropy = 4;
        const m = new T.Mesh(sphere, new T.MeshPhysicalMaterial({ map: tx, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04 }));
        m.castShadow = true; m.receiveShadow = true; ballsGroup.add(m); S.balls.push(m);
        const q = new T.Quaternion().setFromEuler(new T.Euler((i * 1.3) % TAU, (i * 2.1) % TAU, 0)); // each ball sits a different way up
        if (i > 0) q.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), 0)); S.quat.push(q);
        const sh = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false })); sh.rotation.x = -Math.PI / 2; ballsGroup.add(sh); S.shadows.push(sh);
      }
      // show the numbers to the camera at the start
      for (let i = 1; i < 16; i++) S.quat[i].setFromAxisAngle(new T.Vector3(0, 1, 0), -Math.PI / 2).premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -0.9));
    }
    for (const m of S.balls) m.scale.setScalar(R);
    S.built = true;
  }

  // ---- cue stick, aim guide, ghost ball, call marker -----------------------------------------------------------------------
  const cue = new T.Group();
  { const len = 1.47, mk = (r0, r1, l, x, mat) => { const m = new T.Mesh(new T.CylinderGeometry(r0, r1, l, 20), mat); m.rotation.z = Math.PI / 2; m.position.x = x; m.castShadow = true; cue.add(m); return m; };
    const maple = new T.MeshPhysicalMaterial({ color: 0xead2a0, roughness: 0.35, clearcoat: 0.6 }), ebony = new T.MeshPhysicalMaterial({ color: 0x1a0d06, roughness: 0.3, clearcoat: 0.9 }), wrap = new T.MeshStandardMaterial({ color: 0x1e2730, roughness: 0.9 }), ring = new T.MeshStandardMaterial({ color: 0xd8c08a, metalness: 0.8, roughness: 0.3 }), ferrule = new T.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.4 });
    mk(0.0062, 0.0063, 0.011, 0.0055 - 0.011, new T.MeshStandardMaterial({ color: 0x3f6fae, roughness: 0.85 }));
    mk(0.0064, 0.0065, 0.022, -0.011 - 0.011, ferrule);
    mk(0.0065, 0.0105, 0.70, -0.022 - 0.35, maple);
    mk(0.0108, 0.0108, 0.006, -0.725, ring);
    mk(0.0108, 0.0128, 0.32, -0.728 - 0.16, ebony);
    mk(0.0128, 0.0140, 0.26, -1.048 - 0.13, wrap);
    mk(0.0141, 0.0150, 0.16, -1.308 - 0.08, ebony);
    mk(0.0152, 0.0152, 0.008, -len, new T.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }));
    cue.visible = false; scene.add(cue); }
  const lineMat = (c, o) => new T.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false });
  const mkLine = (c, o) => { const l = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3(1, 0, 0)]), lineMat(c, o)); l.visible = false; l.renderOrder = 3; scene.add(l); return l; };
  const guide = mkLine(0xffffff, 0.85), tgtLine = mkLine(0xffe08a, 0.95), tanLine = mkLine(0x9fd8ff, 0.7);
  const ghost = new T.Mesh(new T.SphereGeometry(1, 24, 16), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false })); ghost.visible = false; scene.add(ghost);
  const ghostRing = new T.Mesh(new T.RingGeometry(0.93, 1.0, 40), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: T.DoubleSide, depthWrite: false })); ghostRing.rotation.x = -Math.PI / 2; ghostRing.visible = false; scene.add(ghostRing);
  const callRing = new T.Mesh(new T.RingGeometry(0.9, 1.0, 48), new T.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95, side: T.DoubleSide, depthWrite: false })); callRing.rotation.x = -Math.PI / 2; callRing.visible = false; callRing.renderOrder = 4; scene.add(callRing);
  const placeRing = new T.Mesh(new T.RingGeometry(1.05, 1.25, 40), new T.MeshBasicMaterial({ color: 0x8cff9a, transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false })); placeRing.rotation.x = -Math.PI / 2; placeRing.visible = false; scene.add(placeRing);
  const fullLines = []; // the full guide's paths: one line per moving ball
  for (let k = 0; k < 4; k++) { const l = new T.Line(new T.BufferGeometry(), lineMat(k ? 0xffe08a : 0xffffff, k ? 0.8 : 0.9)); l.visible = false; l.renderOrder = 3; scene.add(l); fullLines.push(l); }

  function setLine(line, a, b) { const p = line.geometry.attributes.position; p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true; line.geometry.computeBoundingSphere(); }

  // ---- state helpers ------------------------------------------------------------------------------------------------------------
  const mine = () => !!(S.v && S.ctx && S.ctx.seat != null && !S.ctx.spectator);
  const myTurn = () => !!(mine() && S.v.turn === S.ctx.seat && !S.v.over && !S.v.choice && !S.play && !S.queue.length && !S.pending);
  const cuePos = () => (S.v?.inHand && S.cue ? S.cue : S.v?.balls?.[0]);
  const stickBase = () => (S.play ? S.play.shot.from[0] : cuePos());
  const validSpot = (x, y) => {
    if (!S.geo) return false; const { halfX, halfY } = S.geo;
    if (Math.abs(x) > halfX || Math.abs(y) > halfY) return false;
    if (S.v.inHand === 'kitchen' && x > S.geo.headX) return false;
    if (S.geo.pockets.some((p) => Math.hypot(p.x - x, p.y - y) <= p.r + R * 0.2)) return false;
    return S.v.balls.every((b, i) => !b || i === 0 || Math.hypot(b.x - x, b.y - y) >= 2 * R * 1.002);
  };

  // the first ball (or cushion) along the aim, and where it sends that ball
  function firstContact(cp, a) {
    const dx = Math.cos(a), dy = Math.sin(a), balls = S.v.balls, { halfX, halfY } = S.geo;
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
    const t = Math.min(tHit, tWall), gx = cp.x + dx * t, gy = cp.y + dy * t;
    if (hitBall > 0 && tHit <= tWall) { const b = balls[hitBall], nx = b.x - gx, ny = b.y - gy, nl = Math.hypot(nx, ny) || 1; return { ball: hitBall, gx, gy, ox: nx / nl, oy: ny / nl, t }; }
    return { ball: -1, gx, gy, t };
  }
  // the pocket a ball heading (ux, uy) from b is going for: the one nearest its line, ahead of it
  function pocketAlong(b, ux, uy) {
    let best = -1, bd = Infinity;
    S.geo.pockets.forEach((p, k) => { const px = p.x - b.x, py = p.y - b.y, along = px * ux + py * uy; if (along <= 0) return; const perp = Math.abs(-px * uy + py * ux); const score = perp / Math.max(0.15, along) + perp; if (score < bd) { bd = score; best = k; } });
    return best;
  }
  function currentCall() {
    if (!S.v?.needCall) return null;
    const want = S.v.wanted || [];
    if (S.callB != null && S.callP != null && S.v.balls[S.callB] && want.includes(S.callB)) return { b: S.callB, p: S.callP };
    const a = S.autoCall;
    if (S.callP != null && a && a.b > 0) return { b: a.b, p: S.callP };
    if (a && a.b > 0 && a.p >= 0) return a;
    if (S.callB != null && S.callP != null) return { b: S.callB, p: S.callP };
    return null;
  }

  function aimGuide() {
    const cp = cuePos(), show = myTurn() && cp;
    const off = S.v?.guide === 'off';
    [guide, tgtLine, tanLine].forEach((l) => (l.visible = false)); ghost.visible = ghostRing.visible = callRing.visible = false; fullLines.forEach((l) => (l.visible = false));
    placeRing.visible = !!(show && S.v.inHand && !S.placeLock);
    if (placeRing.visible) { const q = W(cp.x, cp.y, 0.0012); placeRing.position.copy(q); placeRing.scale.setScalar(R); placeRing.material.color.set(validSpot(cp.x, cp.y) ? 0x8cff9a : 0xff6a5a); }
    if (S.kitchen) S.kitchen.visible = !!(show && S.v.inHand === 'kitchen');
    if (!show) return;
    const fc = firstContact(cp, S.angle);
    // the call: the first ball and the pocket it is heading for (the player can tap a different pocket or ball)
    S.autoCall = fc.ball > 0 && (S.v.wanted || []).includes(fc.ball) ? { b: fc.ball, p: pocketAlong(S.v.balls[fc.ball], fc.ox, fc.oy) } : null;
    const call = currentCall();
    if (S.v.needCall && call && call.p >= 0) { const p = S.geo.pockets[call.p]; callRing.position.copy(W(p.x, p.y, 0.003)); callRing.scale.setScalar(p.r * 1.05 + 0.004 * Math.sin(performance.now() / 180)); callRing.visible = true; }
    if (off) return;
    if (S.v.guide === 'full') { fullGuide(cp); return; }
    const end = W(fc.gx, fc.gy, R);
    setLine(guide, W(cp.x, cp.y, R), end); guide.visible = true;
    ghost.position.copy(end); ghost.scale.setScalar(R); ghost.visible = true;
    ghostRing.position.copy(W(fc.gx, fc.gy, 0.0012)); ghostRing.scale.setScalar(R); ghostRing.visible = true;
    if (fc.ball > 0) {
      const b = S.v.balls[fc.ball], len = 0.42 * Math.max(0.3, S.power + 0.2);
      setLine(tgtLine, W(b.x, b.y, R), W(b.x + fc.ox * len, b.y + fc.oy * len, R)); tgtLine.visible = true;
      // the cue ball's path off the object ball (the tangent line, bent forward by follow or back by draw)
      const dx = Math.cos(S.angle), dy = Math.sin(S.angle), dot = dx * fc.ox + dy * fc.oy, tx = dx - dot * fc.ox, ty = dy - dot * fc.oy, tl = Math.hypot(tx, ty);
      if (tl > 0.05) { const k = 0.25 * tl; const bend = S.oy * 0.6; const ux = tx / tl + fc.ox * bend, uy = ty / tl + fc.oy * bend, ul = Math.hypot(ux, uy) || 1; setLine(tanLine, end, W(fc.gx + (ux / ul) * k, fc.gy + (uy / ul) * k, R)); tanLine.visible = true; }
    }
  }
  // the casual guide: the browser's copy of the engine rolls the shot as it is set up and draws where the balls go
  function fullGuide(cp) {
    const key = `${cp.x.toFixed(4)},${cp.y.toFixed(4)},${S.angle.toFixed(4)},${S.power.toFixed(3)},${S.ox},${S.oy},${S.el}`;
    const now = performance.now();
    if (key !== S.fullKey && now - S.fullAt > 110) {
      S.fullKey = key; S.fullAt = now;
      try {
        const spots = S.v.balls.map((b) => b && { ...b }); spots[0] = { x: cp.x, y: cp.y };
        const r = engineSimulate(spots, { a: S.angle, p: S.power, ox: S.ox, oy: S.oy, el: S.el, brk: S.v.breakShot }, 20);
        const d = decode({ from: spots, tracks: r.tracks, nf: r.nf });
        const moved = []; for (let i = 0; i < d.n; i++) if (r.tracks[i] && r.tracks[i].length) moved.push(i);
        moved.sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : (r.events.findIndex((e) => e.a === a || e.b === a)) - (r.events.findIndex((e) => e.a === b || e.b === b))));
        S.full = moved.slice(0, 4).map((i) => { const pts = []; for (let f = 0; f < d.nf; f++) { const o = (f * d.n + i) * 3; if (d.pos[o + 2] < -R) break; pts.push(W(d.pos[o], d.pos[o + 1], R * 0.6)); } return { i, pts }; });
      } catch { S.full = null; }
    }
    if (!S.full) return;
    S.full.forEach((f, k) => { const l = fullLines[k]; l.geometry.dispose(); l.geometry = new T.BufferGeometry().setFromPoints(f.pts); l.material.color.set(f.i === 0 ? 0xffffff : colorOf(f.i)); l.visible = f.pts.length > 1; });
  }

  function placeCue(pull = 0, show = true) {
    const cp = stickBase();
    cue.visible = !!(show && cp && (myTurn() || S.play?.phase === 'stroke') && !(S.v?.inHand && !S.placeLock && S.dragBall));
    if (!cue.visible) return;
    const sh = S.play?.shot, a = sh ? sh.a : S.angle, ox = sh ? sh.ox || 0 : S.ox, oy = sh ? sh.oy || 0 : S.oy, el = sh ? sh.el || 0 : S.el;
    const tip = cueTip(cp, a, ox, oy, R, 0.0008 + pull + (sh ? 0 : S.pulling ? S.pulling.pow * 0.22 : 0.012 + S.power * 0.04));
    cue.position.set(tip.x, tip.h, -tip.y);
    cue.rotation.set(0, a, -Math.max(0.035, el)); // heading a in the plane, the butt raised by the cue's elevation
    S.tip = tip;
  }

  // ---- layout, camera ------------------------------------------------------------------------------------------------------------------
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
  const corners = () => { const g = S.geo, x = (S.rail ? S.rail.ox : g.L + 0.2) + 0.02, y = (S.rail ? S.rail.oy : g.W + 0.2) + 0.02; return [[-x, -y], [x, -y], [x, y], [-x, y]].flatMap(([a, b]) => [W(a, b, 0), W(a, b, 0.08)]); };
  function fit(dir, up, target) {
    let lo = 0.8, hi = 9; const pts = corners(), v = new T.Vector3();
    for (let k = 0; k < 16; k++) {
      const d = (lo + hi) / 2; cam.position.copy(target).addScaledVector(dir, d); cam.up.copy(up); cam.lookAt(target); cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      let ok = true; for (const p of pts) { v.copy(p).project(cam); if (Math.abs(v.x) > 0.97 || v.y > 0.84 || v.y < -0.8) { ok = false; break; } }
      if (ok) hi = d; else lo = d;
    }
    return hi;
  }
  const orbitQ = new T.Quaternion(), yawAxis = new T.Vector3(0, 1, 0);
  function cameraTarget() {
    const tgt = new T.Vector3(), pos = new T.Vector3(), up = new T.Vector3(0, 1, 0);
    let cueCam = false;
    if (S.camMode === 'cue' && S.v && stickBase()) {
      cueCam = true;
      const a = S.play ? S.play.shot.a : S.angle, P = S.play, base = P && P.phase === 'roll' && S.balls[0].visible ? { x: S.balls[0].position.x, y: -S.balls[0].position.z } : stickBase();
      const back = S.portrait ? 1.15 : 0.95, hgt = S.portrait ? 0.62 : 0.48, ahead = S.portrait ? 0.6 : 0.3;
      pos.copy(W(base.x - Math.cos(a) * back, base.y - Math.sin(a) * back, hgt)); tgt.copy(W(base.x + Math.cos(a) * ahead, base.y + Math.sin(a) * ahead, 0));
    } else {
      const dir = S.camMode === 'top' ? new T.Vector3(0, 1, 0.0001).normalize() : (S.portrait ? new T.Vector3(-0.55, 0.83, 0) : new T.Vector3(0, 0.8, 0.6)).normalize();
      if (S.camMode === 'top') up.copy(S.portrait ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 0, -1));
      const d = fit(dir, up, tgt); pos.copy(tgt).addScaledVector(dir, d);
    }
    if (S.yaw || S.pitch || S.zoom !== 1) {
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
  const dq = new T.Quaternion(), wv = new T.Vector3();
  function putBall(i, x, y, z = 0) {
    const m = S.balls[i], h = R + z;
    m.position.set(x, h, -y); m.quaternion.copy(S.quat[i]); m.scale.setScalar(R);
    const below = z < -R * 2.2; m.visible = !below;
    const sh = S.shadows[i]; sh.visible = m.visible && z > -R * 0.5; sh.position.set(x + 0.004, 0.0007, -y + 0.003); sh.scale.setScalar(R * 2.6);
  }
  // turn ball i by its spin (engine rad/s) for dt seconds: engine (x, y, z) -> three (x, z, -y)
  function spinBall(i, wx, wy, wz, dt) {
    wv.set(wx, wz, -wy); const w = wv.length(); if (w < 1e-4) return;
    dq.setFromAxisAngle(wv.multiplyScalar(1 / w), w * dt); S.quat[i].premultiply(dq).normalize();
  }
  function drawRest() {
    const v = S.v; if (!v) return;
    for (let i = 0; i < 16; i++) {
      let b = v.balls[i];
      if (i === 0 && v.inHand && S.cue && myTurn()) b = S.cue;
      if (b) putBall(i, b.x, b.y, 0); else { S.balls[i].visible = false; S.shadows[i].visible = false; }
    }
  }

  // ---- replays ------------------------------------------------------------------------------------------------------------------------------------
  function startPlay(shot) {
    S.play = { shot, phase: 'stroke', t: 0, ev: 0, d: decode(shot), sunk: {} };
    for (let i = 0; i < 16; i++) { const b = shot.from[i]; if (b) putBall(i, b.x, b.y, 0); else { S.balls[i].visible = false; S.shadows[i].visible = false; } }
    [guide, tgtLine, tanLine].forEach((l) => (l.visible = false)); ghost.visible = ghostRing.visible = callRing.visible = placeRing.visible = false; fullLines.forEach((l) => (l.visible = false));
    S.pulling = null; pop.hidden = true;
  }
  function stepPlay(dt) {
    const P = S.play, sh = P.shot;
    if (P.phase === 'stroke') {
      P.t += dt; if (S.holdAt != null) P.t = Math.min(P.t, S.holdAt);
      const u = Math.min(1, P.t / 0.6), back = 0.08 + sh.p * 0.2, k = (u - 0.6) / 0.4, pull = u < 0.6 ? 0.012 + (u / 0.6) * (back - 0.012) : back * (1 - k * k);
      placeCue(Math.max(0, pull), true);
      if (u >= 1) { P.phase = 'roll'; P.t = 0; cue.visible = false; hooks.sound?.(sh.brk ? 'break' : 'cue', clamp(0.25 + sh.p, 0.2, 1)); if (sh.miscue) hooks.sound?.('miscue', 0.6); }
      return;
    }
    const step = dt * SPEED;
    P.t += step; if (S.holdAt != null) P.t = Math.min(P.t, S.holdAt);
    let hits = 0;
    while (P.ev < sh.events.length && sh.events[P.ev].t <= P.t) {
      const e = sh.events[P.ev++], v = e.v ?? 1;
      if (e.k === 'pot') { hooks.sound?.('pot', clamp(v / 2, 0.3, 1)); P.sunk[e.a] = P.t; }
      else if (e.k === 'hit') { if (hits++ < 3) hooks.sound?.('hit', clamp(v / 3, 0.08, 1)); }
      else if (e.k === 'jaw') hooks.sound?.('jaw', clamp(v / 2, 0.1, 1));
      else hooks.sound?.('cush', clamp(v / 3, 0.08, 1));
    }
    const d = P.d, f = Math.min(d.nf - 1, P.t / sh.dt), i0 = Math.floor(f), i1 = Math.min(d.nf - 1, i0 + 1), u = f - i0;
    for (let k = 0; k < d.n && k < 16; k++) {
      if (!sh.from[k]) continue;
      const a = (i0 * d.n + k) * 3, b = (i1 * d.n + k) * 3;
      const x = d.pos[a] + (d.pos[b] - d.pos[a]) * u, y = d.pos[a + 1] + (d.pos[b + 1] - d.pos[a + 1]) * u, z = d.pos[a + 2] + (d.pos[b + 2] - d.pos[a + 2]) * u;
      spinBall(k, d.w[a] + (d.w[b] - d.w[a]) * u, d.w[a + 1] + (d.w[b + 1] - d.w[a + 1]) * u, d.w[a + 2] + (d.w[b + 2] - d.w[a + 2]) * u, step);
      putBall(k, x, y, z);
    }
    if (P.t >= sh.dur + 0.1) endPlay();
  }
  // point the cue at the nearest of your balls with a clear line (a new turn, or another shot in the same visit)
  function autoAim() {
    const v = S.v, c = (v?.inHand && S.cue) || v?.balls?.[0]; if (!c) return;
    const clear = (b) => { const dx = b.x - c.x, dy = b.y - c.y, L2 = dx * dx + dy * dy; return v.balls.every((o, i) => { if (!o || i === 0 || o === b) return true; const t = clamp(((o.x - c.x) * dx + (o.y - c.y) * dy) / L2, 0, 1); return Math.hypot(c.x + dx * t - o.x, c.y + dy * t - o.y) > 2 * R; }); };
    const want = (v.wanted || []).map((b) => v.balls[b]).filter(Boolean).sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y));
    const b = want.find(clear) || want[0]; if (b) S.angle = Math.atan2(b.y - c.y, b.x - c.x);
  }
  function endPlay() {
    const sh = S.play.shot; S.play = null;
    drawRest(); drawTray(true);
    // every shot starts fresh: the cue ball unplaced, no safety or push, no call, center ball (the cue's elevation stays)
    S.safe = S.push = false; S.callB = S.callP = null; S.placeLock = false; S.ox = S.oy = 0; S.cue = S.v?.inHand ? null : S.cue;
    if (S.v?.inHand && S.v.turn === S.ctx?.seat) S.cue = S.v.balls[0] && validSpot(S.v.balls[0].x, S.v.balls[0].y) ? { ...S.v.balls[0] } : { x: S.v.geo.headX - R * 3, y: 0 };
    if (myTurn() && !S.v.breakShot) { autoAim(); S.power = 0.45; }
    const who = hooks.seatName?.(sh.seat) || '';
    const t = sh.tags || [];
    let txt = '', cls = 'good', sub = '';
    if (sh.win) { txt = S.v?.variant === '9ball' ? (sh.brk ? 'GOLDEN BREAK!' : 'NINE BALL!') : S.v?.variant === 'cutthroat' ? 'LAST ONE STANDING' : 'THE 8 BALL!'; cls = 'gold'; const w = (S.v?.winners || []).map((k) => hooks.seatName?.(k) || `Seat ${k + 1}`); sub = w.length ? `${w.join(' & ')} win${w.length > 1 || w[0] === 'You' ? '' : 's'}` : ''; }
    else if (sh.lose) { txt = sh.note.toUpperCase(); cls = 'foul'; }
    else if (sh.foul) { txt = `FOUL · ${sh.foul}`; cls = 'foul'; sub = sh.note !== sh.foul ? sh.note : ''; }
    else if (t.includes('combo')) { txt = 'COMBINATION!'; sub = who; }
    else if (t.includes('bank')) { txt = 'BANK SHOT!'; sub = who; }
    else if (t.includes('groups')) { txt = sh.note.toUpperCase(); sub = `${who} take${who === 'You' ? '' : 's'} ${sh.note.toLowerCase()}`; }
    else if (sh.brk && sh.potted.length) { txt = sh.potted.length > 1 ? `${sh.potted.length} ON THE BREAK` : 'ONE ON THE BREAK'; }
    else if (t.includes('run') && S.v?.visit?.seat === sh.seat && S.v.visit.pots >= 3) { txt = `RUN OF ${S.v.visit.pots}`; sub = who; }
    else if (sh.push) { txt = 'PUSH OUT'; }
    else if (sh.safe) { txt = 'SAFETY'; cls = ''; }
    else if (sh.potted.length) { txt = sh.potted.length > 1 ? `${sh.potted.length} BALLS DOWN` : 'POCKETED'; }
    else if (sh.miscue) { txt = 'MISCUE'; cls = 'foul'; }
    if (txt) showBanner(txt, cls, sub);
    if (sh.foul) hooks.sound?.('foul', 0.6); else if (sh.win) hooks.sound?.('win', 0.8);
  }
  function showBanner(text, cls, sub) { banner.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`; banner.className = `bq-banner on ${cls || ''}`; clearTimeout(S.banner); S.banner = setTimeout(() => { banner.className = 'bq-banner'; }, 2400); }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- HUD ---------------------------------------------------------------------------------------------------------------------------------------------------
  function drawTop() {
    const v = S.v; if (!v) return;
    const sides = []; for (let s = 0; s < v.sides; s++) sides.push(v.sideOf.map((x, k) => (x === s ? k : -1)).filter((k) => k >= 0));
    const turnSide = v.turn == null ? -1 : v.sideOf[v.turn];
    const key = JSON.stringify([v.balls.map((b) => !!b), v.turn, v.groups, v.out, v.fouls, v.over, sides.map((x) => x.map((k) => hooks.seatName?.(k)))]);
    if (key === S.topKey) return; S.topKey = key;
    top.innerHTML = sides.map((seats, s) => {
      const names = seats.map((k) => esc(hooks.seatName?.(k) || `Seat ${k + 1}`)).join(' & ');
      const g = v.groups[seats[0]];
      let balls = '';
      if (v.variant === '9ball') balls = s === 0 || v.sides === 1 ? '' : '';
      else if (g === 'solids' || g === 'stripes') { const set = g === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]; balls = set.map((n) => cssBall(n, v.balls[n] ? '' : 'gone')).join('') + (set.every((n) => !v.balls[n]) ? cssBall(8, v.balls[8] ? 'next' : 'gone') : ''); }
      else if (v.variant === 'cutthroat' && g) { const k = ['1-5', '6-10', '11-15'].indexOf(g); balls = [1, 2, 3, 4, 5].map((n) => n + k * 5).map((n) => cssBall(n, v.balls[n] ? '' : 'gone')).join(''); }
      const fl = v.variant === '9ball' && v.fouls[s] ? `<span class="fl">${v.fouls[s] === 2 ? 'on 2 fouls' : '1 foul'}</span>` : '';
      const label = v.variant === '8ball' && !g ? '<span class="gp">open</span>' : '';
      return `<div class="bq-side ${s === turnSide && !v.over ? 'on' : ''} ${v.out[s] ? 'out' : ''}"><span class="nm">${s === turnSide && !v.over ? '▶ ' : ''}${names}</span>${label}<span class="bq-mini">${balls}</span>${fl}</div>`;
    }).join('') + (v.variant === '9ball' ? `<div class="bq-side"><span class="bq-mini">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => cssBall(n, v.balls[n] ? (n === v.lowest ? 'next' : '') : 'gone')).join('')}</span></div>` : '');
  }
  // the ball return: potted balls roll into the tray at the side
  function drawTray(sound) {
    const v = S.v; if (!v) return;
    const down = []; for (let n = 1; n < 16; n++) if (!v.balls[n] && (v.variant !== '9ball' || n <= 9)) down.push(n);
    const key = down.join(',') + '|' + v.rackNo; if (key === S.trayKey) return;
    const before = S.trayKey.split('|')[0].split(',').filter(Boolean).map(Number), fresh = down.filter((n) => !before.includes(n));
    S.trayKey = key;
    tray.innerHTML = down.map((n) => cssBall(n)).join('');
    if (sound && fresh.length) setTimeout(() => hooks.sound?.('return', Math.min(1, 0.4 + fresh.length * 0.2)), 250);
  }
  const CHOICES = {
    illegalBreak: { h: 'Illegal break', p: 'Fewer than four balls reached a cushion and nothing went down.', opts: { play: 'Play the table as it lies', rerack: 'Re-rack and break yourself', rebreak: 'Make them break again' } },
    eightBreak: { h: 'The 8 went down on the break', p: 'You can have it spotted and keep shooting, or re-rack and break again.', opts: { spot: 'Spot the 8 and keep shooting', rerack: 'Re-rack and break again' } },
    eightScratch: { h: 'The 8 and the cue ball went down on the break', p: 'Spot the 8 and take the cue ball in hand behind the head string, or re-rack and break.', opts: { spot: 'Spot the 8, ball in hand behind the line', rerack: 'Re-rack and break' } },
    push: { h: 'Push out', p: 'They pushed. You can shoot from here, or hand the shot back to them.', opts: { take: 'Take the shot', pass: 'Hand it back' } },
  };
  let choiceKey = '';
  function drawChoice() {
    const c = S.v?.choice, mineC = c && mine() && c.seat === S.ctx.seat && !S.play && !S.queue.length;
    const key = mineC ? JSON.stringify(c) : '';
    if (key === choiceKey) return; choiceKey = key;
    choiceEl.hidden = !mineC; if (!mineC) return;
    const d = CHOICES[c.kind] || { h: 'Your call', p: '', opts: {} };
    choiceEl.innerHTML = `<h3>${esc(d.h)}</h3><p>${esc(d.p)}</p>` + c.opts.map((k) => `<button data-k="${k}">${esc(d.opts[k] || k)}</button>`).join('');
    choiceEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { choiceEl.hidden = true; choiceKey = 'sent'; hooks.send({ t: 'choose', k: b.dataset.k }); }));
  }
  function drawCtl() {
    const mineT = myTurn(); ctl.hidden = !mineT;
    const v = S.v;
    safeBtn.hidden = !(mineT && v.variant === '8ball' && !v.breakShot); safeBtn.classList.toggle('on', S.safe);
    pushBtn.hidden = !(mineT && v.pushAvail); pushBtn.classList.toggle('on', S.push);
    placeBtn.hidden = !(mineT && v.inHand); placeBtn.textContent = S.placeLock ? 'Move ball' : 'Place ✓';
    let h = '';
    if (mineT) {
      if (v.inHand && !S.placeLock) h = v.breakShot ? 'Drag the cue ball anywhere behind the head string, then aim' : v.inHand === 'kitchen' ? 'Ball in hand behind the head string: drag it, then aim' : 'Ball in hand: drag the cue ball anywhere, then aim';
      else if (v.needCall) { const c = currentCall(); h = c && c.p >= 0 ? `Calling the ${c.b} in the ${POCKET_LABEL[c.p]} · tap a pocket to change` : 'Aim at one of your balls to call it, or tap a pocket'; }
      else if (v.breakShot) h = 'The break: pull back from the cue ball, or set power and Shoot';
      else h = coarse ? 'Drag to aim · pull back from the cue ball to shoot' : 'Click to aim · pull back from the cue ball, or Shoot (← → fine aim, space shoots)';
      if (S.safe) h = 'Safety: the turn ends whatever goes in';
      if (S.push) h = 'Push out: any shot; then they choose who shoots';
    } else if (v.choice && !(mine() && v.choice.seat === S.ctx.seat)) h = `${hooks.seatName?.(v.choice.seat) || 'They'} ${v.choice.kind === 'push' ? 'decide whether to take the push' : 'decide what to do'}`;
    hint.hidden = !h; if (h) hint.textContent = h;
    const dx = S.ox / 0.62, dy = S.oy / 0.62;
    spinBtnDot.style.left = `${50 + dx * 42}%`; spinBtnDot.style.top = `${50 - dy * 42}%`;
    if (document.activeElement !== pow) pow.value = Math.round(S.power * 100);
  }
  function drawSpinPop() {
    const dx = S.ox / 0.62, dy = S.oy / 0.62;
    dialDot.style.left = `${50 + dx * 46}%`; dialDot.style.top = `${50 - dy * 46}%`;
    const off = Math.hypot(S.ox, S.oy), parts = [];
    if (S.oy > 0.05) parts.push(`follow ${Math.round((S.oy / 0.5) * 100)}%`); else if (S.oy < -0.05) parts.push(`draw ${Math.round((-S.oy / 0.5) * 100)}%`);
    if (S.ox > 0.05) parts.push(`right english ${Math.round((S.ox / 0.5) * 100)}%`); else if (S.ox < -0.05) parts.push(`left english ${Math.round((-S.ox / 0.5) * 100)}%`);
    spinVal.textContent = parts.length ? parts.join(', ') : 'Center ball';
    spinWarn.textContent = off > 0.5 ? 'Past half a radius: this will miscue' : off > 0.42 ? 'Near the edge: careful' : '';
    elVal.textContent = `${Math.round((S.el * 180) / Math.PI)}°${S.el > 0.6 ? ' (massé)' : ''}`;
  }

  // ---- pointer input -----------------------------------------------------------------------------------------------------------------------------------------
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const ray = new T.Raycaster(), ndc = new T.Vector2(), plane = new T.Plane(new T.Vector3(0, 1, 0), -R), hit = new T.Vector3();
  function worldAt(e) {
    const r = screenRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    plane.constant = -R; ray.setFromCamera(ndc, cam); if (!ray.ray.intersectPlane(plane, hit)) return null; return { x: hit.x, y: -hit.z };
  }
  function toScreen(x, y) { const r = screenRect(), p = W(x, y, R).project(cam); return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }
  function aimTo(p) { const cp = cuePos(); if (!cp || !p) return; const dx = p.x - cp.x, dy = p.y - cp.y; if (Math.hypot(dx, dy) > R * 0.5) S.angle = Math.atan2(dy, dx); }
  function shoot() {
    if (!myTurn()) return;
    const mv = { t: 'shot', a: Math.round(S.angle * 1e4) / 1e4, p: Math.round(clamp(S.power, 0.04, 1) * 1e3) / 1e3, ox: S.ox, oy: S.oy, el: Math.round(S.el * 1e3) / 1e3 };
    if (S.v.inHand) { const c = S.cue || cuePos(); if (!c || !validSpot(c.x, c.y)) { showBanner('Place the cue ball on a free spot first', 'foul'); return; } mv.cx = Math.round(c.x * 1e5) / 1e5; mv.cy = Math.round(c.y * 1e5) / 1e5; }
    if (S.safe) mv.safe = true;
    if (S.push) mv.push = true;
    if (S.v.needCall && !S.safe) { const c = currentCall(); if (!c || c.p < 0) { showBanner('Call a ball and a pocket', 'foul', 'aim at one of your balls, or tap a pocket'); return; } mv.call = c; }
    S.pending = true; setTimeout(() => { S.pending = false; }, 5000); hooks.send(mv);
  }
  // the call: tap a pocket to call it; double-tap one of your balls to call that ball (a combination or a kiss)
  function pocketUnder(e) {
    if (!S.v?.needCall) return -1;
    const pk = S.geo.pockets.map((p, k) => { const s = toScreen(p.x, p.y); return { k, d: Math.hypot(s.x - e.clientX, s.y - e.clientY) }; }).sort((a, b) => a.d - b.d)[0];
    return pk && pk.d < (coarse ? 34 : 24) ? pk.k : -1;
  }
  let lastTap = { t: 0, b: -1 };
  function tapBall(e) {
    if (!S.v?.needCall) return;
    const bl = (S.v.wanted || []).map((b) => { const p = S.v.balls[b]; if (!p) return null; const s = toScreen(p.x, p.y); return { b, d: Math.hypot(s.x - e.clientX, s.y - e.clientY) }; }).filter(Boolean).sort((a, b) => a.d - b.d)[0];
    if (!bl || bl.d > (coarse ? 22 : 14)) return;
    const now = performance.now();
    if (lastTap.b === bl.b && now - lastTap.t < 450) { S.callB = bl.b; if (S.callP == null && S.autoCall?.p >= 0) S.callP = S.autoCall.p; hooks.sound?.('tick', 0.4); showBanner(`Calling the ${bl.b}`, 'good', 'tap a pocket for it'); }
    lastTap = { t: now, b: bl.b };
  }
  const ptrs = new Map(); let orbiting = null, pinch = 0, downAt = null;
  const orbitBy = (dx, dy) => { S.yaw -= dx * 0.006; S.pitch = clamp(S.pitch + dy * 0.005, -1.2, 0.6); };
  const pinchDist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture?.(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); pop.hidden = true;
    if (ptrs.size === 2) { S.dragging = S.dragBall = false; S.pulling = null; orbiting = 'pair'; pinch = pinchDist(); return; }
    if (e.button === 2 || !myTurn()) { orbiting = 'one'; return; }
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    const p = worldAt(e); if (!p) return;
    const cp = cuePos(); const cs = cp && toScreen(cp.x, cp.y), near = cs && Math.hypot(cs.x - e.clientX, cs.y - e.clientY) < Math.max(coarse ? 34 : 22, 0);
    if (S.v.inHand && !S.placeLock && cp && (near || Math.hypot(p.x - cp.x, p.y - cp.y) < R * 2.5)) { S.dragBall = true; if (!S.cue) S.cue = { ...cp }; return; }
    if (near) { S.pulling = { sx: cs.x, sy: cs.y, pow: 0 }; return; }
    const pk = pocketUnder(e);
    if (pk >= 0) { S.tapPocket = pk; S.dragging = true; return; } // a tap here calls the pocket; a drag still aims
    S.dragging = true; aimTo(p);
  });
  el.addEventListener('pointermove', (e) => {
    const prev = ptrs.get(e.pointerId); if (prev) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (orbiting === 'pair' && ptrs.size === 2 && prev) {
      const d = pinchDist(); if (pinch > 0 && d > 0) S.zoom = clamp(S.zoom * (pinch / d), 0.3, 1.6); pinch = d;
      orbitBy((e.clientX - prev.x) / 2, (e.clientY - prev.y) / 2); return;
    }
    if (orbiting === 'one' && prev) { orbitBy(e.clientX - prev.x, e.clientY - prev.y); return; }
    if (!myTurn() || !prev) return;
    if (S.pulling) { // pulling back from the cue ball: aim through the ball, away from the finger, and the pull sets the power
      const P = S.pulling, dx = e.clientX - P.sx, dy = e.clientY - P.sy, len = Math.hypot(dx, dy), r = screenRect(), max = Math.min(r.width, r.height) * 0.36;
      P.pow = clamp(len / max, 0, 1);
      if (len > 14) { const p = worldAt(e), cp = cuePos(); if (p && cp) S.angle = Math.atan2(cp.y - p.y, cp.x - p.x); }
      S.power = Math.max(0.04, P.pow); return;
    }
    const p = worldAt(e); if (!p) return;
    if (S.dragBall) { if (validSpot(p.x, p.y)) S.cue = { x: p.x, y: p.y }; else { const g = S.geo; const cx = clamp(p.x, -g.halfX, S.v.inHand === 'kitchen' ? g.headX : g.halfX), cy = clamp(p.y, -g.halfY, g.halfY); S.cue = { x: cx, y: cy }; } drawRest(); }
    else if (S.dragging) { if (S.tapPocket != null && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 8) return; S.tapPocket = null; aimTo(p); }
  });
  const up = (e) => {
    ptrs.delete(e.pointerId); if (ptrs.size < 2 && orbiting === 'pair') orbiting = null; if (!ptrs.size) orbiting = null;
    if (S.pulling) { const pw = S.pulling.pow; S.pulling = null; if (pw >= 0.05) { S.power = pw; shoot(); } }
    else if (S.dragging && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 8) {
      if (S.tapPocket != null) { S.callP = S.tapPocket; hooks.sound?.('tick', 0.4); } else tapBall(e);
    }
    S.tapPocket = null;
    if (S.dragBall && S.cue && !validSpot(S.cue.x, S.cue.y)) { const b = S.v.balls[0]; S.cue = b && validSpot(b.x, b.y) ? { ...b } : S.cue; }
    S.dragging = S.dragBall = false; downAt = null;
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => { e.preventDefault(); if (e.shiftKey && myTurn()) S.angle += Math.sign(e.deltaY || e.deltaX) * 0.0025; else S.zoom = clamp(S.zoom * Math.exp(Math.sign(e.deltaY) * 0.08), 0.3, 1.6); }, { passive: false });
  const onKey = (e) => {
    if (!myTurn() || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '') && document.activeElement !== pow) return;
    const f = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowLeft') { S.angle += 0.0015 * f; e.preventDefault(); } else if (e.key === 'ArrowRight') { S.angle -= 0.0015 * f; e.preventDefault(); }
    else if (e.key === 'ArrowUp') { S.power = clamp(S.power + 0.02 * f, 0.04, 1); e.preventDefault(); } else if (e.key === 'ArrowDown') { S.power = clamp(S.power - 0.02 * f, 0.04, 1); e.preventDefault(); }
    else if (e.key === ' ' && document.activeElement?.tagName !== 'BUTTON') { shoot(); e.preventDefault(); }
  };
  window.addEventListener('keydown', onKey);
  pow.addEventListener('input', () => { S.power = clamp(pow.value / 100, 0.04, 1); });
  // the spin dial: tap where the tip meets the cue ball; the cue's elevation under it
  // (the dial is inside the zoomed stage: read the pointer in the dial's own units, offsetX over offsetWidth, not page pixels)
  const spinAt = (e) => { if (e.target !== dial) return; let x = (e.offsetX / dial.offsetWidth - 0.5) * 2, y = -(e.offsetY / dial.offsetHeight - 0.5) * 2; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } x /= 0.92; y /= 0.92; const L = Math.hypot(x, y); if (L > 1) { x /= L; y /= L; } S.ox = Math.round(x * 0.62 * 100) / 100; S.oy = Math.round(y * 0.62 * 100) / 100; drawSpinPop(); };
  let spinDown = false;
  dial.addEventListener('pointerdown', (e) => { spinDown = true; dial.setPointerCapture?.(e.pointerId); spinAt(e); e.stopPropagation(); });
  dial.addEventListener('pointermove', (e) => { if (spinDown) spinAt(e); });
  dial.addEventListener('pointerup', () => { spinDown = false; });
  spinBtn.addEventListener('click', () => { pop.hidden = !pop.hidden; drawSpinPop(); });
  $('.bq-spinreset').addEventListener('click', () => { S.ox = S.oy = 0; S.el = 0.05; elIn.value = 3; drawSpinPop(); });
  $('.bq-spinok').addEventListener('click', () => { pop.hidden = true; });
  elIn.addEventListener('input', () => { S.el = (Number(elIn.value) * Math.PI) / 180; drawSpinPop(); });
  safeBtn.addEventListener('click', () => { S.safe = !S.safe; if (S.safe) S.push = false; });
  pushBtn.addEventListener('click', () => { S.push = !S.push; if (S.push) S.safe = false; });
  placeBtn.addEventListener('click', () => { const c = S.cue || cuePos(); if (!S.placeLock && (!c || !validSpot(c.x, c.y))) { showBanner('That spot is not free', 'foul'); return; } S.placeLock = !S.placeLock; });
  const camLabel = () => (S.camMode === 'table' ? 'Camera: table' : S.camMode === 'top' ? 'Camera: top' : 'Camera: cue');
  viewBtn.addEventListener('click', () => { S.camMode = S.camMode === 'table' ? 'top' : S.camMode === 'top' ? 'cue' : 'table'; S.yaw = S.pitch = 0; S.zoom = 1; viewBtn.textContent = camLabel(); fitKey = ''; });
  viewBtn.textContent = camLabel();
  goBtn.addEventListener('click', shoot);

  // ---- the loop -------------------------------------------------------------------------------------------------------------------------------------------------------
  let building = false;
  function loop(now) {
    if (S.gone) return; S.raf = requestAnimationFrame(loop);
    if (!root.isConnected) { api.dispose(); return; }
    const dt = Math.min(0.1, (now - (S.last || now)) / 1000); S.last = now;
    resize();
    if (S.built) {
      if (!S.play && S.queue.length) { S.pending = false; startPlay(S.queue.shift()); }
      if (S.play) stepPlay(dt); else { drawRest(); placeCue(0); aimGuide(); }
      drawCtl(); drawTop(); drawTray(false); drawChoice(); updateCamera(dt, false);
    }
    renderer.render(scene, cam);
  }
  async function rebuild(view) { if (building) return; building = true; try { await buildTable(view.geo); } finally { building = false; } fitKey = ''; }

  const api = {
    update(view, ctx) {
      S.v = view; S.ctx = ctx;
      const th = JSON.stringify(theme());
      if (!S.built || th !== S.themeKey) rebuild(view);
      const sh = view.shot, key = sh ? sh.n : 0; // (a re-rack keeps the last shot in the view: it is not played again)
      if (S.seen === undefined) { S.seen = key; if (view.balls[0]) { const t = view.balls.find((b, i) => b && i > 0); if (t) S.angle = Math.atan2(t.y - view.balls[0].y, t.x - view.balls[0].x); } }
      else if (key !== S.seen) { S.seen = key; if (sh) S.queue.push(sh); }
      if (!S.play && !S.queue.length) { S.pending = false; if (!view.inHand) S.cue = null; }
      if (view.inHand && !S.cue && view.turn === ctx.seat) S.cue = view.breakShot ? { x: view.geo.headX - R * 2, y: 0 } : (view.balls[0] && validSpot(view.balls[0].x, view.balls[0].y) ? { ...view.balls[0] } : { x: view.geo.headX - R * 3, y: 0 });
      if (view.over && !S.queue.length && !S.play) showBanner(view.winners?.length ? `${view.winners.map((s) => hooks.seatName?.(s) || `Seat ${s + 1}`).join(' & ')} win${view.winners.length > 1 || view.winners.map((s) => hooks.seatName?.(s)).includes('You') ? '' : 's'}` : 'Game over', 'gold', view.note);
      if (view.turn !== S.lastTurn) {
        S.lastTurn = view.turn; S.safe = S.push = false; S.callB = S.callP = null; S.placeLock = false; S.ox = S.oy = 0; S.el = 0.05; elIn.value = 3;
        if (view.turn === ctx.seat && !S.play && !S.queue.length) autoAim();
      }
      if (view.breakShot && view.turn === ctx.seat) { const apex = view.balls.find((b, i) => b && i > 0 && Math.abs(b.y) < 0.01 && Math.abs(b.x - view.geo.footX) < R * 1.5); const c = S.cue || view.balls[0]; if (apex && c && S.lastBreakAim !== view.rackNo) { S.lastBreakAim = view.rackNo; S.angle = Math.atan2(apex.y - c.y, apex.x - c.x); S.power = 0.9; } }
    },
    dispose() { S.gone = true; cancelAnimationFrame(S.raf); window.removeEventListener('keydown', onKey); renderer.dispose(); root.remove(); },
  };
  if (typeof window !== 'undefined' && window.__bqDebug) { // test hooks: the camera, the state, the cue stick, a render-now, and a straight-down probe of the table
    S.cam = cam; window.__bqS = S; S.cueObj = cue; S.render = () => renderer.render(scene, cam); S.glEl = el; S.shoot = shoot; S.toScreen = toScreen; S.myTurn = myTurn;
    S.probe = (x, y) => { const h = new T.Raycaster(new T.Vector3(x, 2, -y), new T.Vector3(0, -1, 0)).intersectObjects(tableGroup.children, false)[0]; return h ? h.point.y : null; };
  }
  S.raf = requestAnimationFrame(loop);
  return api;
}
