import type {
  Account,
  Instance,
  ModFile,
  ModProject,
  ModVersion,
  ProjectType,
  SearchQuery,
  SearchResult,
  Settings,
  SkinEntry,
  VersionSummary
} from '../../shared/types'

/**
 * Thin typed facade over the preload bridge. Everything the UI touches goes
 * through here so the `unknown`-typed IPC surface is cast in exactly one place.
 */
const raw = window.brick

export interface JavaRuntime {
  path: string
  major: number
  vendor: string
  home: string
  source: 'bundled' | 'system' | 'custom'
}

export interface WorldEntry {
  folderName: string
  name: string
  sizeBytes: number
  lastPlayed?: number
  icon?: string
}

export interface ContentUpdate {
  fileName: string
  current?: string
  latest: ModVersion
}

export interface ServerEntry {
  name: string
  address: string
  icon?: string
  acceptTextures?: number
}

export interface ServerStatus {
  online: boolean
  motd?: string
  playersOnline?: number
  playersMax?: number
  version?: string
  protocol?: number
  latencyMs?: number
  favicon?: string
  error?: string
}

export interface ModProblem {
  kind: 'missing' | 'replace' | 'remove' | 'incompatible'
  modId: string
  versionHint?: string
  requiredBy?: string
  raw: string
}

export interface ProposedFix {
  action: 'install' | 'replace' | 'remove'
  modId: string
  reason: string
  resolved: boolean
  project?: { id: string; title: string; iconUrl?: string; source: 'modrinth' }
  version?: ModVersion
  targetFileName?: string
  note?: string
}

export type ContentType = Exclude<ProjectType, 'modpack'>

