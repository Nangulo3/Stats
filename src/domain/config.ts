// Validaciones de la configuración de acciones y categorías.

import type { ActionCategory, ActionDef, ID } from './types'

export interface ConfigIssue {
  actionId?: ID
  categoryId?: ID
  level: 'error' | 'warning'
  message: string
}

export function validateAction(a: ActionDef, all: ActionDef[], categories: ActionCategory[]): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const byId = new Map(all.map((x) => [x.id, x]))
  if (!a.code.trim()) issues.push({ actionId: a.id, level: 'error', message: 'La abreviatura es obligatoria.' })
  if (a.code.trim().length > 10)
    issues.push({ actionId: a.id, level: 'error', message: 'La abreviatura debe tener máximo 10 caracteres.' })
  if (!a.name.trim()) issues.push({ actionId: a.id, level: 'error', message: 'El nombre es obligatorio.' })
  if (!categories.some((c) => c.id === a.categoryId))
    issues.push({ actionId: a.id, level: 'error', message: 'La categoría no existe.' })
  const dupCode = all.find(
    (x) => x.id !== a.id && x.code.trim().toLowerCase() === a.code.trim().toLowerCase(),
  )
  if (dupCode)
    issues.push({ actionId: a.id, level: 'warning', message: `Otra acción ya usa la abreviatura “${dupCode.code}”.` })

  if (a.alsoCounts.includes(a.id))
    issues.push({ actionId: a.id, level: 'error', message: 'Una acción no puede sumarse a sí misma como derivada.' })
  if (new Set(a.alsoCounts).size !== a.alsoCounts.length)
    issues.push({ actionId: a.id, level: 'error', message: 'Hay contadores derivados repetidos.' })
  for (const t of a.alsoCounts) {
    const target = byId.get(t)
    if (!target) {
      issues.push({ actionId: a.id, level: 'warning', message: 'Un contador derivado apunta a una acción que ya no existe.' })
      continue
    }
    if (target.alsoCounts.includes(a.id))
      issues.push({
        actionId: a.id,
        level: 'error',
        message: `${a.code} y ${target.code} se suman mutuamente: eso duplicaría conteos.`,
      })
    else if (target.alsoCounts.length > 0)
      issues.push({
        actionId: a.id,
        level: 'warning',
        message: `${target.code} también tiene derivados; esos no se aplican en cadena al registrar ${a.code}.`,
      })
  }
  // Si otra acción ya suma a esta, registrar ambas manualmente duplicaría el conteo.
  const feeders = all.filter((x) => x.id !== a.id && x.alsoCounts.includes(a.id))
  if (feeders.length && a.alsoCounts.length)
    issues.push({
      actionId: a.id,
      level: 'warning',
      message: `${feeders.map((f) => f.code).join(', ')} ya suman a ${a.code}; revisa que no se cuenten dos veces.`,
    })
  return issues
}

export function validateConfig(actions: ActionDef[], categories: ActionCategory[]): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  for (const c of categories) {
    if (!c.name.trim()) issues.push({ categoryId: c.id, level: 'error', message: 'La categoría necesita un nombre.' })
    if (!/^#[0-9a-fA-F]{6}$/.test(c.color))
      issues.push({ categoryId: c.id, level: 'error', message: 'El color debe tener formato #RRGGBB.' })
  }
  for (const a of actions) issues.push(...validateAction(a, actions, categories))
  return issues
}

export function hasBlockingIssues(issues: ConfigIssue[]): boolean {
  return issues.some((i) => i.level === 'error')
}

/** Reordena un elemento dentro de una lista con campo order (0..n-1). */
export function moveInOrder<T extends { id: ID; order: number }>(items: T[], id: ID, dir: -1 | 1): T[] {
  const sorted = [...items].sort((a, b) => a.order - b.order)
  const i = sorted.findIndex((x) => x.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= sorted.length) return items
  ;[sorted[i], sorted[j]] = [sorted[j], sorted[i]]
  return sorted.map((x, k) => ({ ...x, order: k }))
}

/** Contraste aproximado (WCAG) para decidir texto blanco o negro sobre un color. */
export function readableTextOn(hex: string): '#ffffff' | '#111827' {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return '#ffffff'
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lin(parseInt(m[1], 16)) + 0.7152 * lin(parseInt(m[2], 16)) + 0.0722 * lin(parseInt(m[3], 16))
  const contrastWhite = 1.05 / (L + 0.05)
  const contrastBlack = (L + 0.05) / 0.05
  return contrastWhite >= contrastBlack ? '#ffffff' : '#111827'
}
