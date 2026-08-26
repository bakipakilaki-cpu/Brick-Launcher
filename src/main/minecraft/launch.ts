import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { platform } from 'node:os'
import { instanceDir, paths } from '../paths.js'
import { installVersion, libraryJarPath, nativesDirFor } from './install.js'
import { resolveVersionChain, type VersionJson } from './manifest.js'
import { libraryApplies, rulesAllow } from './rules.js'
import { resolveJavaFor } from './java.js'
import type { Account, Instance, Settings } from '../../shared/types.js'

export interface LaunchHandle {
  process: ChildProcess
  instanceId: string
  logPath: string
}

function flatten(
  entries: (string | { rules: never[]; value: string | string[] })[] | undefined,
  features: Record<string, boolean>
): string[] {
  const out: string[] = []
  for (const entry of entries ?? []) {
    if (typeof entry === 'string') {
      out.push(entry)
      continue
    }
    if (!rulesAllow(entry.rules, features)) continue
    out.push(...(Array.isArray(entry.value) ? entry.value : [entry.value]))
  }
  return out
}

function substitute(args: string[], vars: Record<string, string>): string[] {
  return args.map((arg) =>
    arg.replace(/\$\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole)
  )
}

function buildClasspath(version: VersionJson): string[] {
  const entries: string[] = []
  for (const lib of version.libraries) {
    if (!libraryApplies(lib)) continue
    // Legacy natives-only libraries are unpacked, not put on the classpath.
    if (lib.natives && !lib.downloads?.artifact) continue
    const jar = libraryJarPath(lib)
    if (!entries.includes(jar)) entries.push(jar)
  }
  entries.push(join(paths.versions, version.id, `${version.id}.jar`))
  return entries
}

/**
 * Old versions (pre-1.13) use a single space-separated `minecraftArguments`
 * string; newer ones use the structured `arguments` object.
 */
function gameArguments(version: VersionJson, features: Record<string, boolean>): string[] {
  if (version.arguments?.game?.length) return flatten(version.arguments.game as never, features)
  if (version.minecraftArguments) return version.minecraftArguments.split(' ').filter(Boolean)
  return []
}

function jvmArguments(version: VersionJson, features: Record<string, boolean>): string[] {
  if (version.arguments?.jvm?.length) return flatten(version.arguments.jvm as never, features)
  // Pre-1.13 manifests omit jvm args entirely; supply the classic defaults.
  return ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}']
}

export interface LaunchOptions {
  instance: Instance
  account: Account
  settings: Settings
  onProgress: (stage: string, detail: string, progress: number) => void
  onLog: (line: string) => void
  onExit: (code: number | null) => void
}

