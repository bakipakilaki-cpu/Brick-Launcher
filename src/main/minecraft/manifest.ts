import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from '../paths.js'
import { downloadFile, getJson, getJsonCached } from '../net/download.js'
import type { VersionSummary } from '../../shared/types.js'

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json'

export interface VersionManifest {
  latest: { release: string; snapshot: string }
  versions: {
    id: string
    type: VersionSummary['type']
    url: string
    time: string
    releaseTime: string
    sha1: string
  }[]
}

export interface Rule {
  action: 'allow' | 'disallow'
  os?: { name?: string; version?: string; arch?: string }
  features?: Record<string, boolean>
}

export interface Library {
  name: string
  downloads?: {
    artifact?: { path: string; sha1: string; size: number; url: string }
    classifiers?: Record<string, { path: string; sha1: string; size: number; url: string }>
  }
  url?: string
  natives?: Record<string, string>
  extract?: { exclude?: string[] }
  rules?: Rule[]
}

export interface VersionJson {
  id: string
  inheritsFrom?: string
  type: string
  mainClass: string
  minecraftArguments?: string
  arguments?: {
    game?: (string | { rules: Rule[]; value: string | string[] })[]
    jvm?: (string | { rules: Rule[]; value: string | string[] })[]
  }
  libraries: Library[]
  assetIndex?: { id: string; sha1: string; size: number; totalSize: number; url: string }
  assets?: string
  downloads?: Record<string, { sha1: string; size: number; url: string }>
  javaVersion?: { component: string; majorVersion: number }
  logging?: {
    client?: { argument: string; file: { id: string; sha1: string; size: number; url: string }; type: string }
  }
  releaseTime?: string
}

export async function getVersionManifest(): Promise<VersionManifest> {
  return getJsonCached<VersionManifest>(MANIFEST_URL, 15 * 60 * 1000)
}

export async function listVersions(includeSnapshots: boolean): Promise<VersionSummary[]> {
  const manifest = await getVersionManifest()
  return manifest.versions
    .filter((v) => includeSnapshots || v.type === 'release')
    .map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }))
}

export function versionJsonPath(id: string): string {
  return join(paths.versions, id, `${id}.json`)
}

/** Fetch (and cache on disk) the per-version JSON for a vanilla version id. */
export async function fetchVanillaVersionJson(id: string): Promise<VersionJson> {
  const dest = versionJsonPath(id)
  if (existsSync(dest)) {
    return JSON.parse(await readFile(dest, 'utf8')) as VersionJson
  }
  const manifest = await getVersionManifest()
  const entry = manifest.versions.find((v) => v.id === id)
  if (!entry) throw new Error(`Unknown Minecraft version: ${id}`)
  const json = await getJson<VersionJson>(entry.url)
  await mkdir(join(paths.versions, id), { recursive: true })
  await writeFile(dest, JSON.stringify(json, null, 2))
  return json
}

/** Read a version json from disk (vanilla or loader-generated). */
export async function readVersionJson(id: string): Promise<VersionJson> {
  const dest = versionJsonPath(id)
  if (existsSync(dest)) return JSON.parse(await readFile(dest, 'utf8')) as VersionJson
  return fetchVanillaVersionJson(id)
}

export async function writeVersionJson(id: string, json: VersionJson): Promise<void> {
  await mkdir(join(paths.versions, id), { recursive: true })
  await writeFile(versionJsonPath(id), JSON.stringify(json, null, 2))
}

/**
 * Loader version jsons declare `inheritsFrom` and only list their own extra
 * libraries/arguments. Flatten the chain into one launchable definition, with
 * the child taking priority and its libraries placed first on the classpath.
 */
export async function resolveVersionChain(id: string): Promise<VersionJson> {
  const chain: VersionJson[] = []
  let current: VersionJson | undefined = await readVersionJson(id)
  const seen = new Set<string>()

  while (current) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    chain.push(current)
    current = current.inheritsFrom ? await fetchVanillaVersionJson(current.inheritsFrom) : undefined
  }

  // chain[0] is the most-derived version; fold parents in underneath it.
  const merged = chain.reduceRight<VersionJson>((parent, child) => {
    if (!parent.id) return { ...child }
    return {
      ...parent,
      ...child,
      id: child.id,
      // Loader libraries must win over vanilla's when both provide a coordinate,
      // and must appear earlier on the classpath.
      libraries: [...child.libraries, ...parent.libraries],
      assetIndex: child.assetIndex ?? parent.assetIndex,
      assets: child.assets ?? parent.assets,
      downloads: { ...(parent.downloads ?? {}), ...(child.downloads ?? {}) },
      javaVersion: child.javaVersion ?? parent.javaVersion,
      logging: child.logging ?? parent.logging,
      mainClass: child.mainClass ?? parent.mainClass,
      minecraftArguments: child.minecraftArguments ?? parent.minecraftArguments,
      arguments: {
        game: [...(parent.arguments?.game ?? []), ...(child.arguments?.game ?? [])],
        jvm: [...(parent.arguments?.jvm ?? []), ...(child.arguments?.jvm ?? [])]
      }
    }
  }, {} as VersionJson)

  // De-duplicate libraries by group:artifact, keeping the first (highest priority).
  const seenCoords = new Set<string>()
  merged.libraries = merged.libraries.filter((lib) => {
    const parts = lib.name.split(':')
    const key = `${parts[0]}:${parts[1]}:${parts[3] ?? ''}`
    if (seenCoords.has(key)) return false
    seenCoords.add(key)
    return true
  })

  return merged
}

export interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>
  virtual?: boolean
  map_to_resources?: boolean
}

export async function fetchAssetIndex(version: VersionJson): Promise<AssetIndex | null> {
  if (!version.assetIndex) return null
  const dest = join(paths.assets, 'indexes', `${version.assetIndex.id}.json`)
  await downloadFile({
    url: version.assetIndex.url,
    dest,
    sha1: version.assetIndex.sha1,
    size: version.assetIndex.size
  })
  return JSON.parse(await readFile(dest, 'utf8')) as AssetIndex
}
