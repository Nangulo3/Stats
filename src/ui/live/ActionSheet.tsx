import { useMemo, useState } from 'react'
import { isActionAvailableFor, recordStat } from '../../domain/commands'
import { ROLE_LABELS, type ActionDef, type Match, type PlayerSnapshot, type Position } from '../../domain/types'
import { useStore } from '../../state/store'
import { Sheet } from '../components'
import { catStyle } from '../format'

/** Hoja con las acciones del jugador tocado. Un toque registra y cierra. */
export function ActionSheet({
  match,
  position,
  player,
  onClose,
}: {
  match: Match
  position: Position
  player: PlayerSnapshot
  onClose: () => void
}) {
  const actions = useStore((s) => s.actions)
  const categories = useStore((s) => s.categories)
  const run = useStore((s) => s.run)
  const showToast = useStore((s) => s.showToast)
  const [armed, setArmed] = useState<string | null>(null)

  const groups = useMemo(() => {
    return [...categories]
      .sort((a, b) => a.order - b.order)
      .map((c) => ({
        cat: c,
        items: actions
          .filter((a) => a.categoryId === c.id && isActionAvailableFor(a, player))
          .sort((a, b) => a.order - b.order),
      }))
      .filter((g) => g.items.length > 0)
  }, [actions, categories, player])

  async function tap(a: ActionDef) {
    if (a.confirm && armed !== a.id) {
      setArmed(a.id)
      return
    }
    onClose()
    const ev = await run(match.id, (ctx) => recordStat(ctx, position, a, actions, categories))
    if (ev)
      showToast({
        kind: 'info',
        message: `#${player.number} · ${a.code} registrado`,
        undoEventId: ev.id,
        matchId: match.id,
      })
  }

  return (
    <Sheet
      onClose={onClose}
      title={
        <>
          #{player.number} {player.name}
          <span className="muted small" style={{ display: 'block', fontWeight: 500 }}>
            {ROLE_LABELS[player.role]} · posición {position}
          </span>
        </>
      }
    >
      {groups.length === 0 && <p className="muted">No hay acciones activas para este jugador. Revisa la configuración.</p>}
      {groups.map(({ cat, items }) => (
        <section key={cat.id} className="cat-block" style={catStyle(cat.color)} aria-label={cat.name}>
          <div className="cat-title">
            <span className="cat-dot" aria-hidden />
            <span aria-hidden>{cat.icon}</span>
            {cat.name}
          </div>
          <div className="action-grid">
            {items.map((a) => (
              <button
                key={a.id}
                className="action-btn"
                title={a.description || a.name}
                aria-label={`${a.code}: ${a.name}${armed === a.id ? '. Toca otra vez para confirmar' : ''}`}
                onClick={() => void tap(a)}
                style={armed === a.id ? { outline: '4px solid var(--focus)', outlineOffset: 2 } : undefined}
              >
                <span className="code">{a.code}</span>
                <span className="name">{armed === a.id ? '¿Seguro? Toca otra vez' : a.name}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </Sheet>
  )
}