export async function launchInstance(opts: LaunchOptions): Promise<LaunchHandle> {
  const { instance, account, settings, onProgress, onLog, onExit } = opts

  const version = await installVersion(instance.versionId, settings.concurrentDownloads, (p) =>
    onProgress(p.stage, p.detail, p.progress * 0.9)
  )

  const gameDir = instanceDir(instance.id)
  await mkdir(gameDir, { recursive: true })
  await mkdir(join(gameDir, 'mods'), { recursive: true })

  onProgress('Locating Java', '', 0.92)
  const requiredMajor = version.javaVersion?.majorVersion ?? 8
  const javaPath = await resolveJavaFor(
    requiredMajor,
    instance.javaPath || settings.javaPath || undefined,
    (detail, progress) => onProgress('Preparing Java', detail, 0.92 + progress * 0.06)
  )

  const nativesDir = nativesDirFor(version.id)
  const classpath = buildClasspath(version)
  const memory = instance.memoryMb || settings.defaultMemoryMb

  const features: Record<string, boolean> = {
    is_demo_user: false,
    has_custom_resolution: Boolean(instance.width && instance.height),
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false
  }

  const assetsRoot = paths.assets
  const assetIndexId = version.assetIndex?.id ?? version.assets ?? 'legacy'

  const vars: Record<string, string> = {
    auth_player_name: account.username,
    version_name: version.id,
    game_directory: gameDir,
    assets_root: assetsRoot,
    game_assets: join(assetsRoot, 'virtual', assetIndexId),
    assets_index_name: assetIndexId,
    auth_uuid: account.uuid.replace(/-/g, ''),
    auth_access_token: account.accessToken ?? '0',
    auth_session: account.accessToken ? `token:${account.accessToken}` : '0',
    auth_xuid: account.xuid ?? '0',
    clientid: '',
    user_type: account.kind === 'microsoft' ? 'msa' : 'legacy',
    version_type: version.type ?? 'release',
    natives_directory: nativesDir,
    launcher_name: 'BrickLauncher',
    launcher_version: '1.0.0',
    classpath: classpath.join(delimiter),
    user_properties: '{}',
    library_directory: paths.libraries,
    classpath_separator: delimiter,
    resolution_width: String(instance.width ?? 854),
    resolution_height: String(instance.height ?? 480)
  }

  const args: string[] = []

  args.push(`-Xmx${memory}M`, `-Xms${Math.min(512, memory)}M`)
  args.push(`-Dminecraft.launcher.brand=BrickLauncher`, `-Dminecraft.launcher.version=1.0.0`)

  // Platform flags come from the version manifest itself — notably macOS's
  // -XstartOnFirstThread, which 1.13+ declares under an osx rule. Adding it by
  // hand would also apply it to LWJGL 2 versions, where it hangs the client.
  // The one exception is the Windows 10 os.name workaround, which only old
  // versions need and no manifest provides.
  const legacy = !version.arguments?.jvm?.length
  if (platform() === 'win32' && legacy) {
    args.push('-Dos.name=Windows 10', '-Dos.version=10.0')
  }

  const extraJvm = (instance.jvmArgs ?? settings.jvmArgs ?? '').trim()
  if (extraJvm) args.push(...extraJvm.split(/\s+/))

  args.push(...substitute(jvmArguments(version, features), vars))

  if (version.logging?.client) {
    const configFile = join(paths.assets, 'log_configs', version.logging.client.file.id)
    args.push(version.logging.client.argument.replace('${path}', configFile))
  }

  args.push(version.mainClass)
  args.push(...substitute(gameArguments(version, features), vars))

  if (instance.width && instance.height) {
    if (!args.includes('--width')) args.push('--width', String(instance.width))
    if (!args.includes('--height')) args.push('--height', String(instance.height))
  }

  onProgress('Starting Minecraft', version.id, 1)

  const child = spawn(javaPath, args, {
    cwd: gameDir,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Some Windows-only mod code writes to %APPDATA% directly; point it at the
    // instance so those files stay contained. Harmless to leave alone elsewhere.
    env: platform() === 'win32' ? { ...process.env, APPDATA: gameDir } : process.env
  })

  const logPath = join(paths.logs, `${instance.id}-${Date.now()}.log`)
  await mkdir(paths.logs, { recursive: true })
  const logStream = createWriteStream(logPath)
  logStream.write(`$ ${javaPath} ${args.join(' ')}\n\n`)

  const pump = (chunk: Buffer): void => {
    const text = chunk.toString()
    logStream.write(text)
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) onLog(line)
    }
  }
  child.stdout?.on('data', pump)
  child.stderr?.on('data', pump)

  child.on('error', (err) => {
    onLog(`[launcher] Failed to start Java: ${err.message}`)
    logStream.end()
    onExit(-1)
  })
  child.on('exit', (code) => {
    logStream.end()
    onExit(code)
  })

  return { process: child, instanceId: instance.id, logPath }
}

/** Verify + repair an installation without launching it. */
export async function repairInstance(
  versionId: string,
  concurrency: number,
  onProgress: (stage: string, detail: string, progress: number) => void
): Promise<void> {
  await installVersion(versionId, concurrency, (p) => onProgress(p.stage, p.detail, p.progress))
  await resolveVersionChain(versionId)
}
