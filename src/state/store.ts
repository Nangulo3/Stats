// Estado de la app (zustand). Aplica comandos del dominio y persiste cada cambio
// inmediatamente en IndexedDB. La UI nunca modifica datos por su cuenta.

import { useMemo } from 'react'
import { create } from 'zustand'
import { buildBackup, type AppData, type BackupFile } from '../domain/backup'
import {
  lastScoreEvent,
  lastUndoable,
  voidEvent,
  type CommandResult,
  type Ctx,
} from '../domain/commands'
import { cloneDefaults } from '../domain/defaults'
import { newId, nowIso } from '../domain/ids'
import { createMatch as domainCreateMatch, type NewMatchInput, type PlayerDraft } from '../domain/match'
import { deriveMatchState } from '../domain/matchState'
import type { ActionCategory, ActionDef, ID, Match, MatchEvent, Player, Team } from '../domain/types'
import * as db from '../persistence/db'

export interface Toast {
  id: number
  message: string
  /** Si existe, el toast ofrece deshacer este evento. */
  undoEventId?: ID
  matchId?: ID
  kind: 'info' | 'error'
}

interface State {
  loaded: boolean
  loadError: string | null
  players: Player[]
  categories: ActionCategory[]
  actions: ActionDef[]
  matches: Match[]
  events: MatchEvent[]
  pendingWrites: number
  toast: Toast | null

  init(): Promise<void>
  showToast(t: Omit<Toast, 'id'>): void
  dismissToast(): void

  savePlayer(draft: PlayerDraft, id?: ID): Promise<Player>
  setPlayerActive(id: ID, active: boolean): Promise<void>
  removePlayer(id: ID): Promise<'deleted' | 'deactivated'>

  createMatch(input: NewMatchInput): Promise<ID>
  run<E extends MatchEvent>(matchId: ID, cmd: (ctx: Ctx) => CommandResult<E>): Promise<E | null>
  undoLast(matchId: ID): Promise<void>
  undoLastPoint(matchId: ID): Promise<void>
  voidEventById(matchId: ID, eventId: ID): Promise<void>

  saveCategory(c: ActionCategory): Promise<void>
  deleteCategory(id: ID): Promise<string | null>
  saveAction(a: ActionDef): Promise<void>
  deleteAction(id: ID): Promise<void>
  setConfig(categories: ActionCategory[], actions: ActionDef[]): Promise<void>
  restoreDefaults(): Promise<void>

  exportData(): BackupFile
  importData(data: AppData): Promise<void>
}

let toastSeq = 0

/**
 * Estadísticas se pueden anular en cualquier momento (no afectan a la cancha ni al marcador);
 * puntos, mientras su set siga abierto. Sustituciones, líbero, rotaciones y cierres solo si
 * son lo último, para no dejar la cancha o los sets en un estado incoherente.
 */
export function canVoid(events: MatchEvent[], e: MatchEvent): boolean {
  if (e.voided) return false
  if (lastUndoable(events)?.id === e.id) return true
  if (e.type === 'stat') return true
  if (e.type === 'score')
    return !events.some((x) => !x.voided && x.type === 'set_close' && x.setNumber === e.setNumber)
  return false
}

