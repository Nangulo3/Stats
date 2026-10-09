import { validateStartingLineup, isBackRow } from './lineup'
import { newId, nowIso } from './ids'
import type { ID, Lineup, Match, MatchEvent, MatchRules, Player, PlayerSnapshot, Position, Team } from './types'

export interface NewMatchInput {
  ourTeam: string
  opponent: string
  date: string
  rules: MatchRules
  firstServe: Team
  lineup: Lineup
  liberoId: ID | null
  /** Posición zaguera donde entra el líbero desde el inicio (opcional). */
  liberoStartPosition: Position | null
}

export function snapshot(p: Player): PlayerSnapshot {
  return { id: p.id, number: p.number, name: p.name, role: p.role }
}

export function validateNewMatch(input: NewMatchInput, players: Player[]): string[] {
  const errors: string[] = []
  if (!input.ourTeam.trim()) errors.push('Escribe el nombre de tu equipo.')
  if (!input.opponent.trim()) errors.push('Escribe el nombre del rival.')
  if (!Number.isFinite(Date.parse(input.date))) errors.push('La fecha no es válida.')
  const r = input.rules
  if (!Number.isInteger(r.pointsPerSet) || r.pointsPerSet < 1) errors.push('Los puntos por set deben ser un entero positivo.')
  if (!Number.isInteger(r.decidingSetPoints) || r.decidingSetPoints < 1)
    errors.push('Los puntos del set decisivo deben ser un entero positivo.')
  const active = new Map(players.filter((p) => p.active).map((p) => [p.id, p]))
  errors.push(...validateStartingLineup(input.lineup, (id) => active.has(id), input.liberoId).errors)
  if (input.liberoId && !active.has(input.liberoId)) errors.push('El líbero elegido no está activo.')
  if (input.liberoStartPosition) {
    if (!input.liberoId) errors.push('Elige un líbero para que entre desde el inicio.')
    else if (!isBackRow(input.liberoStartPosition))
      errors.push('El líbero solo puede entrar en una posición zaguera (5, 6 o 1).')
    else if (input.liberoStartPosition === 1 && input.firstServe === 'us')
      errors.push('El líbero no puede sacar: si sacamos primero, no lo pongas en P1.')
  }
  return errors
}

/**
 * Crea el partido. La plantilla del partido es una instantánea de todos los jugadores
 * activos: titulares, líbero y suplentes. Si el líbero entra desde el inicio se registra
 * como evento de líbero, igual que cualquier otra entrada.
 */
export function createMatch(
  input: NewMatchInput,
  players: Player[],
  now: string = nowIso(),
): { match: Match; events: MatchEvent[] } {
  const roster = players.filter((p) => p.active).map(snapshot)
  const match: Match = {
    id: newId(),
    ourTeam: input.ourTeam.trim(),
    opponent: input.opponent.trim(),
    date: input.date,
    rules: { ...input.rules },
    firstServe: input.firstServe,
    status: 'live',
    roster,
    liberoId: input.liberoId,
    initialLineup: { ...input.lineup },
    initialLiberoPosition: input.liberoStartPosition,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
  }
  const events: MatchEvent[] = []
  if (input.liberoId && input.liberoStartPosition) {
    const libero = roster.find((p) => p.id === input.liberoId)!
    const replaced = roster.find((p) => p.id === input.lineup[input.liberoStartPosition!])!
    events.push({
      id: newId(),
      matchId: match.id,
      seq: 1,
      timestamp: now,
      setNumber: 1,
      score: { us: 0, them: 0 },
      voided: false,
      voidedAt: null,
      type: 'libero',
      direction: 'in',
      position: input.liberoStartPosition,
      libero,
      player: replaced,
      lineupBefore: { ...input.lineup },
      lineupAfter: { ...input.lineup, [input.liberoStartPosition]: libero.id },
    })
  }
  return { match, events }
}

// ---------- Jugadores ----------

export interface PlayerDraft {
  number: string
  name: string
  role: Player['role'] | ''
}

export type PlayerErrors = Partial<Record<keyof PlayerDraft, string>>

export function validatePlayer(draft: PlayerDraft, others: Player[], editingId?: ID): PlayerErrors {
  const errors: PlayerErrors = {}
  const n = Number(draft.number)
  if (draft.number.trim() === '' || !Number.isInteger(n) || n < 0 || n > 99)
    errors.number = 'Número de camiseta entre 0 y 99.'
  else if (others.some((p) => p.active && p.id !== editingId && p.number === n))
    errors.number = `El #${n} ya lo usa otro jugador activo.`
  if (!draft.name.trim()) errors.name = 'Escribe el nombre.'
  else if (draft.name.trim().length > 40) errors.name = 'Máximo 40 caracteres.'
  if (!draft.role) errors.role = 'Elige la posición habitual.'
  return errors
}
