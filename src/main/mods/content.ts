import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { instanceDir, paths } from '../paths.js'
import { downloadFile, downloadAll, type DownloadJob } from '../net/download.js'
import * as modrinth from './modrinth.js'
import * as curseforge from './curseforge.js'
import type { ModFile, ModVersion, ProjectType } from '../../shared/types.js'

/** Where each content type lives inside an instance folder. */
export const CONTENT_DIRS: Record<Exclude<ProjectType, 'modpack'>, string> = {
  mod: 'mods',
  shader: 'shaderpacks',
  resourcepack: 'resourcepacks',
  datapack: 'datapacks'
}

const DISABLED_SUFFIX = '.disabled'

export function contentDir(instanceId: string, type: Exclude<ProjectType, 'modpack'>): string {
  return join(instanceDir(instanceId), CONTENT_DIRS[type])
}

interface IndexEntry {
  fileName: string
  name: string
  source: 'modrinth' | 'curseforge' | 'local'
  projectId?: string
  versionId?: string
  version?: string
  iconUrl?: string
}

function indexPath(instanceId: string, type: Exclude<ProjectType, 'modpack'>): string {
  return join(instanceDir(instanceId), '.brick', `${type}-index.json`)
}

async function readIndex(
  instanceId: string,
  type: Exclude<ProjectType, 'modpack'>
): Promise<Record<string, IndexEntry>> {
  try {
    return JSON.parse(await readFile(indexPath(instanceId, type), 'utf8')) as Record<string, IndexEntry>
  } catch {
    return {}
  }
}

async function writeIndex(
  instanceId: string,
  type: Exclude<ProjectType, 'modpack'>,
  index: Record<string, IndexEntry>
): Promise<void> {
  const file = indexPath(instanceId, type)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, JSON.stringify(index, null, 2))
}

/** Strip the .disabled marker to get the canonical key used by the index. */
function baseName(fileName: string): string {
  return fileName.endsWith(DISABLED_SUFFIX) ? fileName.slice(0, -DISABLED_SUFFIX.length) : fileName
}

export async function listContent(
  instanceId: string,
  type: Exclude<ProjectType, 'modpack'>
): Promise<ModFile[]> {
  const dir = contentDir(instanceId, type)
  await mkdir(dir, { recursive: true })
  const index = await readIndex(instanceId, type)

  const entries = await readdir(dir).catch(() => [] as string[])
  const files = entries.filter((f) => /\.(jar|zip)(\.disabled)?$/i.test(f))

  const results: ModFile[] = []
  for (const fileName of files) {
    const key = baseName(fileName)
    const info = await stat(join(dir, fileName))
    const meta = index[key]
    results.push({
      fileName,
      name: meta?.name ?? key.replace(/\.(jar|zip)$/i, ''),
      source: meta?.source ?? 'local',
      projectId: meta?.projectId,
      versionId: meta?.versionId,
      version: meta?.version,
      iconUrl: meta?.iconUrl,
      enabled: !fileName.endsWith(DISABLED_SUFFIX),
      sizeBytes: info.size
    })
  }
  return results.sort((a, b) => a.name.localeCompare(b.name))
}

export interface InstallContentArgs {
  instanceId: string
  type: Exclude<ProjectType, 'modpack'>
  version: ModVersion
  projectTitle: string
  iconUrl?: string
}

export async function installContent(args: InstallContentArgs): Promise<ModFile[]> {
  const { instanceId, type, version, projectTitle, iconUrl } = args
  const dir = contentDir(instanceId, type)
  await mkdir(dir, { recursive: true })

  const index = await readIndex(instanceId, type)

  // Replace an older file from the same project rather than stacking versions,
  // which would make the game load two copies of the same mod.
  const projectId = (version as ModVersion & { projectId?: string }).projectId
  if (projectId) {
    for (const [key, entry] of Object.entries(index)) {
      if (entry.projectId === projectId) {
        await rm(join(dir, key), { force: true })
        await rm(join(dir, key + DISABLED_SUFFIX), { force: true })
        delete index[key]
      }
    }
  }

  await downloadFile({
    url: version.fileUrl,
    dest: join(dir, version.fileName),
    sha1: version.sha1,
    size: version.fileSize
  })

  index[version.fileName] = {
    fileName: version.fileName,
    name: projectTitle,
    source: version.source,
    projectId: (version as ModVersion & { projectId?: string }).projectId,
    versionId: version.id,
    version: version.versionNumber,
    iconUrl
  }
  await writeIndex(instanceId, type, index)
  return listContent(instanceId, type)
}

