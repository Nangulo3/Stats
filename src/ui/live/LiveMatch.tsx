import { useMemo, useState } from 'react'
import { changeScore, closeSet, describeEvent, endMatch, lastUndoable, rotate, setServe, undoLabel } from '../../domain/commands'
import { autoRotateOn, defaultNextServe, deriveMatchState, other, suggestions, validEvents } from '../../domain/matchState'
import type { ID, Match, PlayerSnapshot, Position, Team } from '../../domain/types'
import { useMatchEvents, useStore } from '../../state/store'
import { Sheet, TopBar } from '../components'
import { navigate, routes } from '../router'
import { ActionSheet } from './ActionSheet'
import { EventRow } from './EventRow'
import { Court } from './Court'
import { LiberoSheet, SubstitutionSheet } from './SubstitutionSheet'

type Panel =
  | { kind: 'action'; pos: Position }
  | { kind: 'sub' }
  | { kind: 'libero' }
  | { kind: 'menu' }
  | { kind: 'decidingServe' }
  | null

export function LiveMatch({ matchId }: { matchId: ID }) {
  const match = useStore((s) => s.matches.find((m) => m.id === matchId))
  if (!match) return <NotFound />
  return <LiveMatchInner match={match} />
}

export function NotFound() {
  return (
    <>
      <TopBar title="Partido no encontrado" back="/" />
      <div className="page">
        <p className="muted">Ese partido no existe en este dispositivo.</p>
      </div>
    </>
  )
}

