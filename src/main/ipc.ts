import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { instanceDir, paths } from './paths.js'
import { store } from './store.js'
import * as accounts from './auth/accounts.js'
import * as instances from './instances.js'
import * as skins from './skins.js'
import * as servers from './servers.js'
import * as content from './mods/content.js'
import * as modrinth from './mods/modrinth.js'
import * as curseforge from './mods/curseforge.js'
import { diagnose, type ProposedFix } from './mods/diagnose.js'
import { listVersions as listMcVersions, getVersionManifest } from './minecraft/manifest.js'
import { installLoader, listLoaderBuilds } from './loaders/index.js'
import { installVersion } from './minecraft/install.js'
import { launchInstance, repairInstance } from './minecraft/launch.js'
import { detectJavaRuntimes, downloadJava } from './minecraft/java.js'
import type { ProjectType, SearchQuery } from '../shared/types.js'

/** Running games, keyed by instance id. */
const running = new Map<string, { child: ChildProcess; startedAt: number }>()

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** Report a long-running job to the renderer under a stable task id. */
function makeReporter(label: string): {
  id: string
  step: (stage: string, detail: string, progress: number) => void
  done: () => void
  fail: (message: string) => void
} {
  const id = randomUUID()
  broadcast('task:update', { id, label, detail: '', progress: 0, done: false })
  return {
    id,
    step: (stage, detail, progress) =>
      broadcast('task:update', { id, label: stage || label, detail, progress, done: false }),
    done: () => broadcast('task:update', { id, label, detail: '', progress: 1, done: true }),
    fail: (message) =>
      broadcast('task:update', { id, label, detail: '', progress: 1, done: true, error: message })
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const hint = (err as Error & { hint?: string }).hint
    return hint ? `${err.message}\n\n${hint}` : err.message
  }
  return String(err)
}

/** Wrap a handler so thrown errors reach the renderer as readable text. */
function handle<T extends unknown[], R>(
  channel: string,
  fn: (...args: T) => Promise<R> | R
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true as const, data: await fn(...(args as T)) }
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) }
    }
  })
}

