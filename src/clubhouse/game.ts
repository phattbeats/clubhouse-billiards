// Clubhouse integration (phattbeats/clubhouse-billiards): pool as a Clubhouse table game. The server rolls every shot with
// tailuge/billiards' physics (engine.ts) and sends the replay, so every screen sees the same shot. GPL-3.0.
//
// Variants (WPA World Standardized Rules unless marked house):
//   8-ball   open table after the break, groups by the first called ball made, call-shot (the 8 in the called pocket), ball in hand
//            anywhere after a foul, behind the head string after a break scratch, the illegal-break and 8-on-the-break options.
//   9-ball   lowest ball first, push-out after the break, three fouls in a row lose, the 9 made legally wins (the break included).
//   Cutthroat (3 players) 1-5, 6-10, 11-15; pot the others' balls, a foul gives each opponent one ball back, last one standing wins.
// Seats: 1 practice, 2 singles, 3 Cutthroat (or 3-way 9-ball), 4 doubles (seats 0 and 2 against 1 and 3, partners alternate).
import { rack, simulate, report, geometry, ghost, pocketTargets, R, POCKET_NAMES, type Spot, type Replay, type Report } from "./engine"

const geo = geometry()
const { halfX, halfY, headX, footX } = geo
const MAX_SHOTS_PER_SEAT = 60
const FOOT = { x: footX, y: 0 }

// ---- small helpers ------------------------------------------------------------------------------------------------------------
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
const r4 = (v: number) => Math.round(v * 1e4) / 1e4
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const isSolid = (b: number) => b >= 1 && b <= 7
const isStripe = (b: number) => b >= 9 && b <= 15
const onTable = (balls: Spot[]) => balls.map((b, i) => (b && i > 0 ? i : -1)).filter((i) => i > 0)
const cutGroup = (k: number) => [1, 2, 3, 4, 5].map((x) => x + 5 * k)
const free = (balls: Spot[], x: number, y: number, skip = 0) => balls.every((b, i) => !b || i === skip || Math.hypot(b.x - x, b.y - y) >= 2 * R * 1.002)
const onCloth = (x: number, y: number) => Math.abs(x) <= halfX && Math.abs(y) <= halfY && geo.pockets.every((p) => Math.hypot(p.x - x, p.y - y) > p.r + R * 0.2)

type Variant = "8ball" | "9ball" | "cutthroat"
export function resolveVariant(opt: string | undefined, seats: number): Variant {
  if (opt === "9ball") return "9ball"
  if (seats === 3 && (opt === "auto" || opt === "cutthroat" || opt === "8ball" || !opt)) return "cutthroat"
  return "8ball"
}

// ---- state ------------------------------------------------------------------------------------------------------------------------
interface Choice { seat: number; kind: "illegalBreak" | "eightBreak" | "eightScratch" | "push"; opts: string[]; by: number }
function init({ seats, options, seed }: { seats: number; options?: any; seed: number }) {
  const o = options || {}
  const variant = resolveVariant(o.variant ?? "auto", seats)
  const sides = seats === 4 ? 2 : seats
  const st = {
    rng: seed >>> 0, n: seats, sides, variant, callShot: (o.callShot ?? "wpa") as "wpa" | "eightOnly" | "off", guide: o.guide ?? "short",
    balls: rack(variant, mulberry(seed)) as Spot[], rackNo: 1, turn: 0, breaker: 0, inHand: "kitchen" as "kitchen" | "table" | null, breakShot: true,
    groups: (variant === "cutthroat" ? [0, 1, 2] : Array(sides).fill(null)) as (null | "solids" | "stripes" | number)[],
    out: Array(sides).fill(false) as boolean[], fouls: Array(sides).fill(0) as number[], pushAvail: false, choice: null as Choice | null,
    visit: { seat: 0, pots: 0, fromBreak: true }, potted: Array.from({ length: seats }, () => [] as number[]),
    seq: 0, shots: 0, shot: null as any, over: false, winners: [] as number[], flags: {} as Record<string, number[]>, note: "", lastFoul: "",
  }
  return st
}
type State = ReturnType<typeof init>
const sideOf = (st: State, seat: number) => (st.n === 4 ? seat % 2 : seat)
const seatsOf = (st: State, side: number) => Array.from({ length: st.n }, (_, s) => s).filter((s) => sideOf(st, s) === side)
function nextSeat(st: State, seat: number) {
  for (let k = 1; k <= st.n; k++) { const s = (seat + k) % st.n; if (!st.out[sideOf(st, s)]) return s }
  return seat
}
function addFlag(st: State, k: string, s: number) {
  const f = st.flags[k] || []
  if (!f.includes(s)) st.flags[k] = [...f, s]
}
const groupBalls = (st: State, side: number): number[] => {
  const g = st.groups[side]
  if (st.variant === "cutthroat") return cutGroup(g as number)
  return g === "solids" ? [1, 2, 3, 4, 5, 6, 7] : g === "stripes" ? [9, 10, 11, 12, 13, 14, 15] : []
}
const lowestOn = (balls: Spot[]) => { for (let i = 1; i < balls.length; i++) if (balls[i]) return i; return 0 }