function LiveMatchInner({ match }: { match: Match }) {
  const events = useMatchEvents(match.id)
  const run = useStore((s) => s.run)
  const undoLast = useStore((s) => s.undoLast)
  const undoLastPoint = useStore((s) => s.undoLastPoint)
  const showToast = useStore((s) => s.showToast)
  const [panel, setPanel] = useState<Panel>(null)

  const state = useMemo(() => deriveMatchState(match, events), [match, events])
  const sug = suggestions(match, state)
  const roster = useMemo(() => new Map<ID, PlayerSnapshot>(match.roster.map((p) => [p.id, p])), [match.roster])
  const lastEv = lastUndoable(events)
  const recent = useMemo(() => validEvents(events).slice(-5).reverse(), [events])

  const onCourt = new Set(Object.values(state.lineup))
  const bench = match.roster.filter((p) => !onCourt.has(p.id)).sort((a, b) => a.number - b.number)

  const teamName = (t: Team) => (t === 'us' ? match.ourTeam : match.opponent)

  async function point(team: Team) {
    const ev = await run(match.id, (ctx) => changeScore(ctx, team, 1))
    // Si el punto movió la cancha (rotación o líbero), avisarlo con opción de deshacer.
    if (ev?.auto)
      showToast({ kind: 'info', message: describeEvent(ev, match), undoEventId: ev.id, matchId: match.id })
  }

  async function doRotate() {
    const ev = await run(match.id, rotate)
    if (ev) showToast({ kind: 'info', message: describeEvent(ev, match), undoEventId: ev.id, matchId: match.id })
  }

  /** Antes del set decisivo hay nuevo sorteo: se pregunta quién saca. */
  function requestCloseSet() {
    if (sug.nextIsDeciding) setPanel({ kind: 'decidingServe' })
    else void doCloseSet()
  }

  async function doCloseSet(nextServe?: Team) {
    const n = state.currentSet
    const ev = await run(match.id, (ctx) => closeSet(ctx, nextServe))
    if (ev)
      showToast({
        kind: 'info',
        message: `Set ${n} cerrado · saca primero ${teamName(ev.nextServe ?? defaultNextServe(state))}`,
        undoEventId: ev.id,
        matchId: match.id,
      })
  }

  async function toggleServe() {
    const ev = await run(match.id, (ctx) => setServe(ctx, other(state.serving)))
    if (ev) showToast({ kind: 'info', message: `Saque para ${teamName(ev.team)}`, undoEventId: ev.id, matchId: match.id })
  }

  const server = state.serving === 'us' ? roster.get(state.lineup[1] ?? '') : undefined

  async function doEnd() {
    const ev = await run(match.id, endMatch)
    if (ev) navigate(routes.summary(match.id))
  }

  const selectedPos = panel?.kind === 'action' ? panel.pos : null
  const selectedPlayer = selectedPos ? roster.get(state.lineup[selectedPos] ?? '') : undefined

  return (
    <>
      <TopBar
        title={`Set ${state.currentSet} · ${match.ourTeam} vs ${match.opponent}`}
        sub={state.finished ? 'Partido finalizado' : `Sets ${state.setsWon.us}–${state.setsWon.them} · a ${sug.target} pts`}
        back="/"
        right={
          <button className="icon-btn" aria-label="Más opciones" onClick={() => setPanel({ kind: 'menu' })}>
            ⋯
          </button>
        }
      />

      <div className="page" style={{ gap: 10, paddingBottom: 12 }}>
        <div className="scoreboard">
          {(['us', 'them'] as Team[]).map((t) => (
            <ScoreSide
              key={t}
              side={t}
              name={teamName(t)}
              pts={state.score[t]}
              sets={state.setsWon[t]}
              serving={state.serving === t}
              onPlus={() => void point(t)}
              onMinus={() => void undoLastPoint(match.id, t)}
            />
          ))}
        </div>
        {!state.finished && (
          <div className="serve-line" role="status">
            🏐 Saca <strong>{teamName(state.serving)}</strong>
            {server && (
              <>
                {' '}· #{server.number} {server.name} (P1)
              </>
            )}
            {state.serving === 'them' && autoRotateOn(match.rules) && <span className="muted"> · si hacemos punto, rotamos</span>}
          </div>
        )}

        {state.sets.length > 1 && (
          <div className="sets-strip" aria-label="Resultados por set">
            {state.sets.map((s) => (
              <span key={s.number} className={s.closed ? '' : 'current'}>
                S{s.number} {s.score.us}–{s.score.them}
              </span>
            ))}
          </div>
        )}

        {state.finished && (
          <div className="banner info">
            🏁 Partido finalizado.
            <span className="grow" />
            <a className="btn small" href={'#' + routes.summary(match.id)}>
              Ver resumen
            </a>
          </div>
        )}
        {sug.endMatch && (
          <div className="banner info" role="status">
            <span className="grow">🏆 {sug.endMatch === 'us' ? match.ourTeam : match.opponent} ganó el partido.</span>
            <button className="btn primary small" onClick={() => void doEnd()}>
              Finalizar
            </button>
          </div>
        )}
        {sug.closeSet && (
          <div className="banner info" role="status">
            <span className="grow">
              Set {state.currentSet} para {sug.closeSet === 'us' ? match.ourTeam : match.opponent} ({state.score.us}–{state.score.them}). ¿Cerrar?
            </span>
            <button className="btn primary small" onClick={requestCloseSet}>
              Cerrar set
            </button>
          </div>
        )}
        {state.liberoFrontRowWarning && (
          <div className="banner warn" role="alert">
            <span className="grow">⚠ El líbero quedó en fila delantera (P{state.liberoPosition}). Retíralo o corrige la rotación.</span>
            <button className="btn small" onClick={() => setPanel({ kind: 'libero' })}>
              Líbero
            </button>
          </div>
        )}

        <Court
          lineup={state.lineup}
          roster={roster}
          liberoId={match.liberoId}
          selected={selectedPos}
          serving={state.serving === 'us' && !state.finished}
          onTap={(pos) => setPanel({ kind: 'action', pos })}
        />

        {bench.length > 0 && (
          <div className="bench" aria-label="Fuera de cancha">
            {bench.map((p) => (
              <span key={p.id} className={`bench-chip ${p.id === match.liberoId ? 'libero' : ''}`}>
                <span className="jersey">{p.number}</span>
                {p.id === match.liberoId ? 'Líbero' : p.id === state.liberoReplacedId ? 'Fuera x líbero' : p.role}
              </span>
            ))}
          </div>
        )}

        <div className="recent">
          <div className="recent-head">
            <span className="section-title" style={{ margin: 0 }}>
              Recientes
            </span>
            <button className="undo-btn" disabled={!lastEv} onClick={() => void undoLast(match.id)} title={undoLabel(lastEv, match)}>
              ↶ {undoLabel(lastEv, match)}
            </button>
          </div>
          {recent.length === 0 && <p className="muted small" style={{ margin: 0 }}>Toca un jugador para registrar una acción.</p>}
          {recent.map((e) => (
            <EventRow key={e.id} e={e} match={match} />
          ))}
        </div>
      </div>

      <nav className="quickbar" aria-label="Acciones rápidas">
        <button onClick={() => setPanel({ kind: 'sub' })}>
          <span className="ic">⇄</span>Sustitución
        </button>
        <button onClick={() => setPanel({ kind: 'libero' })} disabled={!match.liberoId}>
          <span className="ic">L</span>Líbero
        </button>
        <button onClick={() => void doRotate()}>
          <span className="ic">↻</span>Rotar
        </button>
        <button onClick={() => navigate(routes.history(match.id))}>
          <span className="ic">☰</span>Historial
        </button>
      </nav>

      {panel?.kind === 'action' && selectedPlayer && (
        <ActionSheet match={match} position={panel.pos} player={selectedPlayer} onClose={() => setPanel(null)} />
      )}
      {panel?.kind === 'sub' && <SubstitutionSheet match={match} state={state} roster={roster} onClose={() => setPanel(null)} />}
      {panel?.kind === 'libero' && <LiberoSheet match={match} state={state} roster={roster} onClose={() => setPanel(null)} />}
      {panel?.kind === 'menu' && (
        <Sheet title="Opciones del partido" onClose={() => setPanel(null)}>
          <div className="stack">
            <a className="btn block" href={'#' + routes.summary(match.id)}>
              📊 Resumen y estadísticas
            </a>
            <a className="btn block" href={'#' + routes.history(match.id)}>
              ☰ Historial completo
            </a>
            <button className="btn block" onClick={() => void undoLastPoint(match.id).then(() => setPanel(null))}>
              ↶ Deshacer último punto
            </button>
            {!state.finished && (
              <button
                className="btn block"
                onClick={() => {
                  setPanel(null)
                  void toggleServe()
                }}
              >
                🏐 Corregir saque: dárselo a {teamName(other(state.serving))}
              </button>
            )}
            {!state.finished && (
              <button
                className="btn block"
                disabled={state.score.us === state.score.them}
                onClick={() => {
                  if (confirm(`¿Cerrar el set ${state.currentSet} con ${state.score.us}–${state.score.them}?`)) {
                    setPanel(null)
                    requestCloseSet()
                  }
                }}
              >
                Cerrar set manualmente
              </button>
            )}
            {!state.finished && (
              <button
                className="btn danger block"
                onClick={() => {
                  if (confirm('¿Finalizar el partido? Podrás deshacerlo desde el historial si fue un error.')) {
                    setPanel(null)
                    void doEnd()
                  }
                }}
              >
                Finalizar partido
              </button>
            )}
            <a className="btn ghost block" href="#/">
              Ir al inicio
            </a>
          </div>
        </Sheet>
      )}
      {panel?.kind === 'decidingServe' && (
        <Sheet title={`Set decisivo (${state.currentSet + 1}º): sorteo`} onClose={() => setPanel(null)}>
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>
              Se cierra el set {state.currentSet} ({state.score.us}–{state.score.them}). ¿Quién saca primero en el set decisivo?
            </p>
            {(['us', 'them'] as Team[]).map((t) => (
              <button
                key={t}
                className="btn big block"
                onClick={() => {
                  setPanel(null)
                  void doCloseSet(t)
                }}
              >
                🏐 {teamName(t)}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  )
}

function ScoreSide({
  side,
  name,
  pts,
  sets,
  serving,
  onPlus,
  onMinus,
}: {
  side: Team
  name: string
  pts: number
  sets: number
  serving: boolean
  onPlus: () => void
  onMinus: () => void
}) {
  return (
    <div className={`score-side ${side} ${serving ? 'serving' : ''}`}>
      <div className="team">
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {serving && <span aria-label="tiene el saque">🏐 </span>}
          {name}
        </span>
        <span className="badge">{sets} sets</span>
      </div>
      <div className="pts" aria-live="polite" aria-label={`${name}: ${pts} puntos`}>
        {pts}
      </div>
      <button className="plus" aria-label={`Sumar punto a ${name}`} onClick={onPlus}>
        +1
      </button>
      <button className="minus" aria-label={`Anular último punto de ${name}`} onClick={onMinus} disabled={pts === 0}>
        ↶ anular último punto
      </button>
    </div>
  )
}

