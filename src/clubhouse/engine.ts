// Clubhouse integration (phattbeats/clubhouse-billiards): a headless wrapper around tailuge/billiards' physics so the
// Clubhouse server can roll every shot and send clients the replay. GPL-3.0, like the rest of this repository.
//
// The table is a WPA 9-foot table (100 x 50 in playing surface) with 2 1/4 in, 6 oz balls. tailuge supplies the cloth (Han
// sliding/rolling/spin-down), the ball-ball collision with cut- and spin-induced throw (Alciatore TP A-14), the cushions
// (Han 2005 blended with Mathavan, nose above the ball's centre), the jaw knuckles and the fall into the pocket. This file adds
// what the upstream engine only draws: squirt (the cue ball pushed off line by side spin), the miscue zone, the cue elevation that
// makes side spin swerve, the 8-ball/9-ball/Cutthroat racks, a compact replay that carries each ball's spin, and one shot report
// (first contact, cushions, pots with their pocket, banks, combos, kicks) that the rules, bots, banners and achievements all read.
import { Vector3 } from "three"
import { Ball, State } from "../model/ball"
import { Table } from "../model/table"
import { OutcomeType, Outcome } from "../model/outcome"
import { cueStrike } from "../model/physics/physics"
import { R as R0, setR, setm, setmu, setrho, setmuS } from "../model/physics/constants"
import * as K from "../model/physics/constants"
import { TableConfig } from "../view/tableconfig"
import { TableGeometry } from "../view/tablegeometry"
import { PocketGeometry } from "../view/pocketgeometry"

// ---- the table (WPA): 2 1/4 in balls of 6 oz on a 9-foot table, Alciatore's typical cloth -------------------------------------
const INCH = 0.0254
export const BALL_R = (2.25 * INCH) / 2 // 0.028575 m
setR(BALL_R)
setm(0.17)
TableConfig.apply("eightball", (10 * (50 * INCH - BALL_R)) / (BALL_R * 43)) // ball centres stop R short of the 50 in long half
TableGeometry.tableY = (25 * INCH) - BALL_R; TableGeometry.Y = TableGeometry.tableY + BALL_R // (upstream's 43:21 is 2% too wide: WPA is 2:1)
PocketGeometry.scaleToRadius(BALL_R)
setmu(0.01) // rolling resistance (Alciatore: 0.005-0.015)
setmuS(0.2) // sliding friction (Alciatore: 0.15-0.4, 0.2 typical)
setrho(0.045 * (0.03275 / BALL_R)) // spin-down: keep tailuge's ~10 rad/s^2 decay at the smaller ball
void R0

export const R = BALL_R
const STEP = 1 / 512
const MAX_SECONDS = 45
export const MAX_SPEED = 7.2 // m/s at full power: a hard stroke
export const BREAK_SPEED = 9.5 // m/s at full power on the break (about 21 mph, a strong amateur break)
export const MISCUE = 0.5 // tip offset past half the ball's radius from centre is a miscue
const END_MASS_RATIO = 0.17 / 0.0115 // ball mass over the cue's effective end mass (a standard maple shaft): sets squirt

export type Spot = { x: number; y: number } | null // null = off the table (potted)
export interface Shot {
  a: number // aim angle, radians (0 = +x, the foot of the table)
  p: number // power 0..1
  ox?: number // tip offset across the ball, fraction of R, + = right english
  oy?: number // tip offset up the ball, fraction of R, + = follow, - = draw
  el?: number // cue elevation, radians (raises the butt: side spin then swerves, a lot of it is a masse)
  brk?: boolean // the break: more power is available
}
export interface ShotEvent { t: number; k: "hit" | "cush" | "jaw" | "pot"; a: number; b?: number; v?: number; c?: string; p?: number; x?: number; y?: number }
// tracks[ball] = segments; a segment is [firstFrame, frameCount, then per frame: x, y, z (mm), wx, wy, wz (rad/s)]
export interface Replay { dt: number; nf: number; tracks: number[][][]; events: ShotEvent[]; dur: number; rest: Spot[]; miscue: boolean; a: number }

const L = TableGeometry.tableX + R // half length of the playing surface (cushion nose to nose)
const Wd = TableGeometry.tableY + R
export const POCKET_NAMES = ["top-left corner", "bottom-left corner", "top side", "bottom side", "top-right corner", "bottom-right corner"]

