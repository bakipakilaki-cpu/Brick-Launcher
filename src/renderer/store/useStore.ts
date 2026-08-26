import { create } from 'zustand'
import { api } from '../lib/api'
import type {
  Account,
  GameStatus,
  Instance,
  Settings,
  SkinEntry,
  TaskProgress,
  VersionSummary
} from '../../shared/types'

interface Toast {
  id: string
  kind: 'info' | 'error' | 'success'
  message: string
}

interface State {
  ready: boolean
  settings: Settings | null
  accounts: Account[]
  activeAccountId: string | null
  instances: Instance[]
  versions: VersionSummary[]
  skins: SkinEntry[]
  tasks: TaskProgress[]
  gameStatus: GameStatus
  runningIds: string[]
  logs: Record<string, string[]>
  toasts: Toast[]

  bootstrap: () => Promise<void>
  refreshAccounts: () => Promise<void>
  refreshInstances: () => Promise<void>
  refreshSkins: () => Promise<void>
  refreshVersions: () => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  toast: (kind: Toast['kind'], message: string) => void
  dismissToast: (id: string) => void
  appendLog: (instanceId: string, line: string) => void
  clearLogs: (instanceId: string) => void
}

/** Cap retained log lines so a long session cannot grow memory without bound. */
const MAX_LOG_LINES = 2000

/**
 * Guards against a second bootstrap registering a duplicate set of IPC
 * listeners — StrictMode runs effects twice in development.
 */
let bootstrapped = false

export const useStore = create<State>((set, get) => ({
  ready: false,
  settings: null,
  accounts: [],
  activeAccountId: null,
  instances: [],
  versions: [],
  skins: [],
  tasks: [],
  gameStatus: { state: 'idle' },
  runningIds: [],
  logs: {},
  toasts: [],

  bootstrap: async () => {
    if (bootstrapped) return
    bootstrapped = true

    const [settings, accountData, instances, skins, running] = await Promise.all([
      api.getSettings(),
      api.listAccounts(),
      api.listInstances(),
      api.listSkins(),
      api.runningGames()
    ])

    set({
      settings,
      accounts: accountData.accounts,
      activeAccountId: accountData.activeId,
      instances,
      skins,
      runningIds: running,
      ready: true
    })

    // Version list is the slowest call and nothing blocks on it.
    get().refreshVersions()

    api.events.onTask((payload) => {
      const task = payload as unknown as TaskProgress
      set((state) => {
        const rest = state.tasks.filter((t) => t.id !== task.id)
        return { tasks: task.done && !task.error ? rest : [...rest, task] }
      })
      if (task.done && !task.error) {
        // Let the completed bar render at 100% for a beat before it leaves.
        setTimeout(
          () => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== task.id) })),
          900
        )
      }
      if (task.error) get().toast('error', task.error)
    })

    api.events.onGameStatus((payload) => {
      const status = payload as unknown as GameStatus
      set({ gameStatus: status })
      api.runningGames().then((ids) => set({ runningIds: ids }))
      if (status.state === 'crashed') {
        get().toast('error', `Minecraft exited unexpectedly (code ${status.code}). Check the logs.`)
      }
    })

    api.events.onGameLog((payload) => {
      const { instanceId, line } = payload as unknown as { instanceId: string; line: string }
      get().appendLog(instanceId, line)
    })

    api.events.onInstancesChanged((payload) => {
      set({ instances: payload as unknown as Instance[] })
    })
  },

  refreshAccounts: async () => {
    const data = await api.listAccounts()
    set({ accounts: data.accounts, activeAccountId: data.activeId })
  },

  refreshInstances: async () => set({ instances: await api.listInstances() }),
  refreshSkins: async () => set({ skins: await api.listSkins() }),

  refreshVersions: async () => {
    const settings = get().settings
    try {
      set({ versions: await api.listVersions(settings?.showSnapshots ?? false) })
    } catch {
      get().toast('error', 'Could not reach Mojang’s version list. Check your connection.')
    }
  },

  saveSettings: async (patch) => {
    const settings = await api.setSettings(patch)
    set({ settings })
    if (patch.showSnapshots !== undefined) await get().refreshVersions()
  },

  toast: (kind, message) => {
    const id = crypto.randomUUID()
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 4200)
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  appendLog: (instanceId, line) =>
    set((state) => {
      const existing = state.logs[instanceId] ?? []
      const next = [...existing, line]
      return {
        logs: {
          ...state.logs,
          [instanceId]: next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next
        }
      }
    }),

  clearLogs: (instanceId) =>
    set((state) => ({ logs: { ...state.logs, [instanceId]: [] } }))
}))
