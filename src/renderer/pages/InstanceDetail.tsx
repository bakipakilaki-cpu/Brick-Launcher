import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpFromLine,
  Copy,
  FolderOpen,
  Globe2,
  Hammer,
  Package,
  Palette,
  Play,
  RefreshCw,
  ScrollText,
  Search,
  Server,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  Wrench
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Empty, Modal, Page, Spinner, Toggle, formatBytes, formatPlaytime, timeAgo } from '../components/ui'
import { Logo } from '../components/Logo'
import { FixModal } from '../components/FixModal'
import { ServersTab } from '../components/ServersTab'
import { api, type ContentType, type ContentUpdate, type WorldEntry } from '../lib/api'
import { useStore } from '../store/useStore'
import type { Instance, ModFile } from '../../shared/types'

type TabId = 'mods' | 'shaders' | 'resourcepacks' | 'worlds' | 'servers' | 'logs' | 'settings'

const CONTENT_TABS: Record<string, { type: ContentType; label: string; ext: string[]; noun: string }> = {
  mods: { type: 'mod', label: 'Mods', ext: ['jar'], noun: 'mod' },
  shaders: { type: 'shader', label: 'Shaders', ext: ['zip'], noun: 'shader pack' },
  resourcepacks: { type: 'resourcepack', label: 'Resource packs', ext: ['zip'], noun: 'resource pack' }
}

