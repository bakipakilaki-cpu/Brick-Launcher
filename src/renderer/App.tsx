import { AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Sidebar, type Route } from './components/Sidebar'
import { TaskTray, Toasts } from './components/ui'
import { FixModal } from './components/FixModal'
import { Logo } from './components/Logo'
import { HomePage } from './pages/Home'
import { InstancesPage } from './pages/Instances'
import { InstanceDetailPage } from './pages/InstanceDetail'
import { BrowsePage } from './pages/Browse'
import { SkinsPage } from './pages/Skins'
import { SettingsPage } from './pages/Settings'
import { Onboarding } from './pages/Onboarding'
import { useStore } from './store/useStore'

const ONBOARDING_KEY = 'brick.onboarded'

export function App() {
  const ready = useStore((s) => s.ready)
  const bootstrap = useStore((s) => s.bootstrap)
  const settings = useStore((s) => s.settings)
  const instances = useStore((s) => s.instances)
  const accounts = useStore((s) => s.accounts)

  const [route, setRoute] = useState<Route>({ name: 'home' })
  const [onboarding, setOnboarding] = useState(false)
  const [fixFor, setFixFor] = useState<string | null>(null)

  const gameStatus = useStore((s) => s.gameStatus)
  const logs = useStore((s) => s.logs)

  // A crash that mentions a dependency problem is worth interrupting for —
  // the loader has already worked out the answer, so offer to apply it.
  useEffect(() => {
    if (gameStatus.state !== 'crashed') return
    const text = (logs[gameStatus.instanceId] ?? []).join('\n')
    if (/Incompatible mods found|FormattedException|which is missing|mandatory dependencies/i.test(text)) {
      setFixFor(gameStatus.instanceId)
    }
    // logs is read once at crash time; it must not re-trigger as lines arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameStatus])

  useEffect(() => {
    bootstrap()
    document.body.classList.toggle('is-mac', navigator.platform.toLowerCase().includes('mac'))
  }, [bootstrap])

  // Show setup the first time, or whenever there is nothing configured yet.
  useEffect(() => {
    if (!ready) return
    const seen = localStorage.getItem(ONBOARDING_KEY) === 'yes'
    if (!seen && accounts.length === 0 && instances.length === 0) setOnboarding(true)
  }, [ready, accounts.length, instances.length])

  // Push the chosen accent and motion preference into CSS custom properties.
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    root.style.setProperty('--accent', settings.accentColor)
    root.style.setProperty('--accent-hover', lighten(settings.accentColor, 0.14))
    root.style.setProperty('--accent-soft', withAlpha(settings.accentColor, 0.14))
    root.style.setProperty('--accent-line', withAlpha(settings.accentColor, 0.32))
    root.style.setProperty('--accent-ink', readableInk(settings.accentColor))
    root.dataset.motion = settings.animationsEnabled ? 'on' : 'off'
  }, [settings])

  if (!ready) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Logo size={56} />
      </div>
    )
  }

  const finishOnboarding = (): void => {
    localStorage.setItem(ONBOARDING_KEY, 'yes')
    setOnboarding(false)
  }

  return (
    <>
      <div className="shell">
        <Sidebar route={route} onNavigate={setRoute} />

        <main className="main">
          <div className="content">
            <AnimatePresence mode="wait">
              {route.name === 'home' && (
                <HomePage
                  key="home"
                  onOpen={(id) => setRoute({ name: 'instance', id })}
                  onNavigate={setRoute}
                />
              )}
              {route.name === 'instances' && (
                <InstancesPage key="instances" onOpen={(id) => setRoute({ name: 'instance', id })} />
              )}
              {route.name === 'instance' && (
                <InstanceDetailPage
                  key={`instance-${route.id}`}
                  id={route.id}
                  onBack={() => setRoute({ name: 'instances' })}
                />
              )}
              {route.name === 'browse' && <BrowsePage key={`browse-${route.type}`} type={route.type} />}
              {route.name === 'skins' && <SkinsPage key="skins" />}
              {route.name === 'settings' && <SettingsPage key="settings" />}
            </AnimatePresence>
          </div>
        </main>
      </div>

      <TaskTray />
      <Toasts />
      <FixModal instanceId={fixFor} open={fixFor !== null} onClose={() => setFixFor(null)} />

      <AnimatePresence>
        {onboarding && <Onboarding key="onboarding" onFinish={finishOnboarding} />}
      </AnimatePresence>
    </>
  )
}

/* ------------------------------ colour utils ------------------------------ */

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16)
  ]
}

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function lighten(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex)
  const mix = (channel: number): number => Math.round(channel + (255 - channel) * amount)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

/** Pick black or white text for a background, by perceived luminance. */
function readableInk(hex: string): string {
  const [r, g, b] = parseHex(hex)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.55 ? '#08130c' : '#ffffff'
}
