import { motion } from 'framer-motion'
import {
  AlertTriangle,
  Check,
  Download,
  Package,
  Play,
  RefreshCw,
  Trash2,
  Wrench,
  X
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Modal, Spinner } from './ui'
import { api, type ProposedFix } from '../lib/api'
import { useStore } from '../store/useStore'

const ACTION_ICON = {
  install: <Download size={15} />,
  replace: <RefreshCw size={15} />,
  remove: <Trash2 size={15} />
}

const ACTION_VERB = {
  install: 'Install',
  replace: 'Replace',
  remove: 'Remove'
}

/**
 * Shown when a launch dies on a dependency problem. The loader already tells us
 * what it wants; this turns that into one click.
 */
export function FixModal({
  instanceId,
  open,
  onClose
}: {
  instanceId: string | null
  open: boolean
  onClose: () => void
}) {
  const logs = useStore((s) => s.logs)
  const instances = useStore((s) => s.instances)
  const toast = useStore((s) => s.toast)

  const [loading, setLoading] = useState(false)
  const [fixes, setFixes] = useState<ProposedFix[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [done, setDone] = useState(false)

  const instance = instances.find((i) => i.id === instanceId)

  useEffect(() => {
    if (!open || !instanceId) return
    let cancelled = false

    setLoading(true)
    setFixes(null)
    setDone(false)

    const logText = (logs[instanceId] ?? []).join('\n')
    api
      .diagnose(instanceId, logText)
      .then((result) => {
        if (cancelled) return
        setFixes(result.fixes)
        // Pre-tick everything we could actually resolve.
        setSelected(new Set(result.fixes.filter((f) => f.resolved).map((f) => f.modId)))
      })
      .catch((err) => {
        if (cancelled) return
        setFixes([])
        toast('error', err instanceof Error ? err.message : String(err))
      })
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
    }
    // logs deliberately excluded: re-running on every new log line would thrash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instanceId])

  const toggle = (modId: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(modId)) next.delete(modId)
      else next.add(modId)
      return next
    })
  }

  const apply = async (): Promise<void> => {
    if (!instanceId || !fixes) return
    const chosen = fixes.filter((f) => f.resolved && selected.has(f.modId))
    if (!chosen.length) return

    setApplying(true)
    try {
      const result = await api.applyFixes(instanceId, chosen)
      if (result.failed.length) {
        toast('error', `Some fixes failed:\n${result.failed.join('\n')}`)
      }
      if (result.applied.length) {
        toast('success', `Fixed: ${result.applied.join(', ')}`)
        setDone(true)
      }
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
    }
  }

  const playAgain = async (): Promise<void> => {
    if (!instanceId) return
    onClose()
    try {
      await api.launch(instanceId)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  const resolvable = (fixes ?? []).filter((f) => f.resolved)
  const unresolvable = (fixes ?? []).filter((f) => !f.resolved)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={done ? 'Mods fixed' : 'Incompatible mods found'}
      icon={
        done ? (
          <Check size={19} style={{ color: 'var(--accent)' }} />
        ) : (
          <AlertTriangle size={19} style={{ color: 'var(--warn)' }} />
        )
      }
      footer={
        done ? (
          <>
            <button className="btn ghost" onClick={onClose}>
              Close
            </button>
            <button className="btn primary" onClick={playAgain}>
              <Play size={15} fill="currentColor" /> Play again
            </button>
          </>
        ) : (
          <>
            <button className="btn ghost" onClick={onClose} disabled={applying}>
              Not now
            </button>
            <button
              className="btn primary"
              onClick={apply}
              disabled={applying || loading || selected.size === 0}
            >
              {applying ? <Spinner size={14} /> : <Wrench size={15} />}
              Fix {selected.size > 0 ? `${selected.size} ` : ''}
              {selected.size === 1 ? 'problem' : 'problems'}
            </button>
          </>
        )
      }
    >
      {loading ? (
        <div className="hstack sm faint" style={{ padding: '10px 0' }}>
          <Spinner /> Reading the crash and searching Modrinth…
        </div>
      ) : done ? (
        <div className="banner info">
          <Check size={15} />
          <div>
            {instance?.name ?? 'The instance'} has been updated. Launch it again to check the
            problem is gone.
          </div>
        </div>
      ) : !fixes || fixes.length === 0 ? (
        <div className="banner warn">
          <AlertTriangle size={15} />
          <div>
            No mod dependency problem was recognised in the last crash. Open the{' '}
            <strong>Console</strong> tab to read the full output.
          </div>
        </div>
      ) : (
        <>
          <div className="muted">
            {instance?.loader === 'fabric' || instance?.loader === 'quilt'
              ? 'The mod loader reported missing dependencies. These are the fixes it suggested:'
              : 'The following mod dependencies are missing:'}
          </div>

          <div className="stack sm">
            {resolvable.map((fix, index) => {
              const on = selected.has(fix.modId)
              return (
                <motion.button
                  key={fix.modId}
                  className={`pick${on ? ' selected' : ''}`}
                  onClick={() => toggle(fix.modId)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <div className="pick-icon">
                    {fix.project?.iconUrl ? (
                      <img
                        src={fix.project.iconUrl}
                        alt=""
                        style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover' }}
                      />
                    ) : (
                      ACTION_ICON[fix.action]
                    )}
                  </div>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="pick-title">
                      {ACTION_VERB[fix.action]} {fix.project?.title ?? fix.modId}
                      {fix.version && (
                        <span className="faint" style={{ fontWeight: 500 }}>
                          {' '}
                          {fix.version.versionNumber}
                        </span>
                      )}
                    </div>
                    <div className="pick-sub">{fix.reason}</div>
                    {fix.note && (
                      <div className="pick-sub" style={{ color: 'var(--warn)' }}>
                        {fix.note}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      border: on ? 'none' : '1px solid var(--line)',
                      background: on ? 'var(--accent)' : 'transparent',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0
                    }}
                  >
                    {on && <Check size={14} color="var(--accent-ink)" strokeWidth={3} />}
                  </div>
                </motion.button>
              )
            })}
          </div>

          {unresolvable.length > 0 && (
            <div className="stack sm">
              <div className="field-label">Needs manual attention</div>
              {unresolvable.map((fix) => (
                <div className="row" key={fix.modId}>
                  <X size={16} style={{ color: 'var(--danger)' }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="row-title">{fix.modId}</div>
                    <div className="row-sub">{fix.note ?? fix.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="banner info">
            <Package size={15} />
            <div>
              Versions are picked to match this instance ({instance?.loader} {instance?.mcVersion})
              and the range the loader asked for.
            </div>
          </div>
        </>
      )}
    </Modal>
  )
}
