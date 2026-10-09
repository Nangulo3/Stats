import { describe, expect, it } from 'vitest'
import { buildBackup, eventsCsv, parseBackup, summaryCsv } from './backup'
import {
  canVoid,
  changeScore,
  closeSet,
  describeEvent,
  isActionAvailableFor,
  setServe,
  countersFor,
  endMatch,
  lastScoreEvent,
  lastUndoable,
  liberoIn,
  liberoOut,
  recordStat,
  rotate,
  substitute,
  undoLabel,
  voidEvent,
  type CommandResult,
  type Ctx,
} from './commands'
import { validateConfig, moveInOrder } from './config'
import { cloneDefaults, DEFAULT_RULES, migrateActions, NO_LIBERO_ACTION_IDS } from './defaults'
import { rotateClockwise, validateStartingLineup } from './lineup'
import { createMatch, DEMO_ROSTER, missingDemoPlayers, suggestLineup, validateNewMatch, validatePlayer, type NewMatchInput } from './match'
import { defaultNextServe, deriveMatchState, setWinnerByRules, suggestions } from './matchState'
import { attributionsFor, countByPlayer, playerRows, sortRows, statColumns, teamCounts } from './stats'
import { BACK_ROW, FRONT_ROW, NON_LIBERO_ROLES, type ActionDef, type Lineup, type Match, type MatchEvent, type Player, type PlayerRole, type Position } from './types'

// ---------- utilidades ----------

const T0 = '2026-10-08T20:00:00.000Z'
function mkPlayer(id: string, number: number, role: Player['role'] = 'PU', active = true): Player {
  return { id, number, name: `Jugador ${number}`, role, active, createdAt: T0, updatedAt: T0 }
}

const players: Player[] = [
  mkPlayer('p1', 1, 'AR'),
  mkPlayer('p2', 2, 'PU'),
  mkPlayer('p3', 3, 'CE'),
  mkPlayer('p4', 4, 'OP'),
  mkPlayer('p5', 5, 'PU'),
  mkPlayer('p6', 6, 'CE'),
  mkPlayer('p7', 7, 'PU'), // suplente
  mkPlayer('p8', 8, 'CE'), // suplente
  mkPlayer('lib', 12, 'LI'),
  mkPlayer('off', 99, 'PU', false),
]

const lineup: Lineup = { 1: 'p1', 2: 'p2', 3: 'p3', 4: 'p4', 5: 'p5', 6: 'p6' }

function setup(extra: Partial<NewMatchInput> = {}) {
  const input: NewMatchInput = {
    ourTeam: 'Nosotros',
    opponent: 'Rival',
    date: T0,
    rules: { ...DEFAULT_RULES },
    firstServe: 'us',
    lineup,
    liberoId: 'lib',
    liberoStartPosition: null,
    ...extra,
  }
  const { match, events } = createMatch(input, players, T0)
  return new Game(match, events)
}

/** Pequeño simulador: aplica comandos y acumula eventos como lo haría el store. */
class Game {
  config = cloneDefaults()
  match: Match
  events: MatchEvent[]
  private n = 0
  constructor(match: Match, events: MatchEvent[]) {
    this.match = match
    this.events = events
  }
  get ctx(): Ctx {
    this.n++
    return {
      match: this.match,
      events: this.events,
      now: new Date(Date.parse(T0) + this.n * 1000).toISOString(),
      id: () => `e${this.events.length + 1}-${this.n}`,
    }
  }
  apply<E extends MatchEvent>(r: CommandResult<E>): E {
    if (!r.ok) throw new Error(r.error)
    this.events = [...this.events, r.event]
    return r.event
  }
  action(code: string): ActionDef {
    const a = this.config.actions.find((x) => x.code === code)
    if (!a) throw new Error(`sin acción ${code}`)
    return a
  }
  stat(pos: Position, code: string) {
    return this.apply(recordStat(this.ctx, pos, this.action(code), this.config.actions, this.config.categories))
  }
  point(team: 'us' | 'them', times = 1) {
    for (let i = 0; i < times; i++) this.apply(changeScore(this.ctx, team, 1))
  }
  get state() {
    return deriveMatchState(this.match, this.events)
  }
  undo() {
    const last = lastUndoable(this.events)
    if (!last) throw new Error('nada que deshacer')
    this.events = voidEvent(this.events, last.id)
    return last
  }
}

// ---------- rotación ----------

