import { useMemo } from 'react'
import { deriveMatchState } from '../../domain/matchState'
import { useStore } from '../../state/store'
import { formatDate } from '../format'
import { routes } from '../router'

export function Home() {
  const matches = useStore((s) => s.matches)
  const events = useStore((s) => s.events)
  const players = useStore((s) => s.players)

  const sorted = useMemo(() => [...matches].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [matches])
  const live = sorted.find((m) => m.status === 'live')
  const last = sorted[0]
  const lastState = useMemo(
    () => (last ? deriveMatchState(last, events.filter((e) => e.matchId === last.id)) : null),
    [last, events],
  )
  const activePlayers = players.filter((p) => p.active).length

  return (
    <div className="page">
      <div className="hero">
        <h1>🏐 Volei · Match Tracker</h1>
        <p className="muted">Estadísticas de partido, toque a toque.</p>
      </div>

      <div className="menu-grid">
        {live && (
          <a className="btn primary big" href={'#' + routes.live(live.id)}>
            ▶ Continuar partido · {live.ourTeam} vs {live.opponent}
          </a>
        )}
        <a className={`btn big ${live ? '' : 'primary'}`} href={'#' + routes.newMatch()}>
          ＋ Nuevo partido
        </a>
        <a className="btn big" href={'#' + routes.players()}>
          👥 Jugadores <span className="badge">{activePlayers} activos</span>
        </a>
        <a className="btn big" href={'#' + routes.matches()}>
          📋 Historial de partidos
        </a>
        <a className="btn big" href={'#' + routes.settings()}>
          ⚙ Configuración de acciones y copias
        </a>
      </div>

      {last && lastState && (
        <a
          className="card"
          style={{ textDecoration: 'none', color: 'inherit' }}
          href={'#' + (last.status === 'live' ? routes.live(last.id) : routes.summary(last.id))}
        >
          <div className="row">
            <span className="muted small grow">Último partido · {formatDate(last.date)}</span>
            <span className={`badge ${last.status === 'live' ? 'live' : ''}`}>
              {last.status === 'live' ? 'En curso' : 'Finalizado'}
            </span>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <strong className="grow">
              {last.ourTeam} vs {last.opponent}
            </strong>
            <strong>
              {lastState.setsWon.us}–{lastState.setsWon.them}
            </strong>
          </div>
        </a>
      )}
    </div>
  )
}
