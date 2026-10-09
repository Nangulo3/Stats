import { useState } from 'react'
import { liberoIn, liberoOut, substitute } from '../../domain/commands'
import { playersOnCourt } from '../../domain/lineup'
import type { MatchState } from '../../domain/matchState'
import { BACK_ROW, POSITIONS, type ID, type Match, type PlayerSnapshot, type Position } from '../../domain/types'
import { useStore } from '../../state/store'
import { Sheet } from '../components'

function PlayerButton({
  p,
  sub,
  pressed,
  onClick,
  disabled,
}: {
  p: PlayerSnapshot
  sub?: string
  pressed?: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button className="list-item" aria-pressed={pressed} onClick={onClick} disabled={disabled}
      style={pressed ? { background: 'color-mix(in srgb, var(--focus) 25%, transparent)' } : undefined}>
      <span className="jersey">{p.number}</span>
      <span className="grow">
        <strong>{p.name}</strong>
        <span className="muted small" style={{ display: 'block' }}>
          {p.role}
          {sub ? ` · ${sub}` : ''}
        </span>
      </span>
      {pressed && <span aria-hidden>✓</span>}
    </button>
  )
}

export function SubstitutionSheet({
  match,
  state,
  roster,
  initialPosition,
  onClose,
}: {
  match: Match
  state: MatchState
  roster: Map<ID, PlayerSnapshot>
  initialPosition?: Position | null
  onClose: () => void
}) {
  const run = useStore((s) => s.run)
  const showToast = useStore((s) => s.showToast)
  const [pos, setPos] = useState<Position | null>(initialPosition ?? null)
  const [inId, setInId] = useState<ID | null>(null)

  const onCourt = new Set(playersOnCourt(state.lineup))
  const bench = match.roster
    .filter((p) => !onCourt.has(p.id) && p.id !== match.liberoId && p.id !== state.liberoReplacedId)
    .sort((a, b) => a.number - b.number)
  const out = pos ? roster.get(state.lineup[pos] ?? '') : undefined
  const incoming = inId ? roster.get(inId) : undefined

  async function confirm() {
    if (!pos || !inId) return
    const ev = await run(match.id, (ctx) => substitute(ctx, pos, inId))
    if (ev) {
      showToast({
        kind: 'info',
        message: `Sale #${ev.out.number}, entra #${ev.in.number}`,
        undoEventId: ev.id,
        matchId: match.id,
      })
      onClose()
    }
  }

  return (
    <Sheet title="Sustitución" onClose={onClose}>
      <div className="stack">
        <div className="section-title">1. ¿Quién sale?</div>
        <div className="list">
          {POSITIONS.map((p) => {
            const pl = roster.get(state.lineup[p] ?? '')
            if (!pl) return null
            const isLib = pl.id === match.liberoId
            return (
              <PlayerButton
                key={p}
                p={pl}
                sub={isLib ? `P${p} · líbero (usa el modo Líbero)` : `P${p}`}
                pressed={pos === p}
                disabled={isLib}
                onClick={() => setPos(p)}
              />
            )
          })}
        </div>

        <div className="section-title">2. ¿Quién entra?</div>
        {bench.length === 0 ? (
          <p className="muted small">No hay suplentes disponibles.</p>
        ) : (
          <div className="list">
            {bench.map((p) => (
              <PlayerButton key={p.id} p={p} pressed={inId === p.id} onClick={() => setInId(p.id)} />
            ))}
          </div>
        )}
        {state.liberoReplacedId && (
          <p className="muted small" style={{ margin: 0 }}>
            #{roster.get(state.liberoReplacedId)?.number} está fuera por el líbero y vuelve cuando este salga.
          </p>
        )}

        <div className="banner info" aria-live="polite">
          {out && incoming
            ? `Sale #${out.number}, entra #${incoming.number}, posición ${pos}`
            : 'Elige quién sale y quién entra.'}
        </div>
        <button className="btn primary big block" disabled={!out || !incoming} onClick={() => void confirm()}>
          Confirmar sustitución
        </button>
      </div>
    </Sheet>
  )
}

export function LiberoSheet({
  match,
  state,
  roster,
  onClose,
}: {
  match: Match
  state: MatchState
  roster: Map<ID, PlayerSnapshot>
  onClose: () => void
}) {
  const run = useStore((s) => s.run)
  const showToast = useStore((s) => s.showToast)
  const libero = match.liberoId ? roster.get(match.liberoId) : undefined
  const [pos, setPos] = useState<Position | null>(null)

  if (!libero) {
    return (
      <Sheet title="Líbero" onClose={onClose}>
        <p className="muted">Este partido no tiene líbero. Se define al crear el partido.</p>
      </Sheet>
    )
  }

  if (state.liberoPosition) {
    const back = state.liberoReplacedId ? roster.get(state.liberoReplacedId) : undefined
    return (
      <Sheet title={`Líbero #${libero.number} en cancha`} onClose={onClose}>
        <div className="stack">
          {state.liberoFrontRowWarning && (
            <div className="banner warn">⚠ El líbero está en fila delantera (P{state.liberoPosition}). Retíralo o corrige la rotación.</div>
          )}
          <div className="banner info">
            {back
              ? `Sale el líbero #${libero.number}, vuelve #${back.number} ${back.name} a la posición ${state.liberoPosition}`
              : 'No se encontró al jugador reemplazado.'}
          </div>
          <button
            className="btn primary big block"
            disabled={!back}
            onClick={async () => {
              const ev = await run(match.id, (ctx) => liberoOut(ctx))
              if (ev) {
                showToast({ kind: 'info', message: `Sale líbero, vuelve #${ev.player.number}`, undoEventId: ev.id, matchId: match.id })
                onClose()
              }
            }}
          >
            Sacar líbero
          </button>
        </div>
      </Sheet>
    )
  }

  const chosen = pos ? roster.get(state.lineup[pos] ?? '') : undefined
  return (
    <Sheet title={`Entrada del líbero #${libero.number}`} onClose={onClose}>
      <div className="stack">
        <div className="section-title">¿Por quién entra? (solo zaga)</div>
        <div className="list">
          {BACK_ROW.map((p) => {
            const pl = roster.get(state.lineup[p] ?? '')
            if (!pl) return null
            return <PlayerButton key={p} p={pl} sub={`P${p}`} pressed={pos === p} onClick={() => setPos(p)} />
          })}
        </div>
        <div className="banner info">
          {chosen ? `Sale #${chosen.number}, entra líbero #${libero.number}, posición ${pos}` : 'Elige la posición zaguera.'}
        </div>
        <button
          className="btn primary big block"
          disabled={!chosen}
          onClick={async () => {
            if (!pos) return
            const ev = await run(match.id, (ctx) => liberoIn(ctx, pos))
            if (ev) {
              showToast({ kind: 'info', message: `Entra líbero por #${ev.player.number}`, undoEventId: ev.id, matchId: match.id })
              onClose()
            }
          }}
        >
          Confirmar entrada
        </button>
      </div>
    </Sheet>
  )
}
