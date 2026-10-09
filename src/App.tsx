import { useEffect } from 'react'
import { useStore } from './state/store'
import { ToastHost } from './ui/components'
import { LiveMatch } from './ui/live/LiveMatch'
import { useRoute } from './ui/router'
import { History } from './ui/screens/History'
import { Home } from './ui/screens/Home'
import { MatchSetup } from './ui/screens/MatchSetup'
import { Matches } from './ui/screens/Matches'
import { Players } from './ui/screens/Players'
import { Settings } from './ui/screens/Settings'
import { Summary } from './ui/screens/Summary'

export default function App() {
  const loaded = useStore((s) => s.loaded)
  const loadError = useStore((s) => s.loadError)
  const init = useStore((s) => s.init)
  const route = useRoute()

  useEffect(() => {
    void init()
  }, [init])

  // Solo avisa al cerrar/recargar si hay una escritura todavía sin confirmar.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().pendingWrites > 0) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  if (!loaded) return <div className="app"><p className="page muted center">Cargando…</p></div>
  if (loadError)
    return (
      <div className="app">
        <div className="page">
          <div className="banner warn">No se pudo abrir el almacenamiento local: {loadError}</div>
          <p className="muted small">Si estás en modo incógnito, abre la app en una ventana normal.</p>
        </div>
      </div>
    )

  return (
    <div className="app">
      <Screen route={route} />
      <ToastHost />
    </div>
  )
}

function Screen({ route }: { route: string[] }) {
  const [a, b, c] = route
  switch (a) {
    case undefined:
      return <Home />
    case 'jugadores':
      return <Players />
    case 'nuevo':
      return <MatchSetup />
    case 'partidos':
      return <Matches />
    case 'configuracion':
      return <Settings />
    case 'partido':
      if (!b) return <Home />
      if (c === 'historial') return <History key={b} matchId={b} />
      if (c === 'resumen') return <Summary key={b} matchId={b} />
      return <LiveMatch key={b} matchId={b} />
    default:
      return <Home />
  }
}
