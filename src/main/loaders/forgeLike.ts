import AdmZip from 'adm-zip'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { mavenToPath, paths } from '../paths.js'
import { downloadAll, downloadFile, getText, type DownloadJob } from '../net/download.js'
import { fetchVanillaVersionJson, writeVersionJson, type VersionJson } from '../minecraft/manifest.js'
import { resolveJavaFor } from '../minecraft/java.js'

const run = promisify(execFile)

export type ForgeKind = 'forge' | 'neoforge'

const FORGE_MAVEN = 'https://maven.minecraftforge.net'
const NEO_MAVEN = 'https://maven.neoforged.net/releases'

/* ------------------------------ version lists ----------------------------- */

function parseMavenVersions(xml: string): string[] {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]).reverse()
}

export async function listForgeVersions(kind: ForgeKind, mcVersion: string): Promise<string[]> {
  if (kind === 'forge') {
    const xml = await getText(`${FORGE_MAVEN}/net/minecraftforge/forge/maven-metadata.xml`)
    // Forge artifact versions look like "1.20.1-47.2.0" or "1.12.2-14.23.5.2859-1.12.2".
    return parseMavenVersions(xml)
      .filter((v) => v.startsWith(`${mcVersion}-`))
      .map((v) => v.slice(mcVersion.length + 1))
  }
  const xml = await getText(`${NEO_MAVEN}/net/neoforged/neoforge/maven-metadata.xml`)
  // NeoForge versions are "<minor>.<patch>.<build>" derived from 1.<minor>.<patch>.
  const parts = mcVersion.split('.')
  if (parts[0] !== '1' || parts.length < 2) return []
  const prefix = `${parts[1]}.${parts[2] ?? '0'}.`
  return parseMavenVersions(xml).filter((v) => v.startsWith(prefix))
}

function installerCoordinate(kind: ForgeKind, mcVersion: string, loaderVersion: string): {
  url: string
  fileName: string
} {
  if (kind === 'forge') {
    const full = `${mcVersion}-${loaderVersion}`
    return {
      url: `${FORGE_MAVEN}/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`,
      fileName: `forge-${full}-installer.jar`
    }
  }
  return {
    url: `${NEO_MAVEN}/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`,
    fileName: `neoforge-${loaderVersion}-installer.jar`
  }
}

/* ---------------------------- install profile ---------------------------- */

interface ProcessorSpec {
  sides?: string[]
  jar: string
  classpath: string[]
  args: string[]
  outputs?: Record<string, string>
}

interface InstallProfile {
  spec?: number
  version?: string
  minecraft?: string
  json?: string
  path?: string
  data?: Record<string, { client: string; server: string }>
  processors?: ProcessorSpec[]
  libraries?: {
    name: string
    downloads?: { artifact?: { path: string; url: string; sha1: string; size: number } }
  }[]
  /** Legacy (pre-1.13) installers embed the version json directly. */
  versionInfo?: VersionJson
  install?: { filePath?: string; path?: string; minecraft?: string }
}

function libDest(path: string): string {
  return join(paths.libraries, ...path.split('/'))
}

async function sha1File(path: string): Promise<string> {
  return createHash('sha1').update(await readFile(path)).digest('hex')
}

/** Resolve a `[group:artifact:version:classifier@ext]` token to a local path. */
function resolveMavenToken(token: string): string {
  return join(paths.libraries, mavenToPath(token.slice(1, -1)))
}

/**
 * Data values come in three flavours: `[maven]` coordinates, `'quoted'`
 * literals, and `/paths` that must be extracted out of the installer jar.
 */
async function resolveDataValue(
  value: string,
  zip: AdmZip,
  workDir: string
): Promise<string> {
  if (value.startsWith('[') && value.endsWith(']')) return resolveMavenToken(value)
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)
  if (value.startsWith('/')) {
    const entry = zip.getEntry(value.slice(1))
    if (!entry) throw new Error(`Installer is missing embedded file ${value}`)
    const dest = join(workDir, value.slice(1))
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, entry.getData())
    return dest
  }
  return value
}

