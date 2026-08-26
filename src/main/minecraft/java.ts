import { execFile } from 'node:child_process'
import { chmod, mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { paths } from '../paths.js'
import { downloadFile, getJson } from '../net/download.js'

const run = promisify(execFile)

export interface JavaRuntime {
  path: string
  major: number
  vendor: string
  /** Resolved JAVA_HOME — the identity used to de-duplicate runtimes. */
  home: string
  source: 'bundled' | 'system' | 'custom'
}

/**
 * Ask a java binary what it is. `-XshowSettings:properties` gives us both the
 * version and java.home in one spawn; java.home is what tells us whether two
 * different paths (a PATH stub and a Homebrew symlink, say) are the same JVM.
 */
export async function probeJava(javaPath: string): Promise<JavaRuntime | null> {
  try {
    const { stderr, stdout } = await run(javaPath, ['-XshowSettings:properties', '-version'], {
      timeout: 8000
    })
    const text = `${stderr}\n${stdout}`

    const versionMatch =
      text.match(/java\.version\s*=\s*(\d+)(?:\.(\d+))?/) ??
      text.match(/version "(\d+)(?:\.(\d+))?[^"]*"/)
    if (!versionMatch) return null
    // Java 8 reports 1.8.0_x; everything newer reports the major directly.
    const major = versionMatch[1] === '1' ? Number(versionMatch[2]) : Number(versionMatch[1])

    const homeMatch = text.match(/java\.home\s*=\s*(.+)/)
    const home = homeMatch ? homeMatch[1].trim() : javaPath

    const vendorLine = text.split('\n').find((l) => /Runtime Environment/.test(l)) ?? ''
    return { path: javaPath, major, vendor: vendorLine.trim(), home, source: 'system' }
  } catch {
    return null
  }
}

function bundledJavaBin(major: number): string {
  const home = join(paths.java, `jre-${major}`)
  return platform() === 'win32'
    ? join(home, 'bin', 'java.exe')
    : join(home, 'Contents', 'Home', 'bin', 'java')
}

/** macOS JDK bundles nest under Contents/Home; Linux tarballs do not. */
function candidateBinsFor(home: string): string[] {
  return platform() === 'win32'
    ? [join(home, 'bin', 'java.exe')]
    : [join(home, 'Contents', 'Home', 'bin', 'java'), join(home, 'bin', 'java')]
}

async function findSystemJava(): Promise<string[]> {
  const found: string[] = []
  if (process.env.JAVA_HOME) found.push(join(process.env.JAVA_HOME, 'bin', 'java'))

  if (platform() === 'darwin') {
    // /usr/libexec/java_home is the authoritative list on macOS.
    try {
      const { stdout } = await run('/usr/libexec/java_home', ['-V'], { timeout: 8000 })
      for (const line of stdout.split('\n')) {
        const m = line.match(/\s(\/.+?)$/)
        if (m) found.push(join(m[1].trim(), 'bin', 'java'))
      }
    } catch {
      /* no JVMs registered */
    }
    for (const base of ['/opt/homebrew/opt', '/usr/local/opt']) {
      try {
        for (const entry of await readdir(base)) {
          if (/^openjdk/.test(entry)) found.push(join(base, entry, 'bin', 'java'))
        }
      } catch {
        /* homebrew not installed */
      }
    }
  }

  if (platform() === 'linux') {
    for (const base of ['/usr/lib/jvm']) {
      try {
        for (const entry of await readdir(base)) found.push(join(base, entry, 'bin', 'java'))
      } catch {
        /* none */
      }
    }
  }

  if (platform() === 'win32') {
    for (const base of ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium']) {
      try {
        for (const entry of await readdir(base)) found.push(join(base, entry, 'bin', 'java.exe'))
      } catch {
        /* none */
      }
    }
  }

  found.push(platform() === 'win32' ? 'java.exe' : 'java')
  return [...new Set(found)]
}

export async function detectJavaRuntimes(): Promise<JavaRuntime[]> {
  const results: JavaRuntime[] = []
  const seenHomes = new Set<string>()

  // Runtimes Brick installed itself take priority, so probe them first and let
  // them claim their java.home before any system alias for the same JVM.
  for (const major of [8, 17, 21]) {
    const bin = bundledJavaBin(major)
    if (!existsSync(bin)) continue
    const probed = await probeJava(bin)
    if (probed && !seenHomes.has(probed.home)) {
      seenHomes.add(probed.home)
      results.push({ ...probed, source: 'bundled' })
    }
  }

  for (const candidate of await findSystemJava()) {
    if (!existsSync(candidate) && !/^java(\.exe)?$/.test(candidate)) continue
    const probed = await probeJava(candidate)
    if (!probed || seenHomes.has(probed.home)) continue
    seenHomes.add(probed.home)
    results.push(probed)
  }

  return results.sort((a, b) => a.major - b.major)
}

interface AdoptiumAsset {
  binary: {
    package: { name: string; link: string; checksum: string; size: number }
  }
  release_name: string
}

function adoptiumOs(): string {
  switch (platform()) {
    case 'darwin':
      return 'mac'
    case 'win32':
      return 'windows'
    default:
      return 'linux'
  }
}

function adoptiumArch(): string {
  switch (arch()) {
    case 'arm64':
      return 'aarch64'
    case 'x64':
      return 'x64'
    default:
      return 'x64'
  }
}

/**
 * Download an Eclipse Temurin JRE of the requested major version into the
 * launcher's own java folder, so a user with no JDK installed can still play.
 */
export async function downloadJava(
  major: number,
  onProgress: (detail: string, progress: number) => void
): Promise<string> {
  const bin = bundledJavaBin(major)
  if (existsSync(bin)) return bin

  onProgress(`Looking up Java ${major}`, 0.05)
  const url =
    `https://api.adoptium.net/v3/assets/latest/${major}/hotspot` +
    `?architecture=${adoptiumArch()}&image_type=jre&os=${adoptiumOs()}&vendor=eclipse`
  const assets = await getJson<AdoptiumAsset[]>(url)
  if (!assets.length) throw new Error(`No Temurin JRE ${major} build for ${adoptiumOs()}/${adoptiumArch()}`)

  const pkg = assets[0].binary.package
  const home = join(paths.java, `jre-${major}`)
  const archive = join(paths.java, pkg.name)

  onProgress(`Downloading Java ${major} (${Math.round(pkg.size / 1048576)} MB)`, 0.2)
  await downloadFile({ url: pkg.link, dest: archive, size: pkg.size })

  onProgress(`Extracting Java ${major}`, 0.75)
  await rm(home, { recursive: true, force: true })
  await mkdir(home, { recursive: true })

  if (pkg.name.endsWith('.zip')) {
    const { default: AdmZip } = await import('adm-zip')
    new AdmZip(archive).extractAllTo(home, true)
  } else {
    // --strip-components drops the "jdk-21.0.5+11-jre" wrapper directory.
    await run('tar', ['-xzf', archive, '-C', home, '--strip-components=1'])
  }
  await rm(archive, { force: true })

  for (const candidate of candidateBinsFor(home)) {
    if (existsSync(candidate)) {
      await chmod(candidate, 0o755).catch(() => {})
      onProgress(`Java ${major} ready`, 1)
      return candidate
    }
  }
  throw new Error(`Extracted Java ${major} but found no java binary under ${home}`)
}

/**
 * Pick the java binary to launch with: an explicit override wins, otherwise a
 * detected runtime matching the version's requirement, otherwise download one.
 */
export async function resolveJavaFor(
  requiredMajor: number,
  override: string | undefined,
  onProgress: (detail: string, progress: number) => void
): Promise<string> {
  if (override) {
    const probed = await probeJava(override)
    if (probed) return override
    throw new Error(`Configured Java path is not runnable: ${override}`)
  }

  const runtimes = await detectJavaRuntimes()
  // Exact major first (Forge and old versions are picky), then any newer one
  // for modern Minecraft, which tolerates a higher JVM.
  const exact = runtimes.find((r) => r.major === requiredMajor)
  if (exact) return exact.path
  if (requiredMajor >= 17) {
    const newer = runtimes.find((r) => r.major >= requiredMajor)
    if (newer) return newer.path
  }
  return downloadJava(requiredMajor, onProgress)
}