export const geometry = () => ({
  R,
  halfX: TableGeometry.tableX, // ball centre limits
  halfY: TableGeometry.tableY,
  L, W: Wd, // the playing surface, nose to nose
  headX: -L / 2, // the head string (break from behind it)
  footX: L / 2, // the foot spot
  pockets: PocketGeometry.pocketCenters.map((p, i) => ({ x: p.pos.x, y: p.pos.y, r: p.radius, id: i, side: i === 2 || i === 3 })),
  knuckles: PocketGeometry.knuckles.map((k) => ({ x: k.pos.x, y: k.pos.y, r: k.radius })),
  maxSpeed: MAX_SPEED, breakSpeed: BREAK_SPEED, miscue: MISCUE,
})

const mm = (v: number) => Math.round(v * 1000)

// ---- racks --------------------------------------------------------------------------------------------------------------------
// Triangle positions, apex on the foot spot, rows running toward the foot rail: row r has r+1 balls.
function trianglePositions(rows: number, rnd: () => number) {
  const noise = R * 0.02 + 0.0004 // a tight rack: a few tenths of a millimetre of air
  const gap = 2 * R + noise
  const out: { x: number; y: number }[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c <= r; c++) {
    const x = L / 2 + r * gap * Math.sqrt(3) / 2, y = (c - r / 2) * gap
    out.push({ x: x + noise * 0.5 * (rnd() - 0.5), y: y + noise * 0.5 * (rnd() - 0.5) })
  }
  return out
}
function shuffled<T>(arr: T[], rnd: () => number) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
const HEAD_SPOT = { x: -L / 2 - R * 2, y: 0 }

// index = ball number (0 = cue ball). 8-ball: 8 in the middle of the third row, a solid and a stripe in the back corners.
export function rack(variant: string, rnd: () => number): Spot[] {
  const out: Spot[] = Array(16).fill(null)
  out[0] = { ...HEAD_SPOT }
  if (variant === "9ball") {
    // the diamond: rows of 1, 2, 3, 2, 1. 1 on the foot spot, 9 in the middle
    const tri = trianglePositions(5, rnd)
    const pos = [tri[0], tri[1], tri[2], tri[3], tri[4], tri[5], tri[7], tri[8], tri[12]]
    const rest = shuffled([2, 3, 4, 5, 6, 7, 8], rnd)
    out[1] = pos[0]; out[9] = pos[4]
    for (const i of [1, 2, 3, 5, 6, 7, 8]) out[rest.pop()!] = pos[i]
    return out
  }
  const tri = trianglePositions(5, rnd)
  if (variant === "cutthroat") {
    out[1] = tri[0]; out[6] = tri[10]; out[11] = tri[14]
    const rest = shuffled([2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 15], rnd)
    for (let i = 1; i < 15; i++) if (i !== 10 && i !== 14) out[rest.pop()!] = tri[i]
    return out
  }
  out[8] = tri[4]
  const solid = 1 + Math.floor(rnd() * 7), stripe = 9 + Math.floor(rnd() * 7)
  const flip = rnd() < 0.5
  out[flip ? solid : stripe] = tri[10]; out[flip ? stripe : solid] = tri[14]
  const rest = shuffled([1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15].filter((b) => b !== solid && b !== stripe), rnd)
  for (let i = 0; i < 15; i++) if (i !== 4 && i !== 10 && i !== 14) out[rest.pop()!] = tri[i]
  return out
}

function build(spots: Spot[]): Table {
  Ball.id = 0 // (upstream numbers every Ball ever made; the pocket's resting depth reads it, so start every shot from zero)
  const balls = spots.map((s, i) => {
    const b = new Ball(new Vector3(s ? s.x : 0, s ? s.y : 0, 0), 0xffffff, i)
    if (!s) b.state = State.InPocket
    return b
  })
  const table = new Table(balls)
  // Upstream checks all 120 pairs every step. A pair where neither ball moves can never collide (Collision.willCollide says so
  // first), so skip those without calling into it: the same pairs in the same order, so the same results, four times faster.
  const anyTable = table as any
  anyTable.prepareAdvanceAll = function (t: number) {
    const bs: Ball[] = this.balls, n = bs.length, mv: boolean[] = new Array(n)
    for (let i = 0; i < n; i++) mv[i] = bs[i].inMotion()
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if ((mv[i] || mv[j]) && !this.prepareAdvancePair(bs[i], bs[j], t)) return false
    }
    for (let i = 0; i < n; i++) if (!this.prepareAdvanceToCushions(bs[i], t)) return false
    return true
  }
  return table
}

