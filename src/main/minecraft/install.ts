import AdmZip from 'adm-zip'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { mavenToPath, paths } from '../paths.js'
import { downloadAll, downloadFile, type DownloadJob } from '../net/download.js'
import {
  fetchAssetIndex,
  resolveVersionChain,
  type Library,
  type VersionJson
} from './manifest.js'
import { currentOs, libraryApplies, nativeClassifier } from './rules.js'

const RESOURCES = 'https://resources.download.minecraft.net'
const MAVEN_FALLBACK = 'https://libraries.minecraft.net/'

export interface InstallProgress {
  stage: string
  detail: string
  progress: number
}

export function libraryJarPath(lib: Library): string {
  const artifactPath = lib.downloads?.artifact?.path ?? mavenToPath(lib.name)
  return join(paths.libraries, artifactPath)
}

function nativeJarPath(lib: Library, classifier: string): string | null {
  const entry = lib.downloads?.classifiers?.[classifier]
  const path = entry?.path ?? mavenToPath(`${lib.name}:${classifier}`)
  return join(paths.libraries, path)
}

/** Build the download job for a library, honouring custom maven repos. */
function libraryJobs(lib: Library): DownloadJob[] {
  const jobs: DownloadJob[] = []
  const artifact = lib.downloads?.artifact

  if (artifact?.url) {
    jobs.push({
      url: artifact.url,
      dest: join(paths.libraries, artifact.path),
      sha1: artifact.sha1,
      size: artifact.size
    })
  } else if (!lib.natives) {
    // Loader manifests (Fabric/Quilt) give a repo base instead of a full URL.
    const relative = mavenToPath(lib.name).split(/[\\/]/).join('/')
    const base = lib.url ?? MAVEN_FALLBACK
    jobs.push({
      url: `${base.endsWith('/') ? base : `${base}/`}${relative}`,
      dest: join(paths.libraries, mavenToPath(lib.name))
    })
  }

  const classifier = nativeClassifier(lib)
  if (classifier) {
    const entry = lib.downloads?.classifiers?.[classifier]
    if (entry) {
      jobs.push({
        url: entry.url,
        dest: join(paths.libraries, entry.path),
        sha1: entry.sha1,
        size: entry.size
      })
    }
  }
  return jobs
}

/**
 * Legacy versions ship natives inside classifier jars that must be unpacked
 * next to the game. Modern versions (1.19+) list them as ordinary libraries and
 * this step becomes a no-op.
 */
export async function extractNatives(version: VersionJson, nativesDir: string): Promise<void> {
  await mkdir(nativesDir, { recursive: true })
  const existing = await readdir(nativesDir).catch(() => [] as string[])

  for (const lib of version.libraries) {
    if (!libraryApplies(lib)) continue
    const classifier = nativeClassifier(lib)
    if (!classifier) continue
    const jar = nativeJarPath(lib, classifier)
    if (!jar || !existsSync(jar)) continue

    const zip = new AdmZip(jar)
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue
      const name = entry.entryName
      if (name.startsWith('META-INF/')) continue
      if (lib.extract?.exclude?.some((prefix) => name.startsWith(prefix))) continue
      const base = name.split('/').pop()!
      if (existing.includes(base)) continue
      await writeFile(join(nativesDir, base), entry.getData())
    }
  }
}

export function nativesDirFor(versionId: string): string {
  return join(paths.natives, `${versionId}-${currentOs()}`)
}

/**
 * Download the client jar, every applicable library, the asset index and all
 * assets for a version. Safe to re-run — finished files are skipped by hash.
 */
export async function installVersion(
  versionId: string,
  concurrency: number,
  onProgress: (p: InstallProgress) => void
): Promise<VersionJson> {
  onProgress({ stage: 'Resolving version', detail: versionId, progress: 0.02 })
  const version = await resolveVersionChain(versionId)

  const jobs: DownloadJob[] = []

  const client = version.downloads?.client
  if (client) {
    jobs.push({
      url: client.url,
      dest: join(paths.versions, version.id, `${version.id}.jar`),
      sha1: client.sha1,
      size: client.size
    })
  }

  for (const lib of version.libraries) {
    if (!libraryApplies(lib)) continue
    jobs.push(...libraryJobs(lib))
  }

  if (version.logging?.client?.file) {
    const log = version.logging.client.file
    jobs.push({
      url: log.url,
      dest: join(paths.assets, 'log_configs', log.id),
      sha1: log.sha1,
      size: log.size
    })
  }

  onProgress({ stage: 'Downloading libraries', detail: `${jobs.length} files`, progress: 0.05 })
  await downloadAll(jobs, concurrency, (p) => {
    onProgress({
      stage: 'Downloading libraries',
      detail: `${p.completed}/${p.total} · ${p.current}`,
      // Libraries occupy 5%..45% of the bar; assets take the rest.
      progress: 0.05 + 0.4 * (p.completed / Math.max(1, p.total))
    })
  })

  onProgress({ stage: 'Reading asset index', detail: version.assetIndex?.id ?? '', progress: 0.46 })
  const index = await fetchAssetIndex(version)

  if (index) {
    const objects = Object.entries(index.objects)
    const assetJobs: DownloadJob[] = objects.map(([, obj]) => ({
      url: `${RESOURCES}/${obj.hash.slice(0, 2)}/${obj.hash}`,
      dest: join(paths.assets, 'objects', obj.hash.slice(0, 2), obj.hash),
      sha1: obj.hash,
      size: obj.size
    }))

    onProgress({ stage: 'Downloading assets', detail: `${assetJobs.length} files`, progress: 0.47 })
    await downloadAll(assetJobs, concurrency, (p) => {
      onProgress({
        stage: 'Downloading assets',
        detail: `${p.completed}/${p.total}`,
        progress: 0.47 + 0.5 * (p.completed / Math.max(1, p.total))
      })
    })

    // Pre-1.7 versions read sounds/lang from a flat "virtual" tree instead of
    // the hashed object store, so mirror the files into place.
    if (index.virtual || index.map_to_resources) {
      const virtualRoot = join(paths.assets, 'virtual', version.assetIndex!.id)
      for (const [name, obj] of objects) {
        const dest = join(virtualRoot, ...name.split('/'))
        if (existsSync(dest)) continue
        await mkdir(join(dest, '..'), { recursive: true })
        await downloadFile({
          url: `${RESOURCES}/${obj.hash.slice(0, 2)}/${obj.hash}`,
          dest,
          sha1: obj.hash
        })
      }
    }
  }

  onProgress({ stage: 'Extracting natives', detail: '', progress: 0.98 })
  await extractNatives(version, nativesDirFor(version.id))

  onProgress({ stage: 'Ready', detail: version.id, progress: 1 })
  return version
}