describe('rotación', () => {
  it('aplica el mapeo horario 4→3, 3→2, 2→1, 1→6, 6→5, 5→4', () => {
    const r = rotateClockwise(lineup)
    expect(r).toEqual({ 3: 'p4', 2: 'p3', 1: 'p2', 6: 'p1', 5: 'p6', 4: 'p5' })
  })
  it('seis rotaciones vuelven a la alineación inicial', () => {
    let l = lineup
    for (let i = 0; i < 6; i++) l = rotateClockwise(l)
    expect(l).toEqual(lineup)
  })
  it('el comando registra el estado anterior y posterior sin tocar estadísticas', () => {
    const g = setup()
    g.stat(4, 'Kills')
    const ev = g.apply(rotate(g.ctx))
    expect(ev.lineupBefore).toEqual(lineup)
    expect(ev.lineupAfter[3]).toBe('p4')
    expect(g.state.lineup[3]).toBe('p4')
    expect(countByPlayer(g.events).get('p4')).toEqual({ 'act-kills': 1, 'act-attempts': 1 })
  })
})

// ---------- alineación y partido ----------

describe('preparación del partido', () => {
  it('rechaza posiciones vacías, duplicados e inactivos', () => {
    const active = (id: string) => players.find((p) => p.id === id)?.active ?? false
    expect(validateStartingLineup({ ...lineup, 6: null }, active, null).ok).toBe(false)
    expect(validateStartingLineup({ ...lineup, 6: 'p1' }, active, null).ok).toBe(false)
    expect(validateStartingLineup({ ...lineup, 6: 'off' }, active, null).ok).toBe(false)
    expect(validateStartingLineup(lineup, active, null).ok).toBe(true)
  })
  it('el líbero que entra desde el inicio queda en una de las seis posiciones, no como séptimo', () => {
    const g = setup({ liberoStartPosition: 5 })
    const s = g.state
    expect(Object.values(s.lineup).filter(Boolean)).toHaveLength(6)
    expect(s.lineup[5]).toBe('lib')
    expect(s.liberoReplacedId).toBe('p5')
    expect(g.events[0].type).toBe('libero')
  })
  it('no permite al líbero entrar desde el inicio en fila delantera', () => {
    const errors = validateNewMatch(
      { ourTeam: 'A', opponent: 'B', date: T0, rules: DEFAULT_RULES, firstServe: 'us', lineup, liberoId: 'lib', liberoStartPosition: 3 },
      players,
    )
    expect(errors.join(' ')).toMatch(/zaguera/)
  })
  it('valida jugadores: número, duplicado activo, nombre y rol', () => {
    expect(validatePlayer({ number: '120', name: 'X', role: 'PU' }, players).number).toBeTruthy()
    expect(validatePlayer({ number: '2', name: 'X', role: 'PU' }, players).number).toMatch(/#2/)
    expect(validatePlayer({ number: '99', name: 'X', role: 'PU' }, players).number).toBeUndefined() // el 99 está inactivo
    expect(validatePlayer({ number: '2', name: 'X', role: 'PU' }, players, 'p2')).toEqual({})
    expect(validatePlayer({ number: '30', name: ' ', role: '' }, players)).toMatchObject({ name: expect.any(String), role: expect.any(String) })
  })
})

// ---------- estadísticas y marcador ----------

describe('estadísticas', () => {
  it('Kills suma Kills y Attempts; Errors suma Errors y Attempts', () => {
    const g = setup()
    g.stat(4, 'Kills')
    g.stat(4, 'Errors')
    g.stat(4, 'Attempts')
    expect(countByPlayer(g.events).get('p4')).toEqual({ 'act-kills': 1, 'act-errors': 1, 'act-attempts': 3 })
  })
  it('SB y BE suman también a Blocks', () => {
    const g = setup()
    g.stat(3, 'SB')
    g.stat(3, 'BE')
    g.stat(3, 'Blocks')
    expect(countByPlayer(g.events).get('p3')).toEqual({ 'act-sb': 1, 'act-be': 1, 'act-blocks': 3 })
  })
  it('una acción genera exactamente un evento', () => {
    const g = setup()
    const before = g.events.length
    g.stat(2, 'Kills')
    expect(g.events.length).toBe(before + 1)
  })
  it('registrar una estadística no cambia el marcador', () => {
    const g = setup()
    g.stat(1, 'Aces')
    g.stat(4, 'Kills')
    expect(g.state.score).toEqual({ us: 0, them: 0 })
  })
  it('cada evento guarda el marcador del instante, aunque luego cambie', () => {
    const g = setup()
    g.point('us', 3)
    g.point('them', 1)
    const ev = g.stat(2, 'Kills')
    g.point('us', 5)
    expect(ev.score).toEqual({ us: 3, them: 1 })
    expect(ev.setNumber).toBe(1)
    expect(ev.position).toBe(2)
    expect(ev.player.number).toBe(2)
  })
  it('no permite estadísticas en una posición sin jugador', () => {
    const g = setup()
    g.match = { ...g.match, initialLineup: { ...lineup, 6: null } }
    const r = recordStat(g.ctx, 6, g.action('Kills'), g.config.actions, g.config.categories)
    expect(r.ok).toBe(false)
  })
  it('respeta las acciones restringidas por rol', () => {
    const g = setup()
    const sd = g.action('SD')
    sd.eligibleRoles = ['LI']
    expect(recordStat(g.ctx, 1, sd, g.config.actions, g.config.categories).ok).toBe(false)
  })
  it('renombrar una acción no cambia los registros anteriores', () => {
    const g = setup()
    const ev = g.stat(4, 'Kills')
    g.action('Kills').name = 'Remate ganador'
    g.action('Kills').code = 'K'
    expect(ev.action.code).toBe('Kills')
    expect(ev.action.name).toBe('Punto de ataque')
    expect(countByPlayer(g.events).get('p4')?.['act-kills']).toBe(1)
  })
  it('los contadores derivados se fijan al registrar (cambiar la regla no reescribe el pasado)', () => {
    const g = setup()
    g.stat(4, 'Kills')
    g.action('Kills').alsoCounts = []
    g.stat(4, 'Kills')
    expect(countByPlayer(g.events).get('p4')).toEqual({ 'act-kills': 2, 'act-attempts': 1 })
  })
  it('countersFor elimina auto-referencias, duplicados y acciones inexistentes', () => {
    const a = { ...cloneDefaults().actions[0], id: 'x', alsoCounts: ['x', 'y', 'y', 'ghost'] }
    expect(countersFor(a, new Set(['x', 'y']))).toEqual(['x', 'y'])
  })
})

describe('marcador', () => {
  it('+1 suma al set actual y no baja de cero', () => {
    const g = setup()
    g.point('us')
    expect(g.state.score).toEqual({ us: 1, them: 0 })
    expect(changeScore(g.ctx, 'them', -1).ok).toBe(false)
    const ev = g.apply(changeScore(g.ctx, 'us', -1))
    expect(ev.before).toEqual({ us: 1, them: 0 })
    expect(ev.after).toEqual({ us: 0, them: 0 })
  })
  it('sugiere cerrar el set solo con objetivo y diferencia de dos', () => {
    expect(setWinnerByRules({ us: 25, them: 24 }, 25, true)).toBeNull()
    expect(setWinnerByRules({ us: 25, them: 23 }, 25, true)).toBe('us')
    expect(setWinnerByRules({ us: 25, them: 24 }, 25, false)).toBe('us')
    expect(setWinnerByRules({ us: 26, them: 28 }, 25, true)).toBe('them')
  })
  it('el set decisivo usa 15 puntos', () => {
    const g = setup({ rules: { ...DEFAULT_RULES, bestOf: 3 } })
    g.point('us', 25)
    g.apply(closeSet(g.ctx))
    g.point('them', 25)
    g.apply(closeSet(g.ctx))
    expect(g.state.currentSet).toBe(3)
    g.point('us', 15)
    expect(suggestions(g.match, g.state).closeSet).toBe('us')
  })
})

// ---------- sets ----------

describe('sets y cierre', () => {
  it('al cerrar un set el siguiente empieza 0–0 y la cancha se mantiene', () => {
    const g = setup({ liberoId: null })
    g.apply(rotate(g.ctx))
    g.point('us', 25)
    g.point('them', 20)
    expect(suggestions(g.match, g.state).closeSet).toBe('us')
    g.apply(closeSet(g.ctx))
    const s = g.state
    expect(s.currentSet).toBe(2)
    expect(s.score).toEqual({ us: 0, them: 0 })
    expect(s.sets[0]).toMatchObject({ number: 1, score: { us: 25, them: 20 }, closed: true, winner: 'us' })
    expect(s.lineup).toEqual(rotateClockwise(lineup))
  })
  it('los contadores por set no se mezclan y el total es la suma', () => {
    const g = setup()
    g.stat(4, 'Kills')
    g.point('us', 25)
    g.apply(closeSet(g.ctx))
    g.stat(4, 'Kills')
    g.stat(4, 'Kills')
    expect(countByPlayer(g.events, { setNumber: 1 }).get('p4')?.['act-kills']).toBe(1)
    expect(countByPlayer(g.events, { setNumber: 2 }).get('p4')?.['act-kills']).toBe(2)
    expect(countByPlayer(g.events).get('p4')?.['act-kills']).toBe(3)
  })
  it('sugiere finalizar cuando un equipo gana los sets necesarios', () => {
    const g = setup({ rules: { ...DEFAULT_RULES, bestOf: 3 } })
    for (let i = 0; i < 2; i++) {
      g.point('us', 25)
      g.apply(closeSet(g.ctx))
    }
    const sug = suggestions(g.match, g.state)
    expect(sug.endMatch).toBe('us')
    expect(sug.closeSet).toBeNull()
    g.apply(endMatch(g.ctx))
    expect(g.state.finished).toBe(true)
    expect(changeScore(g.ctx, 'us', 1).ok).toBe(false)
  })
  it('no cierra un set empatado', () => {
    const g = setup()
    expect(closeSet(g.ctx).ok).toBe(false)
  })
})

// ---------- sustituciones y líbero ----------

describe('sustituciones', () => {
  it('cambia la cancha sin trasladar estadísticas', () => {
    const g = setup()
    g.stat(4, 'Kills')
    const ev = g.apply(substitute(g.ctx, 4, 'p7'))
    expect(ev).toMatchObject({ type: 'substitution', position: 4, out: { id: 'p4' }, in: { id: 'p7' } })
    expect(g.state.lineup[4]).toBe('p7')
    g.stat(4, 'Kills')
    const c = countByPlayer(g.events)
    expect(c.get('p4')?.['act-kills']).toBe(1)
    expect(c.get('p7')?.['act-kills']).toBe(1)
  })
  it('no permite jugadores duplicados ni usar el modo normal para el líbero', () => {
    const g = setup()
    expect(substitute(g.ctx, 4, 'p2').ok).toBe(false)
    expect(substitute(g.ctx, 5, 'lib').ok).toBe(false)
    expect(substitute(g.ctx, 4, 'ghost').ok).toBe(false)
  })
  it('el jugador que salió sigue apareciendo en el resumen', () => {
    const g = setup()
    g.stat(4, 'Kills')
    g.apply(substitute(g.ctx, 4, 'p7'))
    const rows = playerRows(g.match, g.events)
    expect(rows.find((r) => r.player.id === 'p4')?.counts['act-kills']).toBe(1)
  })
})

describe('líbero', () => {
  it('entra solo en zaga, reemplaza y vuelve a salir por el mismo jugador', () => {
    const g = setup()
    expect(liberoIn(g.ctx, 4).ok).toBe(false)
    g.apply(liberoIn(g.ctx, 6))
    expect(g.state.lineup[6]).toBe('lib')
    expect(g.state.liberoReplacedId).toBe('p6')
    // el reemplazado no puede entrar por sustitución normal mientras el líbero está dentro
    expect(substitute(g.ctx, 4, 'p6').ok).toBe(false)
    const out = g.apply(liberoOut(g.ctx))
    expect(out.player.id).toBe('p6')
    expect(g.state.lineup[6]).toBe('p6')
    expect(g.state.liberoPosition).toBeNull()
  })
  it('con el líbero automático apagado, advierte si una rotación lo deja en la red, sin perder datos', () => {
    const g = setup({ rules: { ...DEFAULT_RULES, autoLibero: false } })
    g.apply(liberoIn(g.ctx, 5))
    g.stat(5, 'SD')
    g.apply(rotate(g.ctx)) // 5 → 4
    const s = g.state
    expect(s.liberoPosition).toBe(4)
    expect(s.liberoFrontRowWarning).toBe(true)
    expect(countByPlayer(g.events).get('lib')?.['act-sd']).toBe(1)
    // al salir, vuelve el reemplazado a la posición actual del líbero
    g.apply(liberoOut(g.ctx))
    expect(g.state.lineup[4]).toBe('p5')
    expect(g.state.liberoFrontRowWarning).toBe(false)
  })
  it('nunca hay siete jugadores en cancha', () => {
    const g = setup()
    g.apply(liberoIn(g.ctx, 1))
    const ids = Object.values(g.state.lineup).filter(Boolean)
    expect(ids).toHaveLength(6)
    expect(new Set(ids).size).toBe(6)
  })
})

// ---------- deshacer ----------

describe('deshacer y anular', () => {
  it('deshace la última acción y corrige los contadores derivados', () => {
    const g = setup()
    g.stat(4, 'Kills')
    g.stat(3, 'SB')
    expect(undoLabel(lastUndoable(g.events), g.match)).toBe('Deshacer SB de #3')
    g.undo()
    expect(countByPlayer(g.events).get('p3')).toBeUndefined()
    expect(countByPlayer(g.events).get('p4')).toEqual({ 'act-kills': 1, 'act-attempts': 1 })
  })
  it('el evento anulado se conserva con su rastro', () => {
    const g = setup()
    g.stat(4, 'Kills')
    const undone = g.undo()
    const kept = g.events.find((e) => e.id === undone.id)!
    expect(kept.voided).toBe(true)
    expect(kept.voidedAt).toBeTruthy()
  })
  it('deshacer un punto, una rotación o un cierre de set restaura el estado', () => {
    const g = setup()
    g.point('us')
    expect(undoLabel(lastUndoable(g.events), g.match)).toBe('Deshacer punto de nuestro equipo')
    g.undo()
    expect(g.state.score).toEqual({ us: 0, them: 0 })
    g.apply(rotate(g.ctx))
    g.undo()
    expect(g.state.lineup).toEqual(lineup)
    g.point('them', 25)
    g.apply(closeSet(g.ctx))
    g.undo()
    expect(g.state.currentSet).toBe(1)
    expect(g.state.score).toEqual({ us: 0, them: 25 })
  })
  it('se puede anular el último punto aunque después haya estadísticas', () => {
    const g = setup()
    g.point('us')
    g.stat(4, 'Kills')
    const last = lastScoreEvent(g.events, 1)!
    g.events = voidEvent(g.events, last.id)
    expect(g.state.score).toEqual({ us: 0, them: 0 })
    expect(countByPlayer(g.events).get('p4')?.['act-kills']).toBe(1)
  })
  it('deshacer una sustitución devuelve al jugador a su posición', () => {
    const g = setup()
    g.apply(substitute(g.ctx, 2, 'p8'))
    g.undo()
    expect(g.state.lineup[2]).toBe('p2')
  })
})

// ---------- resumen ----------

describe('resumen', () => {
  it('agrega por equipo, ordena y atribuye métricas de equipo como BM', () => {
    const g = setup()
    g.stat(4, 'Kills')
    g.stat(4, 'Kills')
    g.stat(2, 'Kills')
    g.stat(2, 'BM')
    const team = teamCounts(g.events)
    expect(team['act-kills']).toBe(3)
    expect(team['act-bm']).toBe(1)
    expect(attributionsFor(g.events, 'act-bm')).toEqual([{ player: expect.objectContaining({ id: 'p2' }), count: 1 }])
    const rows = sortRows(playerRows(g.match, g.events), { column: 'act-kills' }, 'desc')
    expect(rows[0].player.id).toBe('p4')
    expect(rows[0].derived.points).toBe(2)
    expect(rows[0].derived.attackEfficiency).toBe(1)
  })
  it('incluye columnas de acciones eliminadas con su nombre histórico', () => {
    const g = setup()
    g.stat(4, 'Touches')
    const actions = g.config.actions.filter((a) => a.code !== 'Touches')
    const cols = statColumns(actions, g.config.categories, g.events)
    expect(cols.find((c) => c.id === 'act-touches')?.name).toMatch(/eliminada/)
  })
})

// ---------- configuración ----------

describe('configuración de acciones', () => {
  it('la configuración por defecto no tiene errores', () => {
    const { actions, categories } = cloneDefaults()
    expect(validateConfig(actions, categories).filter((i) => i.level === 'error')).toEqual([])
  })
  it('detecta auto-conteo y conteo mutuo', () => {
    const { actions, categories } = cloneDefaults()
    actions.find((a) => a.id === 'act-attempts')!.alsoCounts = ['act-kills']
    actions.find((a) => a.id === 'act-touches')!.alsoCounts = ['act-touches']
    const errs = validateConfig(actions, categories).filter((i) => i.level === 'error').map((i) => i.message)
    expect(errs.some((m) => /mutuamente/.test(m))).toBe(true)
    expect(errs.some((m) => /sí misma/.test(m))).toBe(true)
  })
  it('reordena dentro de la lista', () => {
    const items = [
      { id: 'a', order: 0 },
      { id: 'b', order: 1 },
      { id: 'c', order: 2 },
    ]
    expect(moveInOrder(items, 'c', -1).sort((x, y) => x.order - y.order).map((x) => x.id)).toEqual(['a', 'c', 'b'])
    expect(moveInOrder(items, 'a', -1)).toBe(items)
  })
})

// ---------- copia de seguridad ----------

describe('copia de seguridad', () => {
  it('exporta e importa sin pérdidas', () => {
    const g = setup()
    g.stat(4, 'Kills')
    g.point('us')
    const backup = buildBackup({ players, ...g.config, matches: [g.match], events: g.events })
    const parsed = parseBackup(JSON.stringify(backup))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.data.events).toEqual(g.events)
  })
  it('rechaza archivos corruptos o de otra app', () => {
    expect(parseBackup('no json').ok).toBe(false)
    expect(parseBackup(JSON.stringify({ app: 'otra' })).ok).toBe(false)
    const g = setup()
    const b = buildBackup({ players, ...g.config, matches: [], events: [] })
    expect(parseBackup(JSON.stringify({ ...b, players: [{ id: 1 }] })).ok).toBe(false)
    expect(parseBackup(JSON.stringify({ ...b, schemaVersion: 99 })).ok).toBe(false)
  })
  it('genera CSV de eventos y resumen', () => {
    const g = setup()
    g.stat(4, 'Kills')
    g.point('us')
    const csv = eventsCsv(g.match, g.events)
    expect(csv.split('\r\n')).toHaveLength(3)
    expect(csv).toContain('Kills')
    const sum = summaryCsv(g.match, g.events, g.config.actions, g.config.categories)
    expect(sum).toContain('EQUIPO')
  })
})

