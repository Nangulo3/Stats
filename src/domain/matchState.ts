import { emptyLineup, cloneLineup, isFrontRow, positionOf, rotateClockwise } from './lineup'
import type { ID, Lineup, Match, MatchEvent, MatchRules, Position, Score, Team } from './types'

export interface SetResult {
  number: number
  score: Score
  closed: boolean
  winner: Team | null
}

export interface MatchState {
  currentSet: number
  score: Score
  sets: SetResult[]
  setsWon: Score
  lineup: Lineup
  /** Jugador de campo que salió por el líbero (null si el líbero no está en cancha). */
  liberoReplacedId: ID | null
  liberoPosition: Position | null
  liberoFrontRowWarning: boolean
  finished: boolean
}

export function validEvents(events: MatchEvent[]): MatchEvent[] {
  return events.filter((e) => !e.voided).sort((a, b) => a.seq - b.seq)
}

export function setTarget(rules: MatchRules, setNumber: number): number {
  return setNumber === rules.bestOf ? rules.decidingSetPoints : rules.pointsPerSet
}

export function setsToWin(rules: MatchRules): number {
  return Math.ceil(rules.bestOf / 2)
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

/**
 * Reconstruye el estado del partido aplicando, en orden, los eventos no anulados.
 * Es la única fuente del marcador, el set actual y la cancha.
 */
export function deriveMatchState(match: Match, events: MatchEvent[]): MatchState {
  let lineup: Lineup = cloneLineup(match.initialLineup ?? emptyLineup())
  let liberoReplacedId: ID | null = null
  let currentSet = 1
  let finished = false
  const scores = new Map<number, Score>([[1, { us: 0, them: 0 }]])
  const winners = new Map<number, Team>()

  for (const e of validEvents(events)) {
    switch (e.type) {
      case 'score': {
        const s = scores.get(e.setNumber) ?? { us: 0, them: 0 }
        const next = { ...s }
        next[e.team] = Math.max(0, next[e.team] + e.delta)
        scores.set(e.setNumber, next)
        break
      }
      case 'rotation':
        lineup = rotateClockwise(lineup)
        break
      case 'substitution':
        if (lineup[e.position] === e.out.id) lineup = { ...lineup, [e.position]: e.in.id }
        break
      case 'libero':
        if (e.direction === 'in') {
          if (lineup[e.position] === e.player.id) {
            lineup = { ...lineup, [e.position]: e.libero.id }
            liberoReplacedId = e.player.id
          }
        } else {
          const pos = positionOf(lineup, e.libero.id)
          if (pos) {
            lineup = { ...lineup, [pos]: e.player.id }
            liberoReplacedId = null
          }
        }
        break
      case 'set_close':
        winners.set(e.setNumber, e.winner)
        currentSet = e.setNumber + 1
        if (!scores.has(currentSet)) scores.set(currentSet, { us: 0, them: 0 })
        break
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
    }))

  const setsWon: Score = { us: 0, them: 0 }
  for (const w of winners.values()) setsWon[w]++

  const liberoPosition = match.liberoId ? positionOf(lineup, match.liberoId) : null
  return {
    currentSet,
    score: scores.get(currentSet) ?? { us: 0, them: 0 },
    sets,
    setsWon,
    lineup,
    liberoReplacedId: liberoPosition ? liberoReplacedId : null,
    liberoPosition,
    liberoFrontRowWarning: liberoPosition !== null && isFrontRow(liberoPosition),
    finished,
  }
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
  }
}
