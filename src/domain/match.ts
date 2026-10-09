import { validateStartingLineup, isBackRow } from './lineup'
import { newId, nowIso } from './ids'
import type { ID, Lineup, Match, MatchEvent, MatchRules, Player, PlayerRole, PlayerSnapshot, Position, Team } from './types'

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

// ---------- Plantilla de prueba y alineación sugerida ----------

/** Plantilla fija de 7 jugadores para probar rápido: 2 puntas, 1 opuesto, 1 armador, 2 centrales y 1 líbero. */
export const DEMO_ROSTER: { number: number; name: string; role: PlayerRole }[] = [
  { number: 1, name: 'Armador', role: 'AR' },
  { number: 2, name: 'Punta 1', role: 'PU' },
  { number: 3, name: 'Central 1', role: 'CE' },
  { number: 4, name: 'Opuesto', role: 'OP' },
  { number: 5, name: 'Punta 2', role: 'PU' },
  { number: 6, name: 'Central 2', role: 'CE' },
  { number: 12, name: 'Líbero', role: 'LI' },
]

/** Jugadores de la plantilla de prueba que faltan (no se duplican números de jugadores activos). */
export function missingDemoPlayers(existing: Player[]): PlayerDraft[] {
  const used = new Set(existing.filter((p) => p.active).map((p) => p.number))
  return DEMO_ROSTER.filter((d) => !used.has(d.number)).map((d) => ({
    number: String(d.number),
    name: d.name,
    role: d.role,
  }))
}

/**
 * Alineación 5-1 clásica según la posición habitual:
 * armador P1, puntas P2 y P5, central P3 y P6, opuesto P4. El líbero entra por el central de P6.
 * Devuelve null si no hay suficientes jugadores de cada rol.
 */
export function suggestLineup(players: Player[]): { lineup: Lineup; liberoId: ID | null; liberoStart: Position | null } | null {
  const active = [...players].filter((p) => p.active).sort((a, b) => a.number - b.number)
  const take = (role: PlayerRole, n: number) => active.filter((p) => p.role === role).slice(0, n)
  const [ar] = take('AR', 1)
  const pu = take('PU', 2)
  const ce = take('CE', 2)
  const [op] = take('OP', 1)
  if (!ar || pu.length < 2 || ce.length < 2 || !op) return null
  const [li] = take('LI', 1)
  return {
    lineup: { 1: ar.id, 2: pu[0].id, 3: ce[0].id, 4: op.id, 5: pu[1].id, 6: ce[1].id },
    liberoId: li?.id ?? null,
    liberoStart: li ? 6 : null,
  }
}
