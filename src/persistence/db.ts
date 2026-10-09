// Almacenamiento local en IndexedDB (vía idb). Cada cambio se escribe de inmediato.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AppData } from '../domain/backup'
import { CONFIG_VERSION } from '../domain/defaults'
import type { ActionCategory, ActionDef, Match, MatchEvent, Player } from '../domain/types'

const DB_NAME = 'volei-match-tracker'
const DB_VERSION = 1

interface Meta {
  key: string
  value: unknown
}

interface VoleiDB extends DBSchema {
  players: { key: string; value: Player }
  categories: { key: string; value: ActionCategory }
  actions: { key: string; value: ActionDef }
  matches: { key: string; value: Match }
  events: { key: string; value: MatchEvent; indexes: { byMatch: string } }
  meta: { key: string; value: Meta }
}

let dbPromise: Promise<IDBPDatabase<VoleiDB>> | null = null

export function getDb(): Promise<IDBPDatabase<VoleiDB>> {
  if (!dbPromise) {
    dbPromise = openDB<VoleiDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('players', { keyPath: 'id' })
        db.createObjectStore('categories', { keyPath: 'id' })
        db.createObjectStore('actions', { keyPath: 'id' })
        db.createObjectStore('matches', { keyPath: 'id' })
        const ev = db.createObjectStore('events', { keyPath: 'id' })
        ev.createIndex('byMatch', 'matchId')
        db.createObjectStore('meta', { keyPath: 'key' })
      },
    })
  }
  return dbPromise
}

export async function loadAll(): Promise<AppData & { seeded: boolean; configVersion: number }> {
  const db = await getDb()
  const [players, categories, actions, matches, events, seeded, configVersion] = await Promise.all([
    db.getAll('players'),
    db.getAll('categories'),
    db.getAll('actions'),
    db.getAll('matches'),
    db.getAll('events'),
    db.get('meta', 'seeded'),
    db.get('meta', 'configVersion'),
  ])
  return {
    players,
    categories,
    actions,
    matches,
    events,
    seeded: Boolean(seeded?.value),
    // Antes de existir este campo la configuración era la versión 1.
    configVersion: typeof configVersion?.value === 'number' ? configVersion.value : 1,
  }
}

export async function putPlayer(p: Player) {
  await (await getDb()).put('players', p)
}

export async function deletePlayer(id: string) {
  await (await getDb()).delete('players', id)
}

export async function putMatch(m: Match) {
  await (await getDb()).put('matches', m)
}

/** Guarda en una sola transacción el partido y los eventos nuevos o modificados. */
export async function putMatchWithEvents(m: Match, events: MatchEvent[]) {
  const db = await getDb()
  const tx = db.transaction(['matches', 'events'], 'readwrite')
  await Promise.all([tx.objectStore('matches').put(m), ...events.map((e) => tx.objectStore('events').put(e)), tx.done])
}

/** Reemplaza toda la configuración de acciones y categorías. */
export async function replaceConfig(categories: ActionCategory[], actions: ActionDef[]) {
  const db = await getDb()
  const tx = db.transaction(['categories', 'actions', 'meta'], 'readwrite')
  const cs = tx.objectStore('categories')
  const as = tx.objectStore('actions')
  await Promise.all([cs.clear(), as.clear()])
  await Promise.all([
    ...categories.map((c) => cs.put(c)),
    ...actions.map((a) => as.put(a)),
    tx.objectStore('meta').put({ key: 'seeded', value: true }),
    tx.objectStore('meta').put({ key: 'configVersion', value: CONFIG_VERSION }),
    tx.done,
  ])
}

/** Importación de copia: reemplaza todos los datos en una sola transacción. */
export async function replaceAll(data: AppData) {
  const db = await getDb()
  const names = ['players', 'categories', 'actions', 'matches', 'events', 'meta'] as const
  const tx = db.transaction(names, 'readwrite')
  await Promise.all(names.map((n) => tx.objectStore(n).clear()))
  await Promise.all([
    ...data.players.map((x) => tx.objectStore('players').put(x)),
    ...data.categories.map((x) => tx.objectStore('categories').put(x)),
    ...data.actions.map((x) => tx.objectStore('actions').put(x)),
    ...data.matches.map((x) => tx.objectStore('matches').put(x)),
    ...data.events.map((x) => tx.objectStore('events').put(x)),
    tx.objectStore('meta').put({ key: 'seeded', value: true }),
    tx.objectStore('meta').put({ key: 'configVersion', value: CONFIG_VERSION }),
    tx.done,
  ])
}

/** Pide al navegador no borrar los datos locales bajo presión de espacio. */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist()
  } catch {
    // no es crítico
  }
}
