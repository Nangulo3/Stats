import { useMemo, useState } from 'react'
import { describeEvent } from '../../domain/commands'
import { EVENT_TYPE_LABELS, type EventType, type ID } from '../../domain/types'
import { canVoid, useMatchEvents, useStore } from '../../state/store'
import { TopBar } from '../components'
import { EventRow } from '../live/EventRow'
import { NotFound } from '../live/LiveMatch'
import { routes } from '../router'

export function History({ matchId }: { matchId: ID }) {
  const match = useStore((s) => s.matches.find((m) => m.id === matchId))
  const categories = useStore((s) => s.categories)
  const voidEventById = useStore((s) => s.voidEventById)
  const events = useMatchEvents(matchId)

  const [player, setPlayer] = useState('')
  const [category, setCategory] = useState('')
  const [setNo, setSetNo] = useState('')
  const [type, setType] = useState<EventType | ''>('')
  const [showVoided, setShowVoided] = useState(true)
  const [newestFirst, setNewestFirst] = useState(true)

  const sets = useMemo(() => [...new Set(events.map((e) => e.setNumber))].sort((a, b) => a - b), [events])
  const catOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categories) m.set(c.id, c.name)
    for (const e of events) if (e.type === 'stat' && !m.has(e.action.categoryId)) m.set(e.action.categoryId, e.action.categoryName)
    return [...m.entries()]
  }, [categories, events])

  const filtered = useMemo(() => {
    const list = events.filter((e) => {
      if (!showVoided && e.voided) return false
      if (setNo && e.setNumber !== Number(setNo)) return false
      if (type && e.type !== type) return false
      if (category && (e.type !== 'stat' || e.action.categoryId !== category)) return false
      if (player) {
        const ids =
          e.type === 'stat'
            ? [e.player.id]
            : e.type === 'substitution'
              ? [e.out.id, e.in.id]
              : e.type === 'libero'
                ? [e.libero.id, e.player.id]
                : []
        if (!ids.includes(player)) return false
      }
      return true
    })
    return list.sort((a, b) => (newestFirst ? b.seq - a.seq : a.seq - b.seq))
  }, [events, showVoided, setNo, type, category, player, newestFirst])

  if (!match) return <NotFound />
  const voidedCount = events.filter((e) => e.voided).length

  return (
    <>
      <TopBar
        title="Historial de eventos"
        sub={`${match.ourTeam} vs ${match.opponent} · ${events.length - voidedCount} válidos, ${voidedCount} anulados`}
        back={match.status === 'live' ? routes.live(match.id) : routes.summary(match.id)}
      />
      <div className="page" style={{ gap: 10 }}>
        <div className="form-grid">
          <select className="input" aria-label="Filtrar por jugador" value={player} onChange={(e) => setPlayer(e.target.value)}>
            <option value="">Todos los jugadores</option>
            {[...match.roster]
              .sort((a, b) => a.number - b.number)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.number} {p.name}
                </option>
              ))}
          </select>
          <select className="input" aria-label="Filtrar por set" value={setNo} onChange={(e) => setSetNo(e.target.value)}>
            <option value="">Todos los sets</option>
            {sets.map((s) => (
              <option key={s} value={s}>
                Set {s}
              </option>
            ))}
          </select>
          <select className="input" aria-label="Filtrar por categoría" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas las categorías</option>
            {catOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select className="input" aria-label="Filtrar por tipo" value={type} onChange={(e) => setType(e.target.value as EventType | '')}>
            <option value="">Todos los tipos</option>
            {(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((t) => (
              <option key={t} value={t}>
                {EVENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="row wrap">
          <label className="check small grow">
            <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
            Mostrar anulados
          </label>
          <button className="btn small" onClick={() => setNewestFirst(!newestFirst)}>
            {newestFirst ? '↓ Más recientes primero' : '↑ Más antiguos primero'}
          </button>
        </div>

        {filtered.length === 0 && <p className="muted center">No hay eventos con estos filtros.</p>}
        <div className="recent">
          {filtered.map((e) => (
            <EventRow
              key={e.id}
              e={e}
              match={match}
              extra={
                canVoid(events, e) ? (
                  <button
                    className="btn small ghost"
                    aria-label={`Anular ${describeEvent(e, match)}`}
                    onClick={() => {
                      if (confirm(`¿Anular “${describeEvent(e, match)}”? Quedará en el historial como anulado.`))
                        void voidEventById(match.id, e.id)
                    }}
                  >
                    Anular
                  </button>
                ) : null
              }
            />
          ))}
        </div>
      </div>
    </>
  )
}
