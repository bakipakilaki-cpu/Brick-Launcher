import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { paths } from './paths.js'
import { store } from './store.js'
import { fetchWithRetry } from './net/download.js'
import { ensureValidSession } from './auth/accounts.js'
import type { SkinEntry } from '../shared/types.js'

const SKIN_API = 'https://api.minecraftservices.com/minecraft/profile/skins'
const CAPE_API = 'https://api.minecraftservices.com/minecraft/profile/capes/active'

export function listSkins(): SkinEntry[] {
  return store.get('skins')
}

/** Minimal PNG header check so we reject non-skin files before uploading. */
function assertPng(buffer: Buffer): void {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!buffer.subarray(0, 8).equals(signature)) {
    throw new Error('Skins must be PNG images.')
  }
  // Dimensions live at bytes 16..24 of the IHDR chunk.
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const valid = width === 64 && (height === 64 || height === 32)
  if (!valid) {
    throw new Error(`Skin must be 64×64 (or legacy 64×32). This image is ${width}×${height}.`)
  }
}

export async function addSkinFromFile(
  filePath: string,
  name: string,
  variant: 'classic' | 'slim'
): Promise<SkinEntry[]> {
  const buffer = await readFile(filePath)
  assertPng(buffer)

  await mkdir(paths.skins, { recursive: true })
  const id = randomUUID()
  const dest = join(paths.skins, `${id}.png`)
  await copyFile(filePath, dest)

  const entry: SkinEntry = {
    id,
    name: name.trim() || basename(filePath).replace(/\.png$/i, ''),
    path: dest,
    variant,
    addedAt: Date.now()
  }
  store.set('skins', [...store.get('skins'), entry])
  return listSkins()
}

/** Save a skin fetched from a URL (e.g. the account's current Mojang skin). */
export async function addSkinFromUrl(
  url: string,
  name: string,
  variant: 'classic' | 'slim'
): Promise<SkinEntry[]> {
  const res = await fetchWithRetry(url)
  const buffer = Buffer.from(await res.arrayBuffer())
  assertPng(buffer)

  await mkdir(paths.skins, { recursive: true })
  const id = randomUUID()
  const dest = join(paths.skins, `${id}.png`)
  await writeFile(dest, buffer)

  const entry: SkinEntry = { id, name: name.trim() || 'Imported skin', path: dest, variant, addedAt: Date.now() }
  store.set('skins', [...store.get('skins'), entry])
  return listSkins()
}

export async function removeSkin(id: string): Promise<SkinEntry[]> {
  const entry = store.get('skins').find((s) => s.id === id)
  if (entry) await rm(entry.path, { force: true })
  store.set(
    'skins',
    store.get('skins').filter((s) => s.id !== id)
  )
  return listSkins()
}

export function renameSkin(id: string, name: string): SkinEntry[] {
  const skins = store.get('skins').map((s) => (s.id === id ? { ...s, name } : s))
  store.set('skins', skins)
  return listSkins()
}

/** Read a stored skin as a data URL so the renderer can preview it. */
export async function readSkinDataUrl(id: string): Promise<string> {
  const entry = store.get('skins').find((s) => s.id === id)
  if (!entry) throw new Error('Skin not found')
  const buffer = await readFile(entry.path)
  return `data:image/png;base64,${buffer.toString('base64')}`
}

export class SkinNotSupported extends Error {
  constructor() {
    super(
      'Offline accounts cannot upload skins — Mojang only serves skins for accounts that own the game. ' +
        'The skin library still works for singleplayer with a skin-loading mod, and for servers that run their own skin system.'
    )
    this.name = 'SkinNotSupported'
  }
}

/**
 * Upload a stored skin to Mojang for a signed-in Microsoft account. This is the
 * same endpoint the official launcher uses, so the change shows up everywhere.
 */
export async function applySkin(accountId: string, skinId: string): Promise<void> {
  const account = await ensureValidSession(accountId)
  if (account.kind !== 'microsoft' || !account.accessToken) throw new SkinNotSupported()

  const entry = store.get('skins').find((s) => s.id === skinId)
  if (!entry) throw new Error('Skin not found')
  const buffer = await readFile(entry.path)
  assertPng(buffer)

  const form = new FormData()
  form.append('variant', entry.variant)
  form.append('file', new Blob([buffer], { type: 'image/png' }), 'skin.png')

  const res = await fetch(SKIN_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.accessToken}` },
    body: form
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Mojang rejected the skin upload (HTTP ${res.status}). ${body.slice(0, 200)}`)
  }
}

export async function resetSkin(accountId: string): Promise<void> {
  const account = await ensureValidSession(accountId)
  if (account.kind !== 'microsoft' || !account.accessToken) throw new SkinNotSupported()

  const res = await fetch(SKIN_API, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${account.accessToken}` }
  })
  if (!res.ok) throw new Error(`Could not reset the skin (HTTP ${res.status}).`)
}

export async function setCape(accountId: string, capeId: string | null): Promise<void> {
  const account = await ensureValidSession(accountId)
  if (account.kind !== 'microsoft' || !account.accessToken) throw new SkinNotSupported()

  const res = await fetch(CAPE_API, {
    method: capeId ? 'PUT' : 'DELETE',
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: capeId ? JSON.stringify({ capeId }) : undefined
  })
  if (!res.ok) throw new Error(`Could not change the cape (HTTP ${res.status}).`)
}
