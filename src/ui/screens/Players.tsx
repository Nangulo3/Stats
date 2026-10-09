import { useMemo, useState } from 'react'
import { validatePlayer, type PlayerDraft, type PlayerErrors } from '../../domain/match'
import { ROLE_LABELS, type Player, type PlayerRole } from '../../domain/types'
import { useStore } from '../../state/store'
import { Field, Sheet, TopBar } from '../components'
import { DemoRosterButton } from '../DemoRosterButton'

const ROLES = Object.keys(ROLE_LABELS) as PlayerRole[]

export function Players() {
  const players = useStore((s) => s.players)
  const [editing, setEditing] = useState<Player | 'new' | null>(null)
  const [showInactive, setShowInactive] = useState(true)

  const sorted = useMemo(
    () =>
      [...players]
        .filter((p) => showInactive || p.active)
        .sort((a, b) => Number(b.active) - Number(a.active) || a.number - b.number),
    [players, showInactive],
  )

  return (
    <>
      <TopBar
        title="Jugadores"
        sub={`${players.filter((p) => p.active).length} activos · ${players.length} en total`}
        back="/"
        right={
          <button className="btn primary small" onClick={() => setEditing('new')}>
            ＋ Nuevo
          </button>
        }
      />
      <div className="page">
        <label className="check small">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Mostrar inactivos
        </label>
        {sorted.length === 0 ? (
          <div className="card center stack">
            <p className="muted" style={{ margin: 0 }}>
              Crea la plantilla para poder preparar un partido.
            </p>
            <button className="btn primary" onClick={() => setEditing('new')}>
              ＋ Crear el primer jugador
            </button>
            <DemoRosterButton />
          </div>
        ) : (
          <>
          <DemoRosterButton className="btn small block" />
          <div className="list">
            {sorted.map((p) => (
              <button key={p.id} className="list-item" onClick={() => setEditing(p)}>
                <span className={`jersey ${p.active ? '' : 'inactive'}`}>{p.number}</span>
                <span className="grow">
                  <strong>{p.name}</strong>
                  <span className="muted small" style={{ display: 'block' }}>
                    {ROLE_LABELS[p.role]} ({p.role})
                  </span>
                </span>
                <span className={`badge ${p.active ? 'live' : 'off'}`}>{p.active ? 'Activo' : 'Inactivo'}</span>
              </button>
            ))}
          </div>
          </>
        )}
      </div>
      {editing && <PlayerEditor player={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function PlayerEditor({ player, onClose }: { player: Player | null; onClose: () => void }) {
  const players = useStore((s) => s.players)
  const matches = useStore((s) => s.matches)
  const savePlayer = useStore((s) => s.savePlayer)
  const setActive = useStore((s) => s.setPlayerActive)
  const removePlayer = useStore((s) => s.removePlayer)
  const showToast = useStore((s) => s.showToast)
  const [draft, setDraft] = useState<PlayerDraft>({
    number: player ? String(player.number) : '',
    name: player?.name ?? '',
    role: player?.role ?? '',
  })
  const [errors, setErrors] = useState<PlayerErrors>({})
  const used = player ? matches.some((m) => m.roster.some((r) => r.id === player.id)) : false

  async function save(andNew = false) {
    const errs = validatePlayer(draft, players, player?.id)
    setErrors(errs)
    if (Object.keys(errs).length) return
    // El formulario se limpia antes de esperar a IndexedDB para no pisar lo que se escriba después.
    const saving = savePlayer(draft, player?.id)
    if (andNew) {
      setDraft({ number: '', name: '', role: draft.role })
      setErrors({})
      document.getElementById('pnum')?.focus()
    } else onClose()
    await saving
    showToast({ kind: 'info', message: `#${draft.number} ${draft.name.trim()} guardado` })
  }

  async function toggleActive() {
    if (!player) return
    if (!player.active) {
      // al reactivar, el número no debe chocar con otro activo
      const errs = validatePlayer({ number: String(player.number), name: player.name, role: player.role }, players, player.id)
      if (errs.number) {
        setErrors(errs)
        return
      }
    }
    await setActive(player.id, !player.active)
    onClose()
  }

  async function remove() {
    if (!player) return
    const msg = used
      ? `#${player.number} participó en partidos: se desactivará y su historial se conservará. ¿Continuar?`
      : `¿Eliminar a #${player.number} ${player.name}? No ha jugado ningún partido.`
    if (!confirm(msg)) return
    const r = await removePlayer(player.id)
    showToast({ kind: 'info', message: r === 'deleted' ? 'Jugador eliminado' : 'Jugador desactivado' })
    onClose()
  }

  return (
    <Sheet title={player ? `Editar #${player.number}` : 'Nuevo jugador'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        noValidate
      >
        <div className="form-grid">
          <Field label="Número" htmlFor="pnum" error={errors.number}>
            <input
              id="pnum"
              className="input"
              inputMode="numeric"
              autoFocus
              value={draft.number}
              aria-invalid={!!errors.number}
              onChange={(e) => setDraft({ ...draft, number: e.target.value.replace(/\D/g, '').slice(0, 2) })}
            />
          </Field>
          <Field label="Posición habitual" htmlFor="prole" error={errors.role}>
            <select
              id="prole"
              className="input"
              value={draft.role}
              aria-invalid={!!errors.role}
              onChange={(e) => setDraft({ ...draft, role: e.target.value as PlayerRole })}
            >
              <option value="">Elegir…</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]} ({r})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nombre" htmlFor="pname" error={errors.name} className="full">
            <input
              id="pname"
              className="input"
              value={draft.name}
              autoComplete="off"
              aria-invalid={!!errors.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
        </div>
        <button type="submit" className="btn primary block">
          Guardar
        </button>
        {!player && (
          <button type="button" className="btn block" onClick={() => void save(true)}>
            Guardar y crear otro
          </button>
        )}
        {player && (
          <div className="row">
            <button type="button" className="btn grow" onClick={() => void toggleActive()}>
              {player.active ? 'Desactivar' : 'Reactivar'}
            </button>
            <button type="button" className="btn danger grow" onClick={() => void remove()}>
              Eliminar
            </button>
          </div>
        )}
        {used && <p className="muted small">Este jugador tiene partidos registrados: no se puede borrar, solo desactivar.</p>}
      </form>
    </Sheet>
  )
}
