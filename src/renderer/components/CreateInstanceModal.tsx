import { AnimatePresence, motion } from 'framer-motion'
import { Blocks, Image as ImageIcon, Wand2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Modal, Spinner } from './ui'
import { api } from '../lib/api'
import { useStore } from '../store/useStore'
import { LOADERS, type LoaderId } from '../../shared/types'

export function CreateInstanceModal({
  open,
  onClose,
  onCreated
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const versions = useStore((s) => s.versions)
  const settings = useStore((s) => s.settings)
  const toast = useStore((s) => s.toast)

  const [name, setName] = useState('')
  const [loader, setLoader] = useState<LoaderId>('fabric')
  const [mcVersion, setMcVersion] = useState('')
  const [loaderVersion, setLoaderVersion] = useState('')
  const [builds, setBuilds] = useState<string[] | null>(null)
  const [icon, setIcon] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [showSnapshots, setShowSnapshots] = useState(false)

  const visible = versions.filter((v) => showSnapshots || v.type === 'release')

  useEffect(() => {
    if (open && !mcVersion && visible.length) setMcVersion(visible[0].id)
  }, [open, visible, mcVersion])

  // Loader builds depend on the selected Minecraft version, so refetch on change.
  useEffect(() => {
    if (!open || loader === 'vanilla' || !mcVersion) {
      setBuilds(null)
      setLoaderVersion('')
      return
    }
    let cancelled = false
    setBuilds(null)
    api
      .loaderBuilds(loader, mcVersion)
      .then((list) => {
        if (cancelled) return
        setBuilds(list)
        setLoaderVersion(list[0] ?? '')
      })
      .catch(() => {
        if (!cancelled) setBuilds([])
      })
    return () => {
      cancelled = true
    }
  }, [open, loader, mcVersion])

  const pickIcon = async (): Promise<void> => {
    const [file] = await api.pickFiles({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (!file) return

    // The renderer's CSP blocks file:// fetches, so the bytes come back over
    // IPC as a data URL. Downscale through a canvas so the icon stored in the
    // config stays small and square.
    let dataUrl: string
    try {
      dataUrl = await api.readImage(file)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
      return
    }

    // Decode via <img> rather than fetch+createImageBitmap: img-src permits
    // data: URLs under our CSP, connect-src does not.
    const image = new Image()
    image.src = dataUrl
    try {
      await image.decode()
    } catch {
      toast('error', 'Could not read that image.')
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 160
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    // Centre-crop to a square so non-square art is not distorted.
    const side = Math.min(image.naturalWidth, image.naturalHeight)
    ctx.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      160,
      160
    )
    setIcon(canvas.toDataURL('image/png'))
  }

  const reset = (): void => {
    setName('')
    setIcon(undefined)
    setLoaderVersion('')
  }

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const instance = await api.createInstance({
        name: name.trim() || `${LOADERS.find((l) => l.id === loader)!.label} ${mcVersion}`,
        mcVersion,
        loader,
        loaderVersion: loaderVersion || undefined,
        icon,
        memoryMb: settings?.defaultMemoryMb
      })
      reset()
      onClose()
      onCreated(instance.id)
      toast('success', `${instance.name} is ready`)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const noBuilds = builds !== null && builds.length === 0 && loader !== 'vanilla'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New instance"
      icon={<Blocks size={19} style={{ color: 'var(--accent)' }} />}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={create}
            disabled={busy || !mcVersion || noBuilds || (loader !== 'vanilla' && builds === null)}
          >
            {busy ? <Spinner /> : <Wand2 size={15} />} Create
          </button>
        </>
      }
    >
      <div className="hstack md">
        <button
          onClick={pickIcon}
          style={{
            width: 72,
            height: 72,
            borderRadius: 14,
            border: '1px dashed var(--line)',
            background: icon ? 'transparent' : 'var(--bg-card)',
            display: 'grid',
            placeItems: 'center',
            overflow: 'hidden',
            flexShrink: 0
          }}
          title="Choose an icon"
        >
          {icon ? (
            <img
              src={icon}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated' }}
            />
          ) : (
            <ImageIcon size={22} style={{ color: 'var(--ink-faint)' }} />
          )}
        </button>

        <div className="field" style={{ flex: 1 }}>
          <span className="field-label">Instance name</span>
          <input
            className="input"
            placeholder={`${LOADERS.find((l) => l.id === loader)?.label} ${mcVersion}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <span className="field-hint">Click the square to set a custom icon.</span>
        </div>
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

      <div className="hstack md" style={{ alignItems: 'flex-start' }}>
        <div className="field" style={{ flex: 1 }}>
          <span className="field-label">Minecraft version</span>
          <select className="select" value={mcVersion} onChange={(e) => setMcVersion(e.target.value)}>
            {visible.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id}
                {v.type !== 'release' ? ` · ${v.type}` : ''}
              </option>
            ))}
          </select>
          <label className="hstack sm field-hint" style={{ cursor: 'pointer', marginTop: 2 }}>
            <input
              type="checkbox"
              checked={showSnapshots}
              onChange={(e) => setShowSnapshots(e.target.checked)}
              style={{ accentColor: 'var(--accent)' }}
            />
            Show snapshots
          </label>
        </div>

        <AnimatePresence>
          {loader !== 'vanilla' && (
            <motion.div
              className="field"
              style={{ flex: 1 }}
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
            >
              <span className="field-label">{LOADERS.find((l) => l.id === loader)?.label} version</span>
              {builds === null ? (
                <div className="skeleton" style={{ height: 38 }} />
              ) : builds.length === 0 ? (
                <div className="banner warn" style={{ padding: '9px 11px', fontSize: 12.3 }}>
                  No {loader} build for {mcVersion} yet.
                </div>
              ) : (
                <select
                  className="select"
                  value={loaderVersion}
                  onChange={(e) => setLoaderVersion(e.target.value)}
                >
                  {builds.slice(0, 60).map((build, index) => (
                    <option key={build} value={build}>
                      {build}
                      {index === 0 ? ' · latest' : ''}
                    </option>
                  ))}
                </select>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  )
}