// ---------- saque, rotación automática y líbero automático ----------


describe('saque y rotación automática', () => {
  it('sacando: punto nuestro no rota; punto rival nos quita el saque y tampoco rota', () => {
    const g = setup({ liberoId: null }) // sacamos primero
    expect(g.state.serving).toBe('us')
    g.point('us')
    expect(g.state.lineup).toEqual(lineup)
    expect(g.state.serving).toBe('us')
    g.point('them')
    expect(g.state.lineup).toEqual(lineup)
    expect(g.state.serving).toBe('them')
  })
  it('recibiendo: al hacer punto recuperamos el saque y rotamos una vez', () => {
    const g = setup({ liberoId: null, firstServe: 'them' })
    g.point('them') // el rival mantiene el saque
    expect(g.state.lineup).toEqual(lineup)
    g.point('us') // side-out
    expect(g.state.serving).toBe('us')
    expect(g.state.lineup).toEqual(rotateClockwise(lineup))
    g.point('us') // seguimos sacando: no rota
    expect(g.state.lineup).toEqual(rotateClockwise(lineup))
  })
  it('“nos hacen un punto y hacemos otro de vuelta” = una rotación', () => {
    const g = setup({ liberoId: null })
    g.point('them')
    g.point('us')
    expect(g.state.lineup).toEqual(rotateClockwise(lineup))
    expect(g.state.lineup[1]).toBe('p2') // el de P2 pasa a P1 y saca
  })
  it('respeta autoRotate = false', () => {
    const g = setup({ liberoId: null, firstServe: 'them', rules: { ...DEFAULT_RULES, autoRotate: false } })
    g.point('us')
    expect(g.state.lineup).toEqual(lineup)
    expect(g.state.serving).toBe('us')
  })
  it('deshacer el punto deshace también el saque y la rotación', () => {
    const g = setup({ liberoId: null, firstServe: 'them' })
    g.point('us')
    g.undo()
    expect(g.state.serving).toBe('them')
    expect(g.state.lineup).toEqual(lineup)
  })
  it('corrección manual del saque', () => {
    const g = setup({ liberoId: null })
    g.apply(setServe(g.ctx, 'them'))
    expect(g.state.serving).toBe('them')
    expect(setServe(g.ctx, 'them').ok).toBe(false)
    g.point('us')
    expect(g.state.lineup).toEqual(rotateClockwise(lineup))
  })
  it('primer saque por set: alterna y en el decisivo se elige', () => {
    const g = setup({ liberoId: null, rules: { ...DEFAULT_RULES, bestOf: 3 } })
    g.point('us', 25)
    g.apply(closeSet(g.ctx)) // set 1 lo sacamos nosotros → set 2 saca el rival
    expect(g.state.serving).toBe('them')
    expect(g.state.sets[1].firstServe).toBe('them')
    g.point('them', 25)
    expect(defaultNextServe(g.state)).toBe('us')
    g.apply(closeSet(g.ctx, 'them')) // sorteo del set decisivo: saca el rival
    expect(g.state.currentSet).toBe(3)
    expect(g.state.serving).toBe('them')
  })
})

