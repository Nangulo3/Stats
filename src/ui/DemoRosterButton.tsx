import { missingDemoPlayers } from '../domain/match'
import { useStore } from '../state/store'

/** Carga la plantilla fija de 7 jugadores (2 PU, 1 OP, 1 AR, 2 CE, 1 LI) sin duplicar números. */
export function DemoRosterButton({ className = 'btn block' }: { className?: string }) {
  const players = useStore((s) => s.players)
  const savePlayer = useStore((s) => s.savePlayer)
  const showToast = useStore((s) => s.showToast)
  const missing = missingDemoPlayers(players)

  async function load() {
    for (const d of missing) await savePlayer(d)
    showToast({ kind: 'info', message: `Se agregaron ${missing.length} jugadores de prueba` })
  }

  if (missing.length === 0) return null
  return (
    <button className={className} onClick={() => void load()}>
      ⚡ Cargar plantilla de prueba (7 jugadores)
    </button>
  )
}
