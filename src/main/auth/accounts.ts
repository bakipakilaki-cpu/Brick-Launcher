import { createHash, randomUUID } from 'node:crypto'
import { store } from '../store.js'
import {
  BUILTIN_MS_CLIENT_ID,
  refreshAccount,
  signInWithDeviceCode,
  signInWithMicrosoft,
  type DeviceCodePrompt
} from './microsoft.js'
import type { Account } from '../../shared/types.js'

/**
 * Offline UUIDs must match what a vanilla server computes for the same name
 * (a name-based UUID v3 over "OfflinePlayer:<name>"), otherwise worlds and
 * server permissions would not follow the player.
 */
export function offlineUuid(username: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${username}`).digest()
  hash[6] = (hash[6] & 0x0f) | 0x30 // version 3
  hash[8] = (hash[8] & 0x3f) | 0x80 // IETF variant
  return hash.toString('hex')
}

export function formatUuid(hex: string): string {
  const raw = hex.replace(/-/g, '')
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`
}

const NAME_RULE = /^[A-Za-z0-9_]{3,16}$/

export function createOfflineAccount(username: string): Account {
  const name = username.trim()
  if (!NAME_RULE.test(name)) {
    throw new Error('Username must be 3–16 characters, using only letters, numbers and underscore.')
  }
  const accounts = store.get('accounts')
  if (accounts.some((a) => a.kind === 'offline' && a.username.toLowerCase() === name.toLowerCase())) {
    throw new Error(`An offline account named ${name} already exists.`)
  }
  return { id: randomUUID(), kind: 'offline', username: name, uuid: offlineUuid(name) }
}

export function listAccounts(): Account[] {
  // Tokens never leave the main process.
  return store.get('accounts').map(({ accessToken, refreshToken, ...safe }) => safe as Account)
}

export function addAccount(account: Account): Account[] {
  const accounts = store.get('accounts')
  const existing = accounts.findIndex((a) => a.uuid === account.uuid && a.kind === account.kind)
  if (existing >= 0) accounts[existing] = { ...accounts[existing], ...account }
  else accounts.push(account)
  store.set('accounts', accounts)
  if (!store.get('activeAccountId')) store.set('activeAccountId', account.id)
  return listAccounts()
}

export function removeAccount(id: string): Account[] {
  const accounts = store.get('accounts').filter((a) => a.id !== id)
  store.set('accounts', accounts)
  if (store.get('activeAccountId') === id) {
    store.set('activeAccountId', accounts[0]?.id ?? null)
  }
  return listAccounts()
}

export function setActiveAccount(id: string): void {
  store.set('activeAccountId', id)
}

export function getActiveAccountId(): string | null {
  return store.get('activeAccountId')
}

/** Full account including tokens — main-process use only. */
export function getAccountRaw(id: string): Account | undefined {
  return store.get('accounts').find((a) => a.id === id)
}

/**
 * The client ID compiled into the build wins over the per-user setting, so a
 * distributed build signs in with no configuration at all.
 */
export function resolveClientId(): string {
  return BUILTIN_MS_CLIENT_ID.trim() || store.get('settings').msClientId.trim()
}

export function hasClientId(): boolean {
  return resolveClientId().length > 0
}

export async function signIn(): Promise<Account | null> {
  const account = await signInWithMicrosoft(resolveClientId())
  if (!account) return null
  addAccount(account)
  return { ...account, accessToken: undefined, refreshToken: undefined }
}

/** Sign in via device code — no redirect URI needed on the Azure app. */
export async function signInDevice(
  onPrompt: (prompt: DeviceCodePrompt) => void,
  shouldCancel: () => boolean
): Promise<Account | null> {
  const account = await signInWithDeviceCode(resolveClientId(), onPrompt, shouldCancel)
  if (!account) return null
  addAccount(account)
  return { ...account, accessToken: undefined, refreshToken: undefined }
}

/**
 * Returns an account with a currently valid session, refreshing and persisting
 * it first if the Minecraft token has expired.
 */
export async function ensureValidSession(id: string): Promise<Account> {
  const account = getAccountRaw(id)
  if (!account) throw new Error('That account is no longer available. Pick another one.')
  if (account.kind === 'offline') return account

  const refreshed = await refreshAccount(account, resolveClientId())
  if (refreshed.accessToken !== account.accessToken) {
    const accounts = store.get('accounts')
    const index = accounts.findIndex((a) => a.id === id)
    if (index >= 0) {
      accounts[index] = refreshed
      store.set('accounts', accounts)
    }
  }
  return refreshed
}
