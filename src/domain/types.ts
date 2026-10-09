// Tipos del dominio. Todo lo que pasa en un partido es un MatchEvent;
// el estado visible (marcador, cancha, set) se reconstruye a partir de ellos.

export type ID = string

export type Position = 1 | 2 | 3 | 4 | 5 | 6
export const POSITIONS: readonly Position[] = [1, 2, 3, 4, 5, 6]
export const FRONT_ROW: readonly Position[] = [4, 3, 2]
export const BACK_ROW: readonly Position[] = [5, 6, 1]

export type PlayerRole = 'PU' | 'OP' | 'CE' | 'AR' | 'LI' | 'DE'

export const ROLE_LABELS: Record<PlayerRole, string> = {
  PU: 'Punta',
  OP: 'Opuesto',
  CE: 'Central',
  AR: 'Armador',
  LI: 'Líbero',
  DE: 'Defensivo',
}

export interface Player {
  id: ID
  number: number
  name: string
  role: PlayerRole
  active: boolean
  createdAt: string
  updatedAt: string
}

/** Copia de los datos del jugador tal como estaban en el partido/evento. */
export interface PlayerSnapshot {
  id: ID
  number: number
  name: string
  role: PlayerRole
}

export interface ActionCategory {
  id: ID
  name: string
  color: string
  icon: string
  order: number
}

export interface ActionDef {
  id: ID
  /** Abreviatura visible en el botón (Kills, SB, SD…). */
  code: string
  name: string
  description: string
  categoryId: ID
  active: boolean
  order: number
  /** Contadores adicionales (ids de otras acciones) que se suman una vez al registrar esta acción. */
  alsoCounts: ID[]
  /** Roles que pueden usarla. Vacío = todos. */
  eligibleRoles: PlayerRole[]
  /** Pide confirmación antes de registrar. */
  confirm: boolean
  /** Se muestra en el resumen de equipo. */
  teamMetric: boolean
}

export interface ActionSnapshot {
  id: ID
  code: string
  name: string
  categoryId: ID
  categoryName: string
  color: string
}

export type Team = 'us' | 'them'
export interface Score {
  us: number
  them: number
}

export type Lineup = Record<Position, ID | null>

export interface MatchRules {
  bestOf: 3 | 5
  pointsPerSet: number
  decidingSetPoints: number
  winByTwo: boolean
}

export type MatchStatus = 'live' | 'finished'

export interface Match {
  id: ID
  ourTeam: string
  opponent: string
  date: string
  rules: MatchRules
  firstServe: Team
  status: MatchStatus
  /** Instantánea de todos los jugadores disponibles para este partido. */
  roster: PlayerSnapshot[]
  liberoId: ID | null
  initialLineup: Lineup
  /** Si el líbero entra desde el inicio, a qué posición zaguera. */
  initialLiberoPosition: Position | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

interface BaseEvent {
  id: ID
  matchId: ID
  seq: number
  timestamp: string
  setNumber: number
  /** Marcador visible en el instante del registro (antes del efecto del propio evento). */
  score: Score
  voided: boolean
  voidedAt: string | null
}

export interface StatEvent extends BaseEvent {
  type: 'stat'
  player: PlayerSnapshot
  position: Position
  action: ActionSnapshot
  /** Contadores efectivamente incrementados (acción + derivados), fijados al registrar. */
  counters: ID[]
}

export interface ScoreEvent extends BaseEvent {
  type: 'score'
  team: Team
  delta: 1 | -1
  before: Score
  after: Score
}

export interface SubstitutionEvent extends BaseEvent {
  type: 'substitution'
  position: Position
  out: PlayerSnapshot
  in: PlayerSnapshot
  lineupBefore: Lineup
  lineupAfter: Lineup
}

export interface LiberoEvent extends BaseEvent {
  type: 'libero'
  direction: 'in' | 'out'
  position: Position
  libero: PlayerSnapshot
  /** Jugador de campo que sale (direction=in) o que vuelve (direction=out). */
  player: PlayerSnapshot
  lineupBefore: Lineup
  lineupAfter: Lineup
}

export interface RotationEvent extends BaseEvent {
  type: 'rotation'
  lineupBefore: Lineup
  lineupAfter: Lineup
}

export interface SetCloseEvent extends BaseEvent {
  type: 'set_close'
  winner: Team
}

export interface MatchEndEvent extends BaseEvent {
  type: 'match_end'
}

export type MatchEvent =
  | StatEvent
  | ScoreEvent
  | SubstitutionEvent
  | LiberoEvent
  | RotationEvent
  | SetCloseEvent
  | MatchEndEvent

export type EventType = MatchEvent['type']

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  stat: 'Estadística',
  score: 'Marcador',
  substitution: 'Sustitución',
  libero: 'Líbero',
  rotation: 'Rotación',
  set_close: 'Cierre de set',
  match_end: 'Fin del partido',
}
