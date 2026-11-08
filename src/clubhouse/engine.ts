// Clubhouse integration (phattbeats/clubhouse-billiards): a headless wrapper around tailuge/billiards' physics so the
// Clubhouse server can roll every shot and send clients the replay. GPL-3.0, like the rest of this repository.
import { Vector3 } from "three"
import { Ball, State } from "../model/ball"
import { Table } from "../model/table"
import { OutcomeType } from "../model/outcome"
import { cueStrike } from "../model/physics/physics"
import { R, maxPower } from "../model/physics/constants"
import { TableConfig } from "../view/tableconfig"
import { TableGeometry } from "../view/tablegeometry"
import { PocketGeometry } from "../view/pocketgeometry"
import { AimCalculator } from "../network/bot/aimcalculator"

TableConfig.apply("nineball", 10)

const STEP = 0.001953125
const MAX_SECONDS = 40
export const N = 10 // cue ball + the nine numbered balls

export type Spot = { x: number; y: number } | null // null = off the table (potted)
export interface Shot {
  a: number // angle, radians (0 = +x)
  p: number // power 0..1 of maxPower
  ox?: number // cue tip offset on the ball, -0.45..0.45 (right/left english)
  oy?: number // cue tip offset on the ball, -0.45..0.45 (top/back spin)
  el?: number // cue elevation, radians
}
export interface ShotEvent { t: number; k: "hit" | "cush" | "pot"; a: number; b?: number }
export interface Replay { dt: number; frames: number[][]; events: ShotEvent[]; dur: number; rest: Spot[] }

export const geometry = () => ({
  R,
  halfX: TableGeometry.tableX,
  halfY: TableGeometry.tableY,
  pockets: PocketGeometry.pocketCenters.map((p) => ({ x: p.pos.x, y: p.pos.y, r: p.radius })),
  maxPower,
})

const mm = (v: number) => Math.round(v * 1000)

// the nine-ball diamond: ball 1 at the apex, 9 in the middle, cue ball on the head spot. Positions are metres.
export function rack(rnd: () => number): Spot[] {
  const noise = R * 0.023 + 0.00075
  const gap = 2 * R + 2 * noise
  const across = new Vector3(0, gap, 0)
  const diagonal = across.clone().applyAxisAngle(new Vector3(0, 0, -1), Math.PI / 3)
  const jitter = (v: Vector3): Spot => ({ x: v.x + noise * (rnd() - 0.5), y: v.y + noise * (rnd() - 0.5) })
  const pos = new Vector3(TableGeometry.tableX / 2, 0, 0)
  const out: Spot[] = [{ x: -TableGeometry.X / 2, y: 0 }, jitter(pos)]
  pos.add(diagonal); out.push(jitter(pos))
  pos.sub(across); out.push(jitter(pos))
  pos.add(diagonal); out.push(jitter(pos))
  pos.sub(across); out.push(jitter(pos))
  pos.addScaledVector(across, 2); out.push(jitter(pos))
  pos.add(diagonal).sub(across); out.push(jitter(pos))
  pos.sub(across); out.push(jitter(pos))
  pos.add(diagonal); out.push(jitter(pos))
  const t = out[4]; out[4] = out[9]; out[9] = t
  return out
}

function build(spots: Spot[]): Table {
  const balls = spots.map((s, i) => {
    const b = new Ball(new Vector3(s ? s.x : 0, s ? s.y : 0, 0), 0xffffff, i)
    if (!s) b.state = State.InPocket
    return b
  })
  return new Table(balls)
}

// The engine throws ("Depth exceeded resolving collisions") when a pile-up never settles, and prints a long diagnostic first. About
// one random shot in four hundred does it; the same shot a hair to one side does not. So: roll quietly, and on a throw nudge the
// angle and power by a hair and roll again (the replay carries the shot that was actually rolled).
export function simulate(spots: Spot[], shot: Shot, fps = 30): Replay {
  const { log, warn, error } = console
  console.log = console.warn = console.error = () => {}
  try {
    for (let k = 0; ; k++) {
      try {
        const r = roll(spots, k ? { ...shot, a: shot.a + 0.0007 * k, p: shot.p * (1 - 0.001 * k) } : shot, fps)
        return r
      } catch (e) {
        if (k >= 4) throw e
      }
    }
  } finally {
    console.log = log; console.warn = warn; console.error = error
  }
}

// roll one shot from the given positions. `fps` frames per second go in the replay as flat [x0,y0,x1,y1...] in mm.
function roll(spots: Spot[], shot: Shot, fps: number): Replay {
  const table = build(spots)
  const cue = table.cueball
  const offset = new Vector3(shot.ox ?? 0, shot.oy ?? 0, 0)
  const strike = cueStrike(shot.a, Math.max(0.02, Math.min(1, shot.p)) * maxPower, offset, shot.el ?? 0)
  cue.state = State.Sliding
  cue.vel.copy(strike.vel)
  cue.rvel.copy(strike.rvel)
  table.time = 0
  const dt = 1 / fps, every = Math.max(1, Math.round(dt / STEP))
  const frame = () => table.balls.flatMap((b) => (b.onTable() || b.state === State.Falling ? [mm(b.pos.x), mm(b.pos.y)] : [mm(b.pos.x), mm(b.pos.y)]))
  const frames: number[][] = [frame()]
  const events: ShotEvent[] = []
  const idx = (b: Ball) => table.balls.indexOf(b)
  let steps = 0, seen = 0
  while (steps < (MAX_SECONDS / STEP) && !table.allStationary()) {
    table.advance(STEP)
    steps++
    while (seen < table.outcome.length) {
      const o = table.outcome[seen++], t = Math.round(o.timestamp) / 1000
      if (o.type === OutcomeType.Collision) events.push({ t, k: "hit", a: idx(o.ballA!), b: idx(o.ballB!) })
      else if (o.type === OutcomeType.Cushion) events.push({ t, k: "cush", a: idx(o.ballA!) })
      else if (o.type === OutcomeType.Pot) events.push({ t, k: "pot", a: idx(o.ballA!) })
    }
    if (steps % every === 0) frames.push(frame())
  }
  frames.push(frame())
  const rest: Spot[] = table.balls.map((b) => (b.onTable() ? { x: Math.round(b.pos.x * 1e5) / 1e5, y: Math.round(b.pos.y * 1e5) / 1e5 } : null))
  return { dt, frames, events, dur: Math.round(steps * STEP * 100) / 100, rest }
}

// the first ball the cue ball touches, and whether anything touched a cushion/pocket after that contact
export function summarise(r: Replay) {
  const first = r.events.find((e) => e.k === "hit" && (e.a === 0 || e.b === 0))
  const firstHit = first ? (first.a === 0 ? first.b! : first.a) : -1
  const after = first ? r.events.filter((e) => e.t >= first.t && e.k !== "hit") : []
  const potted = r.events.filter((e) => e.k === "pot").map((e) => e.a)
  return { firstHit, railAfter: after.length > 0, potted }
}

// ---- bot aiming (tailuge's ghost-ball AimCalculator) ----------------------------------------------------------------------
let calc: AimCalculator | null = null
export function aimAt(cue: Spot, target: Spot): number {
  calc ||= new AimCalculator()
  const aim = calc.getAimPoint(new Vector3(cue!.x, cue!.y, 0), new Vector3(target!.x, target!.y, 0))
  return Math.atan2(aim.y - cue!.y, aim.x - cue!.x)
}
export const pocketSpots = () => { calc ||= new AimCalculator(); return calc.pockets.map((p) => ({ x: p.x, y: p.y })) }
