import { emptyLineup, cloneLineup, isFrontRow, positionOf, rotateClockwise } from './lineup'
import type { ID, Lineup, LiberoMove, Match, MatchEvent, MatchRules, Position, Score, Team } from './types'

export interface SetResult {
  number: number
  score: Score
  closed: boolean
  winner: Team | null
  firstServe: Team
}

export interface MatchState {
  currentSet: number
  score: Score
  sets: SetResult[]
  setsWon: Score
  lineup: Lineup
  /** Equipo que tiene el saque para el próximo rally. */
  serving: Team
  /** Jugador de campo que salió por el líbero (null si el líbero no está en cancha). */
  liberoReplacedId: ID | null
  liberoPosition: Position | null
  liberoFrontRowWarning: boolean
  finished: boolean
}

export const other = (t: Team): Team => (t === 'us' ? 'them' : 'us')

export function validEvents(events: MatchEvent[]): MatchEvent[] {
  return events.filter((e) => !e.voided).sort((a, b) => a.seq - b.seq)
}

export function setTarget(rules: MatchRules, setNumber: number): number {
  return setNumber === rules.bestOf ? rules.decidingSetPoints : rules.pointsPerSet
}

export function setsToWin(rules: MatchRules): number {
  return Math.ceil(rules.bestOf / 2)
}

export function isDecidingSet(rules: MatchRules, setNumber: number): boolean {
  return setNumber === rules.bestOf
}

export function autoRotateOn(rules: MatchRules): boolean {
  return rules.autoRotate !== false
}

export function autoLiberoOn(rules: MatchRules): boolean {
  return rules.autoLibero !== false
}

/** Ganador del set si el marcador ya alcanzó el objetivo (con diferencia de 2 si aplica). */
export function setWinnerByRules(score: Score, target: number, winByTwo: boolean): Team | null {
  const lead = Math.abs(score.us - score.them)
  const top = Math.max(score.us, score.them)
  if (top < target) return null
  if (winByTwo && lead < 2) return null
  if (lead === 0) return null
  return score.us > score.them ? 'us' : 'them'
}

interface Court {
  lineup: Lineup
  liberoReplacedId: ID | null
}

function applyLiberoIn(c: Court, m: LiberoMove): Court {
  if (c.lineup[m.position] !== m.playerId) return c
  return { lineup: { ...c.lineup, [m.position]: m.liberoId }, liberoReplacedId: m.playerId }
}

function applyLiberoOut(c: Court, m: LiberoMove): Court {
  const pos = positionOf(c.lineup, m.liberoId)
  if (!pos) return c
  return { lineup: { ...c.lineup, [pos]: m.playerId }, liberoReplacedId: null }
}

/**
 * Reconstruye el estado del partido aplicando, en orden, los eventos no anulados.
 * Es la única fuente del marcador, el saque, el set actual y la cancha.
 */
export function deriveMatchState(match: Match, events: MatchEvent[]): MatchState {
  let court: Court = { lineup: cloneLineup(match.initialLineup ?? emptyLineup()), liberoReplacedId: null }
  let currentSet = 1
  let finished = false
  let serving: Team = match.firstServe
  const scores = new Map<number, Score>([[1, { us: 0, them: 0 }]])
  const firstServes = new Map<number, Team>([[1, match.firstServe]])
  const winners = new Map<number, Team>()

  for (const e of validEvents(events)) {
    switch (e.type) {
      case 'score': {
        const s = scores.get(e.setNumber) ?? { us: 0, them: 0 }
        const next = { ...s }
        next[e.team] = Math.max(0, next[e.team] + e.delta)
        scores.set(e.setNumber, next)
        if (e.servingAfter) serving = e.servingAfter
        else if (e.delta > 0) serving = e.team
        if (e.auto) {
          if (e.auto.rotated) court = { ...court, lineup: rotateClockwise(court.lineup) }
          if (e.auto.liberoOut) court = applyLiberoOut(court, e.auto.liberoOut)
          if (e.auto.liberoIn) court = applyLiberoIn(court, e.auto.liberoIn)
        }
        break
      }
      case 'rotation':
        court = { ...court, lineup: rotateClockwise(court.lineup) }
        if (e.liberoOut) court = applyLiberoOut(court, e.liberoOut)
        break
      case 'serve':
        serving = e.team
        break
      case 'substitution':
        if (court.lineup[e.position] === e.out.id) court = { ...court, lineup: { ...court.lineup, [e.position]: e.in.id } }
        break
      case 'libero': {
        const move = { position: e.position, liberoId: e.libero.id, playerId: e.player.id }
        court = e.direction === 'in' ? applyLiberoIn(court, move) : applyLiberoOut(court, move)
        break
      }
      case 'set_close': {
        winners.set(e.setNumber, e.winner)
        const prevFirst = firstServes.get(e.setNumber) ?? match.firstServe
        currentSet = e.setNumber + 1
        const nextFirst = e.nextServe ?? other(prevFirst)
        firstServes.set(currentSet, nextFirst)
        serving = nextFirst
        if (!scores.has(currentSet)) scores.set(currentSet, { us: 0, them: 0 })
        break
      }
      case 'match_end':
        finished = true
        break
      case 'stat':
        break
    }
  }

  const sets: SetResult[] = [...scores.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([n]) => n <= currentSet)
    .map(([number, score]) => ({
      number,
      score,
      closed: winners.has(number),
      winner: winners.get(number) ?? null,
      firstServe: firstServes.get(number) ?? match.firstServe,
    }))

  const setsWon: Score = { us: 0, them: 0 }
  for (const w of winners.values()) setsWon[w]++

  const liberoPosition = match.liberoId ? positionOf(court.lineup, match.liberoId) : null
  return {
    currentSet,
    score: scores.get(currentSet) ?? { us: 0, them: 0 },
    sets,
    setsWon,
    lineup: court.lineup,
    serving,
    liberoReplacedId: liberoPosition ? court.liberoReplacedId : null,
    liberoPosition,
    liberoFrontRowWarning: liberoPosition !== null && isFrontRow(liberoPosition),
    finished,
  }
}

/** Quién saca primero en el set siguiente por defecto: el que no sacó primero en el actual. */
export function defaultNextServe(state: MatchState): Team {
  const cur = state.sets.find((s) => s.number === state.currentSet)
  return other(cur?.firstServe ?? state.serving)
}

/** Sugerencias para la pantalla en vivo (no avanzan nada sin confirmación). */
export function suggestions(match: Match, state: MatchState) {
  const target = setTarget(match.rules, state.currentSet)
  const setWinner = state.finished ? null : setWinnerByRules(state.score, target, match.rules.winByTwo)
  const needed = setsToWin(match.rules)
  const matchWinner: Team | null =
    state.setsWon.us >= needed ? 'us' : state.setsWon.them >= needed ? 'them' : null
  return {
    target,
    closeSet: matchWinner ? null : setWinner,
    endMatch: state.finished ? null : matchWinner,
    /** El set que se abriría al cerrar este es el decisivo: hay que sortear el saque. */
    nextIsDeciding: isDecidingSet(match.rules, state.currentSet + 1),
  }
}
