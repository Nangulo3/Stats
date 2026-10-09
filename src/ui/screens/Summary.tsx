import { useMemo, useState } from 'react'
import { eventsCsv, summaryCsv } from '../../domain/backup'
import { deriveMatchState } from '../../domain/matchState'
import {
  attributionsFor,
  formatEfficiency,
  playerRows,
  sortRows,
  statColumns,
  teamCounts,
  type SortKey,
} from '../../domain/stats'
import type { ID } from '../../domain/types'
import { useMatchEvents, useStore } from '../../state/store'
import { TopBar } from '../components'
import { downloadText, formatDate, slug } from '../format'
import { NotFound } from '../live/LiveMatch'
import { routes } from '../router'

function sameKey(a: SortKey, b: SortKey) {
  return typeof a === 'string' || typeof b === 'string' ? a === b : a.column === b.column
}

export function Summary({ matchId }: { matchId: ID }) {
  const match = useStore((s) => s.matches.find((m) => m.id === matchId))
  const actions = useStore((s) => s.actions)
  const categories = useStore((s) => s.categories)
  const events = useMatchEvents(matchId)
  const [scope, setScope] = useState<number | 'all'>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'number', dir: 'asc' })
  const [onlyWithData, setOnlyWithData] = useState(false)

  const state = useMemo(() => (match ? deriveMatchState(match, events) : null), [match, events])
  const cols = useMemo(() => statColumns(actions, categories, events), [actions, categories, events])
  const filter = useMemo(() => (scope === 'all' ? {} : { setNumber: scope }), [scope])
  const rows = useMemo(() => {
    if (!match) return []
    const all = playerRows(match, events, filter)
    return sortRows(onlyWithData ? all.filter((r) => r.derived.actions > 0) : all, sort.key, sort.dir)
  }, [match, events, filter, sort, onlyWithData])
  const team = useMemo(() => teamCounts(events, filter), [events, filter])

  if (!match || !state) return <NotFound />

  // Columnas sin ningún registro en el partido se ocultan para que la tabla quepa en el móvil.
  const allTeam = teamCounts(events)
  const visibleCols = cols.filter((c) => (allTeam[c.id] ?? 0) > 0 || c.teamMetric)
  const teamMetricCols = cols.filter((c) => c.teamMetric)

  function sortBy(key: SortKey) {
    setSort((s) =>
      sameKey(s.key, key)
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' || key === 'number' ? 'asc' : 'desc' },
    )
  }
  const arrow = (key: SortKey) => (sameKey(sort.key, key) ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '')
  const base = `${slug(match.ourTeam)}-vs-${slug(match.opponent)}-${match.date.slice(0, 10)}`

  return (
    <>
      <TopBar
        title="Resumen"
        sub={`${match.ourTeam} vs ${match.opponent} · ${formatDate(match.date)}`}
        back={match.status === 'live' ? routes.live(match.id) : routes.matches()}
      />
      <div className="page">
        <section className="card">
          <div className="row">
            <div className="grow">
              <div className="muted small">{match.ourTeam}</div>
              <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--us)' }}>{state.setsWon.us}</div>
            </div>
            <div className="center">
              <span className={`badge ${match.status === 'live' ? 'live' : ''}`}>
                {match.status === 'live' ? 'En curso' : 'Finalizado'}
              </span>
              <div className="muted small" style={{ marginTop: 4 }}>
                sets
              </div>
            </div>
            <div className="grow" style={{ textAlign: 'right' }}>
              <div className="muted small">{match.opponent}</div>
              <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--them)' }}>{state.setsWon.them}</div>
            </div>
          </div>
          <div className="sets-strip" style={{ marginTop: 8 }}>
            {state.sets.map((s) => (
              <span key={s.number} className={s.closed ? '' : 'current'}>
                Set {s.number}: {s.score.us}–{s.score.them}
                {s.closed ? '' : ' (en juego)'}
              </span>
            ))}
          </div>
        </section>

        <div className="tabs" role="tablist" aria-label="Ámbito">
          <button className="chip" role="tab" aria-pressed={scope === 'all'} aria-selected={scope === 'all'} onClick={() => setScope('all')}>
            Partido completo
          </button>
          {state.sets.map((s) => (
            <button
              key={s.number}
              className="chip"
              role="tab"
              aria-pressed={scope === s.number}
              aria-selected={scope === s.number}
              onClick={() => setScope(s.number)}
            >
              Set {s.number}
            </button>
          ))}
        </div>

        <section className="stack">
          <div className="row">
            <h2 className="section-title grow" style={{ margin: 0 }}>
              Jugadores
            </h2>
            <label className="check small" style={{ minHeight: 0 }}>
              <input type="checkbox" checked={onlyWithData} onChange={(e) => setOnlyWithData(e.target.checked)} />
              Solo con registros
            </label>
          </div>
          <div className="row wrap small">
            <span className="muted">Ordenar:</span>
            <button className="chip" aria-pressed={sameKey(sort.key, 'number')} onClick={() => sortBy('number')}>
              Número{arrow('number')}
            </button>
            <button className="chip" aria-pressed={sameKey(sort.key, 'name')} onClick={() => sortBy('name')}>
              Nombre{arrow('name')}
            </button>
            <button className="chip" aria-pressed={sameKey(sort.key, 'points')} onClick={() => sortBy('points')}>
              Puntos{arrow('points')}
            </button>
          </div>
          <div className="table-wrap">
            <table className="stats">
              <thead>
                <tr>
                  <th className="sticky">Jugador</th>
                  {visibleCols.map((c) => (
                    <th key={c.id} title={`${c.name} · ${c.categoryName}`}>
                      <button onClick={() => sortBy({ column: c.id })}>
                        {c.code}
                        {arrow({ column: c.id })}
                      </button>
                      <span className="bar" style={{ background: c.color }} />
                    </th>
                  ))}
                  <th title="Kills + Aces + SB">
                    <button onClick={() => sortBy('points')}>Pts{arrow('points')}</button>
                  </th>
                  <th title="(Kills − Errors) / Attempts">
                    <button onClick={() => sortBy('efficiency')}>Ef. at.{arrow('efficiency')}</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.player.id}>
                    <td className="sticky">
                      <strong>#{r.player.number}</strong> {r.player.name}
                      <span className="muted small"> {r.player.role}</span>
                    </td>
                    {visibleCols.map((c) => {
                      const v = r.counts[c.id] ?? 0
                      return (
                        <td key={c.id} className={v ? '' : 'zero'}>
                          {v}
                        </td>
                      )
                    })}
                    <td>{r.derived.points}</td>
                    <td>{formatEfficiency(r.derived.attackEfficiency)}</td>
                  </tr>
                ))}
                <tr className="team">
                  <td className="sticky">Equipo</td>
                  {visibleCols.map((c) => (
                    <td key={c.id}>{team[c.id] ?? 0}</td>
                  ))}
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
          {visibleCols.length < cols.length && (
            <p className="muted small" style={{ margin: 0 }}>
              Se ocultan {cols.length - visibleCols.length} acciones sin registros en este partido.
            </p>
          )}
        </section>

        <section className="card stack">
          <h2>Equipo y rival</h2>
          <table className="stats" style={{ minWidth: 0 }}>
            <thead>
              <tr>
                <th className="sticky">Set</th>
                <th>{match.ourTeam}</th>
                <th>{match.opponent}</th>
                <th>Ganador</th>
              </tr>
            </thead>
            <tbody>
              {state.sets.map((s) => (
                <tr key={s.number}>
                  <td className="sticky">Set {s.number}</td>
                  <td>{s.score.us}</td>
                  <td>{s.score.them}</td>
                  <td>{s.winner ? (s.winner === 'us' ? match.ourTeam : match.opponent) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {teamMetricCols.map((c) => {
            const who = attributionsFor(events, c.id, filter)
            return (
              <div key={c.id} className="stack" style={{ gap: 4 }}>
                <div className="row">
                  <strong className="grow">
                    {c.code} <span className="muted small">{c.name !== c.code ? c.name : ''}</span>
                  </strong>
                  <strong>{team[c.id] ?? 0}</strong>
                </div>
                {who.length > 0 && (
                  <div className="muted small">
                    Registrado por: {who.map((w) => `#${w.player.number} ${w.player.name} (${w.count})`).join(', ')}
                  </div>
                )}
              </div>
            )
          })}
        </section>

        <section className="card stack">
          <h2>Exportar</h2>
          <div className="row wrap">
            <button className="btn grow" onClick={() => downloadText(`${base}-eventos.csv`, eventsCsv(match, events), 'text/csv;charset=utf-8')}>
              ⬇ Eventos CSV
            </button>
            <button
              className="btn grow"
              onClick={() => downloadText(`${base}-resumen.csv`, summaryCsv(match, events, actions, categories), 'text/csv;charset=utf-8')}
            >
              ⬇ Resumen CSV
            </button>
          </div>
          <a className="btn" href={'#' + routes.history(match.id)}>
            ☰ Ver historial completo
          </a>
          {match.status === 'live' && (
            <a className="btn primary" href={'#' + routes.live(match.id)}>
              ▶ Volver a la cancha
            </a>
          )}
        </section>
      </div>
    </>
  )
}
