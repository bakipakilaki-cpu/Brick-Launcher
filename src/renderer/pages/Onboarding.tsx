import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Coffee,
  Download,
  Gamepad2,
  LogIn,
  MemoryStick,
  Sparkles,
  UserRound,
  WifiOff
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Logo } from '../components/Logo'
import { Spinner } from '../components/ui'
import { api, type JavaRuntime } from '../lib/api'
import { useStore } from '../store/useStore'
import { LOADERS, type LoaderId } from '../../shared/types'

type StepId = 'welcome' | 'account' | 'java' | 'memory' | 'instance' | 'done'

const STEPS: StepId[] = ['welcome', 'account', 'java', 'memory', 'instance', 'done']

/** Suggest an allocation that leaves the OS room to breathe. */
function suggestedMemory(totalMb: number): number {
  if (totalMb >= 32768) return 8192
  if (totalMb >= 16384) return 6144
  if (totalMb >= 8192) return 4096
  return 2048
}

export function Onboarding({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState<StepId>('welcome')
  const [direction, setDirection] = useState(1)

  const accounts = useStore((s) => s.accounts)
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const refreshAccounts = useStore((s) => s.refreshAccounts)
  const refreshInstances = useStore((s) => s.refreshInstances)
  const toast = useStore((s) => s.toast)

  const index = STEPS.indexOf(step)

  const go = (next: StepId): void => {
    setDirection(STEPS.indexOf(next) > index ? 1 : -1)
    setStep(next)
  }

  return (
    <div className="onboard">
      <motion.div
        className="onboard-glow"
        style={{ top: -180, left: -140 }}
        animate={{ scale: [1, 1.12, 1], opacity: [0.75, 1, 0.75] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="onboard-glow"
        style={{ bottom: -240, right: -160 }}
        animate={{ scale: [1.1, 1, 1.1], opacity: [0.55, 0.85, 0.55] }}
        transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="onboard-inner">
        <div className="onboard-card">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              initial={{ opacity: 0, x: direction * 36 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -36 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            >
              {step === 'welcome' && <WelcomeStep onNext={() => go('account')} />}
              {step === 'account' && (
                <AccountStep
                  hasAccount={accounts.length > 0}
                  onDone={async () => {
                    await refreshAccounts()
                    go('java')
                  }}
                />
              )}
              {step === 'java' && <JavaStep onNext={() => go('memory')} />}
              {step === 'memory' && (
                <MemoryStep
                  value={settings?.defaultMemoryMb ?? 4096}
                  onChange={(mb) => saveSettings({ defaultMemoryMb: mb })}
                />
              )}
              {step === 'instance' && (
                <InstanceStep
                  onCreated={async () => {
                    await refreshInstances()
                    go('done')
                  }}
                  onSkip={() => go('done')}
                  onError={(message) => toast('error', message)}
                />
              )}
              {step === 'done' && <DoneStep onFinish={onFinish} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className="onboard-foot">
        <button
          className="btn ghost"
          onClick={() => go(STEPS[Math.max(0, index - 1)])}
          disabled={index === 0}
        >
          <ArrowLeft size={15} /> Back
        </button>

        <div className="spacer" />
        <div className="dots">
          {STEPS.map((id) => (
            <div key={id} className={`dot${id === step ? ' active' : ''}`} />
          ))}
        </div>
        <div className="spacer" />

        {step === 'done' ? (
          <button className="btn primary" onClick={onFinish}>
            Start playing <ArrowRight size={15} />
          </button>
        ) : (
          <div className="hstack sm">
            <button className="btn ghost" onClick={onFinish}>
              Skip setup
            </button>
            <button
              className="btn primary"
              onClick={() => go(STEPS[Math.min(STEPS.length - 1, index + 1)])}
              disabled={step === 'account' && accounts.length === 0}
            >
              Continue <ArrowRight size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------- welcome -------------------------------- */

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="stack lg" style={{ alignItems: 'flex-start' }}>
      <motion.div
        initial={{ scale: 0.5, rotate: -18, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.05 }}
      >
        <Logo size={76} animated={false} />
      </motion.div>

      <div>
        <div className="onboard-step">Welcome</div>
        <h1 className="onboard-title">Brick Launcher</h1>
        <p className="onboard-sub">
          Every mod loader, mods and shaders from Modrinth and CurseForge, a skin library, and
          instances that stay out of each other’s way. Let’s set it up — it takes about a minute.
        </p>
      </div>

      <button className="btn primary lg" onClick={onNext}>
        Get started <ArrowRight size={16} />
      </button>
    </div>
  )
}

/* -------------------------------- account -------------------------------- */

function AccountStep({ hasAccount, onDone }: { hasAccount: boolean; onDone: () => void }) {
  const [mode, setMode] = useState<'microsoft' | 'offline' | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refreshAccounts = useStore((s) => s.refreshAccounts)
  const accounts = useStore((s) => s.accounts)

  const signIn = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const account = await api.signInMicrosoft()
      await refreshAccounts()
      if (account) onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const addOffline = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await api.addOfflineAccount(name)
      await refreshAccounts()
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack lg">
      <div>
        <div className="onboard-step">Step 1 · Account</div>
        <h1 className="onboard-title">Who’s playing?</h1>
        <p className="onboard-sub">
          Pick how you want to sign in. You can add more accounts and switch between them at any
          time.
        </p>
      </div>

      <div className="stack sm">
        <button
          className={`pick${mode === 'microsoft' ? ' selected' : ''}`}
          onClick={() => setMode('microsoft')}
        >
          <div className="pick-icon">
            <LogIn size={19} />
          </div>
          <div>
            <div className="pick-title">Microsoft account</div>
            <div className="pick-sub">
              You own Minecraft. Play anywhere, including servers that verify accounts, and change
              your skin from the launcher.
            </div>
          </div>
        </button>

        <button
          className={`pick${mode === 'offline' ? ' selected' : ''}`}
          onClick={() => setMode('offline')}
        >
          <div className="pick-icon">
            <WifiOff size={19} />
          </div>
          <div>
            <div className="pick-title">Offline account</div>
            <div className="pick-sub">
              Just pick a username. Singleplayer, LAN and offline-mode servers work. Servers with
              authentication on will refuse the connection.
            </div>
          </div>
        </button>
      </div>

      <AnimatePresence mode="wait">
        {mode === 'microsoft' && (
          <motion.div
            key="ms"
            className="stack sm"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <button className="btn primary" onClick={signIn} disabled={busy}>
              {busy ? <Spinner /> : <LogIn size={15} />} Sign in with Microsoft
            </button>
            <div className="field-hint">
              A Microsoft sign-in window opens. Brick needs an Azure client ID configured in
              Settings → Accounts first — the field there explains how to create one for free.
            </div>
          </motion.div>
        )}

        {mode === 'offline' && (
          <motion.div
            key="offline"
            className="stack sm"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="hstack sm">
              <input
                className="input"
                placeholder="Choose a username"
                value={name}
                maxLength={16}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) addOffline()
                }}
              />
              <button className="btn primary" onClick={addOffline} disabled={busy || !name.trim()}>
                {busy ? <Spinner /> : <Check size={15} />} Add
              </button>
            </div>
            <div className="field-hint">3–16 characters: letters, numbers and underscore.</div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <div className="banner danger">{error}</div>}

      {hasAccount && (
        <div className="banner info">
          <Check size={15} />
          <div>
            {accounts.length} account{accounts.length === 1 ? '' : 's'} ready. Continue to the next
            step.
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------- java --------------------------------- */

function JavaStep({ onNext }: { onNext: () => void }) {
  const [runtimes, setRuntimes] = useState<JavaRuntime[] | null>(null)
  const [installing, setInstalling] = useState<number | null>(null)
  const toast = useStore((s) => s.toast)

  const scan = async (): Promise<void> => {
    setRuntimes(null)
    try {
      setRuntimes(await api.detectJava())
    } catch {
      setRuntimes([])
    }
  }

  useEffect(() => {
    scan()
  }, [])

  const install = async (major: number): Promise<void> => {
    setInstalling(major)
    try {
      await api.installJava(major)
      await scan()
      toast('success', `Java ${major} installed`)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling(null)
    }
  }

  const has = (major: number): boolean => Boolean(runtimes?.some((r) => r.major >= major))

  return (
    <div className="stack lg">
      <div>
        <div className="onboard-step">Step 2 · Java</div>
        <h1 className="onboard-title">Java runtime</h1>
        <p className="onboard-sub">
          Minecraft runs on Java. Modern versions need Java 21, older ones need Java 8 or 17. Brick
          installs whatever a version needs automatically when you launch — you can also grab them
          now.
        </p>
      </div>

      {runtimes === null ? (
        <div className="hstack sm faint">
          <Spinner /> Scanning your system…
        </div>
      ) : runtimes.length > 0 ? (
        <div className="stack sm">
          {runtimes.map((runtime) => (
            <div className="row" key={runtime.path}>
              <Coffee size={17} style={{ color: 'var(--accent)' }} />
              <div style={{ minWidth: 0 }}>
                <div className="row-title">Java {runtime.major}</div>
                <div className="row-sub truncate mono">{runtime.path}</div>
              </div>
              <div className="spacer" />
              <span className="tag">{runtime.source === 'bundled' ? 'Installed by Brick' : 'System'}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="banner warn">
          <Coffee size={15} />
          <div>No Java found on this Mac. Install one below, or let Brick fetch it on first launch.</div>
        </div>
      )}

      <div className="stack sm">
        <div className="field-label">Install a runtime now</div>
        <div className="hstack sm" style={{ flexWrap: 'wrap' }}>
          {[21, 17, 8].map((major) => (
            <button
              key={major}
              className="btn"
              onClick={() => install(major)}
              disabled={installing !== null || has(major)}
            >
              {installing === major ? <Spinner /> : has(major) ? <Check size={15} /> : <Download size={15} />}
              Java {major}
              <span className="faint" style={{ fontWeight: 500 }}>
                {major === 21 ? '1.20.5+' : major === 17 ? '1.17–1.20.4' : '1.16 and older'}
              </span>
            </button>
          ))}
        </div>
        <div className="field-hint">Eclipse Temurin builds, downloaded from Adoptium.</div>
      </div>

      <button className="btn primary" onClick={onNext} style={{ alignSelf: 'flex-start' }}>
        Continue <ArrowRight size={15} />
      </button>
    </div>
  )
}

/* --------------------------------- memory -------------------------------- */

function MemoryStep({ value, onChange }: { value: number; onChange: (mb: number) => void }) {
  const [totalMb, setTotalMb] = useState<number | null>(null)
  const [local, setLocal] = useState(value)

  useEffect(() => {
    // navigator.deviceMemory is a rough GB figure; good enough to suggest a cap.
    const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    setTotalMb(gb ? gb * 1024 : null)
  }, [])

  const max = totalMb ? Math.max(4096, totalMb - 2048) : 16384
  const suggestion = suggestedMemory(totalMb ?? 16384)

  return (
    <div className="stack lg">
      <div>
        <div className="onboard-step">Step 3 · Memory</div>
        <h1 className="onboard-title">How much RAM?</h1>
        <p className="onboard-sub">
          This is the default for new instances; each one can override it later. More is not always
          better — giving Java everything you have makes garbage collection stutter.
        </p>
      </div>

      <div className="card pad stack md">
        <div className="hstack" style={{ justifyContent: 'space-between' }}>
          <div className="hstack sm">
            <MemoryStick size={17} style={{ color: 'var(--accent)' }} />
            <span className="bold">Allocation</span>
          </div>
          <span
            className="bold"
            style={{ fontSize: 19, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}
          >
            {(local / 1024).toFixed(1)} GB
          </span>
        </div>

        <input
          type="range"
          min={1024}
          max={max}
          step={512}
          value={local}
          onChange={(e) => setLocal(Number(e.target.value))}
          onMouseUp={() => onChange(local)}
          onTouchEnd={() => onChange(local)}
          style={{ width: '100%', accentColor: 'var(--accent)' }}
        />

        <div className="hstack" style={{ justifyContent: 'space-between' }}>
          <span className="faint small">1 GB</span>
          <button
            className="chip"
            onClick={() => {
              setLocal(suggestion)
              onChange(suggestion)
            }}
          >
            Use recommended ({(suggestion / 1024).toFixed(0)} GB)
          </button>
          <span className="faint small">{(max / 1024).toFixed(0)} GB</span>
        </div>
      </div>

      <div className="banner info">
        <MemoryStick size={15} />
        <div>
          4 GB handles most modpacks. Go to 6–8 GB for large packs with shaders. Leave at least 2 GB
          for macOS itself.
        </div>
      </div>
    </div>
  )
}

/* -------------------------------- instance ------------------------------- */

function InstanceStep({
  onCreated,
  onSkip,
  onError
}: {
  onCreated: () => void
  onSkip: () => void
  onError: (message: string) => void
}) {
  const versions = useStore((s) => s.versions)
  const [loader, setLoader] = useState<LoaderId>('fabric')
  const [mcVersion, setMcVersion] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const releases = versions.filter((v) => v.type === 'release')

  useEffect(() => {
    if (!mcVersion && releases.length) setMcVersion(releases[0].id)
  }, [releases, mcVersion])

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.createInstance({
        name: name.trim() || `${LOADERS.find((l) => l.id === loader)!.label} ${mcVersion}`,
        mcVersion,
        loader
      })
      onCreated()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="stack lg">
      <div>
        <div className="onboard-step">Step 4 · First instance</div>
        <h1 className="onboard-title">Make something to play</h1>
        <p className="onboard-sub">
          An instance is one Minecraft setup: its own version, loader, mods and worlds. Nothing here
          touches your other instances.
        </p>
      </div>

      <div className="field">
        <span className="field-label">Mod loader</span>
        <div className="chip-row">
          {LOADERS.map((entry) => (
            <button
              key={entry.id}
              className={`chip${loader === entry.id ? ' active' : ''}`}
              onClick={() => setLoader(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <span className="field-hint">{LOADERS.find((l) => l.id === loader)?.blurb}</span>
      </div>

      <div className="hstack md" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1 }}>
          <span className="field-label">Minecraft version</span>
          <select
            className="select"
            value={mcVersion}
            onChange={(e) => setMcVersion(e.target.value)}
          >
            {releases.length === 0 && <option>Loading…</option>}
            {releases.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1.4 }}>
          <span className="field-label">Name</span>
          <input
            className="input"
            placeholder={`${LOADERS.find((l) => l.id === loader)?.label} ${mcVersion}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>

      <div className="hstack sm">
        <button className="btn primary" onClick={create} disabled={busy || !mcVersion}>
          {busy ? <Spinner /> : <Gamepad2 size={15} />} Create instance
        </button>
        <button className="btn ghost" onClick={onSkip} disabled={busy}>
          I’ll do this later
        </button>
      </div>

      {busy && (
        <div className="banner info">
          <Sparkles size={15} />
          <div>Downloading Minecraft and the loader. Progress is in the bottom-right corner.</div>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------- done --------------------------------- */

function DoneStep({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="stack lg" style={{ alignItems: 'flex-start' }}>
      <motion.div
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 14 }}
        style={{
          width: 74,
          height: 74,
          borderRadius: 20,
          background: 'var(--accent)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--accent-ink)'
        }}
      >
        <Check size={38} strokeWidth={3} />
      </motion.div>

      <div>
        <div className="onboard-step">All set</div>
        <h1 className="onboard-title">You’re ready to play</h1>
        <p className="onboard-sub">
          Browse mods and shaders from the sidebar, drop your own files into any instance, and
          manage skins from the Skins tab. Everything else lives in Settings.
        </p>
      </div>

      <div className="stack sm" style={{ width: '100%' }}>
        {[
          { icon: <UserRound size={16} />, text: 'Switch accounts from the card at the bottom of the sidebar' },
          { icon: <Sparkles size={16} />, text: 'Add a CurseForge API key in Settings to browse their library too' },
          { icon: <Gamepad2 size={16} />, text: 'Open an instance to add mods, shaders, resource packs and worlds' }
        ].map((tip, i) => (
          <motion.div
            key={i}
            className="row"
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + i * 0.08 }}
          >
            <span style={{ color: 'var(--accent)' }}>{tip.icon}</span>
            <span className="small">{tip.text}</span>
          </motion.div>
        ))}
      </div>

      <button className="btn primary lg" onClick={onFinish}>
        Open Brick Launcher <ArrowRight size={16} />
      </button>
    </div>
  )
}
