import type { CSSProperties } from 'react'
import { readableTextOn } from '../domain/config'
import type { MatchEvent } from '../domain/types'

/** Variables CSS para pintar con el color de una categoría y un texto legible encima. */
export function catStyle(color: string): CSSProperties {
  return { ['--cat' as string]: color, ['--cat-ink' as string]: readableTextOn(color) } as CSSProperties
}

export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function slug(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}

export function eventTag(e: MatchEvent): { text: string; color?: string } {
  switch (e.type) {
    case 'stat':
      return { text: e.action.code, color: e.action.color }
    case 'score':
      return { text: e.delta > 0 ? '+1' : '−1' }
    case 'substitution':
      return { text: '⇄' }
    case 'libero':
      return { text: 'L' }
    case 'rotation':
      return { text: '↻' }
    case 'set_close':
      return { text: 'SET' }
    case 'match_end':
      return { text: 'FIN' }
  }
}