// the balls the shooter may hit first
function targets(st: State, side: number, balls: Spot[] = st.balls): number[] {
  const on = onTable(balls)
  if (st.variant === "9ball") { const l = lowestOn(balls); return l ? [l] : [] }
  if (st.variant === "cutthroat") return on
  if (st.breakShot) return on
  if (st.groups[side] == null) { const open = on.filter((b) => b !== 8); return open.length ? open : on.filter((b) => b === 8) }
  const mine = groupBalls(st, side).filter((b) => balls[b])
  return mine.length ? mine : on.filter((b) => b === 8)
}
// the balls the shooter wants to pot (for calls and bots)
function wanted(st: State, side: number, balls: Spot[] = st.balls): number[] {
  if (st.variant === "cutthroat") { const mine = groupBalls(st, side); return onTable(balls).filter((b) => !mine.includes(b)) }
  return targets(st, side, balls)
}
const onEight = (st: State, side: number, balls = st.balls) => st.variant === "8ball" && !st.breakShot && targets(st, side, balls).length === 1 && targets(st, side, balls)[0] === 8
function needCall(st: State, side: number, safe = false) {
  if (st.variant !== "8ball" || st.breakShot || safe) return false
  if (st.callShot === "off") return false
  if (st.callShot === "eightOnly") return onEight(st, side)
  return true
}
function spotBall(balls: Spot[], b: number) {
  let x = FOOT.x
  while (!free(balls, x, FOOT.y, b) && x < halfX - R) x += R * 0.25
  if (!free(balls, x, FOOT.y, b)) { x = FOOT.x; while (!free(balls, x, FOOT.y, b) && x > 0) x -= R * 0.25 }
  balls[b] = { x: r5(x), y: 0 }
}
function rerack(st: State, breakerSeat: number) {
  st.rackNo++
  st.balls = rack(st.variant, mulberry((st.rng + st.rackNo * 7919) >>> 0))
  st.breakShot = true; st.inHand = "kitchen"; st.turn = breakerSeat; st.breaker = breakerSeat; st.pushAvail = false
  if (st.variant === "8ball") st.groups = st.groups.map(() => null)
  st.potted = st.potted.map(() => [])
  st.visit = { seat: breakerSeat, pots: 0, fromBreak: true }
}

// ---- adjudication: what a shot means under the rules (pure; the bots use it to score their options) --------------------------------
interface Verdict {
  foul: string | null; cont: boolean; win: boolean; lose: boolean; assign: null | "solids" | "stripes"; respot: number[]; returns: number[]
  choice: Choice | null; nextInHand: "kitchen" | "table" | null; counted: number[]; note: string; push: boolean; safe: boolean; tags: string[]
}
function judge(st: State, seat: number, mv: any, rep: Report, from: Spot[], rest: Spot[]): Verdict {
  const side = sideOf(st, seat), V = st.variant, brk = st.breakShot
  const pots = rep.pots.filter((p) => p.b > 0).map((p) => p.b)
  const tg = targets(st, side, from)
  const push = V === "9ball" && !!mv.push && st.pushAvail
  const safe = V === "8ball" && !!mv.safe && !brk
  const call = mv.call && Number.isInteger(mv.call.b) ? mv.call : null
  const v: Verdict = { foul: null, cont: false, win: false, lose: false, assign: null, respot: [], returns: [], choice: null, nextInHand: null, counted: [], note: "", push, safe, tags: [] }
  if (brk) v.tags.push("break")
  // fouls
  if (rep.scratch) v.foul = "Scratch"
  else if (rep.firstHit < 0) v.foul = "No ball hit"
  else if (!push && !tg.includes(rep.firstHit)) v.foul = V === "9ball" ? `Hit the ${rep.firstHit} before the ${tg[0]}` : rep.firstHit === 8 ? "Hit the 8 first" : "Wrong ball first"
  else if (!push && !brk && !pots.length && !rep.railAfter) v.foul = "No ball reached a cushion"
  else if (st.inHand === "kitchen" && !brk && from[rep.firstHit] && from[rep.firstHit]!.x < headX - R * 0.01 && !rep.kick) v.foul = "Ball behind the head string"
  if (v.foul === "Scratch") v.tags.push("scratch")
  const legalBreak = !brk || pots.length > 0 || rep.railBalls >= 4
  const nx = nextSeat(st, seat)

  if (V === "8ball") {
    if (brk) {
      if (pots.includes(8)) {
        v.tags.push("eight")
        if (v.foul) { v.choice = { seat: nx, kind: "eightScratch", opts: ["spot", "rerack"], by: seat }; v.note = "8 on the break with a scratch" }
        else { v.choice = { seat, kind: "eightBreak", opts: ["spot", "rerack"], by: seat }; v.note = "8 on the break" }
        return v
      }
      if (!legalBreak) { v.choice = { seat: nx, kind: "illegalBreak", opts: ["play", "rerack", "rebreak"], by: seat }; v.foul = v.foul || null; v.note = "Illegal break: fewer than four balls reached a cushion"; return v }
      if (v.foul) { v.nextInHand = v.foul === "Scratch" ? "kitchen" : "table"; v.note = `${v.foul} on the break` }
      else { v.cont = pots.length > 0; v.counted = pots; v.note = pots.length ? (pots.length > 1 ? `${pots.length} balls on the break` : `The ${pots[0]} on the break`) : "Nothing down on the break" }
      return v
    }
    const solo = st.sides === 1
    if (pots.includes(8)) {
      v.tags.push("eight")
      const was8 = onEight(st, side, from)
      const p8 = rep.pots.find((p) => p.b === 8)!.p
      const callOk = st.callShot === "off" || (call && call.b === 8 && call.p === p8)
      if (!v.foul && was8 && callOk && !safe) { v.win = true; v.note = "The 8 ball"; return v }
      if (solo) { v.respot.push(8); v.foul = v.foul || "The 8 went down early"; v.nextInHand = "table"; v.note = "The 8 is spotted"; return v }
      v.lose = true
      v.note = v.foul ? `${v.foul} on the 8` : !was8 ? "The 8 went down early" : !callOk ? "The 8 in the wrong pocket" : "The 8 on a safety"
      return v
    }
    if (v.foul) { v.nextInHand = "table"; v.note = v.foul; return v }
    if (safe) { v.note = "Safety"; return v }
    // the called ball, or (call off) any of the shooter's balls
    let made: number[] = []
    if (needCall(st, side)) {
      if (call && rep.pots.some((p) => p.b === call.b && p.p === call.p) && (st.groups[side] == null ? call.b !== 8 : groupBalls(st, side).includes(call.b) || call.b === 8)) made = [call.b]
    } else {
      made = st.groups[side] == null ? pots.filter((b) => b !== 8) : pots.filter((b) => groupBalls(st, side).includes(b))
    }
    if (made.length && st.groups[side] == null && !solo) { v.assign = isSolid(made[0]) ? "solids" : "stripes"; v.tags.push("groups") }
    const mineAfter = v.assign ? (v.assign === "solids" ? isSolid : isStripe) : st.groups[side] ? (b: number) => groupBalls(st, side).includes(b) : (b: number) => b !== 8
    v.counted = pots.filter(mineAfter)
    v.cont = made.length > 0
    v.note = v.cont ? (v.assign ? `${v.assign === "solids" ? "Solids" : "Stripes"}` : "Pocketed") : pots.length ? "Not the called pocket" : "Missed"
    return v
  }

  if (V === "9ball") {
    if (brk && !legalBreak && !v.foul) v.foul = "Illegal break"
    if (pots.includes(9)) {
      if (v.foul || push) { v.respot.push(9); v.tags.push("nine-spot") }
      else { v.win = true; v.tags.push("eight"); v.note = brk ? "Nine on the break!" : "The 9 ball"; return v }
    }
    if (v.foul) {
      v.nextInHand = "table"
      v.note = v.foul + (v.respot.length ? " (the 9 is spotted)" : "")
      if (st.fouls[side] + 1 >= 3) { v.lose = true; v.note = "Three fouls in a row" }
      return v
    }
    if (push) { v.choice = { seat: nx, kind: "push", opts: ["take", "pass"], by: seat }; v.note = "Push out"; return v }
    v.counted = pots.filter((b) => b !== 9)
    v.cont = pots.length > 0
    v.note = v.cont ? (brk ? "Down on the break" : "Pocketed") : brk ? "Nothing down on the break" : "Missed"
    return v
  }

  // cutthroat
  const mine = groupBalls(st, side)
  if (v.foul) {
    v.nextInHand = brk && v.foul === "Scratch" ? "kitchen" : "table"
    // each opponent gets one of their pocketed balls back (the lowest)
    for (let s = 0; s < st.sides; s++) if (s !== side) {
      const back = groupBalls(st, s).find((b) => !rest[b] && !v.returns.includes(b))
      if (back) v.returns.push(back)
    }
    v.note = v.foul + (v.returns.length ? ": a ball back for each opponent" : "")
    return v
  }
  v.counted = pots.filter((b) => !mine.includes(b))
  v.cont = v.counted.length > 0 && !pots.some((b) => mine.includes(b))
  v.note = v.counted.length ? (pots.some((b) => mine.includes(b)) ? "Potted one of your own" : "Pocketed") : pots.length ? "Potted one of your own" : brk ? "Nothing down on the break" : "Missed"
  return v
}

