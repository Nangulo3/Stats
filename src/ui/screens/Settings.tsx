import { useMemo, useRef, useState } from 'react'
import { parseBackup } from '../../domain/backup'
import { hasBlockingIssues, moveInOrder, validateAction, validateConfig } from '../../domain/config'
import { newId } from '../../domain/ids'
import { ROLE_LABELS, type ActionCategory, type ActionDef, type PlayerRole } from '../../domain/types'
import { useStore } from '../../state/store'
import { Field, Sheet, TopBar } from '../components'
import { catStyle, downloadText } from '../format'

const ROLES = Object.keys(ROLE_LABELS) as PlayerRole[]

export function Settings() {
  const categories = useStore((s) => s.categories)
  const actions = useStore((s) => s.actions)
  const events = useStore((s) => s.events)
  const setConfig = useStore((s) => s.setConfig)
  const restoreDefaults = useStore((s) => s.restoreDefaults)
  const [editAction, setEditAction] = useState<ActionDef | null>(null)
  const [editCat, setEditCat] = useState<ActionCategory | null>(null)

  const sortedCats = useMemo(() => [...categories].sort((a, b) => a.order - b.order), [categories])
  const usage = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of events) if (e.type === 'stat' && !e.voided) m.set(e.action.id, (m.get(e.action.id) ?? 0) + 1)
    return m
  }, [events])
  const issues = useMemo(() => validateConfig(actions, categories), [actions, categories])

  function newAction(categoryId: string): ActionDef {
    return {
      id: newId(),
      code: '',
      name: '',
      description: '',
      categoryId,
      active: true,
      order: actions.filter((a) => a.categoryId === categoryId).length,
      alsoCounts: [],
      eligibleRoles: [],
      confirm: false,
      teamMetric: false,
    }
  }

  async function moveAction(a: ActionDef, dir: -1 | 1) {
    const inCat = actions.filter((x) => x.categoryId === a.categoryId)
    const moved = moveInOrder(inCat, a.id, dir)
    const byId = new Map(moved.map((x) => [x.id, x]))
    await setConfig(categories, actions.map((x) => byId.get(x.id) ?? x))
  }

  async function toggleAction(a: ActionDef) {
    await setConfig(categories, actions.map((x) => (x.id === a.id ? { ...x, active: !x.active } : x)))
  }

  async function moveCat(c: ActionCategory, dir: -1 | 1) {
    await setConfig(moveInOrder(categories, c.id, dir), actions)
  }

  return (
    <>
      <TopBar title="Configuración" sub="Acciones, categorías y copias de seguridad" back="/" />
      <div className="page">
        <p className="muted small" style={{ margin: 0 }}>
          Lo que configures aquí es lo que aparece al tocar un jugador durante el partido. Los cambios se guardan al instante y
          no modifican los eventos ya registrados.
        </p>
        {issues.filter((i) => i.level === 'error').length > 0 && (
          <div className="issue error">Hay errores en la configuración; revisa las acciones marcadas.</div>
        )}

        {sortedCats.map((c, ci) => {
          const items = actions.filter((a) => a.categoryId === c.id).sort((a, b) => a.order - b.order)
          return (
            <section key={c.id} className="cat-block" style={{ ...catStyle(c.color), padding: 0 }}>
              <div className="row" style={{ padding: '8px 10px' }}>
                <span className="cat-dot" aria-hidden />
                <strong className="grow">
                  {c.icon} {c.name}
                </strong>
                <button className="icon-btn" aria-label={`Subir categoría ${c.name}`} disabled={ci === 0} onClick={() => void moveCat(c, -1)}>
                  ↑
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Bajar categoría ${c.name}`}
                  disabled={ci === sortedCats.length - 1}
                  onClick={() => void moveCat(c, 1)}
                >
                  ↓
                </button>
                <button className="btn small" onClick={() => setEditCat(c)}>
                  Editar
                </button>
              </div>
              <div style={{ borderTop: '1px solid var(--line)' }}>
                {items.map((a, i) => {
                  const err = validateAction(a, actions, categories).some((x) => x.level === 'error')
                  return (
                    <div key={a.id} className={`config-action ${a.active ? '' : 'inactive'}`}>
                      <button className="code-pill" style={{ border: 0 }} onClick={() => setEditAction(a)} aria-label={`Editar ${a.code}`}>
                        {a.code || '?'}
                      </button>
                      <button
                        style={{ border: 0, background: 'transparent', textAlign: 'left', padding: 0 }}
                        onClick={() => setEditAction(a)}
                      >
                        <strong>{a.name}</strong>
                        <span className="muted small" style={{ display: 'block' }}>
                          {!a.active && 'Inactiva · '}
                          {a.alsoCounts.length > 0 &&
                            `+ ${a.alsoCounts.map((id) => actions.find((x) => x.id === id)?.code ?? '?').join(', ')} · `}
                          {usage.get(a.id) ?? 0} registros
                          {err && <span style={{ color: 'var(--danger)' }}> · revisar</span>}
                        </span>
                      </button>
                      <span className="row" style={{ gap: 0 }}>
                        <button className="icon-btn" aria-label={`Subir ${a.code}`} disabled={i === 0} onClick={() => void moveAction(a, -1)}>
                          ↑
                        </button>
                        <button
                          className="icon-btn"
                          aria-label={`Bajar ${a.code}`}
                          disabled={i === items.length - 1}
                          onClick={() => void moveAction(a, 1)}
                        >
                          ↓
                        </button>
                        <button
                          className="icon-btn"
                          aria-label={a.active ? `Desactivar ${a.code}` : `Activar ${a.code}`}
                          aria-pressed={a.active}
                          onClick={() => void toggleAction(a)}
                          title={a.active ? 'Desactivar' : 'Activar'}
                        >
                          {a.active ? '●' : '○'}
                        </button>
                      </span>
                    </div>
                  )
                })}
                <div style={{ padding: 8 }}>
                  <button className="btn small block" onClick={() => setEditAction(newAction(c.id))}>
                    ＋ Acción en {c.name}
                  </button>
                </div>
              </div>
            </section>
          )
        })}

        <button
          className="btn block"
          onClick={() =>
            setEditCat({ id: newId(), name: '', color: '#0f766e', icon: '★', order: categories.length })
          }
        >
          ＋ Nueva categoría
        </button>

        <BackupSection />

        <button
          className="btn danger block"
          onClick={() => {
            if (confirm('¿Restaurar acciones y categorías predeterminadas? Los eventos registrados no se modifican.'))
              void restoreDefaults()
          }}
        >
          Restaurar acciones y categorías predeterminadas
        </button>
      </div>

      {editAction && <ActionEditor initial={editAction} usage={usage.get(editAction.id) ?? 0} onClose={() => setEditAction(null)} />}
      {editCat && <CategoryEditor initial={editCat} onClose={() => setEditCat(null)} />}
    </>
  )
}

function ActionEditor({ initial, usage, onClose }: { initial: ActionDef; usage: number; onClose: () => void }) {
  const actions = useStore((s) => s.actions)
  const categories = useStore((s) => s.categories)
  const saveAction = useStore((s) => s.saveAction)
  const deleteAction = useStore((s) => s.deleteAction)
  const [a, setA] = useState<ActionDef>(initial)
  const isNew = !actions.some((x) => x.id === initial.id)
  const others = actions.filter((x) => x.id !== a.id)
  const all = isNew ? [...actions, a] : actions.map((x) => (x.id === a.id ? a : x))
  const issues = validateAction(a, all, categories)
  const cat = categories.find((c) => c.id === a.categoryId)

  function changeCategory(categoryId: string) {
    const order = categoryId === initial.categoryId ? initial.order : actions.filter((x) => x.categoryId === categoryId).length
    setA({ ...a, categoryId, order })
  }

  function toggleIn<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
  }

  async function save() {
    if (hasBlockingIssues(issues)) return
    await saveAction({ ...a, code: a.code.trim(), name: a.name.trim(), description: a.description.trim() })
    onClose()
  }

  return (
    <Sheet title={isNew ? 'Nueva acción' : `Editar ${initial.code}`} onClose={onClose}>
      <div className="stack">
        <div className="form-grid">
          <Field label="Abreviatura" htmlFor="acode">
            <input id="acode" className="input" maxLength={10} value={a.code} onChange={(e) => setA({ ...a, code: e.target.value })} />
          </Field>
          <Field label="Categoría" htmlFor="acat">
            <select id="acat" className="input" value={a.categoryId} onChange={(e) => changeCategory(e.target.value)}>
              {[...categories]
                .sort((x, y) => x.order - y.order)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Nombre visible" htmlFor="aname" className="full">
            <input id="aname" className="input" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} />
          </Field>
          <Field label="Descripción / ayuda" htmlFor="adesc" className="full">
            <textarea
              id="adesc"
              className="input"
              rows={2}
              value={a.description}
              onChange={(e) => setA({ ...a, description: e.target.value })}
            />
          </Field>
        </div>

        {cat && (
          <div className="row small" style={catStyle(cat.color)}>
            <span className="muted">Vista previa:</span>
            <span className="code-pill">{a.code || '?'}</span>
            <span className="muted">color heredado de {cat.name}</span>
          </div>
        )}

        <label className="check">
          <input type="checkbox" checked={a.active} onChange={(e) => setA({ ...a, active: e.target.checked })} />
          Activa (aparece durante el partido)
        </label>
        <label className="check">
          <input type="checkbox" checked={a.confirm} onChange={(e) => setA({ ...a, confirm: e.target.checked })} />
          Pedir confirmación (doble toque) al registrarla
        </label>
        <label className="check">
          <input type="checkbox" checked={a.teamMetric} onChange={(e) => setA({ ...a, teamMetric: e.target.checked })} />
          Mostrar en el resumen de equipo
        </label>

        <div className="field">
          <span className="label">Contador primario</span>
          <span className="small">Registrar esta acción suma 1 a <strong>{a.code || 'esta acción'}</strong>.</span>
        </div>
        <div className="field">
          <span className="label">También suma a (contadores derivados)</span>
          <div className="chips">
            {others.map((o) => (
              <button
                key={o.id}
                type="button"
                className="chip"
                aria-pressed={a.alsoCounts.includes(o.id)}
                onClick={() => setA({ ...a, alsoCounts: toggleIn(a.alsoCounts, o.id) })}
              >
                {o.code}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Disponible para (vacío = todos los jugadores)</span>
          <div className="chips">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                className="chip"
                aria-pressed={a.eligibleRoles.includes(r)}
                onClick={() => setA({ ...a, eligibleRoles: toggleIn(a.eligibleRoles, r) })}
              >
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>

        {issues.map((i, k) => (
          <div key={k} className={`issue ${i.level}`} role={i.level === 'error' ? 'alert' : undefined}>
            {i.level === 'error' ? '✕ ' : '⚠ '}
            {i.message}
          </div>
        ))}

        <button className="btn primary block" disabled={hasBlockingIssues(issues)} onClick={() => void save()}>
          Guardar
        </button>

        {!isNew && (
          <div className="stack" style={{ gap: 6 }}>
            {usage > 0 && (
              <p className="muted small" style={{ margin: 0 }}>
                Esta acción tiene {usage} registros. Los datos históricos se conservan siempre; lo recomendado es
                desactivarla en lugar de eliminarla.
              </p>
            )}
            <button
              className="btn danger block"
              onClick={() => {
                const msg =
                  usage > 0
                    ? `“${initial.code}” tiene ${usage} registros. Si la eliminas, los eventos se conservan y seguirán apareciendo en los resúmenes como acción eliminada. ¿Eliminar de todos modos?`
                    : `¿Eliminar “${initial.code}”?`
                if (confirm(msg)) void deleteAction(initial.id).then(onClose)
              }}
            >
              Eliminar acción
            </button>
          </div>
        )}
      </div>
    </Sheet>
  )
}

function CategoryEditor({ initial, onClose }: { initial: ActionCategory; onClose: () => void }) {
  const categories = useStore((s) => s.categories)
  const saveCategory = useStore((s) => s.saveCategory)
  const deleteCategory = useStore((s) => s.deleteCategory)
  const showToast = useStore((s) => s.showToast)
  const [c, setC] = useState(initial)
  const isNew = !categories.some((x) => x.id === initial.id)
  const valid = c.name.trim().length > 0 && /^#[0-9a-fA-F]{6}$/.test(c.color)

  return (
    <Sheet title={isNew ? 'Nueva categoría' : `Editar ${initial.name}`} onClose={onClose}>
      <div className="stack">
        <Field label="Nombre" htmlFor="cname" error={c.name.trim() ? undefined : 'Escribe un nombre.'}>
          <input id="cname" className="input" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
        </Field>
        <div className="form-grid">
          <Field label="Color" htmlFor="ccolor">
            <div className="row">
              <input
                id="ccolor"
                type="color"
                className="color-input"
                value={/^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : '#000000'}
                onChange={(e) => setC({ ...c, color: e.target.value })}
              />
              <input
                className="input"
                aria-label="Color en hexadecimal"
                value={c.color}
                onChange={(e) => setC({ ...c, color: e.target.value.trim() })}
              />
            </div>
          </Field>
          <Field label="Icono (opcional)" htmlFor="cicon">
            <input id="cicon" className="input" maxLength={2} value={c.icon} onChange={(e) => setC({ ...c, icon: e.target.value })} />
          </Field>
        </div>
        <div className="cat-block" style={catStyle(c.color)}>
          <div className="cat-title">
            <span className="cat-dot" /> {c.icon} {c.name || 'Vista previa'}
          </div>
          <div className="action-grid">
            <span className="action-btn">
              <span className="code">ABC</span>
              <span className="name">Ejemplo</span>
            </span>
          </div>
        </div>
        <button
          className="btn primary block"
          disabled={!valid}
          onClick={() => void saveCategory({ ...c, name: c.name.trim() }).then(onClose)}
        >
          Guardar
        </button>
        {!isNew && (
          <button
            className="btn danger block"
            onClick={async () => {
              if (!confirm(`¿Eliminar la categoría “${initial.name}”?`)) return
              const err = await deleteCategory(initial.id)
              if (err) showToast({ kind: 'error', message: err })
              else onClose()
            }}
          >
            Eliminar categoría
          </button>
        )}
      </div>
    </Sheet>
  )
}

function BackupSection() {
  const exportData = useStore((s) => s.exportData)
  const importData = useStore((s) => s.importData)
  const showToast = useStore((s) => s.showToast)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onFile(file: File) {
    const text = await file.text()
    const r = parseBackup(text)
    if (!r.ok) {
      showToast({ kind: 'error', message: r.error })
      return
    }
    const d = r.data
    const ok = confirm(
      `Restaurar copia del ${new Date(d.exportedAt).toLocaleString('es-CO')}:\n` +
        `${d.players.length} jugadores, ${d.matches.length} partidos, ${d.events.length} eventos.\n\n` +
        'Esto REEMPLAZA todos los datos actuales de este dispositivo. ¿Continuar?',
    )
    if (!ok) return
    await importData(d)
    showToast({ kind: 'info', message: 'Copia restaurada' })
  }

  return (
    <section className="card stack">
      <h2>Copia de seguridad</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Todo se guarda solo en este dispositivo. Exporta una copia de vez en cuando para no perder datos.
      </p>
      <button
        className="btn block"
        onClick={() => {
          const d = exportData()
          downloadText(`volei-backup-${d.exportedAt.slice(0, 10)}.json`, JSON.stringify(d, null, 2), 'application/json')
        }}
      >
        ⬇ Exportar todo (JSON)
      </button>
      <button className="btn block" onClick={() => fileRef.current?.click()}>
        ⬆ Restaurar desde JSON…
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void onFile(f)
        }}
      />
    </section>
  )
}