export async function setContentEnabled(
  instanceId: string,
  type: Exclude<ProjectType, 'modpack'>,
  fileName: string,
  enabled: boolean
): Promise<ModFile[]> {
  const dir = contentDir(instanceId, type)
  const current = join(dir, fileName)
  const target = join(dir, enabled ? baseName(fileName) : `${baseName(fileName)}${DISABLED_SUFFIX}`)
  if (current !== target && existsSync(current)) await rename(current, target)
  return listContent(instanceId, type)
}

export async function removeContent(
  instanceId: string,
  type: Exclude<ProjectType, 'modpack'>,
  fileName: string
): Promise<ModFile[]> {
  const dir = contentDir(instanceId, type)
  await rm(join(dir, fileName), { force: true })
  const index = await readIndex(instanceId, type)
  delete index[baseName(fileName)]
  await writeIndex(instanceId, type, index)
  return listContent(instanceId, type)
}

/**
 * Copy user-picked files straight into the instance. Accepts the jars/zips the
 * game expects for each content type and skips anything that is not one.
 */
export async function importLocalFiles(
  instanceId: string,
  type: Exclude<ProjectType, 'modpack'>,
  filePaths: string[]
): Promise<{ content: ModFile[]; imported: number; skipped: string[] }> {
  const dir = contentDir(instanceId, type)
  await mkdir(dir, { recursive: true })

  const allowed = type === 'mod' ? /\.jar$/i : /\.(zip|jar)$/i
  const skipped: string[] = []
  let imported = 0

  for (const source of filePaths) {
    const name = source.split(/[\\/]/).pop()!
    if (!allowed.test(name)) {
      skipped.push(name)
      continue
    }
    // Never clobber an existing file — suffix instead.
    let dest = join(dir, name)
    let counter = 1
    while (existsSync(dest)) {
      dest = join(dir, name.replace(/(\.[^.]+)$/, `-${counter++}$1`))
    }
    await writeFile(dest, await readFile(source))
    imported++
  }

  // Anything recognised on Modrinth gets a proper name and icon right away.
  const content = imported > 0 ? await identifyLocalContent(instanceId, type) : await listContent(instanceId, type)
  return { content, imported, skipped }
}

export interface WorldEntry {
  folderName: string
  name: string
  sizeBytes: number
  lastPlayed?: number
  icon?: string
}

function savesDir(instanceId: string): string {
  return join(instanceDir(instanceId), 'saves')
}

async function dirSize(dir: string): Promise<number> {
  let total = 0
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) total += await dirSize(full)
    else total += (await stat(full).catch(() => ({ size: 0 }))).size
  }
  return total
}

export async function listWorlds(instanceId: string): Promise<WorldEntry[]> {
  const dir = savesDir(instanceId)
  await mkdir(dir, { recursive: true })
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])

  const worlds: WorldEntry[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = join(dir, entry.name)
    // level.dat is what makes a folder an actual world.
    if (!existsSync(join(full, 'level.dat'))) continue

    const iconPath = join(full, 'icon.png')
    const icon = existsSync(iconPath)
      ? `data:image/png;base64,${(await readFile(iconPath)).toString('base64')}`
      : undefined

    worlds.push({
      folderName: entry.name,
      name: entry.name,
      sizeBytes: await dirSize(full),
      lastPlayed: (await stat(join(full, 'level.dat')).catch(() => null))?.mtimeMs,
      icon
    })
  }
  return worlds.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
}

/**
 * Import a world from a .zip (the usual download format) or from an unpacked
 * world folder. Zips often wrap the world in a top-level directory, so the
 * level.dat is located first and everything is rebased onto it.
 */
