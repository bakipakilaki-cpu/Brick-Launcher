/** Types shared between the main process, preload bridge, and renderer. */

export type LoaderId = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'

export const LOADERS: { id: LoaderId; label: string; blurb: string }[] = [
  { id: 'vanilla', label: 'Vanilla', blurb: 'Plain Minecraft, no mods' },
  { id: 'fabric', label: 'Fabric', blurb: 'Lightweight and fast-updating' },
  { id: 'quilt', label: 'Quilt', blurb: 'Fabric-compatible community fork' },
  { id: 'forge', label: 'Forge', blurb: 'The classic, biggest mod library' },
  { id: 'neoforge', label: 'NeoForge', blurb: 'Modern Forge successor (1.20.1+)' }
]

/* ------------------------------- accounts ------------------------------- */

export type AccountKind = 'microsoft' | 'offline'

export interface Account {
  id: string
  kind: AccountKind
  username: string
  uuid: string
  /** Only present for microsoft accounts; never rendered. */
  accessToken?: string
  refreshToken?: string
  /** Epoch ms when accessToken stops being valid. */
  expiresAt?: number
  xuid?: string
  skinUrl?: string
  capes?: { id: string; alias: string; url: string; active: boolean }[]
}

/* ------------------------------- instances ------------------------------- */

export interface Instance {
  id: string
  name: string
  /** Minecraft version, e.g. "1.21.4". */
  mcVersion: string
  loader: LoaderId
  /** Resolved loader version; undefined for vanilla. */
  loaderVersion?: string
  /** Version id actually launched (e.g. "fabric-loader-0.16.9-1.21.4"). */
  versionId: string
  icon?: string
  createdAt: number
  lastPlayed?: number
  totalPlaySeconds: number
  memoryMb: number
  javaPath?: string
  jvmArgs?: string
  /** Window size overrides. */
  width?: number
  height?: number
  installed: boolean
  group?: string
}

export interface ModFile {
  /** File name on disk inside the instance's mods folder. */
  fileName: string
  name: string
  source: 'modrinth' | 'curseforge' | 'local'
  projectId?: string
  versionId?: string
  version?: string
  iconUrl?: string
  enabled: boolean
  sizeBytes: number
}

/* --------------------------------- mods --------------------------------- */

export type ProjectType = 'mod' | 'modpack' | 'resourcepack' | 'shader' | 'datapack'

/** Normalised search result — Modrinth and CurseForge both map onto this. */
export interface ModProject {
  id: string
  source: 'modrinth' | 'curseforge'
  slug: string
  title: string
  description: string
  iconUrl?: string
  downloads: number
  follows: number
  author?: string
  categories: string[]
  loaders: string[]
  gameVersions: string[]
  projectType: ProjectType
  updated?: string
  clientSide?: string
  serverSide?: string
}

export interface ModVersion {
  id: string
  source: 'modrinth' | 'curseforge'
  name: string
  versionNumber: string
  gameVersions: string[]
  loaders: string[]
  releaseType: 'release' | 'beta' | 'alpha'
  datePublished: string
  downloads: number
  fileName: string
  fileUrl: string
  fileSize: number
  sha1?: string
  dependencies: { projectId: string; versionId?: string; type: string }[]
}

export interface SearchQuery {
  query: string
  source: 'modrinth' | 'curseforge'
  projectType: ProjectType
  loader?: LoaderId
  gameVersion?: string
  categories?: string[]
  sort?: string
  offset?: number
  limit?: number
}

export interface SearchResult {
  hits: ModProject[]
  total: number
  offset: number
}

/* ------------------------------- progress -------------------------------- */

export interface TaskProgress {
  id: string
  label: string
  detail?: string
  /** 0..1, or -1 for indeterminate. */
  progress: number
  done: boolean
  error?: string
}

export type GameStatus =
  | { state: 'idle' }
  | { state: 'preparing'; instanceId: string }
  | { state: 'running'; instanceId: string; pid: number }
  | { state: 'crashed'; instanceId: string; code: number }

/* ------------------------------- settings -------------------------------- */

export interface Settings {
  gameDir: string
  defaultMemoryMb: number
  javaPath: string
  jvmArgs: string
  /** Azure AD application (client) id used for Microsoft sign-in. */
  msClientId: string
  curseforgeApiKey: string
  closeLauncherOnLaunch: boolean
  showSnapshots: boolean
  concurrentDownloads: number
  accentColor: string
  animationsEnabled: boolean
}

export interface VersionSummary {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
  releaseTime: string
}

export interface SkinEntry {
  id: string
  name: string
  /** Absolute path to the stored PNG. */
  path: string
  variant: 'classic' | 'slim'
  addedAt: number
}
