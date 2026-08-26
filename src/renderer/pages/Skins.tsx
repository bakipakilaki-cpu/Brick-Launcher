import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpFromLine, Check, Download, Info, Shirt, Trash2, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Avatar } from '../components/AccountChip'
import { Empty, Modal, Page, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { useStore } from '../store/useStore'
import type { SkinEntry } from '../../shared/types'

/**
 * Crop the head out of a skin sheet. On a 64-wide skin the face occupies the
 * 8×8 block at (8,8) and the hat overlay the one at (40,8); both are drawn by
 * scaling the whole sheet up and offsetting to the right tile.
 */
function SkinHead({ src, alt, size = 112 }: { src: string; alt: string; size?: number }) {
  const scale = size / 8
  const layer = {
    backgroundImage: `url(${src})`,
    backgroundSize: `${64 * scale}px ${64 * scale}px`,
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated' as const,
    position: 'absolute' as const,
    inset: 0
  }

  return (
    <div style={{ position: 'relative', width: size, height: size }} role="img" aria-label={alt}>
      <div style={{ ...layer, backgroundPosition: `-${8 * scale}px -${8 * scale}px` }} />
      <div style={{ ...layer, backgroundPosition: `-${40 * scale}px -${8 * scale}px` }} />
    </div>
  )
}

export function SkinsPage() {
  const skins = useStore((s) => s.skins)
  const accounts = useStore((s) => s.accounts)
  const activeId = useStore((s) => s.activeAccountId)
  const refreshSkins = useStore((s) => s.refreshSkins)
  const refreshAccounts = useStore((s) => s.refreshAccounts)
  const toast = useStore((s) => s.toast)

  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [variant, setVariant] = useState<'classic' | 'slim'>('classic')

  const active = accounts.find((a) => a.id === activeId)
  const isPremium = active?.kind === 'microsoft'

  // Skins are stored on disk; pull each one in as a data URL for the grid.
  useEffect(() => {
    let cancelled = false
    Promise.all(
      skins.map(async (skin) => [skin.id, await api.skinDataUrl(skin.id).catch(() => '')] as const)
    ).then((entries) => {
      if (!cancelled) setPreviews(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [skins])

  const pick = async (): Promise<void> => {
    const [file] = await api.pickFiles({ filters: [{ name: 'Skin PNG', extensions: ['png'] }] })
    if (!file) return
    setPendingFile(file)
    setName(file.split(/[\\/]/).pop()!.replace(/\.png$/i, ''))
    setVariant('classic')
    setUploadOpen(true)
  }

  const confirmUpload = async (): Promise<void> => {
    if (!pendingFile) return
    setBusy('upload')
    try {
      await api.addSkinFile(pendingFile, name, variant)
      await refreshSkins()
      setUploadOpen(false)
      setPendingFile(null)
      toast('success', 'Skin added to your library')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const importCurrent = async (): Promise<void> => {
    if (!active?.skinUrl) return
    setBusy('import')
    try {
      await api.addSkinUrl(active.skinUrl, `${active.username}'s skin`, 'classic')
      await refreshSkins()
      toast('success', 'Current skin saved to your library')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const apply = async (skin: SkinEntry): Promise<void> => {
    if (!active) return
    setBusy(skin.id)
    try {
      await api.applySkin(active.id, skin.id)
      await refreshAccounts()
      toast('success', `${skin.name} is now your skin`)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (skin: SkinEntry): Promise<void> => {
    await api.removeSkin(skin.id)
    await refreshSkins()
  }

  const reset = async (): Promise<void> => {
    if (!active) return
    setBusy('reset')
    try {
      await api.resetSkin(active.id)
      await refreshAccounts()
      toast('success', 'Skin reset to the default')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Page>
      <div className="hstack md" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h1 className="page-title">Skins</h1>
          <p className="page-sub">Keep a library of skins and switch between them.</p>
        </div>
        <button className="btn primary" onClick={pick}>
          <ArrowUpFromLine size={16} /> Upload skin
        </button>
      </div>

      {/* Current account panel */}
      <div className="card pad hstack md" style={{ marginTop: 22, gap: 18 }}>
        <Avatar account={active} size={64} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="bold" style={{ fontSize: 16 }}>
            {active?.username ?? 'No account selected'}
          </div>
          <div className="faint small">
            {!active
              ? 'Add an account to manage skins.'
              : isPremium
                ? 'Microsoft account — skin changes apply everywhere.'
                : 'Offline account — skins can be stored here but not uploaded to Mojang.'}
          </div>
        </div>
        {isPremium && (
          <div className="hstack sm">
            {active?.skinUrl && (
              <button className="btn sm" onClick={importCurrent} disabled={busy !== null}>
                {busy === 'import' ? <Spinner size={14} /> : <Download size={14} />} Save current
              </button>
            )}
            <button className="btn sm" onClick={reset} disabled={busy !== null}>
              Reset to default
            </button>
          </div>
        )}
      </div>

      {active && !isPremium && (
        <div className="banner info" style={{ marginTop: 14 }}>
          <Info size={15} />
          <div>
            Mojang only accepts skin uploads from accounts that own the game, so an offline account
            can’t change its skin server-side. The library below still works — use a client-side
            skin mod (such as CustomSkinLoader) to see them in singleplayer.
          </div>
        </div>
      )}

      {/* Capes */}
      {isPremium && active?.capes && active.capes.length > 0 && (
        <>
          <div className="section-head">
            <span className="section-title">Capes</span>
          </div>
          <div className="chip-row">
            <button
              className={`chip${active.capes.every((c) => !c.active) ? ' active' : ''}`}
              onClick={async () => {
                await api.setCape(active.id, null)
                await refreshAccounts()
              }}
            >
              No cape
            </button>
            {active.capes.map((cape) => (
              <button
                key={cape.id}
                className={`chip${cape.active ? ' active' : ''}`}
                onClick={async () => {
                  await api.setCape(active.id, cape.id)
                  await refreshAccounts()
                }}
              >
                {cape.alias}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="section-head">
        <span className="section-title">Your library</span>
        <span className="faint small">
          {skins.length} skin{skins.length === 1 ? '' : 's'}
        </span>
      </div>

      {skins.length === 0 ? (
        <Empty
          icon={<Shirt size={26} />}
          title="No skins saved"
          hint="Upload a 64×64 PNG to build your library. Applying one to a Microsoft account changes it everywhere Minecraft shows your character."
          action={
            <button className="btn primary" onClick={pick}>
              <ArrowUpFromLine size={15} /> Upload your first skin
            </button>
          }
        />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(158px, 1fr))' }}>
          <AnimatePresence mode="popLayout">
            {skins.map((skin) => (
              <motion.div
                key={skin.id}
                className="card"
                style={{ overflow: 'hidden' }}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                whileHover={{ y: -3 }}
                layout
              >
                <div
                  style={{
                    aspectRatio: '1',
                    background: 'linear-gradient(140deg, #232830, #171a20)',
                    display: 'grid',
                    placeItems: 'center',
                    padding: 16
                  }}
                >
                  {previews[skin.id] ? (
                    <SkinHead src={previews[skin.id]} alt={skin.name} />
                  ) : (
                    <UserRound size={30} style={{ color: 'var(--ink-faint)' }} />
                  )}
                </div>

                <div style={{ padding: '10px 12px 12px' }}>
                  <div className="truncate bold" style={{ fontSize: 13 }}>
                    {skin.name}
                  </div>
                  <div className="faint" style={{ fontSize: 11 }}>
                    {skin.variant === 'slim' ? 'Slim arms' : 'Classic arms'}
                  </div>
                  <div className="hstack sm" style={{ marginTop: 9 }}>
                    <button
                      className="btn primary sm"
                      style={{ flex: 1 }}
                      onClick={() => apply(skin)}
                      disabled={!isPremium || busy !== null}
                      title={isPremium ? 'Apply this skin' : 'Requires a Microsoft account'}
                    >
                      {busy === skin.id ? <Spinner size={13} /> : <Check size={13} />} Apply
                    </button>
                    <button className="btn ghost sm" onClick={() => remove(skin)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Add skin"
        icon={<Shirt size={19} style={{ color: 'var(--accent)' }} />}
        footer={
          <>
            <button className="btn ghost" onClick={() => setUploadOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={confirmUpload} disabled={busy !== null}>
              {busy === 'upload' ? <Spinner size={14} /> : <Check size={15} />} Add to library
            </button>
          </>
        }
      >
        <div className="field">
          <span className="field-label">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>

        <div className="field">
          <span className="field-label">Arm style</span>
          <div className="chip-row">
            <button
              className={`chip${variant === 'classic' ? ' active' : ''}`}
              onClick={() => setVariant('classic')}
            >
              Classic (4px arms)
            </button>
            <button
              className={`chip${variant === 'slim' ? ' active' : ''}`}
              onClick={() => setVariant('slim')}
            >
              Slim (3px arms)
            </button>
          </div>
          <span className="field-hint">
            Steve models use classic arms, Alex models use slim. Pick whichever your skin was drawn
            for.
          </span>
        </div>

        <div className="faint small mono truncate">{pendingFile}</div>
      </Modal>
    </Page>
  )
}