// ---- moves --------------------------------------------------------------------------------------------------------------------------
function checkShot(st: State, seat: number, mv: any): string | undefined {
  const { a, p } = mv, ox = mv.ox ?? 0, oy = mv.oy ?? 0, el = mv.el ?? 0
  if (![a, p, ox, oy, el].every(Number.isFinite)) return "bad shot"
  if (p < 0.02 || p > 1) return "bad power"
  if (Math.hypot(ox, oy) > 0.62) return "bad spin"
  if (el < 0 || el > 1.0) return "bad cue angle"
  if (st.inHand) {
    const { cx, cy } = mv
    if (![cx, cy].every(Number.isFinite)) return "place the cue ball"
    if (!onCloth(cx, cy)) return "off the table"
    if (st.inHand === "kitchen" && cx > headX) return "behind the head string"
    if (!free(st.balls, cx, cy, 0)) return "ball in the way"
  } else if (!st.balls[0]) return "no cue ball"
  const side = sideOf(st, seat)
  if (mv.push && !(st.variant === "9ball" && st.pushAvail)) return "no push out now"
  if (needCall(st, side, !!mv.safe)) {
    const c = mv.call
    if (!c || !Number.isInteger(c.b) || !Number.isInteger(c.p) || c.p < 0 || c.p > 5) return "call a ball and a pocket"
    if (!st.balls[c.b] || !wanted(st, side).includes(c.b)) return "call one of your balls"
  }
  return undefined
}

function apply(st: State, seat: number, mv: any): string | undefined {
  if (st.over) return "game over"
  if (!mv || typeof mv !== "object") return "bad move"
  if (mv.t === "choose") return choose(st, seat, mv.k)
  if (mv.t !== "shot") return "bad move"
  if (st.choice) return "waiting for a decision"
  if (seat !== st.turn) return "not your turn"
  const bad = checkShot(st, seat, mv); if (bad) return bad
  const from: Spot[] = st.balls.map((b) => (b ? { ...b } : null))
  if (st.inHand) from[0] = { x: mv.cx, y: mv.cy }
  const ang = Math.atan2(Math.sin(mv.a), Math.cos(mv.a))
  const shot = { a: ang, p: mv.p, ox: mv.ox ?? 0, oy: mv.oy ?? 0, el: mv.el ?? 0, brk: st.breakShot }
  let rep: Replay
  try { rep = simulate(from, shot) } catch { return "that shot could not be played, try another" }
  const sum = report(rep)
  const v = judge(st, seat, mv, sum, from, rep.rest)
  commit(st, seat, mv, shot, from, rep, sum, v)
  return undefined
}

