import { AnimatePresence, motion } from 'framer-motion'
import { Check, LogIn, Plus, Trash2, UserRound, WifiOff } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../store/useStore'
import { Modal } from './ui'
import type { Account } from '../../shared/types'

/** Head render for a player, served by Crafatar for premium accounts. */
export function avatarUrl(account: Account | undefined, size = 64): string | undefined {
  if (!account) return undefined
  if (account.kind === 'offline') return undefined
  return `https://crafatar.com/avatars/${account.uuid}?size=${size}&overlay&default=MHF_Steve`
}

/** Deterministic colour so every offline account gets its own tile. */
function offlineTint(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return `hsl(${hash % 360} 45% 32%)`
}

export function Avatar({ account, size = 32 }: { account?: Account; size?: number }) {
  const url = avatarUrl(account, size * 2)
  if (url) {
    return (
      <img
        className="avatar"
        src={url}
        alt=""
        style={{ width: size, height: size }}
        onError={(e) => {
          e.currentTarget.style.visibility = 'hidden'
        }}
      />
    )
  }
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        background: account ? offlineTint(account.username) : '#2a2f38',
        display: 'grid',
        placeItems: 'center',
        fontWeight: 700,
        fontSize: size * 0.42,
        color: '#fff'
      }}
    >
      {account ? account.username.slice(0, 1).toUpperCase() : <UserRound size={size * 0.5} />}
    </div>
  )
}

export function AccountChip() {
  const [open, setOpen] = useState(false)
  const accounts = useStore((s) => s.accounts)
  const activeId = useStore((s) => s.activeAccountId)
  const active = accounts.find((a) => a.id === activeId)

  return (
    <>
      <button className="account-chip" onClick={() => setOpen(true)}>
        <Avatar account={active} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="truncate" style={{ fontWeight: 640, fontSize: 13 }}>
            {active?.username ?? 'No account'}
          </div>
          <div className="faint" style={{ fontSize: 11 }}>
            {active
              ? active.kind === 'microsoft'
                ? 'Microsoft'
                : 'Offline'
              : 'Click to add one'}
          </div>
        </div>
      </button>

      <AccountModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export function AccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const accounts = useStore((s) => s.accounts)
  const activeId = useStore((s) => s.activeAccountId)
  const refreshAccounts = useStore((s) => s.refreshAccounts)
  const toast = useStore((s) => s.toast)

  const [offlineName, setOfflineName] = useState('')
  const [busy, setBusy] = useState(false)

  const signIn = async (): Promise<void> => {
    setBusy(true)
    try {
      const account = await api.signInMicrosoft()
      await refreshAccounts()
      if (account) toast('success', `Signed in as ${account.username}`)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const addOffline = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.addOfflineAccount(offlineName)
      setOfflineName('')
      await refreshAccounts()
      toast('success', 'Offline account added')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const select = async (id: string): Promise<void> => {
    await api.setActiveAccount(id)
    await refreshAccounts()
  }

  const remove = async (id: string): Promise<void> => {
    await api.removeAccount(id)
    await refreshAccounts()
  }

  return (
    <Modal open={open} onClose={onClose} title="Accounts" icon={<UserRound size={19} />}>
      <div className="stack sm">
        <AnimatePresence initial={false}>
          {accounts.map((account) => (
            <motion.div
              key={account.id}
              className="row"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              layout
              style={
                account.id === activeId
                  ? { borderColor: 'var(--accent-line)', background: 'var(--accent-soft)' }
                  : undefined
              }
            >
              <Avatar account={account} size={36} />
              <div style={{ minWidth: 0 }}>
                <div className="row-title truncate">{account.username}</div>
                <div className="row-sub hstack sm" style={{ gap: 5 }}>
                  {account.kind === 'microsoft' ? (
                    <>Microsoft · owns the game</>
                  ) : (
                    <>
                      <WifiOff size={11} /> Offline account
                    </>
                  )}
                </div>
              </div>
              <div className="spacer" />
              {account.id === activeId ? (
                <span className="tag accent">
                  <Check size={12} /> Active
                </span>
              ) : (
                <button className="btn sm" onClick={() => select(account.id)}>
                  Use
                </button>
              )}
              <button
                className="btn ghost sm"
                onClick={() => remove(account.id)}
                aria-label={`Remove ${account.username}`}
              >
                <Trash2 size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>

        {accounts.length === 0 && (
          <div className="faint small" style={{ padding: '6px 2px' }}>
            No accounts yet. Add one below to start playing.
          </div>
        )}
      </div>

      <div className="stack sm">
        <div className="field-label">Add a Microsoft account</div>
        <button className="btn primary" onClick={signIn} disabled={busy}>
          <LogIn size={15} /> Sign in with Microsoft
        </button>
        <div className="field-hint">
          Required to play on servers that verify accounts, and to change your skin.
        </div>
      </div>

      <div className="stack sm">
        <div className="field-label">Add an offline account</div>
        <div className="hstack sm">
          <input
            className="input"
            placeholder="Username"
            value={offlineName}
            maxLength={16}
            onChange={(e) => setOfflineName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && offlineName.trim()) addOffline()
            }}
          />
          <button className="btn" onClick={addOffline} disabled={busy || !offlineName.trim()}>
            <Plus size={15} /> Add
          </button>
        </div>
        <div className="field-hint">
          Works for singleplayer, LAN and servers running in offline mode. Servers with
          authentication enabled will reject it, and skins can’t be uploaded to Mojang.
        </div>
      </div>
    </Modal>
  )
}
