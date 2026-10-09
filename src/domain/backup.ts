// Copia de seguridad JSON (con versión de esquema) y exportación CSV.

import { describeEvent } from './commands'
import { CONFIG_VERSION } from './defaults'
import { deriveMatchState } from './matchState'
import { formatEfficiency, playerRows, statColumns, teamCounts } from './stats'
import type { ActionCategory, ActionDef, Match, MatchEvent, Player } from './types'

export const SCHEMA_VERSION = 1
export const APP_ID = 'volei-match-tracker'

export interface AppData {
  players: Player[]
  categories: ActionCategory[]
  actions: ActionDef[]
  matches: Match[]
  events: MatchEvent[]
}

export interface BackupFile extends AppData {
  app: typeof APP_ID
  schemaVersion: number
  /** Versión de la configuración de acciones (para migrarla al importar). */
  configVersion?: number
  exportedAt: string
}

export function buildBackup(data: AppData, now = new Date().toISOString()): BackupFile {
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, configVersion: CONFIG_VERSION, exportedAt: now, ...data }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

function checkPlayer(p: unknown): boolean {
  return isObj(p) && isStr(p.id) && isNum(p.number) && isStr(p.name) && isStr(p.role) && isBool(p.active)
}
function checkCategory(c: unknown): boolean {
  return isObj(c) && isStr(c.id) && isStr(c.name) && isStr(c.color) && isNum(c.order)
}
function checkAction(a: unknown): boolean {
  return (
    isObj(a) &&
    isStr(a.id) &&
    isStr(a.code) &&
    isStr(a.name) &&
    isStr(a.categoryId) &&
    isBool(a.active) &&
    isNum(a.order) &&
    Array.isArray(a.alsoCounts) &&
    Array.isArray(a.eligibleRoles)
  )
}
function checkMatch(m: unknown): boolean {
  return (
    isObj(m) &&
    isStr(m.id) &&
    isStr(m.ourTeam) &&
    isStr(m.opponent) &&
    isObj(m.rules) &&
    Array.isArray(m.roster) &&
    isObj(m.initialLineup) &&
    (m.status === 'live' || m.status === 'finished')
  )
}
const EVENT_TYPES = new Set(['stat', 'score', 'substitution', 'libero', 'rotation', 'serve', 'set_close', 'match_end'])
function checkEvent(e: unknown): boolean {
  return (
    isObj(e) &&
    isStr(e.id) &&
    isStr(e.matchId) &&
    isNum(e.seq) &&
    isStr(e.type) &&
    EVENT_TYPES.has(e.type) &&
    isNum(e.setNumber) &&
    isObj(e.score) &&
    isBool(e.voided)
  )
}

export type ParseResult = { ok: true; data: BackupFile } | { ok: false; error: string }

/** Valida un archivo de copia antes de importarlo. No acepta datos parciales o corruptos. */
export function parseBackup(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'El archivo no es un JSON válido.' }
  }
  if (!isObj(raw) || raw.app !== APP_ID) return { ok: false, error: 'El archivo no es una copia de esta aplicación.' }
  if (!isNum(raw.schemaVersion)) return { ok: false, error: 'Falta la versión de esquema.' }
  if (raw.schemaVersion > SCHEMA_VERSION)
    return { ok: false, error: `La copia es de una versión más nueva (esquema ${raw.schemaVersion}). Actualiza la app.` }
  const lists: [keyof AppData, (x: unknown) => boolean][] = [
    ['players', checkPlayer],
    ['categories', checkCategory],
    ['actions', checkAction],
    ['matches', checkMatch],
    ['events', checkEvent],
  ]
  for (const [key, check] of lists) {
    const arr = raw[key]
    if (!Array.isArray(arr)) return { ok: false, error: `Falta la lista “${key}”.` }
    const bad = arr.findIndex((x) => !check(x))
    if (bad >= 0) return { ok: false, error: `Elemento ${bad + 1} de “${key}” no es válido.` }
  }
  const matchIds = new Set((raw.matches as Match[]).map((m) => m.id))
  if ((raw.events as MatchEvent[]).some((e) => !matchIds.has(e.matchId)))
    return { ok: false, error: 'Hay eventos que no pertenecen a ningún partido.' }
  // Migraciones futuras: if (raw.schemaVersion < 2) { ... }
  return { ok: true, data: raw as unknown as BackupFile }
}

// ---------- CSV ----------

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: unknown[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export function eventsCsv(match: Match, events: MatchEvent[]): string {
  const header = [
    'secuencia', 'hora', 'set', 'tipo', 'jugador_numero', 'jugador_nombre', 'posicion_cancha',
    'accion_codigo', 'accion_nombre', 'categoria', 'contadores', 'marcador_nuestro', 'marcador_rival',
    'descripcion', 'anulado',
  ]
  const rows = [...events].sort((a, b) => a.seq - b.seq).map((e) => {
    const isStat = e.type === 'stat'
    const pos = e.type === 'stat' || e.type === 'substitution' || e.type === 'libero' ? e.position : ''
    const player = isStat ? e.player : e.type === 'libero' ? e.player : e.type === 'substitution' ? e.in : null
    return [
      e.seq,
      e.timestamp,
      e.setNumber,
      e.type,
      player?.number ?? '',
      player?.name ?? '',
      pos,
      isStat ? e.action.code : '',
      isStat ? e.action.name : '',
      isStat ? e.action.categoryName : '',
      isStat ? e.counters.join('|') : '',
      e.score.us,
      e.score.them,
      describeEvent(e, match),
      e.voided ? 'sí' : 'no',
    ]
  })
  return toCsv([header, ...rows])
}

export function summaryCsv(
  match: Match,
  events: MatchEvent[],
  actions: ActionDef[],
  categories: ActionCategory[],
): string {
  const cols = statColumns(actions, categories, events)
  const state = deriveMatchState(match, events)
  const out: unknown[][] = []
  out.push(['partido', `${match.ourTeam} vs ${match.opponent}`, 'fecha', match.date])
  out.push(['sets', `${state.setsWon.us}-${state.setsWon.them}`])
  for (const s of state.sets) out.push([`set ${s.number}`, `${s.score.us}-${s.score.them}`])
  out.push([])
  const header = ['ambito', 'numero', 'nombre', 'rol', ...cols.map((c) => c.code), 'puntos', 'eficiencia_ataque']
  out.push(header)
  const scopes: { label: string; set?: number }[] = [
    { label: 'partido' },
    ...state.sets.map((s) => ({ label: `set ${s.number}`, set: s.number })),
  ]
  for (const scope of scopes) {
    const rows = playerRows(match, events, { setNumber: scope.set }).sort((a, b) => a.player.number - b.player.number)
    for (const r of rows)
      out.push([
        scope.label,
        r.player.number,
        r.player.name,
        r.player.role,
        ...cols.map((c) => r.counts[c.id] ?? 0),
        r.derived.points,
        formatEfficiency(r.derived.attackEfficiency),
      ])
    const team = teamCounts(events, { setNumber: scope.set })
    out.push([scope.label, '', 'EQUIPO', '', ...cols.map((c) => team[c.id] ?? 0), '', ''])
  }
  return toCsv(out)
}