function commit(st: State, seat: number, mv: any, shot: any, from: Spot[], rep: Replay, sum: Report, v: Verdict) {
  const side = sideOf(st, seat), brk = st.breakShot
  st.seq++; st.shots++
  st.balls = rep.rest.map((b) => (b ? { x: r5(b.x), y: r5(b.y) } : null))
  for (const b of v.respot) spotBall(st.balls, b)
  for (const b of v.returns) spotBall(st.balls, b)
  const pots = sum.pots.filter((p) => p.b > 0).map((p) => p.b).filter((b) => !v.respot.includes(b) && !v.returns.includes(b))
  st.potted[seat].push(...pots)
  if (v.assign) {
    for (let s = 0; s < st.sides; s++) st.groups[s] = s === side ? v.assign : v.assign === "solids" ? "stripes" : "solids"
  }
  // tags for banners, the bot voice and achievements
  const tags = v.tags.slice()
  const good = !v.foul && !v.lose
  // a combination or a bank counts when it was the point of the shot: the called ball, or (no calls) a ball that counted
  const meant = (b: number) => !brk && (mv.call ? mv.call.b === b && (v.cont || v.win) : v.counted.includes(b) || (v.win && b === (st.variant === "9ball" ? 9 : 8)))
  if (good && sum.combos.some(meant)) { tags.push("combo"); addFlag(st, "combo", seat) }
  if (good && sum.banks.some(meant)) { tags.push("bank"); addFlag(st, "bank", seat) }
  if (sum.kick && good && (v.counted.length || v.win)) tags.push("kick")
  if (sum.miscue) tags.push("miscue")
  // the visit: the run of shots one player makes before leaving the table
  if (st.visit.seat !== seat) st.visit = { seat, pots: 0, fromBreak: false }
  st.visit.pots += v.counted.length + (v.win ? 1 : 0)
  if (st.visit.pots >= 3) tags.push("run")
  if (st.visit.pots >= 5) addFlag(st, "run5", seat)
  if (v.foul) st.fouls[side]++
  else st.fouls[side] = 0
  st.lastFoul = v.foul || ""
  st.shot = {
    n: st.seq, seat, side, a: r4(shot.a), p: shot.p, ox: shot.ox, oy: shot.oy, el: shot.el, brk,
    from: from.map((b) => b && { x: r5(b.x), y: r5(b.y) }), dt: rep.dt, nf: rep.nf, tracks: rep.tracks, events: rep.events, dur: rep.dur,
    foul: v.foul, potted: pots, respot: [...v.respot, ...v.returns], win: v.win, lose: v.lose, call: mv.call || null, push: v.push, safe: v.safe,
    note: v.note, tags, miscue: sum.miscue, firstHit: sum.firstHit, rails: sum.railBalls,
  }
  st.note = v.note
  st.pushAvail = false
  st.breakShot = false
  // the end of the game
  const finish = (winSide: number) => {
    st.over = true; st.winners = seatsOf(st, winSide); st.turn = -1 as any
    for (const s of st.winners) {
      if (st.variant === "9ball") { addFlag(st, "nineball", s); if (brk) addFlag(st, "golden", s) }
      else if (st.variant === "8ball") addFlag(st, "eightball", s)
      else addFlag(st, "cutthroat", s)
    }
    if (sideOf(st, seat) === winSide && st.visit.fromBreak && seat === st.breaker) addFlag(st, "breakrun", seat)
  }
  if (v.win) { finish(side); return }
  if (v.lose) {
    if (st.sides === 2) { finish(1 - side); return }
    st.out[side] = true // 3-way: the one who lost is out; the rest play on
    const alive = Array.from({ length: st.sides }, (_, s) => s).filter((s) => !st.out[s])
    if (alive.length === 1) { finish(alive[0]); return }
  }
  if (st.variant === "cutthroat") {
    for (let s = 0; s < st.sides; s++) st.out[s] = !groupBalls(st, s).some((b) => st.balls[b])
    const alive = Array.from({ length: st.sides }, (_, s) => s).filter((s) => !st.out[s])
    if (alive.length <= 1) { finish(alive.length ? alive[0] : side); return }
  }
  if (st.variant === "8ball" && st.sides === 1 && !onTable(st.balls).length) { finish(0); return }
  if (st.shots >= MAX_SHOTS_PER_SEAT * st.n) { // a table that never ends: whoever has the fewest balls left of their own wins
    st.over = true
    const left = Array.from({ length: st.sides }, (_, s) => (st.out[s] ? 99 : st.variant === "9ball" ? -st.potted.filter((_, k) => sideOf(st, k) === s).flat().length : groupBalls(st, s).filter((b) => st.balls[b]).length || (st.groups[s] == null ? 7 : 0)))
    const best = Math.min(...left)
    st.winners = Array.from({ length: st.n }, (_, k) => k).filter((k) => left[sideOf(st, k)] === best)
    st.turn = -1 as any
    st.note = "Shot limit reached"
    return
  }
  if (v.choice) { st.choice = v.choice; st.turn = v.choice.seat; st.inHand = null; if (v.choice.kind === "push") st.turn = v.choice.seat; return }
  if (v.cont) { st.inHand = null; if (st.variant === "9ball" && brk) st.pushAvail = true; return }
  st.turn = nextSeat(st, seat)
  st.inHand = v.nextInHand
  if (!st.balls[0]) st.inHand = st.inHand || "table"
  if (st.variant === "9ball" && brk && !v.foul) st.pushAvail = true
  if (st.variant === "9ball" && brk && v.foul) st.pushAvail = true // (WPA: the incoming player may push out after a foul on the break too)
}

