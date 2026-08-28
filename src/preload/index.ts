import { contextBridge, ipcRenderer } from 'electron'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * Unwrap the main process's result envelope. Handlers there never throw across
 * the bridge, so failures arrive as `{ ok: false }` and become real errors here
 * — letting the renderer use plain try/catch.
 */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as Result<T>
  if (!result.ok) throw new Error(result.error)
  return result.data
}

function on(channel: string, listener: (payload: unknown) => void): () => void {
  const wrapped = (_event: unknown, payload: unknown): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api = {
  app: {
    info: () => call('app:info'),
    openPath: (path: string) => call<void>('app:openPath', path),
    openExternal: (url: string) => call<void>('app:openExternal', url),
    readImage: (filePath: string) => call<string>('app:readImage', filePath),
    createShortcuts: () => call('app:createShortcuts'),
    pickFiles: (options: {
      filters?: { name: string; extensions: string[] }[]
      multi?: boolean
      directory?: boolean
    }) => call<string[]>('app:pickFiles', options)
  },
  settings: {
    get: () => call('settings:get'),
    set: (patch: unknown) => call('settings:set', patch)
  },
  accounts: {
    list: () => call('accounts:list'),
    signInMicrosoft: () => call('accounts:signInMicrosoft'),
    signInDevice: () => call('accounts:signInDevice'),
    cancelDeviceSignIn: () => call<void>('accounts:cancelDeviceSignIn'),
    hasClientId: () => call<boolean>('accounts:hasClientId'),
    onDevicePrompt: (listener: (payload: unknown) => void) => on('accounts:devicePrompt', listener),
    addOffline: (username: string) => call('accounts:addOffline', username),
    remove: (id: string) => call('accounts:remove', id),
    setActive: (id: string) => call('accounts:setActive', id),
    refresh: (id: string) => call('accounts:refresh', id)
  },
  versions: {
    list: (includeSnapshots: boolean) => call('versions:list', includeSnapshots),
    latest: () => call('versions:latest'),
    loaderBuilds: (loader: string, mcVersion: string) => call('loaders:builds', loader, mcVersion)
  },
  java: {
    detect: () => call('java:detect'),
    install: (major: number) => call<string>('java:install', major)
  },
  instances: {
    list: () => call('instances:list'),
    get: (id: string) => call('instances:get', id),
    create: (args: unknown) => call('instances:create', args),
    update: (id: string, patch: unknown) => call('instances:update', id, patch),
    remove: (id: string) => call('instances:delete', id),
    duplicate: (id: string, name: string) => call('instances:duplicate', id, name),
    openFolder: (id: string) => call<void>('instances:openFolder', id),
    repair: (id: string) => call<void>('instances:repair', id)
  },
  game: {
    launch: (instanceId: string, accountId?: string) => call('game:launch', instanceId, accountId),
    stop: (instanceId: string) => call<boolean>('game:stop', instanceId),
    running: () => call<string[]>('game:running')
  },
  content: {
    list: (instanceId: string, type: string) => call('content:list', instanceId, type),
    install: (args: unknown) => call('content:install', args),
    setEnabled: (instanceId: string, type: string, fileName: string, enabled: boolean) =>
      call('content:setEnabled', instanceId, type, fileName, enabled),
    remove: (instanceId: string, type: string, fileName: string) =>
      call('content:remove', instanceId, type, fileName),
    identify: (instanceId: string, type: string) => call('content:identify', instanceId, type),
    import: (instanceId: string, type: string, filePaths: string[]) =>
      call('content:import', instanceId, type, filePaths),
    checkUpdates: (instanceId: string, type: string, gameVersion: string, loader: string) =>
      call('content:checkUpdates', instanceId, type, gameVersion, loader)
  },
  worlds: {
    list: (instanceId: string) => call('worlds:list', instanceId),
    import: (instanceId: string, sourcePath: string) => call('worlds:import', instanceId, sourcePath),
    remove: (instanceId: string, folderName: string) => call('worlds:delete', instanceId, folderName)
  },
  browse: {
    search: (query: unknown) => call('browse:search', query),
    versions: (source: string, projectId: string, gameVersion?: string, loader?: string) =>
      call('browse:versions', source, projectId, gameVersion, loader),
    project: (source: string, projectId: string) => call('browse:project', source, projectId),
    categories: () => call('browse:categories'),
    curseforgeReady: () => call<boolean>('browse:curseforgeReady')
  },
  modpack: {
    install: (args: unknown) => call('modpack:install', args)
  },
  servers: {
    list: (instanceId: string) => call('servers:list', instanceId),
    add: (instanceId: string, entry: unknown) => call('servers:add', instanceId, entry),
    update: (instanceId: string, index: number, patch: unknown) =>
      call('servers:update', instanceId, index, patch),
    remove: (instanceId: string, index: number) => call('servers:remove', instanceId, index),
    move: (instanceId: string, index: number, delta: number) =>
      call('servers:move', instanceId, index, delta),
    ping: (address: string) => call('servers:ping', address)
  },
  diagnose: {
    analyze: (instanceId: string, logText: string) =>
      call('diagnose:analyze', instanceId, logText),
    apply: (instanceId: string, fixes: unknown[]) => call('diagnose:apply', instanceId, fixes)
  },
  skins: {
    list: () => call('skins:list'),
    addFile: (filePath: string, name: string, variant: string) =>
      call('skins:addFile', filePath, name, variant),
    addUrl: (url: string, name: string, variant: string) => call('skins:addUrl', url, name, variant),
    remove: (id: string) => call('skins:remove', id),
    rename: (id: string, name: string) => call('skins:rename', id, name),
    dataUrl: (id: string) => call<string>('skins:dataUrl', id),
    apply: (accountId: string, skinId: string) => call<void>('skins:apply', accountId, skinId),
    reset: (accountId: string) => call<void>('skins:reset', accountId),
    setCape: (accountId: string, capeId: string | null) =>
      call<void>('skins:setCape', accountId, capeId)
  },
  logs: {
    open: () => call<void>('logs:open'),
    openInstance: (instanceId: string) => call<void>('logs:openInstance', instanceId)
  },
  events: {
    onTask: (listener: (payload: unknown) => void) => on('task:update', listener),
    onGameStatus: (listener: (payload: unknown) => void) => on('game:status', listener),
    onGameLog: (listener: (payload: unknown) => void) => on('game:log', listener),
    onInstancesChanged: (listener: (payload: unknown) => void) => on('instances:changed', listener)
  }
}

contextBridge.exposeInMainWorld('brick', api)

export type BrickApi = typeof api
