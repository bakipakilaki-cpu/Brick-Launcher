import { installFabricLike, listLoaderVersions } from './fabricLike.js'
import { installForgeLike, listForgeVersions } from './forgeLike.js'
import { fetchVanillaVersionJson } from '../minecraft/manifest.js'
import type { LoaderId } from '../../shared/types.js'

export interface LoaderProgress {
  stage: string
  detail: string
  progress: number
}

/** Loader builds available for a given Minecraft version, newest first. */
export async function listLoaderBuilds(loader: LoaderId, mcVersion: string): Promise<string[]> {
  switch (loader) {
    case 'vanilla':
      return []
    case 'fabric':
      return listLoaderVersions('fabric', mcVersion)
    case 'quilt':
      return listLoaderVersions('quilt', mcVersion)
    case 'forge':
      return listForgeVersions('forge', mcVersion)
    case 'neoforge':
      return listForgeVersions('neoforge', mcVersion)
  }
}

/**
 * Install a loader on top of a Minecraft version and return the version id
 * that should be launched.
 */
export async function installLoader(
  loader: LoaderId,
  mcVersion: string,
  loaderVersion: string | undefined,
  concurrency: number,
  onProgress: (p: LoaderProgress) => void
): Promise<{ versionId: string; loaderVersion?: string }> {
  if (loader === 'vanilla') {
    await fetchVanillaVersionJson(mcVersion)
    return { versionId: mcVersion }
  }

  let resolved = loaderVersion
  if (!resolved) {
    const builds = await listLoaderBuilds(loader, mcVersion)
    if (!builds.length) {
      throw new Error(`${loader} has no build for Minecraft ${mcVersion} yet.`)
    }
    resolved = builds[0]
  }

  if (loader === 'fabric' || loader === 'quilt') {
    onProgress({ stage: `Installing ${loader}`, detail: resolved, progress: 0.3 })
    const versionId = await installFabricLike(loader, mcVersion, resolved)
    onProgress({ stage: 'Ready', detail: versionId, progress: 1 })
    return { versionId, loaderVersion: resolved }
  }

  const versionId = await installForgeLike(loader, mcVersion, resolved, concurrency, onProgress)
  return { versionId, loaderVersion: resolved }
}