export function registerIpc(): void {
  /* -------------------------------- app -------------------------------- */

  handle('app:info', () => ({
    paths,
    platform: process.platform,
    arch: process.arch
  }))

  handle('app:openPath', async (target: string) => {
    await shell.openPath(target)
  })

  handle('app:openExternal', async (url: string) => {
    // Only ever hand http(s) links to the OS browser.
    if (!/^https?:\/\//i.test(url)) throw new Error('Refusing to open a non-web link.')
    await shell.openExternal(url)
  })

  /**
   * Read a local image as a data URL. The renderer cannot fetch file:// URLs
   * under its CSP, so image picking has to come back through here.
   */
  handle('app:readImage', async (filePath: string) => {
    if (!/\.(png|jpe?g|webp|gif)$/i.test(filePath)) {
      throw new Error('That file is not an image.')
    }
    const { readFile, stat } = await import('node:fs/promises')
    const info = await stat(filePath)
    if (info.size > 8 * 1024 * 1024) throw new Error('Image is too large (max 8 MB).')

    const buffer = await readFile(filePath)
    const ext = filePath.split('.').pop()!.toLowerCase()
    const mime = ext === 'jpg' ? 'jpeg' : ext
    return `data:image/${mime};base64,${buffer.toString('base64')}`
  })

  handle('app:pickFiles', async (options: { filters?: { name: string; extensions: string[] }[]; multi?: boolean; directory?: boolean }) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      properties: [
        options.directory ? 'openDirectory' : 'openFile',
        ...(options.multi ? (['multiSelections'] as const) : [])
      ],
      filters: options.filters
    })
    return result.canceled ? [] : result.filePaths
  })

  /* ------------------------------ settings ----------------------------- */

  handle('settings:get', () => store.get('settings'))
  handle('settings:set', (patch: Record<string, unknown>) => store.patchSettings(patch))

  /* ------------------------------ accounts ----------------------------- */

  handle('accounts:list', () => ({
    accounts: accounts.listAccounts(),
    activeId: accounts.getActiveAccountId()
  }))
  handle('accounts:signInMicrosoft', () => accounts.signIn())
  handle('accounts:addOffline', (username: string) =>
    accounts.addAccount(accounts.createOfflineAccount(username))
  )
  handle('accounts:remove', (id: string) => accounts.removeAccount(id))
  handle('accounts:setActive', (id: string) => {
    accounts.setActiveAccount(id)
    return accounts.getActiveAccountId()
  })
  handle('accounts:refresh', async (id: string) => {
    await accounts.ensureValidSession(id)
    return accounts.listAccounts()
  })

  /* ------------------------------ versions ----------------------------- */

  handle('versions:list', (includeSnapshots: boolean) => listMcVersions(includeSnapshots))
  handle('versions:latest', async () => (await getVersionManifest()).latest)
  handle('loaders:builds', (loader: Parameters<typeof listLoaderBuilds>[0], mcVersion: string) =>
    listLoaderBuilds(loader, mcVersion)
  )

  /* ------------------------------- java -------------------------------- */

  handle('java:detect', () => detectJavaRuntimes())
  handle('java:install', async (major: number) => {
    const task = makeReporter(`Installing Java ${major}`)
    try {
      const path = await downloadJava(major, (detail, progress) =>
        task.step(`Installing Java ${major}`, detail, progress)
      )
      task.done()
      return path
    } catch (err) {
      task.fail(errorMessage(err))
      throw err
    }
  })

  /* ----------------------------- instances ----------------------------- */

  handle('instances:list', () => instances.listInstances())
  handle('instances:get', (id: string) => instances.getInstance(id))

  handle('instances:create', async (args: instances.CreateInstanceArgs) => {
    const task = makeReporter(`Creating ${args.name}`)
    try {
      const instance = await instances.createInstance(args, (stage, detail, progress) =>
        task.step(stage, detail, progress)
      )
      task.done()
      broadcast('instances:changed', instances.listInstances())
      return instance
    } catch (err) {
      task.fail(errorMessage(err))
      broadcast('instances:changed', instances.listInstances())
      throw err
    }
  })

  handle('instances:update', (id: string, patch: Record<string, unknown>) => {
    const list = instances.updateInstance(id, patch)
    broadcast('instances:changed', list)
    return list
  })

  handle('instances:delete', async (id: string) => {
    const list = await instances.deleteInstance(id)
    broadcast('instances:changed', list)
    return list
  })

  handle('instances:duplicate', async (id: string, name: string) => {
    const list = await instances.duplicateInstance(id, name)
    broadcast('instances:changed', list)
    return list
  })

  handle('instances:openFolder', async (id: string) => {
    await shell.openPath(instanceDir(id))
  })

  handle('instances:repair', async (id: string) => {
    const instance = instances.getInstance(id)
    if (!instance) throw new Error('Instance not found')
    const task = makeReporter(`Repairing ${instance.name}`)
    try {
      await repairInstance(instance.versionId, store.get('settings').concurrentDownloads, (stage, detail, progress) =>
        task.step(stage, detail, progress)
      )
      instances.updateInstance(id, { installed: true })
      task.done()
      broadcast('instances:changed', instances.listInstances())
    } catch (err) {
      task.fail(errorMessage(err))
      throw err
    }
  })

  /* ------------------------------ launching ---------------------------- */

  handle('game:launch', async (instanceId: string, accountId?: string) => {
    if (running.has(instanceId)) throw new Error('That instance is already running.')

    const instance = instances.getInstance(instanceId)
    if (!instance) throw new Error('Instance not found')

    const id = accountId ?? accounts.getActiveAccountId()
    if (!id) throw new Error('Add an account before launching.')
    const account = await accounts.ensureValidSession(id)

    const task = makeReporter(`Launching ${instance.name}`)
    broadcast('game:status', { state: 'preparing', instanceId })

    try {
      const handle = await launchInstance({
        instance,
        account,
        settings: store.get('settings'),
        onProgress: (stage, detail, progress) => task.step(stage, detail, progress),
        onLog: (line) => broadcast('game:log', { instanceId, line }),
        onExit: (code) => {
          const entry = running.get(instanceId)
          if (entry) {
            instances.recordPlaySession(instanceId, (Date.now() - entry.startedAt) / 1000)
            running.delete(instanceId)
          }
          broadcast('instances:changed', instances.listInstances())
          broadcast(
            'game:status',
            code === 0 || code === null
              ? { state: 'idle' }
              : { state: 'crashed', instanceId, code }
          )
        }
      })

      running.set(instanceId, { child: handle.process, startedAt: Date.now() })
      instances.updateInstance(instanceId, { installed: true, lastPlayed: Date.now() })
      task.done()
      broadcast('game:status', { state: 'running', instanceId, pid: handle.process.pid ?? -1 })
      broadcast('instances:changed', instances.listInstances())

      if (store.get('settings').closeLauncherOnLaunch) {
        setTimeout(() => BrowserWindow.getAllWindows().forEach((w) => w.minimize()), 3000)
      }
      return { pid: handle.process.pid, logPath: handle.logPath }
    } catch (err) {
      task.fail(errorMessage(err))
      broadcast('game:status', { state: 'idle' })
      throw err
    }
  })

  handle('game:stop', (instanceId: string) => {
    const entry = running.get(instanceId)
    if (!entry) return false
    entry.child.kill()
    return true
  })

  handle('game:running', () => [...running.keys()])

  /* ------------------------------- content ----------------------------- */

  handle('content:list', (instanceId: string, type: Exclude<ProjectType, 'modpack'>) =>
    content.listContent(instanceId, type)
  )

  handle('content:install', async (args: content.InstallContentArgs) => {
    const task = makeReporter(`Installing ${args.projectTitle}`)
    try {
      const list = await content.installContent(args)
      task.done()
      return list
    } catch (err) {
      task.fail(errorMessage(err))
      throw err
    }
  })

  handle(
    'content:setEnabled',
    (instanceId: string, type: Exclude<ProjectType, 'modpack'>, fileName: string, enabled: boolean) =>
      content.setContentEnabled(instanceId, type, fileName, enabled)
  )

  handle('content:remove', (instanceId: string, type: Exclude<ProjectType, 'modpack'>, fileName: string) =>
    content.removeContent(instanceId, type, fileName)
  )

  handle('content:identify', (instanceId: string, type: Exclude<ProjectType, 'modpack'>) =>
    content.identifyLocalContent(instanceId, type)
  )

  handle(
    'content:import',
    (instanceId: string, type: Exclude<ProjectType, 'modpack'>, filePaths: string[]) =>
      content.importLocalFiles(instanceId, type, filePaths)
  )

  handle(
    'content:checkUpdates',
    (instanceId: string, type: Exclude<ProjectType, 'modpack'>, gameVersion: string, loader: string) =>
      content.checkForUpdates(instanceId, type, gameVersion, loader)
  )

  /* -------------------------------- worlds ----------------------------- */

  handle('worlds:list', (instanceId: string) => content.listWorlds(instanceId))
  handle('worlds:import', async (instanceId: string, sourcePath: string) => {
    const task = makeReporter('Importing world')
    try {
      const list = await content.importWorld(instanceId, sourcePath)
      task.done()
      return list
    } catch (err) {
      task.fail(errorMessage(err))
      throw err
    }
  })
  handle('worlds:delete', (instanceId: string, folderName: string) =>
    content.deleteWorld(instanceId, folderName)
  )

  /* ------------------------------- browsing ---------------------------- */

  handle('browse:search', (query: SearchQuery) =>
    query.source === 'curseforge' ? curseforge.search(query) : modrinth.search(query)
  )

  handle('browse:versions', (source: string, projectId: string, gameVersion?: string, loader?: string) =>
    source === 'curseforge'
      ? curseforge.listVersions(projectId, gameVersion, loader)
      : modrinth.listVersions(projectId, gameVersion, loader)
  )

  handle('browse:project', (source: string, projectId: string) =>
    source === 'curseforge' ? curseforge.getProject(projectId) : modrinth.getProject(projectId)
  )

  handle('browse:categories', () => modrinth.listCategories())
  handle('browse:curseforgeReady', () => curseforge.hasApiKey())

  /* ------------------------------- modpacks ---------------------------- */

  handle(
    'modpack:install',
    async (args: {
      name: string
      packUrl: string
      packSha1?: string
      icon?: string
    }) => {
      const task = makeReporter(`Installing ${args.name}`)
      try {
        // Register the folder only — the pack's own index tells us which
        // Minecraft version and loader to install once it is unpacked, so
        // installing anything up front would just be thrown away.
        const placeholder = await instances.createInstanceRecord({
          name: args.name,
          mcVersion: '',
          loader: 'vanilla',
          icon: args.icon
        })

        const info = await content.installMrPack(
          placeholder.id,
          args.packUrl,
          args.packSha1,
          store.get('settings').concurrentDownloads,
          (stage, detail, progress) => task.step(stage, detail, progress * 0.5)
        )

        const { versionId, loaderVersion } = await installLoader(
          info.loader as never,
          info.mcVersion,
          info.loaderVersion,
          store.get('settings').concurrentDownloads,
          (p) => task.step(p.stage, p.detail, 0.5 + p.progress * 0.2)
        )

        await installVersion(versionId, store.get('settings').concurrentDownloads, (p) =>
          task.step(p.stage, p.detail, 0.7 + p.progress * 0.3)
        )

        instances.updateInstance(placeholder.id, {
          name: info.name || args.name,
          mcVersion: info.mcVersion,
          loader: info.loader as never,
          loaderVersion,
          versionId,
          installed: true
        })
        // Mods the pack shipped are on disk but unnamed; match them up so the
        // instance's mod list shows real titles and icons.
        await content.identifyLocalContent(placeholder.id, 'mod').catch(() => {})

        task.done()
        broadcast('instances:changed', instances.listInstances())
        return instances.getInstance(placeholder.id)
      } catch (err) {
        task.fail(errorMessage(err))
        broadcast('instances:changed', instances.listInstances())
        throw err
      }
    }
  )

  /* ------------------------------ servers ------------------------------ */

  handle('servers:list', (instanceId: string) => servers.listServers(instanceId))
  handle('servers:add', (instanceId: string, entry: servers.ServerEntry) =>
    servers.addServer(instanceId, entry)
  )
  handle('servers:update', (instanceId: string, index: number, patch: Partial<servers.ServerEntry>) =>
    servers.updateServer(instanceId, index, patch)
  )
  handle('servers:remove', (instanceId: string, index: number) =>
    servers.removeServer(instanceId, index)
  )
  handle('servers:move', (instanceId: string, index: number, delta: number) =>
    servers.moveServer(instanceId, index, delta)
  )
  handle('servers:ping', (address: string) => servers.pingServer(address))

  /* ------------------------------ autofix ------------------------------ */

  handle('diagnose:analyze', async (instanceId: string, logText: string) => {
    const instance = instances.getInstance(instanceId)
    if (!instance) throw new Error('Instance not found')
    return diagnose({
      instanceId,
      gameVersion: instance.mcVersion,
      loader: instance.loader,
      logText: logText ?? ''
    })
  })

  handle('diagnose:apply', async (instanceId: string, fixes: ProposedFix[]) => {
    const instance = instances.getInstance(instanceId)
    if (!instance) throw new Error('Instance not found')

    const task = makeReporter('Fixing mods')
    const applied: string[] = []
    const failed: string[] = []

    try {
      for (const [index, fix] of fixes.entries()) {
        task.step('Fixing mods', fix.modId, index / Math.max(1, fixes.length))

        try {
          // A replace swaps the jar, so drop the old file before adding the new
          // one — otherwise the loader sees two copies of the same mod.
          if (fix.targetFileName && (fix.action === 'remove' || fix.action === 'replace')) {
            await content.removeContent(instanceId, 'mod', fix.targetFileName)
          }

          if (fix.action !== 'remove') {
            if (!fix.version || !fix.project) {
              failed.push(`${fix.modId}: nothing to install`)
              continue
            }
            await content.installContent({
              instanceId,
              type: 'mod',
              version: { ...fix.version, projectId: fix.project.id } as never,
              projectTitle: fix.project.title,
              iconUrl: fix.project.iconUrl
            })
          }
          applied.push(fix.modId)
        } catch (err) {
          failed.push(`${fix.modId}: ${errorMessage(err)}`)
        }
      }

      task.done()
      return { applied, failed, content: await content.listContent(instanceId, 'mod') }
    } catch (err) {
      task.fail(errorMessage(err))
      throw err
    }
  })

  /* --------------------------------- skins ----------------------------- */

  handle('skins:list', () => skins.listSkins())
  handle('skins:addFile', (filePath: string, name: string, variant: 'classic' | 'slim') =>
    skins.addSkinFromFile(filePath, name, variant)
  )
  handle('skins:addUrl', (url: string, name: string, variant: 'classic' | 'slim') =>
    skins.addSkinFromUrl(url, name, variant)
  )
  handle('skins:remove', (id: string) => skins.removeSkin(id))
  handle('skins:rename', (id: string, name: string) => skins.renameSkin(id, name))
  handle('skins:dataUrl', (id: string) => skins.readSkinDataUrl(id))
  handle('skins:apply', (accountId: string, skinId: string) => skins.applySkin(accountId, skinId))
  handle('skins:reset', (accountId: string) => skins.resetSkin(accountId))
  handle('skins:setCape', (accountId: string, capeId: string | null) =>
    skins.setCape(accountId, capeId)
  )

  /* --------------------------------- logs ------------------------------ */

  handle('logs:open', async () => {
    await shell.openPath(paths.logs)
  })
  handle('logs:openInstance', async (instanceId: string) => {
    await shell.openPath(join(instanceDir(instanceId), 'logs'))
  })
}

/** Kill any still-running games when the launcher quits. */
export function stopAllGames(): void {
  for (const { child } of running.values()) child.kill()
  running.clear()
}