/** Read Main-Class out of a jar's manifest so we can invoke the processor. */
function mainClassOf(jarPath: string): string {
  const manifest = new AdmZip(jarPath).getEntry('META-INF/MANIFEST.MF')
  if (!manifest) throw new Error(`No manifest in ${jarPath}`)
  const text = manifest.getData().toString('utf8').replace(/\r\n /g, '')
  const match = text.match(/Main-Class:\s*(\S+)/)
  if (!match) throw new Error(`No Main-Class in ${jarPath}`)
  return match[1]
}

async function outputsSatisfied(
  spec: ProcessorSpec,
  vars: Record<string, string>
): Promise<boolean> {
  if (!spec.outputs || Object.keys(spec.outputs).length === 0) return false
  for (const [rawPath, rawHash] of Object.entries(spec.outputs)) {
    const path = applyTokens(rawPath, vars)
    const expected = applyTokens(rawHash, vars).replace(/'/g, '')
    if (!existsSync(path)) return false
    if (expected && (await sha1File(path)) !== expected) return false
  }
  return true
}

function applyTokens(input: string, vars: Record<string, string>): string {
  let out = input.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole)
  if (out.startsWith('[') && out.endsWith(']')) out = resolveMavenToken(out)
  return out
}

export interface ForgeProgress {
  stage: string
  detail: string
  progress: number
}

/**
 * Install Forge or NeoForge for a Minecraft version and return the version id
 * to launch. Modern installers ship a processor pipeline (deobfuscation,
 * binary patching) that we must execute locally — this reproduces what the
 * official installer GUI does, headlessly.
 */