export async function importWorld(instanceId: string, sourcePath: string): Promise<WorldEntry[]> {
  const dir = savesDir(instanceId)
  await mkdir(dir, { recursive: true })

  const info = await stat(sourcePath)

  if (info.isDirectory()) {
    if (!existsSync(join(sourcePath, 'level.dat'))) {
      throw new Error('That folder is not a Minecraft world (no level.dat inside).')
    }
    const { cp } = await import('node:fs/promises')
    const name = sourcePath.split(/[\\/]/).filter(Boolean).pop()!
    await cp(sourcePath, uniqueDir(dir, name), { recursive: true })
    return listWorlds(instanceId)
  }

  if (!/\.zip$/i.test(sourcePath)) {
    throw new Error('Worlds must be a .zip archive or an unpacked world folder.')
  }

  const zip = new AdmZip(sourcePath)
  const entries = zip.getEntries()
  const levelEntry = entries.find((e) => e.entryName.replace(/\\/g, '/').endsWith('level.dat'))
  if (!levelEntry) {
    throw new Error('That zip does not contain a Minecraft world (no level.dat inside).')
  }

  const prefix = levelEntry.entryName.replace(/\\/g, '/').slice(0, -'level.dat'.length)
  const baseName =
    prefix.replace(/\/$/, '').split('/').pop() ||
    sourcePath.split(/[\\/]/).pop()!.replace(/\.zip$/i, '')
  const target = uniqueDir(dir, baseName)

  for (const entry of entries) {
    const path = entry.entryName.replace(/\\/g, '/')
    if (entry.isDirectory || !path.startsWith(prefix)) continue
    const relative = path.slice(prefix.length)
    if (!relative) continue
    const dest = join(target, ...relative.split('/'))
    await mkdir(join(dest, '..'), { recursive: true })
    await writeFile(dest, entry.getData())
  }

  return listWorlds(instanceId)
}

function uniqueDir(parent: string, name: string): string {
  let candidate = join(parent, name)
  let counter = 1
  while (existsSync(candidate)) candidate = join(parent, `${name} (${counter++})`)
  return candidate
}

export async function deleteWorld(instanceId: string, folderName: string): Promise<WorldEntry[]> {
  await rm(join(savesDir(instanceId), folderName), { recursive: true, force: true })
  return listWorlds(instanceId)
}

/**
 * Identify locally-added jars by SHA-1 against Modrinth so manually dropped
 * files still show a name, icon and update path.
 */
export async function identifyLocalContent(
  instanceId: string,
  type: Exclude<ProjectType, 'modpack'>
): Promise<ModFile[]> {
  const dir = contentDir(instanceId, type)
  const index = await readIndex(instanceId, type)
  const files = (await listContent(instanceId, type)).filter((f) => f.source === 'local')
  if (!files.length) return listContent(instanceId, type)

  const hashes: Record<string, string> = {}
  for (const file of files) {
    const buf = await readFile(join(dir, file.fileName)).catch(() => null)
    if (!buf) continue
    hashes[createHash('sha1').update(buf).digest('hex')] = file.fileName
  }

  const matches = await modrinth.versionsFromHashes(Object.keys(hashes)).catch(() => ({}))
  const projectIds = [...new Set(Object.values(matches).map((m) => m.projectId))]
  const projects = await Promise.all(
    projectIds.map((id) => modrinth.getProject(id).catch(() => null))
  )
  const byId = new Map(projects.filter(Boolean).map((p) => [p!.id, p!]))

  for (const [hash, version] of Object.entries(matches)) {
    const fileName = hashes[hash]
    if (!fileName) continue
    const project = byId.get(version.projectId)
    index[baseName(fileName)] = {
      fileName: baseName(fileName),
      name: project?.title ?? version.name,
      source: 'modrinth',
      projectId: version.projectId,
      versionId: version.id,
      version: version.versionNumber,
      iconUrl: project?.iconUrl
    }
  }
  await writeIndex(instanceId, type, index)
  return listContent(instanceId, type)
}

