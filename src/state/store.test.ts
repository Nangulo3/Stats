import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { changeScore, recordStat } from '../domain/commands'
import { DEFAULT_RULES } from '../domain/defaults'
import { deriveMatchState } from '../domain/matchState'
import { loadAll } from '../persistence/db'
import { useStore } from './store'

const s = () => useStore.getState()

describe('store + IndexedDB', () => {
  beforeAll(async () => {
    await s().init()
  })

  it('siembra la configuración por defecto la primera vez', async () => {
    expect(s().categories.length).toBe(6)
    expect(s().actions.some((a) => a.code === 'BM')).toBe(true)
    const stored = await loadAll()
    expect(stored.seeded).toBe(true)
    expect(stored.actions.length).toBe(s().actions.length)
  })

  it('guarda partido y eventos, y sobreviven a una recarga', async () => {
    for (let n = 1; n <= 7; n++) await s().savePlayer({ number: String(n), name: `J${n}`, role: n === 7 ? 'LI' : 'PU' })
    const ps = s().players
    const lineup = { 1: ps[0].id, 2: ps[1].id, 3: ps[2].id, 4: ps[3].id, 5: ps[4].id, 6: ps[5].id }
    const matchId = await s().createMatch({
      ourTeam: 'A',
      opponent: 'B',
      date: new Date().toISOString(),
      rules: DEFAULT_RULES,
      firstServe: 'us',
      lineup,
      liberoId: ps[6].id,
      liberoStartPosition: 6,
    })
    const kills = s().actions.find((a) => a.code === 'Kills')!
    await s().run(matchId, (ctx) => changeScore(ctx, 'us', 1))
    await s().run(matchId, (ctx) => recordStat(ctx, 4, kills, s().actions, s().categories))
    await s().undoLast(matchId)

    const stored = await loadAll()
    const match = stored.matches.find((m) => m.id === matchId)!
    const events = stored.events.filter((e) => e.matchId === matchId)
    expect(events).toHaveLength(3) // líbero inicial + punto + kill anulado
    expect(events.find((e) => e.type === 'stat')?.voided).toBe(true)
    const st = deriveMatchState(match, events)
    expect(st.score).toEqual({ us: 1, them: 0 })
    expect(st.lineup[6]).toBe(ps[6].id)
  })

  it('no borra jugadores que participaron en partidos: los desactiva', async () => {
    const p = s().players[0]
    expect(await s().removePlayer(p.id)).toBe('deactivated')
    expect(s().players.find((x) => x.id === p.id)?.active).toBe(false)
    const extra = await s().savePlayer({ number: '40', name: 'Nuevo', role: 'CE' })
    expect(await s().removePlayer(extra.id)).toBe('deleted')
  })

  it('la configuración persiste y se puede restaurar', async () => {
    const cat = { id: 'cat-x', name: 'Saque táctico', color: '#0f766e', icon: '★', order: 6 }
    await s().saveCategory(cat)
    expect((await loadAll()).categories.some((c) => c.id === 'cat-x')).toBe(true)
    await s().restoreDefaults()
    expect((await loadAll()).categories.some((c) => c.id === 'cat-x')).toBe(false)
  })

  it('la importación reemplaza todos los datos', async () => {
    const backup = s().exportData()
    await s().importData({ ...backup, players: [] })
    expect((await loadAll()).players).toHaveLength(0)
    await s().importData(backup)
    expect((await loadAll()).players.length).toBe(backup.players.length)
  })
})