function choose(st: State, seat: number, k: string): string | undefined {
  const c = st.choice
  if (!c) return "nothing to decide"
  if (seat !== c.seat) return "not your decision"
  if (!c.opts.includes(k)) return "pick one of the options"
  st.choice = null
  if (c.kind === "push") { st.turn = k === "take" ? c.seat : c.by; st.inHand = null; st.note = k === "take" ? "Takes the shot" : "Gives it back"; return }
  if (c.kind === "illegalBreak") {
    if (k === "play") { st.turn = c.seat; st.inHand = st.balls[0] ? null : "kitchen"; st.note = "Plays the table as it lies" }
    else rerack(st, k === "rerack" ? c.seat : c.by)
    return
  }
  if (c.kind === "eightBreak") {
    if (k === "spot") { spotBall(st.balls, 8); st.turn = c.seat; st.inHand = st.balls[0] ? null : "kitchen"; st.note = "The 8 is spotted" }
    else rerack(st, c.seat)
    return
  }
  // eightScratch: the incoming player spots the 8 and takes ball in hand behind the head string, or re-racks and breaks
  if (k === "spot") { spotBall(st.balls, 8); st.turn = c.seat; st.inHand = "kitchen"; st.note = "The 8 is spotted" }
  else rerack(st, c.seat)
  return
}

// ---- bots ---------------------------------------------------------------------------------------------------------------------------
// Pots: for each ball it wants and each pocket, the ghost ball on the line into the pocket; the cue ball's path and the object ball's
// path must both be clear. A geometric score (cut, distances, the pocket's mouth) ranks them; the best few are rolled through the
// real physics at a few speeds and spins, and each result is scored on what it leaves for the next shot (position play).
// No pot worth taking: play safe, a legal hit that leaves the next player nothing. Nothing reachable: kick at it off a cushion.
type Cand = { b: number; p: number; a: number; cut: number; d1: number; d2: number; score: number }
const PT = pocketTargets()
function pathClear(balls: Spot[], from: { x: number; y: number }, to: { x: number; y: number }, skip: number[], wide = 2 * R) {
  const dx = to.x - from.x, dy = to.y - from.y, L2 = dx * dx + dy * dy || 1e-9
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]; if (!b || skip.includes(i)) continue
    const t = clamp(((b.x - from.x) * dx + (b.y - from.y) * dy) / L2, 0, 1)
    if (Math.hypot(from.x + dx * t - b.x, from.y + dy * t - b.y) < wide * 0.98) return false
  }
  return true
}
function candidates(balls: Spot[], cue: { x: number; y: number }, want: number[]): Cand[] {
  const out: Cand[] = []
  for (const b of want) {
    const t = balls[b]; if (!t) continue
    for (const pk of PT) {
      const pocket = geo.pockets[pk.id]
      const ex = pk.x - t.x, ey = pk.y - t.y, d2 = Math.hypot(ex, ey)
      // the way into a side pocket is steep; corners take a wide range
      if (pocket.side && Math.abs(ey) / (d2 || 1) < 0.55) continue
      const gh = ghost(t, pk)
      const cx = gh.x - cue.x, cy = gh.y - cue.y, d1 = Math.hypot(cx, cy)
      if (d1 < R * 0.5) continue
      const cut = Math.acos(clamp((cx * ex + cy * ey) / (d1 * d2 || 1), -1, 1))
      if (cut > 1.32) continue // past ~75 degrees
      if (!pathClear(balls, cue, gh, [0, b])) continue
      if (!pathClear(balls, t, pk, [0, b], 2 * R * 0.95)) continue
      const score = Math.cos(cut) ** 1.5 / (1 + 0.9 * d1 + 1.6 * d2) * (pocket.side ? 0.8 : 1)
      out.push({ b, p: pk.id, a: Math.atan2(cy, cx), cut, d1, d2, score })
    }
  }
  return out.sort((x, y) => y.score - x.score)
}
// combinations: the cue ball sends `first` into `then`, which goes into a pocket (9-ball: the lowest into the 9)
function combos(balls: Spot[], cue: { x: number; y: number }, first: number, then: number[]): Cand[] {
  const out: Cand[] = [], f = balls[first]
  if (!f) return out
  for (const b of then) {
    const t = balls[b]; if (!t || b === first) continue
    for (const pk of PT) {
      const pocket = geo.pockets[pk.id], ex = pk.x - t.x, ey = pk.y - t.y, d3 = Math.hypot(ex, ey)
      if (pocket.side && Math.abs(ey) / (d3 || 1) < 0.55) continue
      const g2 = ghost(t, pk), fx = g2.x - f.x, fy = g2.y - f.y, d2 = Math.hypot(fx, fy)
      const cut2 = Math.acos(clamp((fx * ex + fy * ey) / (d2 * d3 || 1), -1, 1)); if (cut2 > 0.5 || d2 > 0.5) continue
      const g1 = ghost(f, g2), cx = g1.x - cue.x, cy = g1.y - cue.y, d1 = Math.hypot(cx, cy)
      const cut1 = Math.acos(clamp((cx * fx + cy * fy) / (d1 * d2 || 1), -1, 1)); if (cut1 > 0.9) continue
      if (!pathClear(balls, cue, g1, [0, first]) || !pathClear(balls, f, g2, [first, b]) || !pathClear(balls, t, pk, [b], 2 * R * 0.95)) continue
      const score = 0.45 * Math.cos(cut1) * Math.cos(cut2) ** 2 / (1 + 0.9 * d1 + 2.5 * d2 + 1.6 * d3)
      out.push({ b, p: pk.id, a: Math.atan2(cy, cx), cut: cut1, d1, d2: d2 + d3, score })
    }
  }
  return out
}
const bestScore = (balls: Spot[], cue: Spot, want: number[]) => (cue ? candidates(balls, cue, want)[0]?.score ?? 0 : 0.35)

