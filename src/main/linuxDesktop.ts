import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { paths } from './paths.js'

const run = promisify(execFile)

const APP_ID = 'brick-launcher'
const DESKTOP_FILE = `${APP_ID}.desktop`

/**
 * Registers the app with the Linux desktop: a menu entry plus a desktop
 * shortcut. AppImage and tar.gz builds are just loose binaries with no
 * installer to do this, so the app integrates itself on first run.
 */

/** Marker so a user who deletes the entry does not get it recreated forever. */
function markerPath(): string {
  return join(paths.root, '.desktop-integrated')
}

/**
 * The command the launcher should be started with. Inside an AppImage,
 * execPath points at the extracted temp mount, which disappears — the AppImage
 * runtime exports APPIMAGE with the real, stable path.
 */
function execCommand(): string {
  const target = process.env.APPIMAGE || process.execPath
  // Escape for the desktop-entry Exec key: quote, and backslash-escape quotes.
  return `"${target.replace(/(["\\$`])/g, '\\$1')}"`
}

async function iconTarget(): Promise<string | null> {
  const dir = join(homedir(), '.local', 'share', 'icons', 'hicolor', '512x512', 'apps')
  // Packaged builds carry the png via extraResources; fall back to the repo
  // copy so `npm run dev` on Linux integrates too.
  const sources = [
    join(process.resourcesPath ?? '', 'build', 'icon.png'),
    join(app.getAppPath(), 'build', 'icon.png'),
    join(process.cwd(), 'build', 'icon.png')
  ]
  const source = sources.find((p) => p && existsSync(p))
  if (!source) return null

  await mkdir(dir, { recursive: true })
  const dest = join(dir, `${APP_ID}.png`)
  await copyFile(source, dest)
  return dest
}

function desktopEntry(iconValue: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Brick Launcher',
    'GenericName=Minecraft Launcher',
    'Comment=Minecraft launcher with mod browsing and every loader',
    `Exec=${execCommand()} %U`,
    `Icon=${iconValue}`,
    'Terminal=false',
    'Categories=Game;ActionGame;',
    'Keywords=minecraft;mods;modrinth;curseforge;games;',
    `StartupWMClass=${APP_ID}`,
    ''
  ].join('\n')
}

/** GNOME/Nautilus refuse to run a desktop file until it is marked trusted. */
async function trustDesktopFile(path: string): Promise<void> {
  await chmod(path, 0o755).catch(() => {})
  await run('gio', ['set', path, 'metadata::trusted', 'true']).catch(() => {})
}

export interface IntegrationResult {
  applied: boolean
  menuEntry?: string
  desktopShortcut?: string
  reason?: string
}

export async function integrateLinuxDesktop(force = false): Promise<IntegrationResult> {
  if (platform() !== 'linux') return { applied: false, reason: 'Not running on Linux.' }
  if (!force && existsSync(markerPath())) {
    return { applied: false, reason: 'Already integrated once.' }
  }

  try {
    // An absolute icon path always resolves; the themed name only works once
    // the icon cache picks it up, so prefer the file we just wrote.
    const icon = await iconTarget()
    const entry = desktopEntry(icon ?? APP_ID)

    const appsDir = join(homedir(), '.local', 'share', 'applications')
    await mkdir(appsDir, { recursive: true })
    const menuEntry = join(appsDir, DESKTOP_FILE)
    await writeFile(menuEntry, entry)
    await chmod(menuEntry, 0o644).catch(() => {})

    // Desktop shortcut — XDG_DESKTOP_DIR covers localised folder names.
    let desktopDir = join(homedir(), 'Desktop')
    try {
      const { stdout } = await run('xdg-user-dir', ['DESKTOP'])
      if (stdout.trim()) desktopDir = stdout.trim()
    } catch {
      /* xdg-user-dirs not installed — fall back to ~/Desktop */
    }

    let desktopShortcut: string | undefined
    if (existsSync(desktopDir)) {
      desktopShortcut = join(desktopDir, DESKTOP_FILE)
      await writeFile(desktopShortcut, entry)
      await trustDesktopFile(desktopShortcut)
    }

    // Best-effort cache refresh so the entry shows without a re-login.
    await run('update-desktop-database', [appsDir]).catch(() => {})
    await run('gtk-update-icon-cache', [
      '-f',
      '-t',
      join(homedir(), '.local', 'share', 'icons', 'hicolor')
    ]).catch(() => {})

    await writeFile(markerPath(), new Date().toISOString())
    return { applied: true, menuEntry, desktopShortcut }
  } catch (err) {
    return { applied: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
