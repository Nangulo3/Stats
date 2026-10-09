// Comandos del partido: validan contra el estado derivado y devuelven el evento a guardar.
// Son funciones puras: no tocan almacenamiento ni UI.

import { isBackRow, isFrontRow, playersOnCourt, positionOf, rotateClockwise } from './lineup'
import {
  autoLiberoOn,
  autoRotateOn,
  defaultNextServe,
  deriveMatchState,
  validEvents,
  type MatchState,
} from './matchState'
import { newId, nowIso } from './ids'
import type {
  ActionCategory,
  ActionDef,
  AutoEffects,
  ID,
  Lineup,
  LiberoMove,
  LiberoEvent,
  Match,
  MatchEndEvent,
  MatchEvent,
  PlayerSnapshot,
  Position,
  RotationEvent,
  ScoreEvent,
  ServeEvent,
  SetCloseEvent,
  StatEvent,
  SubstitutionEvent,
  Team,
} from './types'

export type CommandResult<T extends MatchEvent = MatchEvent> =
  | { ok: true; event: T }
  | { ok: false; error: string }

export interface Ctx {
  match: Match
  events: MatchEvent[]
  now?: string
  id?: () => string
}

function base(ctx: Ctx, state: MatchState) {
  const maxSeq = ctx.events.reduce((m, e) => Math.max(m, e.seq), 0)
  return {
    id: (ctx.id ?? newId)(),
    matchId: ctx.match.id,
    seq: maxSeq + 1,
    timestamp: ctx.now ?? nowIso(),
    setNumber: state.currentSet,
    score: { ...state.score },
    voided: false,
    voidedAt: null,
  }
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

function rosterPlayer(match: Match, id: ID | null): PlayerSnapshot | null {
  if (!id) return null
  return match.roster.find((p) => p.id === id) ?? null
}

function guardLive(ctx: Ctx, state: MatchState): string | null {
  if (ctx.match.status === 'finished' || state.finished) return 'El partido está finalizado.'
  return null
}

/** Contadores que incrementa una acción: ella misma más sus derivados, sin duplicados. */
export function countersFor(action: ActionDef, allActionIds: Set<ID>): ID[] {
  const out = [action.id]
  for (const id of action.alsoCounts) {
    if (id !== action.id && allActionIds.has(id) && !out.includes(id)) out.push(id)
  }
  return out
}

/** Rol efectivo en el partido: quien juega de líbero cuenta como LI aunque su ficha diga otra cosa. */
export function effectiveRole(player: PlayerSnapshot, match?: Pick<Match, 'liberoId'>) {
  return match && player.id === match.liberoId ? 'LI' : player.role
}

export function isActionAvailableFor(action: ActionDef, player: PlayerSnapshot, match?: Pick<Match, 'liberoId'>): boolean {
  const role = effectiveRole(player, match)
  return action.active && (action.eligibleRoles.length === 0 || action.eligibleRoles.includes(role))
}

export function recordStat(
  ctx: Ctx,
  position: Position,
  action: ActionDef,
  actions: ActionDef[],
  categories: ActionCategory[],
): CommandResult<StatEvent> {
  const state = deriveMatchState(ctx.match, ctx.events)
  const g = guardLive(ctx, state)
  if (g) return fail(g)
  const player = rosterPlayer(ctx.match, state.lineup[position])
  if (!player) return fail(`No hay jugador en la posición ${position}.`)
  if (!action.active) return fail(`La acción ${action.code} está desactivada.`)
  if (!isActionAvailableFor(action, player, ctx.match))
    return fail(`${action.code} no está disponible para el rol de #${player.number}.`)
  const cat = categories.find((c) => c.id === action.categoryId)
  return {
    ok: true,
    event: {
      ...base(ctx, state),
      type: 'stat',
      player: { ...player },
      position,
      action: {
        id: action.id,
        code: action.code,
        name: action.name,
        categoryId: action.categoryId,
        categoryName: cat?.name ?? '—',
        color: cat?.color ?? '#64748b',
      },
      counters: countersFor(action, new Set(actions.map((a) => a.id))),
    },
  }
}

/** Busca, en zaga, al central por el que debe entrar el líbero (P1 primero, luego P6 y P5). */
function centralInBackRow(match: Match, lineup: Lineup): Position | null {
  for (const p of [1, 6, 5] as Position[]) {
    const pl = rosterPlayer(match, lineup[p])
    if (pl && pl.id !== match.liberoId && pl.role === 'CE') return p
  }
  return null
}

/** Si el líbero quedó en la red, sale y vuelve el jugador al que reemplazaba. */
function liberoOutIfFrontRow(match: Match, lineup: Lineup, replacedId: ID | null): LiberoMove | null {
  if (!match.liberoId || !replacedId || !autoLiberoOn(match.rules)) return null
  const pos = positionOf(lineup, match.liberoId)
  if (!pos || !isFrontRow(pos) || playersOnCourt(lineup).includes(replacedId)) return null
  return { position: pos, liberoId: match.liberoId, playerId: replacedId }
}

/**
 * Consecuencias automáticas de un punto:
 * - Si lo ganamos recibiendo (recuperamos el saque) rotamos en sentido horario;
 *   si el líbero llega a la red, sale y vuelve el jugador al que reemplazaba.
 * - Si lo gana el rival mientras sacábamos (perdemos el saque), el líbero entra por el central de zaga.
 */
export function pointEffects(match: Match, state: MatchState, team: Team): AutoEffects | null {
  const sideOut = team !== state.serving
  if (!sideOut) return null
  let lineup = state.lineup
  let rotated = false
  let liberoOut: LiberoMove | null = null
  let liberoIn: LiberoMove | null = null
  if (team === 'us' && autoRotateOn(match.rules)) {
    lineup = rotateClockwise(lineup)
    rotated = true
    liberoOut = liberoOutIfFrontRow(match, lineup, state.liberoReplacedId)
    if (liberoOut) lineup = { ...lineup, [liberoOut.position]: liberoOut.playerId }
  }
  if (team === 'them' && match.liberoId && autoLiberoOn(match.rules) && !positionOf(lineup, match.liberoId)) {
    const pos = centralInBackRow(match, lineup)
    if (pos) {
      liberoIn = { position: pos, liberoId: match.liberoId, playerId: lineup[pos]! }
      lineup = { ...lineup, [pos]: match.liberoId }
    }
  }
  if (!rotated && !liberoOut && !liberoIn) return null
  return { rotated, liberoOut, liberoIn, lineupBefore: { ...state.lineup }, lineupAfter: lineup }
}

export function changeScore(ctx: Ctx, team: Team, delta: 1 | -1): CommandResult<ScoreEvent> {
  const state = deriveMatchState(ctx.match, ctx.events)
  const g = guardLive(ctx, state)
  if (g) return fail(g)
  const before = { ...state.score }
  if (delta < 0 && before[team] === 0) return fail('El marcador no puede bajar de cero.')
  const after = { ...before, [team]: before[team] + delta }
  const servingAfter = delta > 0 ? team : state.serving
  return {
    ok: true,
    event: {
      ...base(ctx, state),
      type: 'score',
      team,
      delta,
      before,
      after,
      servingBefore: state.serving,
      servingAfter,
      auto: delta > 0 ? pointEffects(ctx.match, state, team) : null,
    },
  }
}

/** Corrige manualmente qué equipo tiene el saque (no rota ni cambia el marcador). */
export function setServe(ctx: Ctx, team: Team): CommandResult<ServeEvent> {
  const state = deriveMatchState(ctx.match, ctx.events)
  const g = guardLive(ctx, state)
  if (g) return fail(g)
  if (state.serving === team) return fail('Ese equipo ya tiene el saque.')
  return { ok: true, event: { ...base(ctx, state), type: 'serve', team } }
}

export function substitute(ctx: Ctx, position: Position, inId: ID): CommandResult<SubstitutionEvent> {
  const state = deriveMatchState(ctx.match, ctx.events)
  const g = guardLive(ctx, state)
  if (g) return fail(g)
  const out = rosterPlayer(ctx.match, state.lineup[position])
  const incoming = rosterPlayer(ctx.match, inId)
  if (!out) return fail(`No hay jugador en la posición ${position}.`)
  if (!incoming) return fail('El jugador que entra no está en la plantilla del partido.')
  if (out.id === ctx.match.liberoId) return fail('Para sacar al líbero usa el modo Líbero.')
  if (incoming.id === ctx.match.liberoId) return fail('Para meter al líbero usa el modo Líbero.')
  if (playersOnCourt(state.lineup).includes(incoming.id))
    return fail(`#${incoming.number} ya está en la cancha.`)
  if (state.liberoReplacedId === incoming.id)
    return fail(`#${incoming.number} salió por el líbero; vuelve cuando el líbero salga.`)
  const lineupAfter = { ...state.lineup, [position]: incoming.id }
  return {
    ok: true,
    event: {
      ...base(ctx, state),
      type: 'substitution',
      position,
      out: { ...out },
      in: { ...incoming },
      lineupBefore: { ...state.lineup },
      lineupAfter,
    },
  }
}

export function liberoIn(ctx: Ctx, position: Position): CommandResult<LiberoEvent> {
  const state = deriveMatchState(ctx.match, ctx.events)
  const g = guardLive(ctx, state)
  if (g) return fail(g)
  const libero = rosterPlayer(ctx.match, ctx.match.liberoId)
  if (!libero) return fail('Este partido no tiene líbero.')
  if (state.liberoPosition) return fail('El líbero ya está en la cancha.')
  if (!isBackRow(position)) return fail('El líbero solo puede entrar en una posición zaguera (5, 6 o 1).')
  const player = rosterPlayer(ctx.match, state.lineup[position])
  if (!player) return fail(`No hay jugador en la posición ${position}.`)
  return {
    ok: true,
    event: {
      ...base(ctx, state),
      type: 'libero',
      direction: 'in',
      position,
      libero: { ...libero },
      player: { ...player },
      lineupBefore: { ...state.lineup },
      lineupAfter: { ...state.lineup, [position]: libero.id },
    },
  }
}

/** El líbero sale y vuelve el jugador al que reemplazó (o, si ya no está disponible, quien se indique). */
export function liberoOut(ctx: Ctx, returningId?: ID): CommandResult<LiberoEvent> {
  const state = deriveMatchState(ctx.match, ctx.events)
  const g = guardLive(ctx, state)
  if (g) return fail(g)
  const libero = rosterPlayer(ctx.match, ctx.match.liberoId)
  if (!libero || !state.liberoPosition) return fail('El líbero no está en la cancha.')
  const backId = returningId ?? state.liberoReplacedId
  const player = rosterPlayer(ctx.match, backId)
  if (!player) return fail('Elige qué jugador vuelve a la cancha.')
  if (playersOnCourt(state.lineup).includes(player.id)) return fail(`#${player.number} ya está en la cancha.`)
  const position = state.liberoPosition
  return {
    ok: true,
    event: {
      ...base(ctx, state),
      type: 'libero',
      direction: 'out',
      position,
      libero: { ...libero },
      player: { ...player },
      lineupBefore: { ...state.lineup },
      lineupAfter: { ...state.lineup, [position]: player.id },
    },
  }
}

export function rotate(ctx: Ctx): CommandResult<RotationEvent> {
  const state = deriveMatchState(ctx.match, ctx.events)
  const g = guardLive(ctx, state)
  if (g) return fail(g)
  let lineupAfter = rotateClockwise(state.lineup)
  const liberoOut = liberoOutIfFrontRow(ctx.match, lineupAfter, state.liberoReplacedId)
  if (liberoOut) lineupAfter = { ...lineupAfter, [liberoOut.position]: liberoOut.playerId }
  return {
    ok: true,
    event: {
      ...base(ctx, state),
      type: 'rotation',
      lineupBefore: { ...state.lineup },
      lineupAfter,
      liberoOut,
    },
  }
}

/**
 * Cierra el set. En los sets normales saca primero el equipo que no sacó primero en el
 * anterior; antes del set decisivo hay nuevo sorteo, así que se puede indicar nextServe.
 */
export function closeSet(ctx: Ctx, nextServe?: Team): CommandResult<SetCloseEvent> {
  const state = deriveMatchState(ctx.match, ctx.events)
  const g = guardLive(ctx, state)
  if (g) return fail(g)
  const { us, them } = state.score
  if (us === them) return fail('No se puede cerrar un set empatado.')
  const winner: Team = us > them ? 'us' : 'them'
  return {
    ok: true,
    event: { ...base(ctx, state), type: 'set_close', winner, nextServe: nextServe ?? defaultNextServe(state) },
  }
}

export function endMatch(ctx: Ctx): CommandResult<MatchEndEvent> {
  const state = deriveMatchState(ctx.match, ctx.events)
  const g = guardLive(ctx, state)
  if (g) return fail(g)
  return { ok: true, event: { ...base(ctx, state), type: 'match_end' } }
}

// ---------- Deshacer / anular ----------

export function lastUndoable(events: MatchEvent[]): MatchEvent | null {
  const valid = validEvents(events)
  return valid.length ? valid[valid.length - 1] : null
}

export function lastScoreEvent(events: MatchEvent[], setNumber: number, team?: Team): ScoreEvent | null {
  const valid = validEvents(events).filter(
    (e): e is ScoreEvent => e.type === 'score' && e.setNumber === setNumber && (!team || e.team === team),
  )
  return valid.length ? valid[valid.length - 1] : null
}

/**
 * Qué se puede anular sin dejar el partido incoherente:
 * - la última acción, siempre;
 * - una estadística, siempre (no afecta cancha, saque ni marcador);
 * - un punto, si después solo hay estadísticas (el saque y las rotaciones dependen del orden de los puntos);
 * - sustituciones, líbero, rotaciones, saque y cierres, solo si son lo último.
 */
export function canVoid(events: MatchEvent[], e: MatchEvent): boolean {
  if (e.voided) return false
  const valid = validEvents(events)
  if (valid.length && valid[valid.length - 1].id === e.id) return true
  if (e.type === 'stat') return true
  if (e.type === 'score') return !valid.some((x) => x.seq > e.seq && x.type !== 'stat')
  return false
}

/** Marca un evento como anulado. No borra nada: el rastro queda en el historial. */
export function voidEvent(events: MatchEvent[], id: ID, now: string = nowIso()): MatchEvent[] {
  return events.map((e) => (e.id === id ? { ...e, voided: true, voidedAt: now } : e))
}

export function teamName(match: Match, team: Team): string {
  return team === 'us' ? match.ourTeam : match.opponent
}

/** Texto corto para el botón Deshacer y para el historial. */
export function describeEvent(e: MatchEvent, match: Match): string {
  switch (e.type) {
    case 'stat':
      return `${e.action.code} de #${e.player.number}`
    case 'score': {
      if (e.delta < 0) return `corrección −1 ${e.team === 'us' ? 'nuestro equipo' : 'rival'}`
      const parts = [`punto de ${e.team === 'us' ? 'nuestro equipo' : 'rival'}`]
      const num = (id: ID) => match.roster.find((p) => p.id === id)?.number ?? '?'
      if (e.auto?.rotated) parts.push('rotación')
      if (e.auto?.liberoOut) parts.push(`sale líbero, vuelve #${num(e.auto.liberoOut.playerId)}`)
      if (e.auto?.liberoIn) parts.push(`entra líbero por #${num(e.auto.liberoIn.playerId)}`)
      return parts.join(' · ')
    }
    case 'serve':
      return `saque para ${teamName(match, e.team)}`
    case 'substitution':
      return `sustitución: sale #${e.out.number}, entra #${e.in.number} (pos. ${e.position})`
    case 'libero':
      return e.direction === 'in'
        ? `entrada del líbero #${e.libero.number} por #${e.player.number}`
        : `salida del líbero, vuelve #${e.player.number}`
    case 'rotation': {
      const back = e.liberoOut ? match.roster.find((p) => p.id === e.liberoOut!.playerId)?.number : null
      return back ? `rotación · sale líbero, vuelve #${back}` : 'rotación'
    }
    case 'set_close':
      return `cierre del set ${e.setNumber} (gana ${teamName(match, e.winner)})`
    case 'match_end':
      return 'fin del partido'
  }
}

export function undoLabel(e: MatchEvent | null, match: Match): string {
  return e ? `Deshacer ${describeEvent(e, match)}` : 'Nada que deshacer'
}
