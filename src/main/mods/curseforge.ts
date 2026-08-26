import { store } from '../store.js'
import type {
  ModProject,
  ModVersion,
  ProjectType,
  SearchQuery,
  SearchResult
} from '../../shared/types.js'

const API = 'https://api.curseforge.com/v1'
const GAME_ID = 432

/** CurseForge class ids for the content types we surface. */
const CLASS_IDS: Record<ProjectType, number> = {
  mod: 6,
  modpack: 4471,
  resourcepack: 12,
  shader: 6552,
  datapack: 6945
}

const CLASS_TO_TYPE: Record<number, ProjectType> = Object.fromEntries(
  Object.entries(CLASS_IDS).map(([type, id]) => [id, type as ProjectType])
) as Record<number, ProjectType>

/** modLoaderType values used by the search endpoint. */
const LOADER_IDS: Record<string, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6
}
const LOADER_NAME_BY_ID: Record<number, string> = {
  1: 'forge',
  2: 'cauldron',
  3: 'liteloader',
  4: 'fabric',
  5: 'quilt',
  6: 'neoforge'
}

export class CurseForgeKeyMissing extends Error {
  constructor() {
    super('No CurseForge API key configured.')
    this.name = 'CurseForgeKeyMissing'
  }
}

function headers(): Record<string, string> {
  const key = store.get('settings').curseforgeApiKey.trim()
  if (!key) throw new CurseForgeKeyMissing()
  return { 'x-api-key': key, Accept: 'application/json' }
}

/**
 * CurseForge sits behind CloudFront, which answers bursts with a 403 that is
 * indistinguishable from a bad key. Retry those a few times before believing
 * it, so fast scrolling does not look like an auth failure.
 */
async function cfJson<T>(url: string): Promise<T> {
  let lastStatus = 0
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: headers() })
    if (res.ok) return (await res.json()) as T
    lastStatus = res.status
    if (res.status !== 403 && res.status !== 429) break
    await new Promise((r) => setTimeout(r, 600 * 2 ** attempt))
  }
  if (lastStatus === 403 || lastStatus === 429) {
    throw new Error(
      'CurseForge is rate-limiting or rejecting this request (HTTP 403). ' +
        'Wait a moment and retry — if it persists, check your API key in Settings → Integrations.'
    )
  }
  throw new Error(`CurseForge request failed (HTTP ${lastStatus}).`)
}

export function hasApiKey(): boolean {
  return store.get('settings').curseforgeApiKey.trim().length > 0
}

interface CfMod {
  id: number
  name: string
  slug: string
  summary: string
  classId: number
  downloadCount: number
  thumbsUpCount?: number
  logo?: { thumbnailUrl: string }
  authors: { name: string }[]
  categories: { name: string; classId?: number }[]
  dateModified: string
  latestFilesIndexes?: { gameVersion: string; modLoader?: number }[]
}

function toProject(mod: CfMod): ModProject {
  const indexes = mod.latestFilesIndexes ?? []
  return {
    id: String(mod.id),
    source: 'curseforge',
    slug: mod.slug,
    title: mod.name,
    description: mod.summary,
    iconUrl: mod.logo?.thumbnailUrl,
    downloads: mod.downloadCount,
    follows: mod.thumbsUpCount ?? 0,
    author: mod.authors?.[0]?.name,
    categories: mod.categories?.map((c) => c.name) ?? [],
    loaders: [
      ...new Set(
        indexes
          .map((i) => (i.modLoader !== undefined ? LOADER_NAME_BY_ID[i.modLoader] : undefined))
          .filter((l): l is string => Boolean(l))
      )
    ],
    gameVersions: [...new Set(indexes.map((i) => i.gameVersion))],
    projectType: CLASS_TO_TYPE[mod.classId] ?? 'mod',
    updated: mod.dateModified
  }
}

