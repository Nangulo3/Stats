/** ID estable. crypto.randomUUID solo existe en contextos seguros (https/localhost),
 * así que hay una alternativa para cuando la app se abre por IP en la red local. */
export function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      // contexto no seguro: seguir con la alternativa
    }
  }
  const rnd = () => Math.random().toString(16).slice(2, 10).padEnd(8, '0')
  return `${Date.now().toString(16)}-${rnd()}-${rnd()}`
}

export function nowIso(): string {
  return new Date().toISOString()
}
