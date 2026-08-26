import { getJson, getJsonCached } from '../net/download.js'
import { writeVersionJson, type VersionJson } from '../minecraft/manifest.js'

/**
 * Fabric and Quilt expose the same meta API shape, so one implementation
 * serves both — only the base URL differs.
 */
const ENDPOINTS = {
  fabric: 'https://meta.fabricmc.net/v2',
  quilt: 'https://meta.quiltmc.org/v3'
} as const

export type FabricLike = keyof typeof ENDPOINTS

interface LoaderEntry {
  loader: { separator: string; build: number; maven: string; version: string; stable?: boolean }
  intermediary: { maven: string; version: string; stable?: boolean }
}

export async function listGameVersions(kind: FabricLike): Promise<string[]> {
  const versions = await getJsonCached<{ version: string; stable: boolean }[]>(
    `${ENDPOINTS[kind]}/versions/game`,
    30 * 60 * 1000
  )
  return versions.map((v) => v.version)
}

export async function listLoaderVersions(kind: FabricLike, mcVersion: string): Promise<string[]> {
  const entries = await getJsonCached<LoaderEntry[]>(
    `${ENDPOINTS[kind]}/versions/loader/${encodeURIComponent(mcVersion)}`,
    10 * 60 * 1000
  )
  // Quilt publishes beta loaders alongside stable ones; keep the order the API
  // gives (newest first) so the default pick is the latest build.
  return entries.map((e) => e.loader.version)
}

/**
 * Fetch the ready-made launch profile and store it as a version json. It uses
 * `inheritsFrom` so the vanilla installer supplies the client jar and assets.
 */
export async function installFabricLike(
  kind: FabricLike,
  mcVersion: string,
  loaderVersion: string
): Promise<string> {
  const url = `${ENDPOINTS[kind]}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
  const profile = await getJson<VersionJson>(url)
  if (!profile.id) throw new Error(`${kind} returned a profile without an id`)
  await writeVersionJson(profile.id, profile)
  return profile.id
}