export function InstanceDetailPage({ id, onBack }: { id: string; onBack: () => void }) {
  const instances = useStore((s) => s.instances)
  const running = useStore((s) => s.runningIds.includes(id))
  const toast = useStore((s) => s.toast)
  const [tab, setTab] = useState<TabId>('mods')

  const instance = instances.find((i) => i.id === id)

  if (!instance) {
    return (
      <Page>
        <Empty
          icon={<Package size={26} />}
          title="Instance not found"
          hint="It may have been deleted."
          action={
            <button className="btn" onClick={onBack}>
              <ArrowLeft size={15} /> Back
            </button>
          }
        />
      </Page>
    )
  }

  const play = async (): Promise<void> => {
    try {
      if (running) await api.stopGame(id)
      else await api.launch(id)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  const tabs: { id: TabId; label: string; icon: typeof Package }[] = [
    { id: 'mods', label: 'Mods', icon: Package },
    { id: 'shaders', label: 'Shaders', icon: Sparkles },
    { id: 'resourcepacks', label: 'Resource packs', icon: Palette },
    { id: 'worlds', label: 'Worlds', icon: Globe2 },
    { id: 'servers', label: 'Servers', icon: Server },
    { id: 'logs', label: 'Console', icon: ScrollText },
    { id: 'settings', label: 'Settings', icon: Settings2 }
  ]

  return (
    <Page>
      <button className="btn ghost sm" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={15} /> All instances
      </button>

      <div className="hstack md" style={{ gap: 18, alignItems: 'flex-start' }}>
        <div
          style={{
            width: 84,
            height: 84,
            borderRadius: 16,
            overflow: 'hidden',
            background: 'linear-gradient(140deg, #232830, #171a20)',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0
          }}
        >
          {instance.icon ? (
            <img
              src={instance.icon}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated' }}
            />
          ) : (
            <Logo size={46} animated={false} />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title truncate">{instance.name}</h1>
          <div className="hstack sm" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <span className="tag accent">{instance.loader}</span>
            <span className="tag">{instance.mcVersion}</span>
            {instance.loaderVersion && <span className="tag">{instance.loaderVersion}</span>}
            {!instance.installed && <span className="tag warn">Needs repair</span>}
          </div>
          <div className="faint small" style={{ marginTop: 7 }}>
            {formatPlaytime(instance.totalPlaySeconds)} · {timeAgo(instance.lastPlayed)}
          </div>
        </div>

        <div className="hstack sm">
          <button className="btn icon" onClick={() => api.openInstanceFolder(id)} title="Open folder">
            <FolderOpen size={16} />
          </button>
          <button className={`btn lg${running ? '' : ' primary'}`} onClick={play}>
            {running ? <Square size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
            {running ? 'Stop' : 'Play'}
          </button>
        </div>
      </div>

      <div className="tabs" style={{ marginTop: 26 }}>
        {tabs.map((entry) => {
          const Icon = entry.icon
          return (
            <button
              key={entry.id}
              className={`tab${tab === entry.id ? ' active' : ''}`}
              onClick={() => setTab(entry.id)}
            >
              <span className="hstack sm" style={{ gap: 7 }}>
                <Icon size={15} />
                {entry.label}
              </span>
              {tab === entry.id && (
                <motion.div layoutId="tab-underline" className="tab-underline" />
              )}
            </button>
          )
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          {CONTENT_TABS[tab] ? (
            <ContentTab instance={instance} config={CONTENT_TABS[tab]} />
          ) : tab === 'worlds' ? (
            <WorldsTab instance={instance} />
          ) : tab === 'servers' ? (
            <ServersTab instance={instance} />
          ) : tab === 'logs' ? (
            <LogsTab instance={instance} />
          ) : (
            <SettingsTab instance={instance} onDeleted={onBack} />
          )}
        </motion.div>
      </AnimatePresence>
    </Page>
  )
}

/* ------------------------------ content tab ------------------------------ */

function ContentTab({
  instance,
  config
}: {
  instance: Instance
  config: { type: ContentType; label: string; ext: string[]; noun: string }
}) {
  const toast = useStore((s) => s.toast)
  const [files, setFiles] = useState<ModFile[] | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [updates, setUpdates] = useState<ContentUpdate[]>([])

  const load = useCallback(async (): Promise<void> => {
    try {
      setFiles(await api.listContent(instance.id, config.type))
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
      setFiles([])
    }
  }, [instance.id, config.type, toast])

  useEffect(() => {
    setFiles(null)
    setUpdates([])
    load()
  }, [load])

  const upload = async (): Promise<void> => {
    const picked = await api.pickFiles({
      multi: true,
      filters: [{ name: config.label, extensions: config.ext }]
    })
    if (!picked.length) return

    setBusy(true)
    try {
      const result = await api.importContent(instance.id, config.type, picked)
      setFiles(result.content)
      if (result.imported) {
        toast('success', `Added ${result.imported} ${config.noun}${result.imported === 1 ? '' : 's'}`)
      }
      if (result.skipped.length) {
        toast('error', `Skipped ${result.skipped.length} file(s) — expected .${config.ext.join(' / .')}`)
      }
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const identify = async (): Promise<void> => {
    setBusy(true)
    try {
      setFiles(await api.identifyContent(instance.id, config.type))
      toast('success', 'Matched files against Modrinth')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const checkUpdates = async (): Promise<void> => {
    setBusy(true)
    try {
      const found = await api.checkContentUpdates(
        instance.id,
        config.type,
        instance.mcVersion,
        instance.loader
      )
      setUpdates(found)
      toast(found.length ? 'info' : 'success', found.length ? `${found.length} update(s) available` : 'Everything is up to date')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const applyUpdate = async (update: ContentUpdate): Promise<void> => {
    setBusy(true)
    try {
      const existing = files?.find((f) => f.fileName === update.fileName)
      await api.installContent({
        instanceId: instance.id,
        type: config.type,
        version: { ...update.latest, projectId: existing?.projectId } as never,
        projectTitle: existing?.name ?? update.latest.name,
        iconUrl: existing?.iconUrl
      })
      setUpdates((prev) => prev.filter((u) => u.fileName !== update.fileName))
      await load()
      toast('success', `Updated to ${update.latest.versionNumber}`)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (file: ModFile): Promise<void> => {
    setFiles(await api.setContentEnabled(instance.id, config.type, file.fileName, !file.enabled))
  }

  const remove = async (file: ModFile): Promise<void> => {
    setFiles(await api.removeContent(instance.id, config.type, file.fileName))
  }

  const needle = query.trim().toLowerCase()
  const visible = (files ?? []).filter((f) => !needle || f.name.toLowerCase().includes(needle))

  return (
    <div className="stack md">
      <div className="hstack md" style={{ flexWrap: 'wrap' }}>
        <div className="search-box">
          <Search size={15} />
          <input
            className="input"
            placeholder={`Search installed ${config.label.toLowerCase()}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="spacer" />
        <button className="btn" onClick={checkUpdates} disabled={busy || !files?.length}>
          {busy ? <Spinner size={14} /> : <RefreshCw size={15} />} Check updates
        </button>
        <button className="btn" onClick={identify} disabled={busy || !files?.length}>
          <Wand2 size={15} /> Identify
        </button>
        <button className="btn primary" onClick={upload} disabled={busy}>
          <ArrowUpFromLine size={15} /> Upload {config.noun}
        </button>
      </div>

      {updates.length > 0 && (
        <div className="stack sm">
          <div className="field-label">Updates available</div>
          {updates.map((update) => (
            <div className="row" key={update.fileName} style={{ borderColor: 'var(--accent-line)' }}>
              <RefreshCw size={16} style={{ color: 'var(--accent)' }} />
              <div style={{ minWidth: 0 }}>
                <div className="row-title truncate">{update.latest.name}</div>
                <div className="row-sub">
                  {update.current ?? 'installed'} → {update.latest.versionNumber}
                </div>
              </div>
              <div className="spacer" />
              <button className="btn primary sm" onClick={() => applyUpdate(update)} disabled={busy}>
                Update
              </button>
            </div>
          ))}
        </div>
      )}

      {files === null ? (
        <div className="stack sm">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton" style={{ height: 58 }} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Empty
          icon={<Package size={26} />}
          title={files.length === 0 ? `No ${config.label.toLowerCase()} yet` : 'Nothing matches'}
          hint={
            files.length === 0
              ? `Browse ${config.label.toLowerCase()} from the sidebar, or upload your own .${config.ext.join('/.')} files.`
              : undefined
          }
          action={
            files.length === 0 ? (
              <button className="btn primary" onClick={upload}>
                <ArrowUpFromLine size={15} /> Upload {config.noun}
              </button>
            ) : undefined
          }
        />
      ) : (
        <div>
          <AnimatePresence initial={false}>
            {visible.map((file) => (
              <motion.div
                key={file.fileName}
                className={`row${file.enabled ? '' : ' disabled'}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 20 }}
                layout
              >
                {file.iconUrl ? (
                  <img
                    src={file.iconUrl}
                    alt=""
                    style={{ width: 34, height: 34, borderRadius: 7, objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 7,
                      background: 'var(--bg-hover)',
                      display: 'grid',
                      placeItems: 'center'
                    }}
                  >
                    <Package size={16} style={{ color: 'var(--ink-faint)' }} />
                  </div>
                )}

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row-title truncate">{file.name}</div>
                  <div className="row-sub truncate">
                    {file.version ? `${file.version} · ` : ''}
                    {formatBytes(file.sizeBytes)}
                    {file.source !== 'local' ? ` · ${file.source}` : ' · local file'}
                  </div>
                </div>

                <Toggle checked={file.enabled} onChange={() => toggle(file)} label="Enabled" />
                <button className="btn ghost sm" onClick={() => remove(file)} aria-label="Delete">
                  <Trash2 size={15} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

/* ------------------------------- worlds tab ------------------------------ */

function WorldsTab({ instance }: { instance: Instance }) {
  const toast = useStore((s) => s.toast)
  const [worlds, setWorlds] = useState<WorldEntry[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      setWorlds(await api.listWorlds(instance.id))
    } catch {
      setWorlds([])
    }
  }, [instance.id])

  useEffect(() => {
    load()
  }, [load])

  const upload = async (fromFolder: boolean): Promise<void> => {
    const [picked] = await api.pickFiles(
      fromFolder ? { directory: true } : { filters: [{ name: 'World archive', extensions: ['zip'] }] }
    )
    if (!picked) return

    setBusy(true)
    try {
      setWorlds(await api.importWorld(instance.id, picked))
      toast('success', 'World imported')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (world: WorldEntry): Promise<void> => {
    setBusy(true)
    try {
      setWorlds(await api.deleteWorld(instance.id, world.folderName))
      toast('success', `Deleted ${world.name}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack md">
      <div className="hstack md" style={{ flexWrap: 'wrap' }}>
        <div className="faint small">
          Worlds live in this instance’s <span className="mono">saves</span> folder.
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => upload(true)} disabled={busy}>
          <FolderOpen size={15} /> Import folder
        </button>
        <button className="btn primary" onClick={() => upload(false)} disabled={busy}>
          <ArrowUpFromLine size={15} /> Upload world (.zip)
        </button>
      </div>

      {worlds === null ? (
        <div className="stack sm">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="skeleton" style={{ height: 58 }} />
          ))}
        </div>
      ) : worlds.length === 0 ? (
        <Empty
          icon={<Globe2 size={26} />}
          title="No worlds yet"
          hint="Worlds you create in game appear here. You can also upload a .zip you downloaded, or import an existing world folder."
          action={
            <button className="btn primary" onClick={() => upload(false)}>
              <ArrowUpFromLine size={15} /> Upload world
            </button>
          }
        />
      ) : (
        <div>
          <AnimatePresence initial={false}>
            {worlds.map((world) => (
              <motion.div
                key={world.folderName}
                className="row"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 20 }}
                layout
              >
                {world.icon ? (
                  <img
                    src={world.icon}
                    alt=""
                    style={{ width: 40, height: 40, borderRadius: 7, imageRendering: 'pixelated' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 7,
                      background: 'var(--bg-hover)',
                      display: 'grid',
                      placeItems: 'center'
                    }}
                  >
                    <Globe2 size={18} style={{ color: 'var(--ink-faint)' }} />
                  </div>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row-title truncate">{world.name}</div>
                  <div className="row-sub">
                    {formatBytes(world.sizeBytes)} · {timeAgo(world.lastPlayed)}
                  </div>
                </div>
                <button className="btn ghost sm" onClick={() => remove(world)} disabled={busy}>
                  <Trash2 size={15} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

/* -------------------------------- logs tab ------------------------------- */

function LogsTab({ instance }: { instance: Instance }) {
  const lines = useStore((s) => s.logs[instance.id] ?? [])
  const clearLogs = useStore((s) => s.clearLogs)
  const consoleRef = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)
  const [fixOpen, setFixOpen] = useState(false)

  // Surface the fixer whenever the captured output shows a dependency failure.
  const hasModProblem = lines.some((l) =>
    /Incompatible mods found|FormattedException|which is missing|mandatory dependencies/i.test(l)
  )

  useEffect(() => {
    if (stick && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight
    }
  }, [lines, stick])

  const severity = (line: string): string => {
    if (/\b(ERROR|FATAL|Exception|Caused by)\b/.test(line)) return 'error'
    if (/\bWARN\b/.test(line)) return 'warn'
    if (/\bINFO\b/.test(line)) return 'info'
    return ''
  }

  return (
    <div className="stack md">
      <div className="hstack md">
        <div className="faint small">
          {lines.length ? `${lines.length} lines from this session` : 'Output appears here while the game runs.'}
        </div>
        <div className="spacer" />
        <label className="hstack sm faint small" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={stick}
            onChange={(e) => setStick(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          Auto-scroll
        </label>
        <button className="btn sm" onClick={() => clearLogs(instance.id)} disabled={!lines.length}>
          Clear
        </button>
        <button className="btn sm" onClick={() => api.openInstanceLogs(instance.id)}>
          <FolderOpen size={14} /> Log files
        </button>
        <button
          className={`btn sm${hasModProblem ? ' primary' : ''}`}
          onClick={() => setFixOpen(true)}
        >
          <Wrench size={14} /> Fix mods
        </button>
      </div>

      {hasModProblem && (
        <motion.div
          className="banner warn"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <AlertTriangle size={15} />
          <div style={{ flex: 1 }}>
            A mod dependency problem was detected in this session’s output. Brick can install what
            the loader asked for.
          </div>
          <button className="btn primary sm" onClick={() => setFixOpen(true)}>
            <Wrench size={14} /> Fix it
          </button>
        </motion.div>
      )}

      <FixModal instanceId={instance.id} open={fixOpen} onClose={() => setFixOpen(false)} />

      <div className="console" ref={consoleRef}>
        {lines.length === 0 ? (
          <span className="faint">Waiting for output…</span>
        ) : (
          lines.map((line, index) => (
            <div key={index} className={`console-line ${severity(line)}`}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/* ------------------------------ settings tab ----------------------------- */

function SettingsTab({ instance, onDeleted }: { instance: Instance; onDeleted: () => void }) {
  const toast = useStore((s) => s.toast)
  const globalSettings = useStore((s) => s.settings)

  const [name, setName] = useState(instance.name)
  const [memory, setMemory] = useState(instance.memoryMb)
  const [jvmArgs, setJvmArgs] = useState(instance.jvmArgs ?? '')
  const [width, setWidth] = useState(instance.width ?? 0)
  const [height, setHeight] = useState(instance.height ?? 0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(instance.name)
    setMemory(instance.memoryMb)
    setJvmArgs(instance.jvmArgs ?? '')
    setWidth(instance.width ?? 0)
    setHeight(instance.height ?? 0)
  }, [instance.id, instance.name, instance.memoryMb, instance.jvmArgs, instance.width, instance.height])

  const dirty =
    name !== instance.name ||
    memory !== instance.memoryMb ||
    jvmArgs !== (instance.jvmArgs ?? '') ||
    width !== (instance.width ?? 0) ||
    height !== (instance.height ?? 0)

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.updateInstance(instance.id, {
        name: name.trim() || instance.name,
        memoryMb: memory,
        jvmArgs: jvmArgs.trim() || undefined,
        width: width || undefined,
        height: height || undefined
      })
      toast('success', 'Saved')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const repair = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.repairInstance(instance.id)
      toast('success', 'Files verified and repaired')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const duplicate = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.duplicateInstance(instance.id, `${instance.name} copy`)
      toast('success', 'Instance duplicated')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const destroy = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.deleteInstance(instance.id)
      setConfirmDelete(false)
      onDeleted()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="stack lg" style={{ maxWidth: 620 }}>
      <div className="field">
        <span className="field-label">Instance name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="field">
        <span className="field-label">
          Memory · {(memory / 1024).toFixed(1)} GB
          {globalSettings && memory !== globalSettings.defaultMemoryMb && (
            <span className="faint"> (overrides the global default)</span>
          )}
        </span>
        <input
          type="range"
          min={1024}
          max={16384}
          step={512}
          value={memory}
          onChange={(e) => setMemory(Number(e.target.value))}
          style={{ accentColor: 'var(--accent)' }}
        />
      </div>

      <div className="hstack md">
        <div className="field" style={{ flex: 1 }}>
          <span className="field-label">Window width</span>
          <input
            className="input"
            type="number"
            placeholder="Default"
            value={width || ''}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <span className="field-label">Window height</span>
          <input
            className="input"
            type="number"
            placeholder="Default"
            value={height || ''}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="field">
        <span className="field-label">Extra JVM arguments</span>
        <input
          className="input mono"
          placeholder={globalSettings?.jvmArgs ?? ''}
          value={jvmArgs}
          onChange={(e) => setJvmArgs(e.target.value)}
        />
        <span className="field-hint">Leave empty to use the global arguments from Settings.</span>
      </div>

      <div className="hstack sm">
        <button className="btn primary" onClick={save} disabled={!dirty || busy}>
          {busy ? <Spinner size={14} /> : null} Save changes
        </button>
        <button className="btn" onClick={repair} disabled={busy}>
          <Hammer size={15} /> Verify &amp; repair
        </button>
        <button className="btn" onClick={duplicate} disabled={busy}>
          <Copy size={15} /> Duplicate
        </button>
      </div>

      <div className="card pad stack sm" style={{ borderColor: 'rgba(255,92,92,0.24)' }}>
        <div className="bold" style={{ color: 'var(--danger)' }}>
          Delete this instance
        </div>
        <div className="faint small">
          Removes the instance and everything inside it — mods, configs, worlds and screenshots.
          This cannot be undone.
        </div>
        <button
          className="btn danger"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 size={15} /> Delete instance
        </button>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${instance.name}?`}
        icon={<Trash2 size={19} style={{ color: 'var(--danger)' }} />}
        footer={
          <>
            <button className="btn ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Keep it
            </button>
            <button className="btn danger" onClick={destroy} disabled={busy}>
              {busy ? <Spinner size={14} /> : <Trash2 size={15} />} Delete permanently
            </button>
          </>
        }
      >
        <div className="banner danger">
          <Trash2 size={15} />
          <div>
            Every world, mod and config file in this instance will be erased. There is no undo — if
            you want to keep the worlds, open the folder and copy them out first.
          </div>
        </div>
      </Modal>
    </div>
  )
}