export async function search(query: SearchQuery): Promise<SearchResult> {
  const params = new URLSearchParams({
    gameId: String(GAME_ID),
    classId: String(CLASS_IDS[query.projectType]),
    searchFilter: query.query,
    sortField: query.sort === 'downloads' ? '6' : query.sort === 'updated' ? '3' : '2',
    sortOrder: 'desc',
    index: String(query.offset ?? 0),
    pageSize: String(Math.min(50, query.limit ?? 20))
  })
  if (query.gameVersion) params.set('gameVersion', query.gameVersion)
  // Loader filtering only makes sense for mods and modpacks.
  const loaderFilterable = query.projectType === 'mod' || query.projectType === 'modpack'
  if (query.loader && LOADER_IDS[query.loader] && loaderFilterable) {
    params.set('modLoaderType', String(LOADER_IDS[query.loader]))
  }

  const data = await cfJson<{
    data: CfMod[]
    pagination: { totalCount: number; index: number }
  }>(`${API}/mods/search?${params}`)

  return {
    hits: data.data.map(toProject),
    // CurseForge caps deep paging at 10 000 results.
    total: Math.min(data.pagination.totalCount, 10_000),
    offset: data.pagination.index
  }
}

interface CfFile {
  id: number
  displayName: string
  fileName: string
  releaseType: number
  fileDate: string
  fileLength: number
  downloadCount: number
  downloadUrl: string | null
  gameVersions: string[]
  hashes: { value: string; algo: number }[]
  dependencies: { modId: number; relationType: number }[]
  sortableGameVersions?: { gameVersionName: string }[]
}

const RELEASE_TYPES: Record<number, ModVersion['releaseType']> = {
  1: 'release',
  2: 'beta',
  3: 'alpha'
}

/** relationType 3 is "required dependency", 2 is optional. */
const RELATION_TYPES: Record<number, string> = { 2: 'optional', 3: 'required', 4: 'tool', 5: 'incompatible' }

function toVersion(file: CfFile, modId: string): ModVersion {
  const loaderNames = new Set(Object.keys(LOADER_IDS))
  return {
    id: String(file.id),
    source: 'curseforge',
    name: file.displayName,
    versionNumber: file.displayName,
    gameVersions: file.gameVersions.filter((v) => !loaderNames.has(v.toLowerCase())),
    loaders: file.gameVersions.filter((v) => loaderNames.has(v.toLowerCase())).map((v) => v.toLowerCase()),
    releaseType: RELEASE_TYPES[file.releaseType] ?? 'release',
    datePublished: file.fileDate,
    downloads: file.downloadCount,
    fileName: file.fileName,
    // Some authors disable third-party downloads; the CDN path still resolves.
    fileUrl: file.downloadUrl ?? fallbackUrl(file),
    fileSize: file.fileLength,
    sha1: file.hashes?.find((h) => h.algo === 1)?.value,
    dependencies: (file.dependencies ?? []).map((d) => ({
      projectId: String(d.modId),
      type: RELATION_TYPES[d.relationType] ?? 'optional'
    }))
  }
}

function fallbackUrl(file: CfFile): string {
  const id = String(file.id)
  return `https://mediafilez.forgecdn.net/files/${id.slice(0, 4)}/${Number(id.slice(4))}/${file.fileName}`
}

export async function listVersions(
  modId: string,
  gameVersion?: string,
  loader?: string
): Promise<ModVersion[]> {
  const params = new URLSearchParams({ pageSize: '50' })
  if (gameVersion) params.set('gameVersion', gameVersion)
  if (loader && LOADER_IDS[loader]) params.set('modLoaderType', String(LOADER_IDS[loader]))

  const data = await cfJson<{ data: CfFile[] }>(`${API}/mods/${modId}/files?${params}`)
  return data.data.map((f) => toVersion(f, modId))
}

export async function getProject(modId: string): Promise<ModProject & { body: string }> {
  const [{ data: mod }, description] = await Promise.all([
    cfJson<{ data: CfMod }>(`${API}/mods/${modId}`),
    cfJson<{ data: string }>(`${API}/mods/${modId}/description`)
      .then((r) => r.data)
      .catch(() => '')
  ])
  return { ...toProject(mod), body: description }
}
