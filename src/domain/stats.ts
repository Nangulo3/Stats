// Agregación de estadísticas. Todo se calcula desde los eventos válidos;
// no hay contadores guardados aparte que puedan desincronizarse.

import { METRIC_IDS } from './defaults'
import { validEvents } from './matchState'
import type { ActionCategory, ActionDef, ID, Match, MatchEvent, PlayerSnapshot, StatEvent } from './types'

export type Counts = Record<ID, number>

export interface StatColumn {
  id: ID
  code: string
  name: string
  color: string
  categoryName: string
  teamMetric: boolean
}

export interface PlayerRow {
  player: PlayerSnapshot
  counts: Counts
  derived: DerivedMetrics
}

export interface DerivedMetrics {
  /** (Kills − Errors) / Attempts. null si no hay intentos. */
  attackEfficiency: number | null
  /** Kills + Aces + SB. */
  points: number
  /** Total de eventos estadísticos registrados para el jugador. */
  actions: number
}

export interface StatsFilter {
  setNumber?: number
}

export function statEvents(events: MatchEvent[], filter: StatsFilter = {}): StatEvent[] {
  return validEvents(events).filter(
    (e): e is StatEvent =>
      e.type === 'stat' && (filter.setNumber === undefined || e.setNumber === filter.setNumber),
  )
}

/** Suma los contadores fijados en cada evento (acción + derivados) una sola vez. */
export function countByPlayer(events: MatchEvent[], filter: StatsFilter = {}): Map<ID, Counts> {
  const out = new Map<ID, Counts>()
  for (const e of statEvents(events, filter)) {
    const c = out.get(e.player.id) ?? {}
    for (const id of e.counters) c[id] = (c[id] ?? 0) + 1
    out.set(e.player.id, c)
  }
  return out
}

export function teamCounts(events: MatchEvent[], filter: StatsFilter = {}): Counts {
  const c: Counts = {}
  for (const e of statEvents(events, filter)) for (const id of e.counters) c[id] = (c[id] ?? 0) + 1
  return c
}

export function derive(counts: Counts, actionsCount: number): DerivedMetrics {
  const k = counts[METRIC_IDS.kills] ?? 0
  const e = counts[METRIC_IDS.attackErrors] ?? 0
  const ta = counts[METRIC_IDS.attempts] ?? 0
  return {
    attackEfficiency: ta > 0 ? (k - e) / ta : null,
    points: k + (counts[METRIC_IDS.aces] ?? 0) + (counts[METRIC_IDS.soloBlocks] ?? 0),
    actions: actionsCount,
  }
}

/**
 * Columnas del resumen: las acciones actuales en el orden de configuración, más las que
 * solo existen en el historial (acciones eliminadas), con su nombre de aquel momento.
 */
export function statColumns(
  actions: ActionDef[],
  categories: ActionCategory[],
  events: MatchEvent[],
): StatColumn[] {
  const catOrder = new Map(categories.map((c) => [c.id, c]))
  const sorted = [...actions].sort((a, b) => {
    const ca = catOrder.get(a.categoryId)?.order ?? 999
    const cb = catOrder.get(b.categoryId)?.order ?? 999
    return ca - cb || a.order - b.order
  })
  const cols: StatColumn[] = sorted.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    color: catOrder.get(a.categoryId)?.color ?? '#64748b',
    categoryName: catOrder.get(a.categoryId)?.name ?? '—',
    teamMetric: a.teamMetric,
  }))
  const known = new Set(cols.map((c) => c.id))
  for (const e of statEvents(events)) {
    if (!known.has(e.action.id)) {
      known.add(e.action.id)
      cols.push({
        id: e.action.id,
        code: e.action.code,
        name: `${e.action.name} (eliminada)`,
        color: e.action.color,
        categoryName: e.action.categoryName,
        teamMetric: false,
      })
    }
  }
  return cols
}

/** Filas por jugador: todos los del partido, aunque hayan salido de la cancha. */
export function playerRows(match: Match, events: MatchEvent[], filter: StatsFilter = {}): PlayerRow[] {
  const counts = countByPlayer(events, filter)
  const actionTotals = new Map<ID, number>()
  for (const e of statEvents(events, filter))
    actionTotals.set(e.player.id, (actionTotals.get(e.player.id) ?? 0) + 1)
  const seen = new Map<ID, PlayerSnapshot>(match.roster.map((p) => [p.id, p]))
  for (const e of statEvents(events)) if (!seen.has(e.player.id)) seen.set(e.player.id, e.player)
  return [...seen.values()].map((player) => {
    const c = counts.get(player.id) ?? {}
    return { player, counts: c, derived: derive(c, actionTotals.get(player.id) ?? 0) }
  })
}

export type SortKey = 'number' | 'name' | { column: ID } | 'points' | 'efficiency'

export function sortRows(rows: PlayerRow[], key: SortKey, dir: 'asc' | 'desc' = 'asc'): PlayerRow[] {
  const val = (r: PlayerRow): number | string => {
    if (key === 'number') return r.player.number
    if (key === 'name') return r.player.name.toLocaleLowerCase('es')
    if (key === 'points') return r.derived.points
    if (key === 'efficiency') return r.derived.attackEfficiency ?? -Infinity
    return r.counts[key.column] ?? 0
  }
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = val(a)
    const vb = val(b)
    if (va < vb) return -1 * sign
    if (va > vb) return 1 * sign
    return a.player.number - b.player.number
  })
}

/** Quién registró cada acción de equipo (p. ej. BM) para poder consultarlo. */
export function attributionsFor(events: MatchEvent[], actionId: ID, filter: StatsFilter = {}) {
  const byPlayer = new Map<ID, { player: PlayerSnapshot; count: number }>()
  for (const e of statEvents(events, filter)) {
    if (!e.counters.includes(actionId)) continue
    const cur = byPlayer.get(e.player.id) ?? { player: e.player, count: 0 }
    cur.count++
    byPlayer.set(e.player.id, cur)
  }
  return [...byPlayer.values()].sort((a, b) => b.count - a.count)
}

export function formatEfficiency(v: number | null): string {
  if (v === null) return '—'
  return (v >= 0 ? '' : '−') + Math.abs(v).toFixed(3).replace(/^0/, '')
}