/** Check installed content against the latest compatible release. */
export async function checkForUpdates(
  instanceId: string,
  type: Exclude<ProjectType, 'modpack'>,
  gameVersion: string,
  loader: string
): Promise<{ fileName: string; current?: string; latest: ModVersion }[]> {
  const installed = await listContent(instanceId, type)
  const updates: { fileName: string; current?: string; latest: ModVersion }[] = []

  for (const file of installed) {
    if (!file.projectId || file.source === 'local') continue
    try {
      const versions =
        file.source === 'modrinth'
          ? await modrinth.listVersions(file.projectId, gameVersion, loader)
          : await curseforge.listVersions(file.projectId, gameVersion, loader)
      const latest = versions[0]
      if (latest && latest.id !== file.versionId) {
        updates.push({ fileName: file.fileName, current: file.version, latest })
      }
    } catch {
      // A single unreachable project should not abort the whole check.
    }
  }
  return updates
}

/* ------------------------------- modpacks -------------------------------- */

interface MrPackIndex {
  formatVersion: number
  name: string
  versionId: string
  dependencies: Record<string, string>
  files: {
    path: string
    hashes: { sha1: string }
    downloads: string[]
    fileSize: number
    env?: { client: string; server: string }
  }[]
}

export interface ModpackInfo {
  name: string
  mcVersion: string
  loader: string
  loaderVersion?: string
}

/**
 * Install a Modrinth .mrpack into an instance folder: fetch every listed file
 * and unpack the overrides tree on top.
 */
export async function installMrPack(
  instanceId: string,
  packUrl: string,
  packSha1: string | undefined,
  concurrency: number,
  onProgress: (stage: string, detail: string, progress: number) => void
): Promise<ModpackInfo> {
  const dir = instanceDir(instanceId)
  await mkdir(dir, { recursive: true })

  const packPath = join(paths.cache, `pack-${instanceId}.mrpack`)
  onProgress('Downloading modpack', '', 0.05)
  await downloadFile({ url: packUrl, dest: packPath, sha1: packSha1 })

  const zip = new AdmZip(packPath)
  const indexEntry = zip.getEntry('modrinth.index.json')
  if (!indexEntry) throw new Error('This file is not a valid Modrinth modpack (.mrpack).')
  const index = JSON.parse(indexEntry.getData().toString('utf8')) as MrPackIndex

  onProgress('Downloading pack content', `${index.files.length} files`, 0.1)
  const jobs: DownloadJob[] = index.files
    .filter((f) => f.env?.client !== 'unsupported')
    .map((f) => ({
      url: f.downloads[0],
      dest: join(dir, ...f.path.split('/')),
      sha1: f.hashes.sha1,
      size: f.fileSize
    }))

  await downloadAll(jobs, concurrency, (p) => {
    onProgress('Downloading pack content', `${p.completed}/${p.total} · ${p.current}`, 0.1 + 0.8 * (p.completed / Math.max(1, p.total)))
  })

  onProgress('Applying overrides', '', 0.92)
  for (const entry of zip.getEntries()) {
    const name = entry.entryName
    const prefix = name.startsWith('overrides/')
      ? 'overrides/'
      : name.startsWith('client-overrides/')
        ? 'client-overrides/'
        : null
    if (!prefix || entry.isDirectory) continue
    const relative = name.slice(prefix.length)
    if (!relative) continue
    const dest = join(dir, ...relative.split('/'))
    await mkdir(join(dest, '..'), { recursive: true })
    await writeFile(dest, entry.getData())
  }

  await rm(packPath, { force: true })

  const deps = index.dependencies
  const loader = deps['fabric-loader']
    ? 'fabric'
    : deps['quilt-loader']
      ? 'quilt'
      : deps.forge
        ? 'forge'
        : deps.neoforge
          ? 'neoforge'
          : 'vanilla'

  onProgress('Modpack ready', index.name, 1)
  return {
    name: index.name,
    mcVersion: deps.minecraft,
    loader,
    loaderVersion:
      deps['fabric-loader'] ?? deps['quilt-loader'] ?? deps.forge ?? deps.neoforge ?? undefined
  }
}
