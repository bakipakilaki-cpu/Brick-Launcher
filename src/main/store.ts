import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { paths } from './paths.js'
import type { Account, Instance, Settings, SkinEntry } from '../shared/types.js'

interface Schema {
  settings: Settings
  accounts: Account[]
  activeAccountId: string | null
  instances: Instance[]
  skins: SkinEntry[]
}

function defaults(): Schema {
  return {
    settings: {
      gameDir: paths.instances,
      defaultMemoryMb: 4096,
      javaPath: '',
      jvmArgs:
        '-XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 ' +
        '-XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M',
      msClientId: '',
      // Ships with a working key so CurseForge browsing needs no setup. Users
      // can replace it with their own in Settings → Integrations.
      curseforgeApiKey: '$2a$10$MhYNlP.E55kvistq8UCbrupVXy0SB2MXWhJevk8noDTxRv/PRvW9G',
      closeLauncherOnLaunch: false,
      showSnapshots: false,
      concurrentDownloads: 16,
      accentColor: '#1bd96a',
      animationsEnabled: true
    },
    accounts: [],
    activeAccountId: null,
    instances: [],
    skins: []
  }
}

/**
 * Small JSON-file store. Writes go through a temp file + rename so a crash
 * mid-write can never leave a truncated config behind.
 */
class Store {
  private file = join(paths.root, 'config.json')
  private data: Schema = defaults()

  load(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    if (!existsSync(this.file)) {
      this.persist()
      return
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Schema>
      const base = defaults()
      this.data = {
        ...base,
        ...parsed,
        // Merge settings key-by-key so new options added in an update appear
        // with their default instead of being undefined.
        settings: { ...base.settings, ...(parsed.settings ?? {}) }
      }
    } catch {
      this.data = defaults()
    }
  }

  private persist(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.file)
  }

  get<K extends keyof Schema>(key: K): Schema[K] {
    return this.data[key]
  }

  set<K extends keyof Schema>(key: K, value: Schema[K]): void {
    this.data[key] = value
    this.persist()
  }

  patchSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.persist()
    return this.data.settings
  }
}

export const store = new Store()
