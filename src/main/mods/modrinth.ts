import { getJson, getJsonCached } from '../net/download.js'
import type {
  ModProject,
  ModVersion,
  ProjectType,
  SearchQuery,
  SearchResult
} from '../../shared/types.js'

const API = 'https://api.modrinth.com/v2'

interface MrHit {
  project_id: string
  slug: string
  title: string
  description: string
  icon_url?: string
  downloads: number
  follows: number
  author: string
  categories: string[]
  versions: string[]
  project_type: string
  date_modified: string
  client_side: string
  server_side: string
  display_categories?: string[]
}

const LOADER_NAMES = new Set([
  'fabric',
  'forge',
  'neoforge',
  'quilt',
  'liteloader',
  'modloader',
  'rift',
  'bukkit',
  'paper',
  'iris',
  'optifine',
  'canvas',
  'vanilla',
  'minecraft'
])

function toProject(hit: MrHit): ModProject {
  return {
    id: hit.project_id,
    source: 'modrinth',
    slug: hit.slug,
    title: hit.title,
    description: hit.description,
    iconUrl: hit.icon_url || undefined,
    downloads: hit.downloads,
    follows: hit.follows,
    author: hit.author,
    // Modrinth mixes loaders into the category list; split them back out so the
    // UI can show real categories as tags.
    categories: (hit.display_categories ?? hit.categories).filter((c) => !LOADER_NAMES.has(c)),
    loaders: hit.categories.filter((c) => LOADER_NAMES.has(c)),
    gameVersions: hit.versions,
    projectType: (hit.project_type as ProjectType) ?? 'mod',
    updated: hit.date_modified,
    clientSide: hit.client_side,
    serverSide: hit.server_side
  }
}

export async function search(query: SearchQuery): Promise<SearchResult> {
  const facets: string[][] = [[`project_type:${query.projectType}`]]

  // Mods and modpacks are tagged by loader; resource packs and shaders are not,
  // so filtering those by fabric/forge would return nothing at all.
  const loaderFilterable = query.projectType === 'mod' || query.projectType === 'modpack'
  if (query.loader && query.loader !== 'vanilla' && loaderFilterable) {
    facets.push([`categories:${query.loader}`])
  }
  if (query.gameVersion) facets.push([`versions:${query.gameVersion}`])
  for (const category of query.categories ?? []) facets.push([`categories:${category}`])

  const params = new URLSearchParams({
    query: query.query,
    facets: JSON.stringify(facets),
    index: query.sort ?? 'relevance',
    offset: String(query.offset ?? 0),
    limit: String(query.limit ?? 20)
  })

  const data = await getJson<{ hits: MrHit[]; total_hits: number; offset: number }>(
    `${API}/search?${params}`
  )
  return {
    hits: data.hits.map(toProject),
    total: data.total_hits,
    offset: data.offset
  }
}

interface MrVersion {
  id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  version_type: 'release' | 'beta' | 'alpha'
  date_published: string
  downloads: number
  files: {
    url: string
    filename: string
    size: number
    primary: boolean
    hashes: { sha1?: string }
  }[]
  dependencies: { project_id: string; version_id?: string; dependency_type: string }[]
}

function toVersion(v: MrVersion): ModVersion | null {
  const file = v.files.find((f) => f.primary) ?? v.files[0]
  if (!file) return null
  return {
    id: v.id,
    source: 'modrinth',
    name: v.name,
    versionNumber: v.version_number,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    releaseType: v.version_type,
    datePublished: v.date_published,
    downloads: v.downloads,
    fileName: file.filename,
    fileUrl: file.url,
    fileSize: file.size,
    sha1: file.hashes.sha1,
    dependencies: v.dependencies.map((d) => ({
      projectId: d.project_id,
      versionId: d.version_id ?? undefined,
      type: d.dependency_type
    }))
  }
}

export async function listVersions(
  projectId: string,
  gameVersion?: string,
  loader?: string
): Promise<ModVersion[]> {
  const params = new URLSearchParams()
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]))
  if (loader && loader !== 'vanilla') params.set('loaders', JSON.stringify([loader]))
  const suffix = params.toString() ? `?${params}` : ''
  const versions = await getJson<MrVersion[]>(`${API}/project/${projectId}/version${suffix}`)
  return versions.map(toVersion).filter((v): v is ModVersion => v !== null)
}

export async function getProject(idOrSlug: string): Promise<ModProject & { body: string }> {
  const p = await getJson<
    MrHit & { id: string; body: string; game_versions: string[]; loaders: string[] }
  >(`${API}/project/${idOrSlug}`)
  return {
    ...toProject({ ...p, project_id: p.id, author: '', follows: p.follows ?? 0 }),
    gameVersions: p.game_versions ?? [],
    loaders: p.loaders ?? [],
    body: p.body ?? ''
  }
}

export async function listCategories(): Promise<{ name: string; projectType: string }[]> {
  const cats = await getJsonCached<{ name: string; project_type: string }[]>(
    `${API}/tag/category`,
    24 * 60 * 60 * 1000
  )
  return cats.map((c) => ({ name: c.name, projectType: c.project_type }))
}

/** Look up installed jars by hash so we can tell what a mods folder contains. */
export async function versionsFromHashes(
  hashes: string[]
): Promise<Record<string, ModVersion & { projectId: string }>> {
  if (!hashes.length) return {}
  const data = await getJson<Record<string, MrVersion & { project_id: string }>>(
    `${API}/version_files`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes, algorithm: 'sha1' })
    }
  )
  const out: Record<string, ModVersion & { projectId: string }> = {}
  for (const [hash, version] of Object.entries(data)) {
    const mapped = toVersion(version)
    if (mapped) out[hash] = { ...mapped, projectId: version.project_id }
  }
  return out
}
