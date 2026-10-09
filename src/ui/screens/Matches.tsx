import { useMemo } from 'react'
import { deriveMatchState } from '../../domain/matchState'
import { useStore } from '../../state/store'
import { TopBar } from '../components'
import { formatDate } from '../format'
import { routes } from '../router'

export function Matches() {
  const matches = useStore((s) => s.matches)
  const events = useStore((s) => s.events)
  const rows = useMemo(
    () =>
      [...matches]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((m) => ({ m, st: deriveMatchState(m, events.filter((e) => e.matchId === m.id)) })),
    [matches, events],
  )
  return (
    <>
      <TopBar title="Historial de partidos" back="/" />
      <div className="page">
        {rows.length === 0 && <p className="muted center">Aún no hay partidos.</p>}
        {rows.length > 0 && (
          <div className="list">
            {rows.map(({ m, st }) => (
              <a
                key={m.id}
                className="list-item"
                style={{ color: 'inherit', textDecoration: 'none' }}
                href={'#' + (m.status === 'live' ? routes.live(m.id) : routes.summary(m.id))}
              >
                <div className="grow">
                  <strong>
                    {m.ourTeam} vs {m.opponent}
                  </strong>
                  <div className="muted small">
                    {formatDate(m.date)} · {st.sets.map((s) => `${s.score.us}-${s.score.them}`).join(', ')}
                  </div>
                </div>
                <div className="stack" style={{ alignItems: 'flex-end', gap: 4 }}>
                  <strong>
                    {st.setsWon.us}–{st.setsWon.them}
                  </strong>
                  <span className={`badge ${m.status === 'live' ? 'live' : ''}`}>
                    {m.status === 'live' ? 'En curso' : 'Finalizado'}
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