function powerFor(c: Cand) { return clamp(0.12 + 0.17 * c.d1 + 0.26 * c.d2 + 0.12 * (1 - Math.cos(c.cut)), 0.12, 0.85) }

function bot(st: State, seat: number, opts?: { level?: string; style?: { risk?: number }; timeout?: boolean }) {
  if (st.over) return null
  const easy = opts?.level === "easy", risk = opts?.style?.risk ?? 0.5, quick = !!opts?.timeout
  const rnd = (k: number) => hash((st.rng ^ Math.imul(st.seq + 1, 2654435761) ^ Math.imul(st.rackNo, 40503)) >>> 0, k + seat * 131)
  const side = sideOf(st, seat)
  if (st.choice) {
    if (st.choice.seat !== seat) return null
    const c = st.choice
    if (c.kind === "push") { const cue = st.balls[0]; const s = bestScore(st.balls, cue, wanted(st, side)); return { t: "choose", k: s > 0.12 + (risk - 0.5) * 0.1 ? "take" : "pass" } }
    if (c.kind === "illegalBreak") return { t: "choose", k: "play" }
    return { t: "choose", k: "spot" }
  }
  if (st.turn !== seat) return null
  if (st.breakShot) {
    const nine = st.variant === "9ball"
    const cy = nine ? (rnd(1) < 0.5 ? -1 : 1) * (0.12 + rnd(2) * 0.1) : (rnd(1) - 0.5) * R * 3
    const cx = headX - R * 1.5
    const apex = st.balls[1] && st.variant !== "8ball" ? st.balls[1]! : st.balls.find((b, i) => b && i > 0 && Math.abs(b.y) < 1e-2 && Math.abs(b.x - footX) < R)!
    const tgt = apex || { x: footX, y: 0 }
    const a = Math.atan2(tgt.y - cy, tgt.x - cx) + (rnd(3) - 0.5) * (easy ? 0.01 : 0.003)
    return { t: "shot", cx: r5(cx), cy: r5(cy), a: r4(a), p: easy ? 0.8 : r4(0.92 + rnd(4) * 0.08), ox: 0, oy: easy ? 0 : -0.1, el: 0.05 }
  }
  const want = wanted(st, side), legal = targets(st, side)
  // ball in hand: stand where the best pot is an easy, nearly straight shot with a little angle for position
  let cue = st.balls[0], place: { cx: number; cy: number } | null = null
  if (st.inHand || !cue) {
    let best: { x: number; y: number; s: number } | null = null
    const probe = st.balls.map((b) => (b ? { ...b } : null)); probe[0] = null
    for (const b of want) {
      const t = probe[b]; if (!t) continue
      for (const pk of PT) {
        if (!pathClear(probe, t, pk, [b], 2 * R * 0.95)) continue
        const ex = t.x - pk.x, ey = t.y - pk.y, d = Math.hypot(ex, ey) || 1, gh = ghost(t, pk)
        for (const [back, turn] of [[0.28, 0.18], [0.28, -0.18], [0.45, 0.1], [0.45, -0.1], [0.2, 0]]) {
          const c = Math.cos(turn), s = Math.sin(turn), ux = (ex / d) * c - (ey / d) * s, uy = (ex / d) * s + (ey / d) * c
          const x = gh.x + ux * back, y = gh.y + uy * back
          if (!onCloth(x, y) || !free(probe, x, y, 0) || (st.inHand === "kitchen" && x > headX - R * 0.1)) continue
          const sc = bestScore(probe, { x, y }, want)
          if (!best || sc > best.s) best = { x, y, s: sc }
        }
      }
    }
    if (!best) { // nothing pottable: somewhere legal and free, near the middle
      for (let k = 0; k < 40 && !best; k++) {
        const x = st.inHand === "kitchen" ? headX - R - rnd(10 + k) * (halfX + headX - 2 * R) : (rnd(10 + k) - 0.5) * halfX * 1.6, y = (rnd(60 + k) - 0.5) * halfY * 1.6
        if (onCloth(x, y) && free(probe, x, y, 0)) best = { x, y, s: 0 }
      }
    }
    const b = best || { x: headX - R * 2, y: 0 }
    place = { cx: r5(b.x), cy: r5(b.y) }; cue = { x: b.x, y: b.y }
  }
  const spots = st.balls.map((b) => (b ? { ...b } : null)); spots[0] = { x: cue!.x, y: cue!.y }
  const callFor = (c: Cand | null) => (c && needCall(st, side) ? { b: c.b, p: c.p } : undefined)
  const finish = (a: number, p: number, ox: number, oy: number, c: Cand | null, extra: any = {}) => {
    const err = easy ? 0.02 : 0.007, perr = easy ? 0.15 : 0.06
    const call = callFor(c) || (needCall(st, side) && !extra.safe ? fallbackCall(st, side, spots) : undefined)
    return { t: "shot", ...(place || {}), a: r4(a + (rnd(3) - 0.5) * 2 * err), p: r4(clamp(p * (1 + (rnd(4) - 0.5) * 2 * perr), 0.04, 1)), ox, oy, el: 0.05, ...(call ? { call } : {}), ...extra }
  }
  const cands = candidates(spots, cue!, want)
  if (st.variant === "9ball" && legal[0] && legal[0] !== 9 && !easy) cands.push(...combos(spots, cue!, legal[0], [9]))
  cands.sort((x, y) => y.score - x.score)
  if (quick) { const c = cands[0]; if (c) return finish(c.a, powerFor(c), 0, 0, c); return kick(st, seat, spots, legal, finish, rnd, true) }
  // roll the best few through the real physics
  const top = cands.slice(0, easy ? 2 : 4)
  const variations = easy ? [[1, 0]] : [[1, -0.05], [0.8, 0.3], [1.15, -0.3], [1.35, 0.1]]
  let bestMv: any = null, bestSc = -Infinity
  const score = (mvLike: any, c: Cand | null, safety = false) => {
    let rep: Replay
    try { rep = simulate(spots, { a: mvLike.a, p: mvLike.p, ox: mvLike.ox, oy: mvLike.oy, el: 0.05 }, 30, true) } catch { return -1e9 }
    const sum = report(rep)
    const sim = { ...st, inHand: st.inHand } as State
    const v = judge(sim, seat, { ...mvLike, call: callFor(c), safe: safety }, sum, spots, rep.rest)
    if (v.win) return 1e6
    if (v.lose) return -1e6
    let sc = 0
    if (v.foul) sc -= 300
    const nextWant = v.assign ? (v.assign === "solids" ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]).filter((b) => rep.rest[b]) : wanted({ ...st, breakShot: false } as State, side, rep.rest)
    if (v.cont) {
      sc += 200 + 25 * v.counted.length
      if (!easy) sc += 260 * bestScore(rep.rest, rep.rest[0], nextWant.length ? nextWant : [8].filter((b) => rep.rest[b]))
    } else if (!v.foul) {
      // the turn passes: how much does it leave the next player?
      const nx = nextSeat(st, seat), theirs = wanted({ ...st, breakShot: false } as State, sideOf(st, nx), rep.rest)
      sc -= 220 * bestScore(rep.rest, rep.rest[0], theirs)
      sc += 15 * v.counted.length
    }
    return sc
  }
  for (const c of top) {
    const base = powerFor(c)
    for (const [k, oy] of variations) {
      const mvLike = { a: c.a, p: clamp(base * k * (1 + (risk - 0.5) * 0.2), 0.08, 1), ox: 0, oy }
      const sc = score(mvLike, c) + c.score * 40
      if (sc > bestSc) { bestSc = sc; bestMv = { ...mvLike, c } }
    }
  }
  // no make worth it: a safety (standard bots), or anything legal
  const threshold = 150 + (0.5 - risk) * 160
  if (!easy && bestSc < threshold) {
    const tries: any[] = []
    for (const b of legal) {
      const t = spots[b]; if (!t || !pathClear(spots, cue!, t, [0, b])) continue
      const base = Math.atan2(t.y - cue!.y, t.x - cue!.x), cut = Math.asin(clamp((R * 1.6) / (Math.hypot(t.x - cue!.x, t.y - cue!.y) || 1), -1, 1))
      for (const da of [0, cut, -cut]) for (const p of [0.16, 0.3]) tries.push({ a: base + da, p, ox: 0, oy: -0.1 })
    }
    for (const mvLike of tries.slice(0, 10)) {
      const sc = score(mvLike, null, true) + 60
      if (sc > bestSc) { bestSc = sc; bestMv = { ...mvLike, c: null, safe: st.variant === "8ball" } }
    }
  }
  if (!bestMv || bestSc < -250) return kick(st, seat, spots, legal, finish, rnd, false, score)
  return finish(bestMv.a, bestMv.p, bestMv.ox, bestMv.oy, bestMv.c, bestMv.safe ? { safe: true } : {})
}

