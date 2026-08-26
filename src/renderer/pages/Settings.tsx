import { motion } from 'framer-motion'
import {
  Coffee,
  Check,
  Download,
  ExternalLink,
  FolderOpen,
  Info,
  Key,
  MemoryStick,
  Palette,
  Sparkles,
  UserRound
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { AccountModal } from '../components/AccountChip'
import { Page, Spinner, Toggle } from '../components/ui'
import { api, type JavaRuntime } from '../lib/api'
import { useStore } from '../store/useStore'

const ACCENTS = ['#1bd96a', '#4f8cff', '#b46cff', '#ff7043', '#ffb340', '#ff5c8a']

export function SettingsPage() {
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const toast = useStore((s) => s.toast)

  const [runtimes, setRuntimes] = useState<JavaRuntime[] | null>(null)
  const [installing, setInstalling] = useState<number | null>(null)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [paths, setPaths] = useState<Record<string, string>>({})
  const [clientId, setClientId] = useState('')
  const [cfKey, setCfKey] = useState('')

  useEffect(() => {
    api.detectJava().then(setRuntimes).catch(() => setRuntimes([]))
    api.info().then((info) => setPaths(info.paths))
  }, [])

  useEffect(() => {
    if (settings) {
      setClientId(settings.msClientId)
      setCfKey(settings.curseforgeApiKey)
    }
  }, [settings])

  if (!settings) return null

  const installJava = async (major: number): Promise<void> => {
    setInstalling(major)
    try {
      await api.installJava(major)
      setRuntimes(await api.detectJava())
      toast('success', `Java ${major} installed`)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling(null)
    }
  }

  return (
    <Page>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Defaults for new instances, integrations and appearance.</p>

      {/* -------------------------------- game -------------------------------- */}
      <Section icon={<MemoryStick size={17} />} title="Game defaults">
        <div className="field">
          <span className="field-label">
            Default memory · {(settings.defaultMemoryMb / 1024).toFixed(1)} GB
          </span>
          <input
            type="range"
            min={1024}
            max={16384}
            step={512}
            value={settings.defaultMemoryMb}
            onChange={(e) => saveSettings({ defaultMemoryMb: Number(e.target.value) })}
            style={{ accentColor: 'var(--accent)' }}
          />
          <span className="field-hint">
            Applies to new instances. Existing ones keep their own setting.
          </span>
        </div>

        <div className="field">
          <span className="field-label">JVM arguments</span>
          <input
            className="input mono"
            value={settings.jvmArgs}
            onChange={(e) => saveSettings({ jvmArgs: e.target.value })}
          />
          <span className="field-hint">
            Default flags passed to Java. The preset here tunes the G1 garbage collector for
            Minecraft.
          </span>
        </div>

        <div className="field">
          <span className="field-label">Parallel downloads · {settings.concurrentDownloads}</span>
          <input
            type="range"
            min={1}
            max={32}
            value={settings.concurrentDownloads}
            onChange={(e) => saveSettings({ concurrentDownloads: Number(e.target.value) })}
            style={{ accentColor: 'var(--accent)' }}
          />
          <span className="field-hint">
            Higher is faster on good connections. Lower it if downloads keep failing.
          </span>
        </div>

        <Row
          title="Show snapshots"
          hint="Include development versions in the version pickers."
          control={
            <Toggle
              checked={settings.showSnapshots}
              onChange={(value) => saveSettings({ showSnapshots: value })}
            />
          }
        />

        <Row
          title="Minimise on launch"
          hint="Tuck the launcher away once Minecraft starts."
          control={
            <Toggle
              checked={settings.closeLauncherOnLaunch}
              onChange={(value) => saveSettings({ closeLauncherOnLaunch: value })}
            />
          }
        />
      </Section>

      {/* -------------------------------- java -------------------------------- */}
      <Section icon={<Coffee size={17} />} title="Java">
        {runtimes === null ? (
          <div className="hstack sm faint">
            <Spinner /> Scanning…
          </div>
        ) : runtimes.length === 0 ? (
          <div className="banner warn">
            <Coffee size={15} />
            <div>No Java found. Install one below — Brick will also fetch it automatically the
              first time a version needs it.</div>
          </div>
        ) : (
          <div className="stack sm">
            {runtimes.map((runtime) => (
              <div className="row" key={runtime.path}>
                <Coffee size={16} style={{ color: 'var(--accent)' }} />
                <div style={{ minWidth: 0 }}>
                  <div className="row-title">Java {runtime.major}</div>
                  <div className="row-sub mono truncate">{runtime.path}</div>
                </div>
                <div className="spacer" />
                <span className="tag">{runtime.source === 'bundled' ? 'Brick' : 'System'}</span>
              </div>
            ))}
          </div>
        )}

        <div className="hstack sm" style={{ flexWrap: 'wrap' }}>
          {[21, 17, 8].map((major) => {
            const present = runtimes?.some((r) => r.major === major)
            return (
              <button
                key={major}
                className="btn"
                onClick={() => installJava(major)}
                disabled={installing !== null || present}
              >
                {installing === major ? <Spinner size={14} /> : present ? <Check size={15} /> : <Download size={15} />}
                Java {major}
              </button>
            )
          })}
        </div>

        <div className="field">
          <span className="field-label">Java path override</span>
          <input
            className="input mono"
            placeholder="Leave empty to choose automatically"
            value={settings.javaPath}
            onChange={(e) => saveSettings({ javaPath: e.target.value })}
          />
          <span className="field-hint">
            Only set this if you need a specific JVM. Automatic selection matches the Java each
            Minecraft version requires.
          </span>
        </div>
      </Section>

      {/* ------------------------------ accounts ------------------------------ */}
      <Section icon={<UserRound size={17} />} title="Accounts">
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setAccountsOpen(true)}>
          <UserRound size={15} /> Manage accounts
        </button>

        <div className="field">
          <span className="field-label">Microsoft client ID</span>
          <input
            className="input mono"
            placeholder="00000000-0000-0000-0000-000000000000"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            onBlur={() => saveSettings({ msClientId: clientId.trim() })}
          />
          <span className="field-hint">
            Microsoft sign-in needs your own free Azure application. Create one at{' '}
            <button
              className="btn ghost sm"
              style={{ padding: 0, display: 'inline-flex', height: 'auto' }}
              onClick={() => api.openExternal('https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade')}
            >
              portal.azure.com <ExternalLink size={11} />
            </button>
            , add the “Mobile and desktop applications” platform with redirect URI{' '}
            <span className="mono selectable">
              https://login.microsoftonline.com/common/oauth2/nativeclient
            </span>
            , then paste the Application (client) ID here. Offline accounts work without this.
          </span>
        </div>
      </Section>

      {/* ---------------------------- integrations ---------------------------- */}
      <Section icon={<Key size={17} />} title="Integrations">
        <div className="banner info">
          <Info size={15} />
          <div>Modrinth works out of the box. CurseForge requires a free API key.</div>
        </div>

        <div className="field">
          <span className="field-label">CurseForge API key</span>
          <input
            className="input mono"
            type="password"
            placeholder="Paste your key to enable CurseForge browsing"
            value={cfKey}
            onChange={(e) => setCfKey(e.target.value)}
            onBlur={() => saveSettings({ curseforgeApiKey: cfKey.trim() })}
          />
          <span className="field-hint">
            Get one from{' '}
            <button
              className="btn ghost sm"
              style={{ padding: 0, display: 'inline-flex', height: 'auto' }}
              onClick={() => api.openExternal('https://console.curseforge.com/')}
            >
              console.curseforge.com <ExternalLink size={11} />
            </button>{' '}
            — sign in, open API Keys, and copy the key.
          </span>
        </div>
      </Section>

      {/* ----------------------------- appearance ----------------------------- */}
      <Section icon={<Palette size={17} />} title="Appearance">
        <div className="field">
          <span className="field-label">Accent colour</span>
          <div className="hstack sm">
            {ACCENTS.map((color) => (
              <motion.button
                key={color}
                onClick={() => saveSettings({ accentColor: color })}
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.94 }}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: color,
                  border:
                    settings.accentColor === color ? '2px solid var(--ink)' : '2px solid transparent',
                  display: 'grid',
                  placeItems: 'center'
                }}
                aria-label={`Accent ${color}`}
              >
                {settings.accentColor === color && <Check size={16} color="#08130c" strokeWidth={3} />}
              </motion.button>
            ))}
          </div>
        </div>

        <Row
          title="Animations"
          hint="Turn off for a snappier, static interface."
          control={
            <Toggle
              checked={settings.animationsEnabled}
              onChange={(value) => saveSettings({ animationsEnabled: value })}
            />
          }
        />
      </Section>

      {/* -------------------------------- files ------------------------------- */}
      <Section icon={<FolderOpen size={17} />} title="Files">
        <div className="stack sm">
          {[
            { label: 'Instances', path: paths.instances },
            { label: 'Shared game files', path: paths.shared },
            { label: 'Java runtimes', path: paths.java },
            { label: 'Logs', path: paths.logs }
          ]
            .filter((entry) => entry.path)
            .map((entry) => (
              <div className="row" key={entry.label}>
                <FolderOpen size={16} style={{ color: 'var(--ink-faint)' }} />
                <div style={{ minWidth: 0 }}>
                  <div className="row-title">{entry.label}</div>
                  <div className="row-sub mono truncate">{entry.path}</div>
                </div>
                <div className="spacer" />
                <button className="btn sm" onClick={() => api.openPath(entry.path)}>
                  Open
                </button>
              </div>
            ))}
        </div>
      </Section>

      <div className="hstack sm faint small" style={{ marginTop: 34, justifyContent: 'center' }}>
        <Sparkles size={13} /> Brick Launcher 1.0.0
      </div>

      <AccountModal open={accountsOpen} onClose={() => setAccountsOpen(false)} />
    </Page>
  )
}

function Section({
  icon,
  title,
  children
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <>
      <div className="section-head">
        <div className="hstack sm">
          <span style={{ color: 'var(--accent)' }}>{icon}</span>
          <span className="section-title">{title}</span>
        </div>
      </div>
      <div className="card pad stack md" style={{ maxWidth: 720 }}>
        {children}
      </div>
    </>
  )
}

function Row({
  title,
  hint,
  control
}: {
  title: string
  hint: string
  control: React.ReactNode
}) {
  return (
    <div className="hstack md">
      <div style={{ flex: 1 }}>
        <div className="bold" style={{ fontSize: 13.5 }}>
          {title}
        </div>
        <div className="field-hint">{hint}</div>
      </div>
      {control}
    </div>
  )
}
