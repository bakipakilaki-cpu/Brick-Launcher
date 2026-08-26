import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useStore } from '../store/useStore'

/* --------------------------------- modal --------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  wide
}: {
  open: boolean
  onClose: () => void
  title: string
  icon?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
        >
          <motion.div
            className={`modal${wide ? ' wide' : ''}`}
            initial={{ opacity: 0, scale: 0.95, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              {icon}
              <div className="modal-title">{title}</div>
              <div className="spacer" />
              <button className="btn ghost icon" onClick={onClose} aria-label="Close">
                <X size={17} />
              </button>
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-foot">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* -------------------------------- toggle --------------------------------- */

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label?: string
}) {
  return (
    <button
      className={`toggle${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      aria-label={label}
    >
      <span className="toggle-knob" />
    </button>
  )
}

/* -------------------------------- toasts --------------------------------- */

const TOAST_ICONS = {
  info: <Info size={16} />,
  error: <AlertCircle size={16} />,
  success: <CheckCircle2 size={16} />
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)

  return (
    <div
      style={{
        position: 'fixed',
        top: 18,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 300,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: 440,
        maxWidth: 'calc(100vw - 48px)',
        pointerEvents: 'none'
      }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            className={`banner ${toast.kind === 'error' ? 'danger' : toast.kind === 'success' ? 'info' : 'info'}`}
            style={{ pointerEvents: 'auto', background: 'var(--bg-card)', boxShadow: 'var(--shadow-pop)' }}
            initial={{ opacity: 0, y: -18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          >
            {TOAST_ICONS[toast.kind]}
            <div style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{toast.message}</div>
            <button className="btn ghost sm" onClick={() => dismiss(toast.id)}>
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------- task tray ------------------------------- */

export function TaskTray() {
  const tasks = useStore((s) => s.tasks)

  return (
    <div className="tasks">
      <AnimatePresence initial={false}>
        {tasks.map((task) => (
          <motion.div
            key={task.id}
            className="task"
            initial={{ opacity: 0, y: 22, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            layout
          >
            <div className="task-label">
              <Loader2 size={14} className="spin" style={{ color: 'var(--accent)' }} />
              <span className="truncate">{task.label}</span>
              <div className="spacer" />
              <span className="faint" style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                {task.progress >= 0 ? `${Math.round(task.progress * 100)}%` : ''}
              </span>
            </div>
            {task.detail && <div className="task-detail">{task.detail}</div>}
            <div className="bar">
              <motion.div
                className={`bar-fill${task.progress < 0 ? ' indeterminate' : ''}`}
                animate={{ width: task.progress >= 0 ? `${task.progress * 100}%` : undefined }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
              />
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/* -------------------------------- helpers -------------------------------- */

export function Empty({
  icon,
  title,
  hint,
  action
}: {
  icon: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <motion.div
      className="empty"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
    >
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {hint && <div style={{ maxWidth: 420, lineHeight: 1.55 }}>{hint}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </motion.div>
  )
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="spin" />
}

/** Page-level fade/slide used by every route so navigation feels continuous. */
export function Page({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export function formatPlaytime(seconds: number): string {
  if (seconds < 60) return 'Under a minute'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours === 0) return `${minutes}m played`
  return `${hours}h ${minutes}m played`
}

export function timeAgo(timestamp?: number): string {
  if (!timestamp) return 'Never played'
  const delta = Date.now() - timestamp
  const minutes = Math.floor(delta / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}
