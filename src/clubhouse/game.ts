// Clubhouse integration (phattbeats/clubhouse-billiards): Nine-Ball as a Clubhouse table game. The server rolls every shot
// with tailuge/billiards' physics (engine.ts) and sends the replay, so every screen sees the same shot. GPL-3.0.
// Rules: rotation. The cue ball must hit the lowest numbered ball first, and then a ball must be pocketed or reach a cushion.
// Any foul (scratch, wrong first ball, no ball hit, no cushion) gives the next player the cue ball in hand. Pocket a ball
// legally and you shoot again. Pocket the 9 on a legal shot and you win; on a foul it goes back on the foot spot.
import { rack, simulate, summarise, geometry, aimAt, pocketSpots, N, type Spot, type Replay } from "./engine"

const MAX_SHOTS_PER_SEAT = 45
const geo = geometry()
const { R, halfX, halfY } = geo
const FOOT = rack(() => 0.5)[1] as { x: number; y: number }

function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const r5 = (v: number) => Math.round(v * 1e5) / 1e5
const lowestOn = (balls: Spot[]) => { for (let i = 1; i < N; i++) if (balls[i]) return i; return 0 }
const free = (balls: Spot[], x: number, y: number, skip = 0) => balls.every((b, i) => !b || i === skip || Math.hypot(b.x - x, b.y - y) >= 2 * R * 1.001)
const inBounds = (x: number, y: number) => Math.abs(x) <= halfX - R * 0.2 && Math.abs(y) <= halfY - R * 0.2

function init({ seats, seed }: { seats: number; seed: number }) {
  const rnd = mulberry(seed)
  return {
    rng: seed >>> 0, n: seats, balls: rack(rnd), turn: 0, inHand: true, breakShot: true, seq: 0, shots: 0,
    potted: Array.from({ length: seats }, () => [] as number[]), shot: null as any, over: false, winners: [] as number[], flags: {} as Record<string, any>,
    note: "", foulSeat: -1,
  }
}
type State = ReturnType<typeof init>

function addFlag(st: State, k: string, s: number) {
  const f = st.flags[k]
  st.flags[k] = Array.isArray(f) ? (f.includes(s) ? f : [...f, s]) : [s]
}

function apply(st: State, seat: number, mv: any): string | undefined {
  if (st.over) return "game over"
  if (!mv || mv.t !== "shot") return "bad move"
  if (seat !== st.turn) return "not your turn"
  const { a, p } = mv, ox = mv.ox ?? 0, oy = mv.oy ?? 0
  if (![a, p, ox, oy].every(Number.isFinite)) return "bad shot"
  if (p < 0.02 || p > 1) return "bad power"
  if (Math.hypot(ox, oy) > 0.5) return "bad spin"
  const balls: Spot[] = st.balls.map((b) => (b ? { ...b } : null))
  if (st.inHand) {
    const { cx, cy } = mv
    if (![cx, cy].every(Number.isFinite)) return "place the cue ball"
    if (!inBounds(cx, cy)) return "off the table"
    if (st.breakShot && cx > -halfX / 2) return "break from behind the head string"
    if (!free(balls, cx, cy, 0)) return "ball in the way"
    balls[0] = { x: cx, y: cy }
  } else if (!balls[0]) return "no cue ball"
  const ang = Math.atan2(Math.sin(a), Math.cos(a))
  const lowest = lowestOn(balls)
  const rep: Replay = simulate(balls, { a: ang, p, ox, oy })
  const sum = summarise(rep)
  st.seq++; st.shots++
  const pots = sum.potted.filter((i) => i > 0)
  let foul: string | null = null
  if (sum.potted.includes(0)) foul = "Scratch"
  else if (sum.firstHit < 0) foul = "No ball hit"
  else if (sum.firstHit !== lowest) foul = `Hit the ${sum.firstHit} before the ${lowest}`
  else if (!pots.length && !sum.railAfter) foul = "No ball reached a cushion"
  st.balls = rep.rest
  let respot = false, win = false
  if (pots.includes(9)) {
    if (foul) {
      respot = true
      let x = FOOT.x
      while (!free(st.balls, x, FOOT.y, 9) && x < halfX) x += R * 0.5
      st.balls[9] = { x: r5(x), y: r5(FOOT.y) }
    } else win = true
  }
  const kept = pots.filter((i) => !(i === 9 && respot))
  st.potted[seat].push(...kept)
  st.shot = { n: st.seq, seat, a: Math.round(ang * 1e4) / 1e4, p, ox, oy, from: balls.map((b) => b && { x: r5(b.x), y: r5(b.y) }), dt: rep.dt, frames: rep.frames, events: rep.events, dur: rep.dur, foul, potted: kept, respot, win, lowest }
  st.note = foul ? `${foul}${respot ? " (9 ball spotted)" : ""}` : win ? "Nine ball" : pots.length ? "Pocketed" : "Missed"
  st.foulSeat = foul ? seat : -1
  if (win) {
    st.over = true; st.winners = [seat]; addFlag(st, "nineball", seat)
    if (st.breakShot) addFlag(st, "golden", seat)
  } else if (st.shots >= MAX_SHOTS_PER_SEAT * st.n) {
    st.over = true
    const best = Math.max(...st.potted.map((x) => x.length))
    st.winners = st.potted.map((x, s) => (x.length === best ? s : -1)).filter((s) => s >= 0)
  } else if (foul) { st.turn = (seat + 1) % st.n; st.inHand = true } else if (pots.length) { st.inHand = false } else { st.turn = (seat + 1) % st.n; st.inHand = false }
  st.breakShot = false
  return undefined
}