// a called ball the bot can name when its chosen shot is not a straight pot (a safety needs no call; a kick or a "best effort" does)
function fallbackCall(st: State, side: number, spots: Spot[]) {
  const w = wanted(st, side).filter((b) => spots[b])
  const b = w[0] ?? 8
  const t = spots[b]
  let best = 0, bd = Infinity
  if (t) geo.pockets.forEach((p, i) => { const d = Math.hypot(p.x - t.x, p.y - t.y); if (d < bd) { bd = d; best = i } })
  return { b, p: best }
}

// nothing reachable straight on: sweep the angles and keep the shot that reaches a legal ball first (off the cushions)
function kick(st: State, seat: number, spots: Spot[], legal: number[], finish: any, rnd: (k: number) => number, quick: boolean, score?: any) {
  const cue = spots[0]!
  const angles: number[] = []
  for (const b of legal) { const t = spots[b]; if (t) angles.push(Math.atan2(t.y - cue.y, t.x - cue.x)) }
  for (let k = 0; k < (quick ? 0 : 14); k++) angles.push(rnd(200 + k) * Math.PI * 2)
  let best = { a: angles[0] ?? 0, sc: -Infinity }
  if (quick || !score) return finish(best.a, 0.4, 0, 0, null)
  for (const a of angles.slice(0, 16)) {
    const sc = score({ a, p: 0.42, ox: 0, oy: 0 }, null, true)
    if (sc > best.sc) best = { a, sc }
  }
  return finish(best.a, 0.42, 0, 0, null, st.variant === "8ball" ? { safe: true } : {})
}