describe('líbero automático', () => {
  // P4 Dani OP, P3 Caro CE, P2 Bea PU, P5 Eva PU, P6 Fer CE, P1 Ana AR. Líbero #12 entra por Fer (P6).
  it('sale solo cuando la rotación lo lleva a la red y vuelve el central', () => {
    const g = setup({ liberoStartPosition: 6, firstServe: 'them' })
    g.point('us') // rota: líbero 6→5
    expect(g.state.lineup[5]).toBe('lib')
    g.point('them')
    g.point('us') // rota: líbero 5→4 → sale, vuelve Fer en P4
    const s = g.state
    expect(s.lineup[4]).toBe('p6')
    expect(s.liberoPosition).toBeNull()
    expect(s.liberoFrontRowWarning).toBe(false)
    expect(Object.values(s.lineup).filter(Boolean)).toHaveLength(6)
    const ev = g.events[g.events.length - 1]
    expect(describeEvent(ev, g.match)).toContain('sale líbero, vuelve #6')
  })
  it('el otro central saca en P1 y, cuando perdemos el saque, entra el líbero por él', () => {
    const g = setup({ liberoStartPosition: 6, firstServe: 'them' })
    g.point('us')
    g.point('them')
    g.point('us') // líbero fuera; Caro (CE) llega a P1 y saca
    expect(g.state.lineup[1]).toBe('p3')
    expect(g.state.serving).toBe('us')
    g.point('us') // seguimos sacando: nada cambia
    expect(g.state.lineup[1]).toBe('p3')
    g.point('them') // nos hacen punto: entra el líbero por Caro en P1
    expect(g.state.lineup[1]).toBe('lib')
    expect(g.state.liberoReplacedId).toBe('p3')
  })
  it('simulación de varias vueltas: nunca hay líbero en la red, ni sacando, ni siete en cancha', () => {
    const g = setup({ liberoStartPosition: 6, firstServe: 'them' })
    for (let i = 0; i < 24; i++) {
      g.point('us') // recuperamos el saque y rotamos
      let s = g.state
      if (s.liberoPosition) expect(BACK_ROW).toContain(s.liberoPosition)
      expect(s.lineup[1]).not.toBe('lib') // el líbero nunca saca
      g.point('them') // perdemos el saque
      s = g.state
      if (s.liberoPosition) {
        expect(BACK_ROW).toContain(s.liberoPosition)
        expect(['p3', 'p6']).toContain(s.liberoReplacedId) // siempre por un central
      }
      const ids = Object.values(s.lineup).filter(Boolean)
      expect(new Set(ids).size).toBe(6)
      for (const p of FRONT_ROW) expect(s.lineup[p]).not.toBe('lib')
    }
    // tras 24 rotaciones (4 vueltas) el orden base vuelve a ser el inicial
    const base = { ...g.state.lineup }
    if (g.state.liberoReplacedId) base[g.state.liberoPosition!] = g.state.liberoReplacedId
    expect(base).toEqual(lineup)
  })
  it('una rotación manual también saca al líbero si llega a la red', () => {
    const g = setup({ liberoStartPosition: 5 })
    const ev = g.apply(rotate(g.ctx))
    expect(ev.liberoOut?.playerId).toBe('p5')
    expect(g.state.lineup[4]).toBe('p5')
  })
  it('deshacer el punto devuelve al líbero', () => {
    const g = setup({ liberoStartPosition: 6, firstServe: 'them' })
    g.point('us')
    g.point('them')
    g.point('us')
    g.undo()
    expect(g.state.lineup[5]).toBe('lib')
    expect(g.state.liberoReplacedId).toBe('p6')
  })
  it('no entra automáticamente si está apagado', () => {
    const g = setup({ rules: { ...DEFAULT_RULES, autoLibero: false } })
    g.point('them')
    expect(g.state.liberoPosition).toBeNull()
  })
  it('el líbero no puede sacar desde el inicio', () => {
    const errors = validateNewMatch(
      { ourTeam: 'A', opponent: 'B', date: T0, rules: DEFAULT_RULES, firstServe: 'us', lineup, liberoId: 'lib', liberoStartPosition: 1 },
      players,
    )
    expect(errors.join(' ')).toMatch(/no puede sacar/)
  })
})

