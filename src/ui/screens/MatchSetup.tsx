import { useMemo, useState } from 'react'
import { DEFAULT_RULES } from '../../domain/defaults'
import { emptyLineup } from '../../domain/lineup'
import { validateNewMatch, type NewMatchInput } from '../../domain/match'
import { BACK_ROW, type ID, type Lineup, type Position } from '../../domain/types'
import { useStore } from '../../state/store'
import { Field, TopBar } from '../components'
import { navigate, routes } from '../router'

function localInputValue(d: Date) {
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}

const LAST_TEAM_KEY = 'volei.lastTeamName'

export function MatchSetup() {
  const players = useStore((s) => s.players)
  const createMatch = useStore((s) => s.createMatch)
  const active = useMemo(() => players.filter((p) => p.active).sort((a, b) => a.number - b.number), [players])

  const [ourTeam, setOurTeam] = useState(() => {
    try {
      return localStorage.getItem(LAST_TEAM_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [opponent, setOpponent] = useState('')
  const [date, setDate] = useState(() => localInputValue(new Date()))
  const [rules, setRules] = useState({ ...DEFAULT_RULES })
  const [firstServe, setFirstServe] = useState<'us' | 'them'>('us')
  const [lineup, setLineup] = useState<Lineup>(emptyLineup())
  const [liberoId, setLiberoId] = useState<ID | ''>(() => active.find((p) => p.role === 'LI')?.id ?? '')
  const [liberoStart, setLiberoStart] = useState<Position | ''>('')
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const assigned = new Set(Object.values(lineup).filter(Boolean))
  const byId = new Map(active.map((p) => [p.id, p]))

  function setSlot(pos: Position, id: ID | '') {
    const next = { ...lineup }
    // Si el jugador ya estaba en otra posición, se mueve (no se duplica).
    for (const p of [1, 2, 3, 4, 5, 6] as Position[]) if (id && next[p] === id) next[p] = null
    next[pos] = id || null
    setLineup(next)
    if (id && id === liberoId) setLiberoId('')
  }

  async function start() {
    const input: NewMatchInput = {
      ourTeam,
      opponent,
      date: new Date(date).toISOString(),
      rules,
      firstServe,
      lineup,
      liberoId: liberoId || null,
      liberoStartPosition: liberoId && liberoStart ? liberoStart : null,
    }
    const errs = validateNewMatch(input, players)
    setErrors(errs)
    if (errs.length) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setBusy(true)
    try {
      localStorage.setItem(LAST_TEAM_KEY, ourTeam.trim())
    } catch {
      // opcional
    }
    const id = await createMatch(input)
    navigate(routes.live(id), true)
  }

  if (active.length < 6) {
    return (
      <>
        <TopBar title="Nuevo partido" back="/" />
        <div className="page">
          <div className="card stack center">
            <p style={{ margin: 0 }}>
              Necesitas al menos <strong>6 jugadores activos</strong> (tienes {active.length}).
            </p>
            <a className="btn primary" href={'#' + routes.players()}>
              Ir a Jugadores
            </a>
          </div>
        </div>
      </>
    )
  }

  const slot = (pos: Position) => {
    const id = lineup[pos]
    const p = id ? byId.get(id) : undefined
    return (
      <div className="slot" key={pos}>
        <span className="pos">P{pos}</span>
        <select
          aria-label={`Jugador en posición ${pos}`}
          className={id ? '' : 'empty'}
          value={id ?? ''}
          onChange={(e) => setSlot(pos, e.target.value)}
        >
          <option value="">— elegir —</option>
          {active.map((pl) => (
            <option key={pl.id} value={pl.id}>
              #{pl.number} {pl.name} ({pl.role}){assigned.has(pl.id) && pl.id !== id ? ' ·en cancha' : ''}
            </option>
          ))}
        </select>
        {p && liberoStart === pos && liberoId && <span className="pos">↔ líbero</span>}
      </div>
    )
  }

  const liberoOptions = active.filter((p) => !assigned.has(p.id))

  return (
    <>
      <TopBar title="Nuevo partido" back="/" />
      <div className="page">
        {errors.length > 0 && (
          <div className="banner warn" role="alert" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            {errors.map((e) => (
              <span key={e}>• {e}</span>
            ))}
          </div>
        )}

        <section className="card stack">
          <h2>Partido</h2>
          <div className="form-grid">
            <Field label="Nuestro equipo" htmlFor="us">
              <input id="us" className="input" value={ourTeam} onChange={(e) => setOurTeam(e.target.value)} />
            </Field>
            <Field label="Rival" htmlFor="them">
              <input id="them" className="input" value={opponent} onChange={(e) => setOpponent(e.target.value)} />
            </Field>
            <Field label="Fecha y hora" htmlFor="date" className="full">
              <input id="date" type="datetime-local" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <div className="field">
            <span className="label">Formato</span>
            <div className="seg">
              {([3, 5] as const).map((n) => (
                <button key={n} type="button" aria-pressed={rules.bestOf === n} onClick={() => setRules({ ...rules, bestOf: n })}>
                  Al mejor de {n}
                </button>
              ))}
            </div>
          </div>
          <div className="form-grid">
            <Field label="Puntos por set" htmlFor="pps">
              <input
                id="pps"
                className="input"
                inputMode="numeric"
                value={rules.pointsPerSet}
                onChange={(e) => setRules({ ...rules, pointsPerSet: Number(e.target.value.replace(/\D/g, '')) || 0 })}
              />
            </Field>
            <Field label={`Set decisivo (${rules.bestOf}º)`} htmlFor="dsp">
              <input
                id="dsp"
                className="input"
                inputMode="numeric"
                value={rules.decidingSetPoints}
                onChange={(e) => setRules({ ...rules, decidingSetPoints: Number(e.target.value.replace(/\D/g, '')) || 0 })}
              />
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={rules.winByTwo} onChange={(e) => setRules({ ...rules, winByTwo: e.target.checked })} />
            Diferencia de dos puntos para ganar el set
          </label>
          <div className="field">
            <span className="label">Saque inicial</span>
            <div className="seg">
              <button type="button" aria-pressed={firstServe === 'us'} onClick={() => setFirstServe('us')}>
                {ourTeam.trim() || 'Nosotros'}
              </button>
              <button type="button" aria-pressed={firstServe === 'them'} onClick={() => setFirstServe('them')}>
                {opponent.trim() || 'Rival'}
              </button>
            </div>
          </div>
        </section>

        <section className="card stack">
          <h2>Titulares</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Asigna un jugador a cada posición. La red está arriba.
          </p>
          <div className="court court-preview">
            <div className="court-grid">
              {([4, 3, 2, 5, 6, 1] as Position[]).map(slot)}
            </div>
          </div>
        </section>

        <section className="card stack">
          <h2>Líbero (opcional)</h2>
          <Field label="Líbero disponible" htmlFor="lib">
            <select
              id="lib"
              className="input"
              value={liberoId}
              onChange={(e) => {
                setLiberoId(e.target.value)
                if (!e.target.value) setLiberoStart('')
              }}
            >
              <option value="">Sin líbero</option>
              {liberoOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.number} {p.name} ({p.role})
                </option>
              ))}
            </select>
          </Field>
          {liberoId && (
            <Field label="¿Entra desde el inicio?" htmlFor="libstart">
              <select
                id="libstart"
                className="input"
                value={liberoStart}
                onChange={(e) => setLiberoStart(e.target.value ? (Number(e.target.value) as Position) : '')}
              >
                <option value="">No, queda disponible</option>
                {BACK_ROW.map((pos) => {
                  const p = lineup[pos] ? byId.get(lineup[pos]!) : undefined
                  return (
                    <option key={pos} value={pos} disabled={!p}>
                      Sí, en P{pos} por {p ? `#${p.number} ${p.name}` : '(posición vacía)'}
                    </option>
                  )
                })}
              </select>
            </Field>
          )}
          <p className="muted small" style={{ margin: 0 }}>
            El resto de jugadores activos quedan como suplentes del partido.
          </p>
        </section>

        <button className="btn primary big block" disabled={busy} onClick={() => void start()}>
          Iniciar partido
        </button>
      </div>
    </>
  )
}