// Squirt (Alciatore TP A-31): side spin pushes the cue ball off the aim line, away from the side struck.
export function squirt(ox: number) {
  const b = Math.max(-0.6, Math.min(0.6, ox)), c = Math.sqrt(1 - b * b)
  return Math.atan((2.5 * b * c) / (1 + END_MASS_RATIO + 2.5 * c * c)) // right english (ox > 0) -> the ball leaves left of the line (+angle)
}

// How the tip meets the ball: the launch angle, speed and spin. Past MISCUE the tip slides off: a feeble, skewed hit.
export function strike(shot: Shot) {
  let ox = shot.ox ?? 0, oy = shot.oy ?? 0
  const off = Math.hypot(ox, oy), miscue = off > MISCUE
  const top = shot.brk ? BREAK_SPEED : MAX_SPEED
  let speed = Math.max(0.02, Math.min(1, shot.p)) * top
  let a = shot.a + squirt(ox)
  if (miscue) { speed *= 0.22; a += Math.sign(ox || 1) * 0.18; ox *= 0.3; oy *= 0.3 }
  const el = Math.max(0, Math.min(1.2, shot.el ?? 0))
  // tailuge's cueStrike takes the offset as a fraction of R (its +x is the ball's LEFT side) and a speed in m/s, and loses a
  // little speed off-centre
  const s = cueStrike(a, speed, new Vector3(-ox, oy, 0), el)
  return { vel: s.vel, rvel: s.rvel, miscue, a }
}

// The engine throws ("Depth exceeded resolving collisions") when a pile-up never settles, and prints a long diagnostic first. It is
// rare; the same shot a hair to one side does not do it. So: roll quietly, and on a throw nudge the angle and power by a hair and
// roll again (the replay carries the shot that was actually rolled).
export function simulate(spots: Spot[], shot: Shot, fps = 30, quick = false): Replay {
  const { log, warn, error } = console
  console.log = console.warn = console.error = () => {}
  try {
    for (let k = 0; ; k++) {
      try {
        return roll(spots, k ? { ...shot, a: shot.a + 0.0007 * k, p: shot.p * (1 - 0.001 * k) } : shot, fps, quick)
      } catch (e) {
        if (k >= 5) throw e
      }
    }
  } finally {
    console.log = log; console.warn = warn; console.error = error
  }
}

