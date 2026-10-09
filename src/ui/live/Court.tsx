import type { ID, Lineup, PlayerSnapshot, Position } from '../../domain/types'

const ORDER: Position[] = [4, 3, 2, 5, 6, 1]

/** Cancha fija 4–3–2 / 5–6–1. Siempre seis círculos; cambia quién ocupa cada uno. */
export function Court({
  lineup,
  roster,
  liberoId,
  selected,
  onTap,
}: {
  lineup: Lineup
  roster: Map<ID, PlayerSnapshot>
  liberoId: ID | null
  selected: Position | null
  onTap: (pos: Position) => void
}) {
  return (
    <div className="court" aria-label="Cancha">
      <span className="court-label front">Red · fila delantera</span>
      <span className="court-label back">Zaga</span>
      <div className="court-grid">
        {ORDER.map((pos) => {
          const id = lineup[pos]
          const p = id ? roster.get(id) : undefined
          const cls = ['circle', !p && 'empty', id === liberoId && 'libero', selected === pos && 'selected']
            .filter(Boolean)
            .join(' ')
          return (
            <div className="slot" key={pos}>
              <button
                className={cls}
                disabled={!p}
                aria-pressed={selected === pos}
                aria-label={p ? `Posición ${pos}: #${p.number} ${p.name}, ${p.role}` : `Posición ${pos} vacía`}
                onClick={() => onTap(pos)}
              >
                <span className="num">{p ? p.number : '—'}</span>
                <span className="role">{p ? p.role : ''}</span>
              </button>
              <span className="pos">P{pos}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