export const useStore = create<State>()((set, get) => {
  /** Ejecuta una escritura, contando las pendientes para avisar al cerrar la página. */
  async function persist<T>(fn: () => Promise<T>): Promise<T> {
    set((s) => ({ pendingWrites: s.pendingWrites + 1 }))
    try {
      return await fn()
    } catch (err) {
      get().showToast({ kind: 'error', message: `No se pudo guardar: ${(err as Error).message ?? err}` })
      throw err
    } finally {
      set((s) => ({ pendingWrites: s.pendingWrites - 1 }))
    }
  }

  function matchById(id: ID): Match {
    const m = get().matches.find((x) => x.id === id)
    if (!m) throw new Error('Partido no encontrado')
    return m
  }

  function matchEvents(id: ID): MatchEvent[] {
    return get().events.filter((e) => e.matchId === id)
  }

  /** Actualiza estado del partido según sus eventos y guarda partido + eventos cambiados. */
  async function commitMatch(match: Match, allMatchEvents: MatchEvent[], changed: MatchEvent[]) {
    const state = deriveMatchState(match, allMatchEvents)
    const now = nowIso()
    const updated: Match = {
      ...match,
      status: state.finished ? 'finished' : 'live',
      finishedAt: state.finished ? (match.finishedAt ?? now) : null,
      updatedAt: now,
    }
    set((s) => ({
      matches: s.matches.map((m) => (m.id === match.id ? updated : m)),
      events: [...s.events.filter((e) => e.matchId !== match.id), ...allMatchEvents],
    }))
    await persist(() => db.putMatchWithEvents(updated, changed))
  }

  return {
    loaded: false,
    loadError: null,
    players: [],
    categories: [],
    actions: [],
    matches: [],
    events: [],
    pendingWrites: 0,
    toast: null,

    async init() {
      try {
        const data = await db.loadAll()
        let { categories, actions } = data
        if (!data.seeded && categories.length === 0 && actions.length === 0) {
          const d = cloneDefaults()
          categories = d.categories
          actions = d.actions
          await db.replaceConfig(categories, actions)
        }
        set({ ...data, categories, actions, loaded: true })
        void db.requestPersistentStorage()
      } catch (err) {
        set({ loadError: (err as Error).message ?? String(err), loaded: true })
      }
    },

    showToast(t) {
      set({ toast: { ...t, id: ++toastSeq } })
    },
    dismissToast() {
      set({ toast: null })
    },

    // ---------- jugadores ----------

    async savePlayer(draft, id) {
      const now = nowIso()
      const existing = id ? get().players.find((p) => p.id === id) : undefined
      const player: Player = {
        id: existing?.id ?? newId(),
        number: Number(draft.number),
        name: draft.name.trim(),
        role: draft.role as Player['role'],
        active: existing?.active ?? true,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      set((s) => ({
        players: existing ? s.players.map((p) => (p.id === player.id ? player : p)) : [...s.players, player],
      }))
      await persist(() => db.putPlayer(player))
      return player
    },

    async setPlayerActive(id, active) {
      const p = get().players.find((x) => x.id === id)
      if (!p) return
      const updated = { ...p, active, updatedAt: nowIso() }
      set((s) => ({ players: s.players.map((x) => (x.id === id ? updated : x)) }))
      await persist(() => db.putPlayer(updated))
    },

    /** Si el jugador participó en algún partido no se borra: se desactiva. */
    async removePlayer(id) {
      const used = get().matches.some((m) => m.roster.some((r) => r.id === id))
      if (used) {
        await get().setPlayerActive(id, false)
        return 'deactivated'
      }
      set((s) => ({ players: s.players.filter((p) => p.id !== id) }))
      await persist(() => db.deletePlayer(id))
      return 'deleted'
    },

    // ---------- partido ----------

    async createMatch(input) {
      const { match, events } = domainCreateMatch(input, get().players)
      set((s) => ({ matches: [...s.matches, match], events: [...s.events, ...events] }))
      await persist(() => db.putMatchWithEvents(match, events))
      return match.id
    },

    async run(matchId, cmd) {
      const match = matchById(matchId)
      const events = matchEvents(matchId)
      const r = cmd({ match, events })
      if (!r.ok) {
        get().showToast({ kind: 'error', message: r.error })
        return null
      }
      await commitMatch(match, [...events, r.event], [r.event])
      return r.event
    },

    async undoLast(matchId) {
      const events = matchEvents(matchId)
      const last = lastUndoable(events)
      if (!last) return
      await get().voidEventById(matchId, last.id)
    },

    async undoLastPoint(matchId) {
      const match = matchById(matchId)
      const events = matchEvents(matchId)
      const state = deriveMatchState(match, events)
      const last = lastScoreEvent(events, state.currentSet)
      if (!last) {
        get().showToast({ kind: 'error', message: 'No hay puntos que corregir en este set.' })
        return
      }
      await get().voidEventById(matchId, last.id)
    },

    async voidEventById(matchId, eventId) {
      const match = matchById(matchId)
      const current = matchEvents(matchId)
      const target = current.find((e) => e.id === eventId)
      if (!target || target.voided) return
      if (!canVoid(current, target)) {
        get().showToast({
          kind: 'error',
          message: 'Solo se puede deshacer si es la última acción registrada.',
        })
        return
      }
      const events = voidEvent(current, eventId)
      const changed = events.find((e) => e.id === eventId)
      if (!changed) return
      await commitMatch(match, events, [changed])
    },

    // ---------- configuración ----------

    async saveCategory(c) {
      const exists = get().categories.some((x) => x.id === c.id)
      const categories = exists ? get().categories.map((x) => (x.id === c.id ? c : x)) : [...get().categories, c]
      await get().setConfig(categories, get().actions)
    },

    async deleteCategory(id) {
      if (get().actions.some((a) => a.categoryId === id))
        return 'Mueve o elimina primero las acciones de esta categoría.'
      const categories = get()
        .categories.filter((c) => c.id !== id)
        .sort((a, b) => a.order - b.order)
        .map((c, i) => ({ ...c, order: i }))
      await get().setConfig(categories, get().actions)
      return null
    },

    async saveAction(a) {
      const exists = get().actions.some((x) => x.id === a.id)
      const actions = exists ? get().actions.map((x) => (x.id === a.id ? a : x)) : [...get().actions, a]
      await get().setConfig(get().categories, actions)
    },

    async deleteAction(id) {
      const actions = get()
        .actions.filter((a) => a.id !== id)
        .map((a) => ({ ...a, alsoCounts: a.alsoCounts.filter((x) => x !== id) }))
      await get().setConfig(get().categories, actions)
    },

    async setConfig(categories, actions) {
      set({ categories, actions })
      await persist(() => db.replaceConfig(categories, actions))
    },

    async restoreDefaults() {
      const d = cloneDefaults()
      await get().setConfig(d.categories, d.actions)
    },

    // ---------- copia de seguridad ----------

    exportData() {
      const { players, categories, actions, matches, events } = get()
      return buildBackup({ players, categories, actions, matches, events })
    },

    async importData(data) {
      const clean: AppData = {
        players: data.players,
        categories: data.categories,
        actions: data.actions,
        matches: data.matches,
        events: data.events,
      }
      await persist(() => db.replaceAll(clean))
      set({ ...clean })
    },
  }
})

export function useMatchEvents(matchId: ID | undefined): MatchEvent[] {
  const events = useStore((s) => s.events)
  return useMemo(() => events.filter((e) => e.matchId === matchId), [events, matchId])
}

export function teamLabel(match: Match, t: Team) {
  return t === 'us' ? match.ourTeam : match.opponent
}
