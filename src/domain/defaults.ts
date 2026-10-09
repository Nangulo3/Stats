import { NON_LIBERO_ROLES, type ActionCategory, type ActionDef, type MatchRules } from './types'

export const DEFAULT_RULES: MatchRules = {
  bestOf: 5,
  pointsPerSet: 25,
  decidingSetPoints: 15,
  winByTwo: true,
  autoRotate: true,
  autoLibero: true,
}

export const DEFAULT_CATEGORIES: ActionCategory[] = [
  { id: 'cat-reception', name: 'Recepción', color: '#2563eb', icon: '🛡', order: 0 },
  { id: 'cat-defense', name: 'Defensa', color: '#16a34a', icon: '🧤', order: 1 },
  { id: 'cat-block', name: 'Bloqueo', color: '#7c3aed', icon: '✋', order: 2 },
  { id: 'cat-attack', name: 'Ataque', color: '#ea580c', icon: '💥', order: 3 },
  { id: 'cat-serve', name: 'Servicio', color: '#d97706', icon: '🎯', order: 4 },
  { id: 'cat-other', name: 'Otras acciones', color: '#64748b', icon: '•', order: 5 },
]

type Seed = Omit<ActionDef, 'active' | 'eligibleRoles' | 'confirm' | 'teamMetric' | 'alsoCounts'> &
  Partial<Pick<ActionDef, 'alsoCounts' | 'confirm' | 'teamMetric' | 'eligibleRoles'>>

const seeds: Seed[] = [
  { id: 'act-rec-pos', code: 'R+', name: 'Recepción positiva', description: 'Recepción que permite construir el ataque.', categoryId: 'cat-reception', order: 0 },
  { id: 'act-rec-perf', code: 'R#', name: 'Recepción perfecta', description: 'Recepción ideal al armador, con todas las opciones de ataque.', categoryId: 'cat-reception', order: 1 },
  { id: 'act-rec-err', code: 'RE', name: 'Error de recepción', description: 'Recepción que termina en punto rival o no se puede jugar.', categoryId: 'cat-reception', order: 2 },

  { id: 'act-sd', code: 'SD', name: 'Defensa exitosa', description: 'Defensa que mantiene el balón en juego para nuestro equipo.', categoryId: 'cat-defense', order: 0 },
  { id: 'act-bt', code: 'BT', name: 'Defensa sin continuidad', description: 'Toque defensivo que no permite continuar la jugada.', categoryId: 'cat-defense', order: 1 },

  { id: 'act-sb', code: 'SB', name: 'Bloqueo exitoso', description: 'Bloqueo que termina en punto. Suma también a Blocks.', categoryId: 'cat-block', order: 0, alsoCounts: ['act-blocks'], eligibleRoles: NON_LIBERO_ROLES },
  { id: 'act-blocks', code: 'Blocks', name: 'Bloqueo realizado', description: 'Bloqueo que no terminó como SB ni como BE. Es también el total de acciones de bloqueo.', categoryId: 'cat-block', order: 1, eligibleRoles: NON_LIBERO_ROLES },
  { id: 'act-be', code: 'BE', name: 'Error de bloqueo', description: 'Error en el bloqueo (red, invasión, toque que da punto). Suma también a Blocks.', categoryId: 'cat-block', order: 2, alsoCounts: ['act-blocks'], eligibleRoles: NON_LIBERO_ROLES },

  { id: 'act-kills', code: 'Kills', name: 'Punto de ataque', description: 'Ataque que termina en punto. Suma también a Attempts.', categoryId: 'cat-attack', order: 0, alsoCounts: ['act-attempts'], eligibleRoles: NON_LIBERO_ROLES },
  { id: 'act-errors', code: 'Errors', name: 'Error de ataque', description: 'Ataque fuera, a la red o bloqueado para punto rival. Suma también a Attempts.', categoryId: 'cat-attack', order: 1, alsoCounts: ['act-attempts'] },
  { id: 'act-attempts', code: 'Attempts', name: 'Intento de ataque', description: 'Ataque que no fue kill ni error. No lo sumes después de Kills o Errors.', categoryId: 'cat-attack', order: 2 },

  { id: 'act-aces', code: 'Aces', name: 'Punto directo de servicio', description: 'Saque que termina en punto directo. Recuerda pulsar +1 en el marcador.', categoryId: 'cat-serve', order: 0 },
  { id: 'act-se', code: 'SE', name: 'Error de servicio', description: 'Saque fuera o a la red.', categoryId: 'cat-serve', order: 1 },

  { id: 'act-touches', code: 'Touches', name: 'Toques', description: 'Toque de balón sin otra clasificación.', categoryId: 'cat-other', order: 0 },
  { id: 'act-bm', code: 'BM', name: 'BM', description: 'Estadística de equipo de la hoja de referencia. Edita esta descripción con su significado exacto.', categoryId: 'cat-other', order: 1, teamMetric: true },
]

export const DEFAULT_ACTIONS: ActionDef[] = seeds.map((s) => ({
  alsoCounts: [],
  confirm: false,
  teamMetric: false,
  eligibleRoles: [],
  active: true,
  ...s,
}))

/** Ids de acciones usadas en métricas derivadas, si siguen existiendo. */
export const METRIC_IDS = {
  kills: 'act-kills',
  attackErrors: 'act-errors',
  attempts: 'act-attempts',
  aces: 'act-aces',
  serveErrors: 'act-se',
  soloBlocks: 'act-sb',
} as const

/** Versión de la configuración predeterminada. Súbela cuando cambien los valores por defecto. */
export const CONFIG_VERSION = 2

/** Acciones que el líbero no puede hacer (no bloquea ni remata por encima de la red). */
export const NO_LIBERO_ACTION_IDS = ['act-sb', 'act-blocks', 'act-be', 'act-kills']

/**
 * Actualiza una configuración guardada con versiones anteriores sin pisar lo que el
 * usuario personalizó: solo toca acciones predeterminadas que siguen con el valor de fábrica.
 */
export function migrateActions(actions: ActionDef[], fromVersion: number): ActionDef[] {
  if (fromVersion >= CONFIG_VERSION) return actions
  const ids = new Set(actions.map((a) => a.id))
  return actions.map((a) => {
    let next = a
    // v2: el líbero no ve bloqueo ni Kills
    if (NO_LIBERO_ACTION_IDS.includes(a.id) && a.eligibleRoles.length === 0)
      next = { ...next, eligibleRoles: [...NON_LIBERO_ROLES] }
    // v2: Kills y Errors siempre suman Attempts
    if ((a.id === 'act-kills' || a.id === 'act-errors') && ids.has('act-attempts') && !a.alsoCounts.includes('act-attempts'))
      next = { ...next, alsoCounts: [...next.alsoCounts, 'act-attempts'] }
    return next
  })
}

export function cloneDefaults(): { categories: ActionCategory[]; actions: ActionDef[] } {
  return {
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    actions: DEFAULT_ACTIONS.map((a) => ({ ...a, alsoCounts: [...a.alsoCounts], eligibleRoles: [...a.eligibleRoles] })),
  }
}
