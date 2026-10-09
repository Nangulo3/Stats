import { BACK_ROW, FRONT_ROW, POSITIONS, type ID, type Lineup, type Position } from './types'

export function emptyLineup(): Lineup {
  return { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null }
}

export function cloneLineup(l: Lineup): Lineup {
  return { ...l }
}

/**
 * Rotación en sentido horario:
 * 4→3, 3→2, 2→1, 1→6, 6→5, 5→4.
 * Devuelve una alineación nueva; no toca estadísticas ni roles.
 */
export function rotateClockwise(l: Lineup): Lineup {
  return {
    3: l[4],
    2: l[3],
    1: l[2],
    6: l[1],
    5: l[6],
    4: l[5],
  }
}

export function positionOf(l: Lineup, playerId: ID): Position | null {
  for (const p of POSITIONS) if (l[p] === playerId) return p
  return null
}

export function playersOnCourt(l: Lineup): ID[] {
  return POSITIONS.map((p) => l[p]).filter((x): x is ID => x !== null)
}

export function isFrontRow(p: Position): boolean {
  return FRONT_ROW.includes(p)
}

export function isBackRow(p: Position): boolean {
  return BACK_ROW.includes(p)
}

export interface LineupValidation {
  ok: boolean
  errors: string[]
}

/** Valida una alineación inicial: 6 jugadores distintos, todos presentes y activos. */
export function validateStartingLineup(
  l: Lineup,
  isActive: (id: ID) => boolean,
  liberoId: ID | null,
): LineupValidation {
  const errors: string[] = []
  const missing = POSITIONS.filter((p) => !l[p])
  if (missing.length) errors.push(`Falta asignar la posición ${missing.join(', ')}.`)
  const ids = playersOnCourt(l)
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (dup.length) errors.push('Un mismo jugador está asignado a más de una posición.')
  if (ids.some((id) => !isActive(id))) errors.push('Hay un jugador inactivo en la alineación.')
  if (liberoId && ids.includes(liberoId))
    errors.push('El líbero no se asigna como titular; elige con quién entra desde el inicio.')
  return { ok: errors.length === 0, errors }
}
