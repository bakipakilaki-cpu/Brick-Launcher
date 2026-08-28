"use strict";
const electron = require("electron");
async function call(channel, ...args) {
  const result = await electron.ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
function on(channel, listener) {
  const wrapped = (_event, payload) => listener(payload);
  electron.ipcRenderer.on(channel, wrapped);
  return () => electron.ipcRenderer.removeListener(channel, wrapped);
}
const api = {
  app: {
    info: () => call("app:info"),
    openPath: (path) => call("app:openPath", path),
    openExternal: (url) => call("app:openExternal", url),
    readImage: (filePath) => call("app:readImage", filePath),
    createShortcuts: () => call("app:createShortcuts"),
    pickFiles: (options) => call("app:pickFiles", options)
  },
  settings: {
    get: () => call("settings:get"),
    set: (patch) => call("settings:set", patch)
  },
  accounts: {
    list: () => call("accounts:list"),
    signInMicrosoft: () => call("accounts:signInMicrosoft"),
    addOffline: (username) => call("accounts:addOffline", username),
    remove: (id) => call("accounts:remove", id),
    setActive: (id) => call("accounts:setActive", id),
    refresh: (id) => call("accounts:refresh", id)
  },
  versions: {
    list: (includeSnapshots) => call("versions:list", includeSnapshots),
    latest: () => call("versions:latest"),
    loaderBuilds: (loader, mcVersion) => call("loaders:builds", loader, mcVersion)
  },
  java: {
    detect: () => call("java:detect"),
    install: (major) => call("java:install", major)
  },
  instances: {
    list: () => call("instances:list"),
    get: (id) => call("instances:get", id),
    create: (args) => call("instances:create", args),
    update: (id, patch) => call("instances:update", id, patch),
    remove: (id) => call("instances:delete", id),
    duplicate: (id, name) => call("instances:duplicate", id, name),
    openFolder: (id) => call("instances:openFolder", id),
    repair: (id) => call("instances:repair", id)
  },
  game: {
    launch: (instanceId, accountId) => call("game:launch", instanceId, accountId),
    stop: (instanceId) => call("game:stop", instanceId),
    running: () => call("game:running")
  },
  content: {
    list: (instanceId, type) => call("content:list", instanceId, type),
    install: (args) => call("content:install", args),
    setEnabled: (instanceId, type, fileName, enabled) => call("content:setEnabled", instanceId, type, fileName, enabled),
    remove: (instanceId, type, fileName) => call("content:remove", instanceId, type, fileName),
    identify: (instanceId, type) => call("content:identify", instanceId, type),
    import: (instanceId, type, filePaths) => call("content:import", instanceId, type, filePaths),
    checkUpdates: (instanceId, type, gameVersion, loader) => call("content:checkUpdates", instanceId, type, gameVersion, loader)
  },
  worlds: {
    list: (instanceId) => call("worlds:list", instanceId),
    import: (instanceId, sourcePath) => call("worlds:import", instanceId, sourcePath),
    remove: (instanceId, folderName) => call("worlds:delete", instanceId, folderName)
  },
  browse: {
    search: (query) => call("browse:search", query),
    versions: (source, projectId, gameVersion, loader) => call("browse:versions", source, projectId, gameVersion, loader),
    project: (source, projectId) => call("browse:project", source, projectId),
    categories: () => call("browse:categories"),
    curseforgeReady: () => call("browse:curseforgeReady")
  },
  modpack: {
    install: (args) => call("modpack:install", args)
  },
  servers: {
    list: (instanceId) => call("servers:list", instanceId),
    add: (instanceId, entry) => call("servers:add", instanceId, entry),
    update: (instanceId, index, patch) => call("servers:update", instanceId, index, patch),
    remove: (instanceId, index) => call("servers:remove", instanceId, index),
    move: (instanceId, index, delta) => call("servers:move", instanceId, index, delta),
    ping: (address) => call("servers:ping", address)
  },
  diagnose: {
    analyze: (instanceId, logText) => call("diagnose:analyze", instanceId, logText),
    apply: (instanceId, fixes) => call("diagnose:apply", instanceId, fixes)
  },
  skins: {
    list: () => call("skins:list"),
    addFile: (filePath, name, variant) => call("skins:addFile", filePath, name, variant),
    addUrl: (url, name, variant) => call("skins:addUrl", url, name, variant),
    remove: (id) => call("skins:remove", id),
    rename: (id, name) => call("skins:rename", id, name),
    dataUrl: (id) => call("skins:dataUrl", id),
    apply: (accountId, skinId) => call("skins:apply", accountId, skinId),
    reset: (accountId) => call("skins:reset", accountId),
    setCape: (accountId, capeId) => call("skins:setCape", accountId, capeId)
  },
  logs: {
    open: () => call("logs:open"),
    openInstance: (instanceId) => call("logs:openInstance", instanceId)
  },
  events: {
    onTask: (listener) => on("task:update", listener),
    onGameStatus: (listener) => on("game:status", listener),
    onGameLog: (listener) => on("game:log", listener),
    onInstancesChanged: (listener) => on("instances:changed", listener)
  }
};
electron.contextBridge.exposeInMainWorld("brick", api);
