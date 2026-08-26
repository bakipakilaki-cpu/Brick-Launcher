import { motion } from 'framer-motion'
import { AlertTriangle, Play, Square } from 'lucide-react'
import { useState } from 'react'
import { Logo } from './Logo'
import { timeAgo } from './ui'
import { api } from '../lib/api'
import { useStore } from '../store/useStore'
import type { Instance } from '../../shared/types'

const LOADER_LABEL: Record<string, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge'
}

export function InstanceCard({
  instance,
  onOpen
}: {
  instance: Instance
  onOpen: (id: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const running = useStore((s) => s.runningIds.includes(instance.id))
  const toast = useStore((s) => s.toast)

  const play = async (event: React.MouseEvent): Promise<void> => {
    event.stopPropagation()
    try {
      if (running) await api.stopGame(instance.id)
      else await api.launch(instance.id)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <motion.button
      className="instance-card"
      onClick={() => onOpen(instance.id)}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      layout
    >
      <div className="instance-art">
        {instance.icon ? (
          <img src={instance.icon} alt="" />
        ) : (
          <Logo size={54} animated={false} />
        )}

        {(hovered || running) && (
          <motion.div
            className="instance-play"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
          >
            <motion.div
              className="instance-play-btn"
              onClick={play}
              whileHover={{ scale: 1.09 }}
              whileTap={{ scale: 0.93 }}
              initial={{ scale: 0.75 }}
              animate={{ scale: 1 }}
              role="button"
              aria-label={running ? 'Stop' : 'Play'}
            >
              {running ? (
                <Square size={19} fill="currentColor" />
              ) : (
                <Play size={22} fill="currentColor" style={{ marginLeft: 3 }} />
              )}
            </motion.div>
          </motion.div>
        )}

        {!instance.installed && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              background: 'rgba(255,179,64,0.16)',
              color: 'var(--warn)',
              borderRadius: 6,
              padding: '3px 6px',
              display: 'grid',
              placeItems: 'center'
            }}
            title="Not fully installed — open it and choose Repair"
          >
            <AlertTriangle size={13} />
          </div>
        )}
      </div>

      <div className="instance-meta">
        <div className="instance-name">{instance.name}</div>
        <div className="instance-sub">
          <span>{LOADER_LABEL[instance.loader] ?? instance.loader}</span>
          <span>·</span>
          <span>{instance.mcVersion}</span>
        </div>
        <div className="instance-sub" style={{ marginTop: 1 }}>
          {running ? (
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Running</span>
          ) : (
            timeAgo(instance.lastPlayed)
          )}
        </div>
      </div>
    </motion.button>
  )
}
