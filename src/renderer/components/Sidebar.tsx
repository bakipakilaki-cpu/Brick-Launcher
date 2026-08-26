import { motion } from 'framer-motion'
import {
  Blocks,
  Compass,
  Home,
  Package,
  Settings as SettingsIcon,
  Shirt,
  Sparkles,
  Palette
} from 'lucide-react'
import { LogoLockup } from './Logo'
import { useStore } from '../store/useStore'
import { AccountChip } from './AccountChip'

export type Route =
  | { name: 'home' }
  | { name: 'instances' }
  | { name: 'browse'; type: 'mod' | 'modpack' | 'resourcepack' | 'shader' }
  | { name: 'skins' }
  | { name: 'settings' }
  | { name: 'instance'; id: string }

interface NavEntry {
  key: string
  label: string
  icon: typeof Home
  route: Route
  count?: number
}

export function Sidebar({
  route,
  onNavigate
}: {
  route: Route
  onNavigate: (route: Route) => void
}) {
  const instances = useStore((s) => s.instances)

  const main: NavEntry[] = [
    { key: 'home', label: 'Home', icon: Home, route: { name: 'home' } },
    {
      key: 'instances',
      label: 'Instances',
      icon: Blocks,
      route: { name: 'instances' },
      count: instances.length
    },
    { key: 'skins', label: 'Skins', icon: Shirt, route: { name: 'skins' } }
  ]

  const discover: NavEntry[] = [
    { key: 'mod', label: 'Mods', icon: Package, route: { name: 'browse', type: 'mod' } },
    { key: 'modpack', label: 'Modpacks', icon: Compass, route: { name: 'browse', type: 'modpack' } },
    {
      key: 'resourcepack',
      label: 'Resource packs',
      icon: Palette,
      route: { name: 'browse', type: 'resourcepack' }
    },
    { key: 'shader', label: 'Shaders', icon: Sparkles, route: { name: 'browse', type: 'shader' } }
  ]

  const isActive = (entry: NavEntry): boolean => {
    if (entry.route.name === 'browse' && route.name === 'browse') {
      return entry.route.type === route.type
    }
    return entry.route.name === route.name
  }

  const renderItem = (entry: NavEntry) => {
    const active = isActive(entry)
    const Icon = entry.icon
    return (
      <button
        key={entry.key}
        className={`nav-item${active ? ' active' : ''}`}
        onClick={() => onNavigate(entry.route)}
      >
        {active && (
          <motion.div
            layoutId="nav-active"
            className="nav-item-bg"
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          />
        )}
        <Icon size={17} />
        <span>{entry.label}</span>
        {entry.count !== undefined && entry.count > 0 && (
          <span className="nav-count">{entry.count}</span>
        )}
      </button>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <LogoLockup />
      </div>

      <nav className="nav">
        {main.map(renderItem)}
        <div className="nav-label">Discover</div>
        {discover.map(renderItem)}
        <div className="spacer" />
      </nav>

      <button
        className={`nav-item${route.name === 'settings' ? ' active' : ''}`}
        style={{ margin: '0 10px 4px', width: 'calc(100% - 20px)' }}
        onClick={() => onNavigate({ name: 'settings' })}
      >
        <SettingsIcon size={17} />
        <span>Settings</span>
      </button>

      <AccountChip />
    </aside>
  )
}