// ---- bots (tailuge's ghost-ball AimCalculator picks the line; the real physics scores the options) -----------------------
function bot(st: State, seat: number, opts?: { level?: string; style?: { risk?: number } }) {
  if (st.over || st.turn !== seat) return null
  const easy = opts?.level === "easy", risk = opts?.style?.risk ?? 0.5
  const rnd = (k: number) => hash((st.rng ^ Math.imul(st.seq + 1, 2654435761)) >>> 0, k + seat * 131)
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4
  if (st.breakShot) return { t: "shot", cx: r5(-halfX / 2 - R), cy: r5((rnd(1) - 0.5) * R * 2), a: r4((rnd(2) - 0.5) * 0.02), p: 1, ox: 0, oy: 0 }
  const lowest = lowestOn(st.balls), target = st.balls[lowest]!
  let cue = st.balls[0]
  let place: { cx: number; cy: number } | null = null
  if (st.inHand) {
    // stand a few diameters behind the target, on the line from the nearest pocket through it
    const pk = pocketSpots().sort((p1, p2) => Math.hypot(p1.x - target.x, p1.y - target.y) - Math.hypot(p2.x - target.x, p2.y - target.y))
    const spots: { x: number; y: number }[] = []
    for (const q of pk.slice(0, 3)) {
      const dx = target.x - q.x, dy = target.y - q.y, d = Math.hypot(dx, dy) || 1
      for (const back of [0.45, 0.7, 0.3]) spots.push({ x: target.x + (dx / d) * back, y: target.y + (dy / d) * back })
    }
    for (let k = 0; k < 6; k++) spots.push({ x: (rnd(10 + k) - 0.5) * halfX * 1.8, y: (rnd(20 + k) - 0.5) * halfY * 1.6 })
    const ok = spots.find((s) => inBounds(s.x, s.y) && free(st.balls, s.x, s.y, 0))
    const s = ok || { x: -halfX / 2, y: 0 }
    place = { cx: r5(s.x), cy: r5(s.y) }
    cue = { x: s.x, y: s.y }
  }
  if (!cue) return null
  const base = aimAt(cue, target)
  const tries: { a: number; p: number; oy: number }[] = []
  const powers = easy ? [0.45] : [0.3, 0.45, 0.62, 0.8]
  for (const pw of powers) for (const da of easy ? [0] : [0, 0.012, -0.012]) tries.push({ a: base + da, p: pw + (risk - 0.5) * 0.1, oy: 0 })
  const spots = st.balls.map((b) => (b ? { ...b } : null))
  if (place) spots[0] = { x: cue.x, y: cue.y }
  let best = tries[0], bestScore = -Infinity
  for (const c of tries.slice(0, easy ? 1 : 9)) {
    const rep = simulate(spots, { a: c.a, p: Math.max(0.05, Math.min(1, c.p)), ox: 0, oy: c.oy })
    const sm = summarise(rep)
    const pots = sm.potted.filter((i) => i > 0)
    let sc = rnd(30 + tries.indexOf(c)) * 2
    if (sm.firstHit !== lowest) sc -= 200
    if (sm.potted.includes(0)) sc -= 300
    if (!pots.length && !sm.railAfter) sc -= 150
    if (pots.length && sm.firstHit === lowest && !sm.potted.includes(0)) sc += 100 * pots.length + (pots.includes(9) ? 500 : 0)
    if (sc > bestScore) { bestScore = sc; best = c }
  }
  const err = easy ? 0.03 : 0.004
  const a = best.a + (rnd(3) - 0.5) * 2 * err
  return { t: "shot", ...(place || {}), a: r4(a), p: r4(Math.max(0.05, Math.min(1, best.p))), ox: 0, oy: best.oy }
}

const think = () => 1600
// the table waits for the last shot to finish rolling before a bot steps up
const settle = (st: State) => (st.shot ? Math.round((Math.min(st.shot.dur, 14) / 1.3) * 1000) + 700 : 0)

function view(st: State) {
  return {
    geo, balls: st.balls.map((b) => b && { x: r5(b.x), y: r5(b.y) }), turn: st.over ? null : st.turn, inHand: st.inHand, breakShot: st.breakShot,
    lowest: lowestOn(st.balls), potted: st.potted.map((x) => x.slice()), shot: st.shot, over: st.over, winners: st.winners.slice(), note: st.note, flags: st.flags || {},
  }
}

function info(st: State) {
  const scores = st.potted.map((x) => `${x.length} ball${x.length === 1 ? "" : "s"}`)
  if (st.over) {
    const w = st.winners
    const message = w.length === 1 ? `Seat ${w[0] + 1} wins${st.balls[9] ? "" : " on the nine"}` : `Tie between seats ${w.map((s) => s + 1).join(", ")}`
    return { turn: null, over: true, winners: w, message, scores }
  }
  const lowest = lowestOn(st.balls)
  return { turn: st.turn, over: false, winners: [], scores, message: `Seat ${st.turn + 1} to shoot · ${st.breakShot ? "break" : `lowest ball is the ${lowest}`}${st.inHand && !st.breakShot ? " · cue ball in hand" : ""}` }
}

export default {
  id: "billiards", name: "Billiards", category: "sports", tagline: "Nine-ball in 3D. Real spin, real cushions, real pockets.",
  min: 1, max: 4, defaultSeats: 2, init, view, apply, bot, info, think, settle, testTrials: 1,
}