describe('acciones del líbero', () => {
  it('no puede registrar bloqueos ni Kills, pero sí defensa y recepción', () => {
    const g = setup({ liberoStartPosition: 6 })
    const libero = g.match.roster.find((p) => p.id === 'lib')!
    for (const code of ['SB', 'Blocks', 'BE', 'Kills']) {
      expect(isActionAvailableFor(g.action(code), libero, g.match)).toBe(false)
      expect(recordStat(g.ctx, 6, g.action(code), g.config.actions, g.config.categories).ok).toBe(false)
    }
    for (const code of ['SD', 'R+', 'Errors']) expect(isActionAvailableFor(g.action(code), libero, g.match)).toBe(true)
  })
  it('quien juega de líbero cuenta como líbero aunque su ficha diga otro rol', () => {
    const g = setup({ liberoStartPosition: 6 })
    const libAsDE = { ...g.match.roster.find((p) => p.id === 'lib')!, role: 'DE' as const }
    expect(isActionAvailableFor(g.action('Kills'), libAsDE, g.match)).toBe(false)
  })
  it('la migración restringe al líbero y asegura Attempts sin pisar personalizaciones', () => {
    const old = cloneDefaults().actions.map((a) => ({
      ...a,
      eligibleRoles: [] as PlayerRole[],
      alsoCounts: a.id === 'act-kills' ? [] : a.alsoCounts,
    }))
    old.find((a) => a.id === 'act-be')!.eligibleRoles = ['CE'] // personalizado: se respeta
    const m = migrateActions(old, 1)
    expect(m.find((a) => a.id === 'act-sb')!.eligibleRoles).toEqual(NON_LIBERO_ROLES)
    expect(m.find((a) => a.id === 'act-be')!.eligibleRoles).toEqual(['CE'])
    expect(m.find((a) => a.id === 'act-kills')!.alsoCounts).toContain('act-attempts')
    expect(m.find((a) => a.id === 'act-errors')!.alsoCounts).toEqual(['act-attempts'])
    expect(NO_LIBERO_ACTION_IDS).toHaveLength(4)
    expect(migrateActions(m, 2)).toBe(m)
  })
})