export async function installForgeLike(
  kind: ForgeKind,
  mcVersion: string,
  loaderVersion: string,
  concurrency: number,
  onProgress: (p: ForgeProgress) => void
): Promise<string> {
  const { url, fileName } = installerCoordinate(kind, mcVersion, loaderVersion)
  const workDir = join(paths.cache, `${kind}-${mcVersion}-${loaderVersion}`)
  const installerPath = join(workDir, fileName)

  onProgress({ stage: 'Downloading installer', detail: fileName, progress: 0.05 })
  await mkdir(workDir, { recursive: true })
  await downloadFile({ url, dest: installerPath })

  const zip = new AdmZip(installerPath)

  const profileEntry = zip.getEntry('install_profile.json')
  if (!profileEntry) throw new Error(`${fileName} has no install_profile.json`)
  const profile = JSON.parse(profileEntry.getData().toString('utf8')) as InstallProfile

  /* ---------------- legacy path: pre-1.13, no processors ---------------- */
  if (!profile.processors?.length && profile.versionInfo) {
    onProgress({ stage: 'Installing (legacy)', detail: profile.versionInfo.id, progress: 0.4 })
    const versionJson = profile.versionInfo
    await writeVersionJson(versionJson.id, versionJson)

    // The universal jar lives inside the installer rather than on Maven.
    const embedded = profile.install?.filePath
    if (embedded && profile.install?.path) {
      const entry = zip.getEntry(embedded)
      if (entry) {
        const dest = join(paths.libraries, mavenToPath(profile.install.path))
        await mkdir(dirname(dest), { recursive: true })
        await writeFile(dest, entry.getData())
      }
    }
    onProgress({ stage: 'Ready', detail: versionJson.id, progress: 1 })
    return versionJson.id
  }

  /* ---------------- modern path: run the processor pipeline ------------- */
  const versionEntry = zip.getEntry(profile.json?.replace(/^\//, '') ?? 'version.json')
  if (!versionEntry) throw new Error(`${fileName} has no version json`)
  const versionJson = JSON.parse(versionEntry.getData().toString('utf8')) as VersionJson
  await writeVersionJson(versionJson.id, versionJson)

  // Ensure the vanilla client jar exists — processors patch it.
  const vanilla = await fetchVanillaVersionJson(mcVersion)
  const clientJar = join(paths.versions, mcVersion, `${mcVersion}.jar`)
  if (vanilla.downloads?.client) {
    await downloadFile({
      url: vanilla.downloads.client.url,
      dest: clientJar,
      sha1: vanilla.downloads.client.sha1,
      size: vanilla.downloads.client.size
    })
  }

  onProgress({ stage: 'Downloading loader libraries', detail: '', progress: 0.15 })
  const jobs: DownloadJob[] = []
  const embeddedLibs: { path: string; entry: string }[] = []

  for (const lib of [...(profile.libraries ?? []), ...(versionJson.libraries ?? [])]) {
    const artifact = lib.downloads?.artifact
    const path = artifact?.path ?? mavenToPath(lib.name)
    const dest = libDest(path.split(/[\\/]/).join('/'))
    if (artifact?.url) {
      jobs.push({ url: artifact.url, dest, sha1: artifact.sha1, size: artifact.size })
    } else {
      // An empty url means the jar is packed inside the installer under maven/.
      embeddedLibs.push({ path: dest, entry: `maven/${path}` })
    }
  }

  await downloadAll(jobs, concurrency, (p) => {
    onProgress({
      stage: 'Downloading loader libraries',
      detail: `${p.completed}/${p.total} · ${p.current}`,
      progress: 0.15 + 0.35 * (p.completed / Math.max(1, p.total))
    })
  })

  for (const lib of embeddedLibs) {
    if (existsSync(lib.path)) continue
    const entry = zip.getEntry(lib.entry)
    if (!entry) continue
    await mkdir(dirname(lib.path), { recursive: true })
    await writeFile(lib.path, entry.getData())
  }

  const vars: Record<string, string> = {
    MINECRAFT_JAR: clientJar,
    SIDE: 'client',
    ROOT: workDir,
    INSTALLER: installerPath,
    LIBRARY_DIR: paths.libraries
  }
  for (const [key, entry] of Object.entries(profile.data ?? {})) {
    vars[key] = await resolveDataValue(entry.client, zip, workDir)
  }

  const processors = (profile.processors ?? []).filter(
    (p) => !p.sides || p.sides.includes('client')
  )

  if (processors.length) {
    onProgress({ stage: 'Preparing Java for patching', detail: '', progress: 0.52 })
    // Processors are compiled for the same Java the game needs.
    const javaPath = await resolveJavaFor(
      versionJson.javaVersion?.majorVersion ?? vanilla.javaVersion?.majorVersion ?? 8,
      undefined,
      (detail, progress) =>
        onProgress({ stage: 'Preparing Java', detail, progress: 0.52 + progress * 0.05 })
    )

    for (const [index, spec] of processors.entries()) {
      const label = spec.jar.split(':')[1] ?? spec.jar
      const share = 0.4 / processors.length
      const base = 0.57 + index * share
      onProgress({
        stage: 'Patching Minecraft',
        detail: `${index + 1}/${processors.length} · ${label}`,
        progress: base
      })

      if (await outputsSatisfied(spec, vars)) continue

      const jarPath = resolveMavenToken(`[${spec.jar}]`)
      if (!existsSync(jarPath)) throw new Error(`Processor jar missing: ${spec.jar}`)

      const classpath = [...spec.classpath.map((c) => resolveMavenToken(`[${c}]`)), jarPath]
      const args = spec.args.map((arg) => applyTokens(arg, vars))

      try {
        await run(javaPath, ['-cp', classpath.join(delimiter), mainClassOf(jarPath), ...args], {
          cwd: workDir,
          maxBuffer: 1024 * 1024 * 64,
          timeout: 10 * 60 * 1000
        })
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        throw new Error(`${kind} processor "${label}" failed: ${detail}`)
      }
    }
  }

  await rm(join(workDir, 'data'), { recursive: true, force: true })
  onProgress({ stage: 'Ready', detail: versionJson.id, progress: 1 })
  return versionJson.id
}
