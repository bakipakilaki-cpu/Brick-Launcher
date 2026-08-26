import { motion } from 'framer-motion'
import { Blocks, Clock, Compass, Package, Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { CreateInstanceModal } from '../components/CreateInstanceModal'
import { InstanceCard } from '../components/InstanceCard'
import { Logo } from '../components/Logo'
import { Empty, Page, formatPlaytime } from '../components/ui'
import { useStore } from '../store/useStore'
import type { Route } from '../components/Sidebar'

export function HomePage({
  onOpen,
  onNavigate
}: {
  onOpen: (id: string) => void
  onNavigate: (route: Route) => void
}) {
  const instances = useStore((s) => s.instances)
  const accounts = useStore((s) => s.accounts)
  const activeId = useStore((s) => s.activeAccountId)
  const [creating, setCreating] = useState(false)

  const active = accounts.find((a) => a.id === activeId)
  const recent = [...instances]
    .filter((i) => i.lastPlayed)
    .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
    .slice(0, 6)

  const totalSeconds = instances.reduce((sum, i) => sum + i.totalPlaySeconds, 0)

  const shortcuts = [
    {
      icon: <Package size={19} />,
      title: 'Browse mods',
      sub: 'Modrinth and CurseForge',
      route: { name: 'browse', type: 'mod' } as Route
    },
    {
      icon: <Compass size={19} />,
      title: 'Find a modpack',
      sub: 'Install with one click',
      route: { name: 'browse', type: 'modpack' } as Route
    },
    {
      icon: <Sparkles size={19} />,
      title: 'Get shaders',
      sub: 'Make it look incredible',
      route: { name: 'browse', type: 'shader' } as Route
    }
  ]

  return (
    <Page>
      <div className="hstack md" style={{ alignItems: 'center', gap: 18 }}>
        <motion.div
          initial={{ scale: 0.6, rotate: -14, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 16 }}
        >
          <Logo size={52} animated={false} />
        </motion.div>
        <div>
          <h1 className="page-title">
            {active ? `Welcome back, ${active.username}` : 'Welcome to Brick'}
          </h1>
          <p className="page-sub">
            {totalSeconds > 0
              ? `${formatPlaytime(totalSeconds)} across ${instances.length} instance${instances.length === 1 ? '' : 's'}`
              : 'Set up an instance and start playing.'}
          </p>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: 26 }}>
        {shortcuts.map((shortcut, index) => (
          <motion.button
            key={shortcut.title}
            className="card pad hstack md"
            style={{ textAlign: 'left', gap: 13 }}
            onClick={() => onNavigate(shortcut.route)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05, duration: 0.28 }}
            whileHover={{ y: -3, borderColor: 'var(--accent-line)' }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0
              }}
            >
              {shortcut.icon}
            </div>
            <div>
              <div className="bold">{shortcut.title}</div>
              <div className="faint small">{shortcut.sub}</div>
            </div>
          </motion.button>
        ))}
      </div>

      <div className="section-head">
        <div className="hstack sm">
          <Clock size={17} style={{ color: 'var(--ink-faint)' }} />
          <span className="section-title">Jump back in</span>
        </div>
        <button className="btn sm" onClick={() => onNavigate({ name: 'instances' })}>
          All instances
        </button>
      </div>

      {recent.length > 0 ? (
        <div className="grid instances">
          {recent.map((instance) => (
            <InstanceCard key={instance.id} instance={instance} onOpen={onOpen} />
          ))}
        </div>
      ) : instances.length > 0 ? (
        <div className="grid instances">
          {instances.slice(0, 6).map((instance) => (
            <InstanceCard key={instance.id} instance={instance} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <Empty
          icon={<Blocks size={26} />}
          title="Nothing to play yet"
          hint="Create an instance to choose a Minecraft version and a mod loader."
          action={
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> New instance
            </button>
          }
        />
      )}

      <CreateInstanceModal open={creating} onClose={() => setCreating(false)} onCreated={onOpen} />
    </Page>
  )
}