describe('anular puntos', () => {
  it('un punto solo se puede anular si después solo hubo estadísticas', () => {
    const g = setup({ liberoId: null })
    g.point('us')
    const first = g.events[g.events.length - 1]
    g.stat(4, 'Kills')
    expect(canVoid(g.events, first)).toBe(true)
    g.point('them')
    expect(canVoid(g.events, first)).toBe(false)
  })
})

describe('plantilla de prueba y alineación sugerida', () => {
  it('crea 2 PU, 1 OP, 1 AR, 2 CE y 1 LI sin repetir números activos', () => {
    const all = missingDemoPlayers([])
    expect(all).toHaveLength(7)
    const count = (r: string) => all.filter((d) => d.role === r).length
    expect([count('PU'), count('OP'), count('AR'), count('CE'), count('LI')]).toEqual([2, 1, 1, 2, 1])
    expect(missingDemoPlayers(players).map((d) => d.number)).toEqual([]) // 1–6 y 12 ya existen
  })
  it('sugiere la 5-1: AR en P1, PU en P2/P5, CE en P3/P6, OP en P4 y líbero por el central de P6', () => {
    const demo: Player[] = DEMO_ROSTER.map((d, i) => mkPlayer(`d${i}`, d.number, d.role))
    const sug = suggestLineup(demo)!
    const role = (pos: Position) => demo.find((p) => p.id === sug.lineup[pos])!.role
    expect([1, 2, 3, 4, 5, 6].map((p) => role(p as Position))).toEqual(['AR', 'PU', 'CE', 'OP', 'PU', 'CE'])
    expect(sug.liberoStart).toBe(6)
    expect(demo.find((p) => p.id === sug.liberoId)!.role).toBe('LI')
    expect(validateNewMatch({ ourTeam: 'A', opponent: 'B', date: T0, rules: DEFAULT_RULES, firstServe: 'us', lineup: sug.lineup, liberoId: sug.liberoId, liberoStartPosition: sug.liberoStart }, demo)).toEqual([])
    expect(suggestLineup(demo.filter((p) => p.role !== 'OP'))).toBeNull()
  })
})