// quick (bots only): once every moving ball is rolling slowly, stop and slide each one straight out to where rolling resistance
// would stop it (into a pocket if that is where it ends). Good enough to judge a shot; real shots always roll to the end.
const QUICK_V = 0.35
function roll(spots: Spot[], shot: Shot, fps: number, quick = false): Replay {
  const table = build(spots)
  const cue = table.cueball
  const st = strike(shot)
  cue.state = State.Sliding
  cue.vel.copy(st.vel)
  cue.rvel.copy(st.rvel)
  table.time = 0
  const dt = 1 / fps, every = Math.max(1, Math.round(dt / STEP))
  const n = table.balls.length
  const dense: number[][] = Array.from({ length: n }, () => [])
  const sample = () => {
    for (let i = 0; i < n; i++) {
      const b = table.balls[i]
      dense[i].push(mm(b.pos.x), mm(b.pos.y), mm(b.pos.z), Math.round(b.rvel.x), Math.round(b.rvel.y), Math.round(b.rvel.z))
    }
  }
  if (!quick) sample()
  const events: ShotEvent[] = []
  const idx = (b: Ball) => table.balls.indexOf(b)
  let steps = 0, seen = 0
  while (steps < MAX_SECONDS / STEP && !table.allStationary()) {
    table.advance(STEP)
    steps++
    while (seen < table.outcome.length) {
      const o = table.outcome[seen++], t = Math.round(o.timestamp) / 1000, v = Math.round(Math.abs(o.incidentSpeed || 0) * 100) / 100
      if (o.type === OutcomeType.Collision) events.push({ t, k: "hit", a: idx(o.ballA!), b: idx(o.ballB!), v })
      else if (o.type === OutcomeType.Cushion) events.push(o.cushion ? { t, k: "cush", a: idx(o.ballA!), v, c: o.cushion, x: mm(o.ballA!.pos.x), y: mm(o.ballA!.pos.y) } : { t, k: "jaw", a: idx(o.ballA!), v })
      else if (o.type === OutcomeType.Pot) events.push({ t, k: "pot", a: idx(o.ballA!), v, p: PocketGeometry.pocketCenters.indexOf(o.ballA!.pocket) })
    }
    if (quick) {
      if (steps % 16 === 0 && table.balls.every((b) => !b.inMotion() || (b.state === State.Rolling && b.vel.length() < QUICK_V))) break
      continue
    }
    if (steps % every === 0) sample()
  }
  if (quick) {
    const pk = PocketGeometry.pocketCenters, t = Math.round(table.time) / 1000
    const rest: Spot[] = table.balls.map((b, i) => {
      if (!b.onTable()) return null
      if (!b.inMotion()) return { x: b.pos.x, y: b.pos.y }
      const v = b.vel.length(), d = (v * v) / (2 * K.mu * K.g), ux = b.vel.x / v, uy = b.vel.y / v
      const x = Math.max(-TableGeometry.tableX, Math.min(TableGeometry.tableX, b.pos.x + ux * d)), y = Math.max(-TableGeometry.tableY, Math.min(TableGeometry.tableY, b.pos.y + uy * d))
      const p = pk.findIndex((q: any) => Math.hypot(q.pos.x - (b.pos.x + ux * d), q.pos.y - (b.pos.y + uy * d)) < q.radius + R * 0.5)
      if (p >= 0) { events.push({ t, k: "pot", a: i, p }); return null }
      return { x, y }
    })
    return { dt, nf: 0, tracks: [], events, dur: Math.round(steps * STEP * 100) / 100, rest, miscue: st.miscue, a: st.a }
  }
  if (steps % every !== 0) sample()
  const nf = dense[0].length / 6
  // keep only the frames where a ball moves (or spins): a segment starts one frame before it starts moving
  const tracks = dense.map((d) => {
    const segs: number[][] = []
    let cur: number[] | null = null
    for (let f = 1; f < nf; f++) {
      const o = f * 6, moved = d[o] !== d[o - 6] || d[o + 1] !== d[o - 5] || d[o + 2] !== d[o - 4] || d[o + 3] || d[o + 4] || d[o + 5]
      if (moved) {
        if (!cur) { cur = [f - 1, 1, ...d.slice(o - 6, o)]; segs.push(cur) }
        cur.push(...d.slice(o, o + 6)); cur[1]++
      } else cur = null
    }
    return segs
  })
  const rest: Spot[] = table.balls.map((b) => (b.onTable() ? { x: Math.round(b.pos.x * 1e5) / 1e5, y: Math.round(b.pos.y * 1e5) / 1e5 } : null))
  return { dt, nf, tracks, events, dur: Math.round(steps * STEP * 100) / 100, rest, miscue: st.miscue, a: st.a }
}

// Expand a replay into dense per-frame arrays: out[f] = [x0, y0, z0, x1, ...] in metres, plus each ball's spin. (Tests and bots.)
export function expand(spots: Spot[], r: Replay) {
  const n = spots.length, pos: number[][] = []
  const last = spots.map((s) => (s ? [s.x * 1000, s.y * 1000, 0] : [0, 0, -1000]))
  const at: (number[] | null)[][] = Array.from({ length: n }, () => Array(r.nf).fill(null))
  r.tracks.forEach((segs, i) => segs.forEach((s) => { for (let k = 0; k < s[1]; k++) at[i][s[0] + k] = s.slice(2 + k * 6, 8 + k * 6) }))
  for (let f = 0; f < r.nf; f++) {
    const row: number[] = []
    for (let i = 0; i < n; i++) { const s = at[i][f]; if (s) last[i] = s.slice(0, 3); row.push(last[i][0] / 1000, last[i][1] / 1000, last[i][2] / 1000) }
    pos.push(row)
  }
  return pos
}

