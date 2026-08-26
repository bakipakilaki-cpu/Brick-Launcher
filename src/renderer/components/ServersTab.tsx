import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Plus,
  RefreshCw,
  Server,
  Signal,
  Trash2,
  Users
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Empty, Modal, Spinner } from './ui'
import { api, type ServerEntry, type ServerStatus } from '../lib/api'
import { useStore } from '../store/useStore'
import type { Instance } from '../../shared/types'

/**
 * Reads and writes the instance's real servers.dat, so anything added here
 * appears on Minecraft's own multiplayer screen (and anything added in game
 * shows up here).
 */
export function ServersTab({ instance }: { instance: Instance }) {
  const toast = useStore((s) => s.toast)

  const [servers, setServers] = useState<ServerEntry[] | null>(null)
  const [status, setStatus] = useState<Record<string, ServerStatus>>({})
  const [pinging, setPinging] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      setServers(await api.listServers(instance.id))
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
      setServers([])
    }
  }, [instance.id, toast])

  useEffect(() => {
    load()
  }, [load])

  const refreshStatus = useCallback(
    async (list: ServerEntry[]): Promise<void> => {
      setPinging(true)
      // Ping in parallel — each has its own timeout, so one dead host does not
      // hold up the rest of the list.
      const results = await Promise.all(
        list.map(async (s) => [s.address, await api.pingServer(s.address)] as const)
      )
      setStatus(Object.fromEntries(results))
      setPinging(false)
    },
    []
  )

  useEffect(() => {
    if (servers && servers.length) refreshStatus(servers)
  }, [servers, refreshStatus])

  const add = async (): Promise<void> => {
    setBusy(true)
    try {
      setServers(await api.addServer(instance.id, { name, address }))
      setName('')
      setAddress('')
      setAdding(false)
      toast('success', 'Server added')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (index: number): Promise<void> => {
    setServers(await api.removeServer(instance.id, index))
  }

  const move = async (index: number, delta: number): Promise<void> => {
    setServers(await api.moveServer(instance.id, index, delta))
  }

  return (
    <div className="stack md">
      <div className="hstack md" style={{ flexWrap: 'wrap' }}>
        <div className="faint small">
          Saved to this instance’s <span className="mono">servers.dat</span> — the same list
          Minecraft shows under Multiplayer.
        </div>
        <div className="spacer" />
        <button
          className="btn"
          onClick={() => servers && refreshStatus(servers)}
          disabled={pinging || !servers?.length}
        >
          {pinging ? <Spinner size={14} /> : <RefreshCw size={15} />} Refresh status
        </button>
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Plus size={15} /> Add server
        </button>
      </div>

      {servers === null ? (
        <div className="stack sm">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="skeleton" style={{ height: 62 }} />
          ))}
        </div>
      ) : servers.length === 0 ? (
        <Empty
          icon={<Server size={26} />}
          title="No servers yet"
          hint="Add a server address and it will be waiting for you on the multiplayer screen when you launch."
          action={
            <button className="btn primary" onClick={() => setAdding(true)}>
              <Plus size={15} /> Add your first server
            </button>
          }
        />
      ) : (
        <div>
          <AnimatePresence initial={false}>
            {servers.map((server, index) => {
              const info = status[server.address]
              return (
                <motion.div
                  key={`${server.address}-${index}`}
                  className="row"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  layout
                >
                  {info?.favicon ? (
                    <img
                      src={info.favicon}
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
                      <Server size={18} style={{ color: 'var(--ink-faint)' }} />
                    </div>
                  )}

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="hstack sm" style={{ gap: 8 }}>
                      <span className="row-title truncate">{server.name}</span>
                      {info && (
                        <span className={`tag ${info.online ? 'accent' : 'danger'}`}>
                          {info.online ? 'Online' : info.error ?? 'Offline'}
                        </span>
                      )}
                    </div>
                    <div className="row-sub truncate mono">{server.address}</div>
                    {info?.online && (
                      <div className="row-sub hstack sm" style={{ gap: 12, marginTop: 2 }}>
                        <span className="stat">
                          <Users size={11} /> {info.playersOnline ?? '?'}/{info.playersMax ?? '?'}
                        </span>
                        {info.version && <span>{info.version}</span>}
                        {info.latencyMs !== undefined && (
                          <span className="stat">
                            <Signal size={11} /> {info.latencyMs} ms
                          </span>
                        )}
                      </div>
                    )}
                    {info?.online && info.motd && (
                      <div className="row-sub truncate" style={{ marginTop: 2, opacity: 0.75 }}>
                        {info.motd.split('\n')[0]}
                      </div>
                    )}
                  </div>

                  <button
                    className="btn ghost sm"
                    onClick={() => navigator.clipboard.writeText(server.address)}
                    title="Copy address"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    title="Move up"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() => move(index, 1)}
                    disabled={index === servers.length - 1}
                    title="Move down"
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button className="btn ghost sm" onClick={() => remove(index)} title="Remove">
                    <Trash2 size={14} />
                  </button>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add server"
        icon={<Server size={19} style={{ color: 'var(--accent)' }} />}
        footer={
          <>
            <button className="btn ghost" onClick={() => setAdding(false)} disabled={busy}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={add}
              disabled={busy || !name.trim() || !address.trim()}
            >
              {busy ? <Spinner size={14} /> : <Plus size={15} />} Add
            </button>
          </>
        }
      >
        <div className="field">
          <span className="field-label">Server name</span>
          <input
            className="input"
            placeholder="My favourite server"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <span className="field-label">Server address</span>
          <input
            className="input mono"
            placeholder="play.example.com  or  1.2.3.4:25565"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim() && address.trim()) add()
            }}
          />
          <span className="field-hint">
            Port defaults to 25565 if you leave it off. Make sure the server runs{' '}
            {instance.mcVersion} — and if you use an offline account, that it allows offline mode.
          </span>
        </div>
      </Modal>
    </div>
  )
}
