import { useEffect, useRef, type ReactNode } from 'react'
import { useStore } from '../state/store'
import { navigate } from './router'

export function TopBar({
  title,
  sub,
  back,
  right,
}: {
  title: string
  sub?: string
  back?: string
  right?: ReactNode
}) {
  return (
    <header className="topbar">
      {back !== undefined && (
        <button className="icon-btn" aria-label="Volver" onClick={() => navigate(back)}>
          ←
        </button>
      )}
      <h1>
        {title}
        {sub && <span className="sub">{sub}</span>}
      </h1>
      {right}
    </header>
  )
}

export function Sheet({
  title,
  onClose,
  children,
  headExtra,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  headExtra?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', onKey)
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [])
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2>{title}</h2>
          {headExtra}
          <button className="icon-btn" aria-label="Cerrar" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ToastHost() {
  const toast = useStore((s) => s.toast)
  const dismiss = useStore((s) => s.dismissToast)
  const voidEventById = useStore((s) => s.voidEventById)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(dismiss, toast.undoEventId ? 4500 : 3000)
    return () => clearTimeout(t)
  }, [toast, dismiss])
  if (!toast) return null
  return (
    <div className={`toast ${toast.kind === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
      <span className="grow">{toast.message}</span>
      {toast.undoEventId && toast.matchId && (
        <button
          onClick={() => {
            void voidEventById(toast.matchId!, toast.undoEventId!)
            dismiss()
          }}
        >
          Deshacer
        </button>
      )}
    </div>
  )
}

export function Field({
  label,
  error,
  children,
  htmlFor,
  className,
}: {
  label: string
  error?: string
  children: ReactNode
  htmlFor?: string
  className?: string
}) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