// ---- the table's view, the shell's summary -------------------------------------------------------------------------------------------
const think = (mv: any) => (mv?.t === "choose" ? 1400 : mv?.cx !== undefined ? 2600 : 1900)
// the table waits for the last shot to finish rolling before a bot steps up (replays run 1.25x the physics clock)
const settle = (st: State) => (st.shot ? Math.round((Math.min(st.shot.dur, 16) / 1.25) * 1000) + 1300 : 0)

function groupLabel(st: State, side: number) {
  const g = st.groups[side]
  if (st.variant === "cutthroat") return ["1-5", "6-10", "11-15"][g as number]
  if (st.variant === "9ball") return null
  return g
}
function view(st: State) {
  const side = st.over ? -1 : sideOf(st, st.turn)
  return {
    variant: st.variant, callShot: st.callShot, guide: st.guide, geo, n: st.n, sides: st.sides,
    balls: st.balls.map((b) => b && { x: r5(b.x), y: r5(b.y) }), turn: st.over ? null : st.turn, inHand: st.inHand, breakShot: st.breakShot,
    targets: st.over || side < 0 ? [] : targets(st, side), wanted: st.over || side < 0 ? [] : wanted(st, side), needCall: !st.over && side >= 0 && needCall(st, side), onEight: !st.over && side >= 0 && onEight(st, side),
    groups: Array.from({ length: st.n }, (_, s) => groupLabel(st, sideOf(st, s))), sideOf: Array.from({ length: st.n }, (_, s) => sideOf(st, s)),
    out: st.out.slice(), fouls: st.fouls.slice(), pushAvail: st.pushAvail, choice: st.choice, potted: st.potted.map((x) => x.slice()),
    shot: st.shot, over: st.over, winners: st.winners.slice(), note: st.note, flags: st.flags || {}, lowest: lowestOn(st.balls), visit: st.visit, rackNo: st.rackNo,
    pocketNames: POCKET_NAMES,
  }
}

function info(st: State) {
  const left = (s: number) => groupBalls(st, sideOf(st, s)).filter((b) => st.balls[b]).length
  const scores = Array.from({ length: st.n }, (_, s) => {
    if (st.variant === "9ball") { const n = st.potted[s].length; return `${n} ball${n === 1 ? "" : "s"}` }
    if (st.variant === "cutthroat") return st.out[sideOf(st, s)] ? "out" : `${left(s)} left`
    const g = st.groups[sideOf(st, s)]
    return g ? `${g} · ${left(s)} left` : "open"
  })
  const name = (s: number) => `Seat ${s + 1}`
  if (st.over) {
    const w = st.winners
    const message = w.length === 1 ? `${name(w[0])} wins` : w.length ? `${w.map(name).join(" & ")} win` : "Game over"
    return { turn: null, over: true, winners: w, message, scores }
  }
  const side = sideOf(st, st.turn)
  const what = st.choice ? "deciding" : st.breakShot ? "break" : st.variant === "9ball" ? `the ${lowestOn(st.balls)} is next` : onEight(st, side) ? "on the 8" : st.groups[side] ? `${groupLabel(st, side)}` : st.variant === "8ball" ? "open table" : "any ball"
  return { turn: st.turn, over: false, winners: [], scores, message: `${name(st.turn)} to shoot · ${what}${st.inHand && !st.breakShot ? " · ball in hand" : ""}${st.fouls[side] === 2 && st.variant === "9ball" ? " · on two fouls" : ""}` }
}

const options = [
  { key: "variant", label: "Game", type: "enum", default: "auto", group: "Game",
    help: "8-ball for 2 or 4 players (4 is doubles), Cutthroat for 3. 9-ball works at any count. 8-ball needs two sides, so at 3 players it plays Cutthroat; Cutthroat needs 3 and otherwise plays 8-ball.",
    values: [{ v: "auto", label: "8-ball (Cutthroat at 3)" }, { v: "8ball", label: "8-ball" }, { v: "9ball", label: "9-ball" }, { v: "cutthroat", label: "Cutthroat (3 players)" }] },
  { key: "callShot", label: "Calling shots", type: "enum", default: "wpa", group: "Game",
    help: "8-ball. WPA: every shot names a ball and a pocket (the aim line picks it; tap a pocket to change). House rules: only the 8 is called, or nothing is (slop counts).",
    values: [{ v: "wpa", label: "Call every shot (WPA)" }, { v: "eightOnly", label: "Call the 8 only (house)" }, { v: "off", label: "Slop counts (house)" }] },
  { key: "guide", label: "Aiming guide", type: "enum", default: "short", group: "Table",
    help: "Short: the line to the first ball and where it goes. Full: the whole path the physics predicts, for a casual table. Off: no lines.",
    values: [{ v: "short", label: "Short" }, { v: "full", label: "Full path (casual)" }, { v: "off", label: "Off" }] },
]

export default {
  id: "billiards", name: "Billiards", category: "sports", tagline: "8-ball, 9-ball and Cutthroat in 3D. Real spin, throw, cushions and pocket jaws.",
  min: 1, max: 4, defaultSeats: 2, options, init, view, apply, bot, info, think, settle, testTrials: 1,
}
export { judge, targets, wanted, needCall, candidates, resolveVariant as variantFor }
export { simulate, report, rack, geometry, squirt, strike } from "./engine"
