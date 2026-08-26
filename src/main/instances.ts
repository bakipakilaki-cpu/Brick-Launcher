import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { instanceDir } from './paths.js'
import { store } from './store.js'
import { installLoader } from './loaders/index.js'
import { installVersion } from './minecraft/install.js'
import type { Instance, LoaderId } from '../shared/types.js'

export function listInstances(): Instance[] {
  return store.get('instances')
}

export function getInstance(id: string): Instance | undefined {
  return store.get('instances').find((i) => i.id === id)
}

function save(instances: Instance[]): Instance[] {
  store.set('instances', instances)
  return instances
}

export function updateInstance(id: string, patch: Partial<Instance>): Instance[] {
  const instances = store.get('instances')
  const index = instances.findIndex((i) => i.id === id)
  if (index < 0) throw new Error('Instance not found')
  instances[index] = { ...instances[index], ...patch, id }
  return save(instances)
}

export interface CreateInstanceArgs {
  name: string
  mcVersion: string
  loader: LoaderId
  loaderVersion?: string
  icon?: string
  memoryMb?: number
  group?: string
}

/**
 * Register an instance and lay out its folders without downloading anything.
 * Modpack installs need the folder to exist before they know which Minecraft
 * version and loader the pack actually wants.
 */
export async function createInstanceRecord(args: CreateInstanceArgs): Promise<Instance> {
  const settings = store.get('settings')
  const instance: Instance = {
    id: randomUUID(),
    name: args.name.trim() || `${args.loader} ${args.mcVersion}`,
    mcVersion: args.mcVersion,
    loader: args.loader,
    loaderVersion: args.loaderVersion,
    versionId: args.mcVersion,
    icon: args.icon,
    createdAt: Date.now(),
    totalPlaySeconds: 0,
    memoryMb: args.memoryMb ?? settings.defaultMemoryMb,
    installed: false,
    group: args.group
  }

  save([...store.get('instances'), instance])

  const dir = instanceDir(instance.id)
  for (const sub of ['mods', 'shaderpacks', 'resourcepacks', 'saves', 'config', '.brick']) {
    await mkdir(join(dir, sub), { recursive: true })
  }
  return instance
}

/**
 * Create the instance record and folder up front so it appears in the UI
 * immediately, then install the loader and game files in the background.
 */
export async function createInstance(
  args: CreateInstanceArgs,
  onProgress: (stage: string, detail: string, progress: number) => void
): Promise<Instance> {
  const settings = store.get('settings')
  const id = randomUUID()

  const instance: Instance = {
    id,
    name: args.name.trim() || `${args.loader} ${args.mcVersion}`,
    mcVersion: args.mcVersion,
    loader: args.loader,
    loaderVersion: args.loaderVersion,
    versionId: args.mcVersion,
    icon: args.icon,
    createdAt: Date.now(),
    totalPlaySeconds: 0,
    memoryMb: args.memoryMb ?? settings.defaultMemoryMb,
    installed: false,
    group: args.group
  }

  save([...store.get('instances'), instance])

  const dir = instanceDir(id)
  for (const sub of ['mods', 'shaderpacks', 'resourcepacks', 'saves', 'config', '.brick']) {
    await mkdir(join(dir, sub), { recursive: true })
  }

  try {
    onProgress('Installing loader', args.loader, 0.05)
    const { versionId, loaderVersion } = await installLoader(
      args.loader,
      args.mcVersion,
      args.loaderVersion,
      settings.concurrentDownloads,
      (p) => onProgress(p.stage, p.detail, 0.05 + p.progress * 0.35)
    )

    updateInstance(id, { versionId, loaderVersion })

    await installVersion(versionId, settings.concurrentDownloads, (p) =>
      onProgress(p.stage, p.detail, 0.4 + p.progress * 0.6)
    )

    updateInstance(id, { installed: true })
    onProgress('Ready to play', instance.name, 1)
  } catch (err) {
    // Keep the record so the user can retry or delete it, but mark it broken.
    updateInstance(id, { installed: false })
    throw err
  }

  return getInstance(id)!
}

export async function deleteInstance(id: string): Promise<Instance[]> {
  await rm(instanceDir(id), { recursive: true, force: true })
  return save(store.get('instances').filter((i) => i.id !== id))
}

export async function duplicateInstance(id: string, newName: string): Promise<Instance[]> {
  const source = getInstance(id)
  if (!source) throw new Error('Instance not found')

  const copy: Instance = {
    ...source,
    id: randomUUID(),
    name: newName,
    createdAt: Date.now(),
    lastPlayed: undefined,
    totalPlaySeconds: 0
  }

  const { cp } = await import('node:fs/promises')
  await cp(instanceDir(source.id), instanceDir(copy.id), { recursive: true })
  return save([...store.get('instances'), copy])
}

export function recordPlaySession(id: string, seconds: number): void {
  const instance = getInstance(id)
  if (!instance) return
  updateInstance(id, {
    lastPlayed: Date.now(),
    totalPlaySeconds: instance.totalPlaySeconds + Math.max(0, Math.round(seconds))
  })
}