// ---- the shot report ------------------------------------------------------------------------------------------------------------
export interface Report {
  firstHit: number // the first object ball the cue ball touched, -1 for none
  railAfter: boolean // a ball reached a cushion (or the jaws) after that first contact
  pots: { b: number; p: number; t: number }[] // object balls and the cue ball, in the order they dropped, with the pocket
  scratch: boolean
  railBalls: number // distinct object balls that touched a cushion (the break's "four to a rail")
  banks: number[] // potted balls that came off a cushion after their last contact with a ball
  combos: number[] // potted balls the cue ball never touched (another object ball sent them in)
  kick: boolean // the cue ball reached a cushion before its first contact
  cueRails: number // cushions the cue ball touched in the whole shot
  touched: number[] // object balls the cue ball touched
  speed: number // the cue ball's speed off the tip, m/s
  miscue: boolean
}

export function report(r: Replay, speed = 0): Report {
  const ev = r.events
  const first = ev.find((e) => e.k === "hit" && (e.a === 0 || e.b === 0))
  const firstHit = first ? (first.a === 0 ? first.b! : first.a) : -1
  const after = first ? ev.filter((e) => e.t >= first.t && (e.k === "cush" || e.k === "jaw")) : []
  const pots = ev.filter((e) => e.k === "pot").map((e) => ({ b: e.a, p: e.p ?? -1, t: e.t }))
  const railBalls = new Set(ev.filter((e) => (e.k === "cush" || e.k === "jaw") && e.a > 0).map((e) => e.a)).size
  const touched = [...new Set(ev.filter((e) => e.k === "hit" && (e.a === 0 || e.b === 0)).map((e) => (e.a === 0 ? e.b! : e.a)))]
  const banks: number[] = [], combos: number[] = []
  for (const p of pots) {
    if (p.b === 0) continue
    const mine = ev.filter((e) => e.t <= p.t && ((e.k === "hit" && (e.a === p.b || e.b === p.b)) || ((e.k === "cush") && e.a === p.b)))
    const lastHit = mine.filter((e) => e.k === "hit").pop()
    // a bank: off a cushion after its last contact with a ball, from far enough away that it is not the jaw's own cushion end
    const pk = PocketGeometry.pocketCenters[p.p]?.pos
    if (pk && mine.some((e) => e.k === "cush" && (!lastHit || e.t > lastHit.t) && Math.hypot(e.x! / 1000 - pk.x, e.y! / 1000 - pk.y) > 10 * R)) banks.push(p.b)
    const firstContact = mine.find((e) => e.k === "hit")
    if (firstContact && firstContact.a !== 0 && firstContact.b !== 0) combos.push(p.b)
  }
  const kick = !!first && ev.some((e) => e.k === "cush" && e.a === 0 && e.t < first.t)
  return {
    firstHit, railAfter: after.length > 0, pots, scratch: pots.some((p) => p.b === 0), railBalls, banks, combos, kick,
    cueRails: ev.filter((e) => e.k === "cush" && e.a === 0).length, touched, speed, miscue: r.miscue,
  }
}

// ---- aiming helpers (bots) --------------------------------------------------------------------------------------------------------
// The ghost ball: where the cue ball's centre must be to send `target` toward `aim`.
export function ghost(target: { x: number; y: number }, aim: { x: number; y: number }) {
  const dx = aim.x - target.x, dy = aim.y - target.y, d = Math.hypot(dx, dy) || 1
  return { x: target.x - (dx / d) * 2 * R, y: target.y - (dy / d) * 2 * R }
}
// Where a ball must cross into a pocket: a point a little inside the jaws, toward the table.
export const pocketTargets = () => geometry().pockets.map((p) => {
  const k = p.side ? 0.6 : 0.75, inx = p.side ? 0 : -Math.sign(p.x), iny = -Math.sign(p.y), d = Math.hypot(inx, iny) || 1
  return { x: p.x + (inx / d) * R * k * 2, y: p.y + (iny / d) * R * k * 2, id: p.id }
})
export const constants = () => ({ mu: K.mu, muS: K.muS, rho: K.rho, m: K.m, R: K.R, e_ball: 0.925 })
export { Outcome }
