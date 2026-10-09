import { useEffect, useState } from 'react'

/** Enrutador mínimo por hash: funciona sin servidor y sin conexión. */
export function parseHash(hash: string): string[] {
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
}

export function useRoute(): string[] {
  const [segs, setSegs] = useState(() => parseHash(location.hash))
  useEffect(() => {
    const on = () => {
      setSegs(parseHash(location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return segs
}

export function navigate(path: string, replace = false) {
  const h = '#' + (path.startsWith('/') ? path : '/' + path)
  if (replace) location.replace(h)
  else location.hash = h
}

export const routes = {
  home: () => '/',
  players: () => '/jugadores',
  newMatch: () => '/nuevo',
  matches: () => '/partidos',
  settings: () => '/configuracion',
  live: (id: string) => `/partido/${id}`,
  history: (id: string) => `/partido/${id}/historial`,
  summary: (id: string) => `/partido/${id}/resumen`,
}