export const api = {
  info: () => raw.app.info() as Promise<{ paths: Record<string, string>; platform: string; arch: string }>,
  openPath: raw.app.openPath,
  openExternal: raw.app.openExternal,
  pickFiles: raw.app.pickFiles,
  readImage: raw.app.readImage,

  getSettings: () => raw.settings.get() as Promise<Settings>,
  setSettings: (patch: Partial<Settings>) => raw.settings.set(patch) as Promise<Settings>,

  listAccounts: () =>
    raw.accounts.list() as Promise<{ accounts: Account[]; activeId: string | null }>,
  signInMicrosoft: () => raw.accounts.signInMicrosoft() as Promise<Account | null>,
  addOfflineAccount: (username: string) => raw.accounts.addOffline(username) as Promise<Account[]>,
  removeAccount: (id: string) => raw.accounts.remove(id) as Promise<Account[]>,
  setActiveAccount: (id: string) => raw.accounts.setActive(id) as Promise<string | null>,
  refreshAccount: (id: string) => raw.accounts.refresh(id) as Promise<Account[]>,

  listVersions: (includeSnapshots: boolean) =>
    raw.versions.list(includeSnapshots) as Promise<VersionSummary[]>,
  latestVersions: () => raw.versions.latest() as Promise<{ release: string; snapshot: string }>,
  loaderBuilds: (loader: string, mcVersion: string) =>
    raw.versions.loaderBuilds(loader, mcVersion) as Promise<string[]>,

  detectJava: () => raw.java.detect() as Promise<JavaRuntime[]>,
  installJava: (major: number) => raw.java.install(major),

  listInstances: () => raw.instances.list() as Promise<Instance[]>,
  getInstance: (id: string) => raw.instances.get(id) as Promise<Instance | undefined>,
  createInstance: (args: {
    name: string
    mcVersion: string
    loader: string
    loaderVersion?: string
    icon?: string
    memoryMb?: number
    group?: string
  }) => raw.instances.create(args) as Promise<Instance>,
  updateInstance: (id: string, patch: Partial<Instance>) =>
    raw.instances.update(id, patch) as Promise<Instance[]>,
  deleteInstance: (id: string) => raw.instances.remove(id) as Promise<Instance[]>,
  duplicateInstance: (id: string, name: string) =>
    raw.instances.duplicate(id, name) as Promise<Instance[]>,
  openInstanceFolder: raw.instances.openFolder,
  repairInstance: raw.instances.repair,

  launch: (instanceId: string, accountId?: string) =>
    raw.game.launch(instanceId, accountId) as Promise<{ pid: number; logPath: string }>,
  stopGame: raw.game.stop,
  runningGames: raw.game.running,

  listContent: (instanceId: string, type: ContentType) =>
    raw.content.list(instanceId, type) as Promise<ModFile[]>,
  installContent: (args: {
    instanceId: string
    type: ContentType
    version: ModVersion
    projectTitle: string
    iconUrl?: string
  }) => raw.content.install(args) as Promise<ModFile[]>,
  setContentEnabled: (instanceId: string, type: ContentType, fileName: string, enabled: boolean) =>
    raw.content.setEnabled(instanceId, type, fileName, enabled) as Promise<ModFile[]>,
  removeContent: (instanceId: string, type: ContentType, fileName: string) =>
    raw.content.remove(instanceId, type, fileName) as Promise<ModFile[]>,
  identifyContent: (instanceId: string, type: ContentType) =>
    raw.content.identify(instanceId, type) as Promise<ModFile[]>,
  importContent: (instanceId: string, type: ContentType, filePaths: string[]) =>
    raw.content.import(instanceId, type, filePaths) as Promise<{
      content: ModFile[]
      imported: number
      skipped: string[]
    }>,
  checkContentUpdates: (instanceId: string, type: ContentType, gameVersion: string, loader: string) =>
    raw.content.checkUpdates(instanceId, type, gameVersion, loader) as Promise<ContentUpdate[]>,

  listWorlds: (instanceId: string) => raw.worlds.list(instanceId) as Promise<WorldEntry[]>,
  importWorld: (instanceId: string, sourcePath: string) =>
    raw.worlds.import(instanceId, sourcePath) as Promise<WorldEntry[]>,
  deleteWorld: (instanceId: string, folderName: string) =>
    raw.worlds.remove(instanceId, folderName) as Promise<WorldEntry[]>,

  search: (query: SearchQuery) => raw.browse.search(query) as Promise<SearchResult>,
  projectVersions: (source: string, projectId: string, gameVersion?: string, loader?: string) =>
    raw.browse.versions(source, projectId, gameVersion, loader) as Promise<ModVersion[]>,
  project: (source: string, projectId: string) =>
    raw.browse.project(source, projectId) as Promise<ModProject & { body: string }>,
  categories: () => raw.browse.categories() as Promise<{ name: string; projectType: string }[]>,
  curseforgeReady: raw.browse.curseforgeReady,

  installModpack: (args: { name: string; packUrl: string; packSha1?: string; icon?: string }) =>
    raw.modpack.install(args) as Promise<Instance>,

  listServers: (instanceId: string) => raw.servers.list(instanceId) as Promise<ServerEntry[]>,
  addServer: (instanceId: string, entry: { name: string; address: string }) =>
    raw.servers.add(instanceId, entry) as Promise<ServerEntry[]>,
  updateServer: (instanceId: string, index: number, patch: Partial<ServerEntry>) =>
    raw.servers.update(instanceId, index, patch) as Promise<ServerEntry[]>,
  removeServer: (instanceId: string, index: number) =>
    raw.servers.remove(instanceId, index) as Promise<ServerEntry[]>,
  moveServer: (instanceId: string, index: number, delta: number) =>
    raw.servers.move(instanceId, index, delta) as Promise<ServerEntry[]>,
  pingServer: (address: string) => raw.servers.ping(address) as Promise<ServerStatus>,

  diagnose: (instanceId: string, logText: string) =>
    raw.diagnose.analyze(instanceId, logText) as Promise<{
      problems: ModProblem[]
      fixes: ProposedFix[]
    }>,
  applyFixes: (instanceId: string, fixes: ProposedFix[]) =>
    raw.diagnose.apply(instanceId, fixes) as Promise<{
      applied: string[]
      failed: string[]
      content: ModFile[]
    }>,

  listSkins: () => raw.skins.list() as Promise<SkinEntry[]>,
  addSkinFile: (filePath: string, name: string, variant: 'classic' | 'slim') =>
    raw.skins.addFile(filePath, name, variant) as Promise<SkinEntry[]>,
  addSkinUrl: (url: string, name: string, variant: 'classic' | 'slim') =>
    raw.skins.addUrl(url, name, variant) as Promise<SkinEntry[]>,
  removeSkin: (id: string) => raw.skins.remove(id) as Promise<SkinEntry[]>,
  renameSkin: (id: string, name: string) => raw.skins.rename(id, name) as Promise<SkinEntry[]>,
  skinDataUrl: raw.skins.dataUrl,
  applySkin: raw.skins.apply,
  resetSkin: raw.skins.reset,
  setCape: raw.skins.setCape,

  openLogs: raw.logs.open,
  openInstanceLogs: raw.logs.openInstance,

  events: raw.events
}
