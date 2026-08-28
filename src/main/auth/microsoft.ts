import { BrowserWindow } from 'electron'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { fetchWithRetry } from '../net/download.js'
import type { Account } from '../../shared/types.js'

const REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient'
const AUTHORIZE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize'
const TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
const XBL = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MC_LOGIN = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MC_PROFILE = 'https://api.minecraftservices.com/minecraft/profile'
const SCOPE = 'XboxLive.signin offline_access'
const DEVICE_CODE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode'

/**
 * Baked-in Azure application (client) ID. Microsoft requires every app that
 * signs into Xbox Live to register its own — there is no shared public ID — so
 * fill this in once with your own registration and everyone using your builds
 * gets Microsoft sign-in with no setup at all. Leave it empty to fall back to
 * the per-user value in Settings.
 *
 * Register at https://portal.azure.com -> App registrations -> New:
 *   - Supported account types: personal Microsoft accounts
 *   - Authentication -> Allow public client flows: Yes   (device-code sign-in)
 *   - Optionally add the "Mobile and desktop applications" platform with
 *     redirect URI https://login.microsoftonline.com/common/oauth2/nativeclient
 *     to enable the embedded browser flow as well.
 */
export const BUILTIN_MS_CLIENT_ID = ''

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export class AuthError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message)
    this.name = 'AuthError'
  }
}

/** Opens a login window and resolves with the OAuth code, or null if cancelled. */
function promptForCode(clientId: string, challenge: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      response_mode: 'query',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account'
    })

    const win = new BrowserWindow({
      width: 520,
      height: 720,
      title: 'Sign in with Microsoft',
      autoHideMenuBar: true,
      backgroundColor: '#16181c',
      webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'ms-auth' }
    })

    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
      if (!win.isDestroyed()) win.destroy()
    }

    const inspect = (rawUrl: string): void => {
      if (!rawUrl.startsWith(REDIRECT_URI)) return
      const url = new URL(rawUrl)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      if (code) finish(() => resolve(code))
      else if (error) {
        const description = url.searchParams.get('error_description') ?? error
        finish(() => reject(new AuthError(`Microsoft rejected the sign-in: ${description}`)))
      }
    }

    win.webContents.on('will-redirect', (_e, url) => inspect(url))
    win.webContents.on('will-navigate', (_e, url) => inspect(url))
    win.on('closed', () => {
      if (!settled) {
        settled = true
        resolve(null)
      }
    })

    win.loadURL(`${AUTHORIZE}?${params.toString()}`).catch((err) => finish(() => reject(err)))
  })
}

async function postForm(url: string, body: Record<string, string>): Promise<Response> {
  return fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  })
}

interface MsTokens {
  access_token: string
  refresh_token: string
  expires_in: number
}

/** Exchange XBL/XSTS tokens for a Minecraft session and profile. */
async function xboxToMinecraft(msAccessToken: string): Promise<{
  token: string
  expiresAt: number
  uuid: string
  name: string
  skinUrl?: string
  capes: Account['capes']
  xuid?: string
}> {
  const xblRes = await fetchWithRetry(XBL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${msAccessToken}`
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    })
  })
  const xbl = (await xblRes.json()) as {
    Token: string
    DisplayClaims: { xui: { uhs: string }[] }
  }
  const uhs = xbl.DisplayClaims.xui[0].uhs

  const xstsRes = await fetch(XSTS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    })
  })

  if (!xstsRes.ok) {
    const body = (await xstsRes.json().catch(() => ({}))) as { XErr?: number }
    // Microsoft encodes the reason as a numeric XErr rather than a message.
    const reasons: Record<number, string> = {
      2148916233: 'This Microsoft account has no Xbox profile. Create one at xbox.com, then try again.',
      2148916235: 'Xbox Live is not available in this account’s region.',
      2148916236: 'This account needs adult verification before it can use Xbox Live.',
      2148916238: 'This is a child account. Add it to a Microsoft Family group to sign in.'
    }
    throw new AuthError(
      reasons[body.XErr ?? 0] ?? `Xbox Live authorisation failed (HTTP ${xstsRes.status}).`
    )
  }
  const xsts = (await xstsRes.json()) as {
    Token: string
    DisplayClaims: { xui: { uhs: string; xid?: string }[] }
  }

  const mcRes = await fetchWithRetry(MC_LOGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${uhs};${xsts.Token}` })
  })
  const mc = (await mcRes.json()) as { access_token: string; expires_in: number }

  const profileRes = await fetch(MC_PROFILE, {
    headers: { Authorization: `Bearer ${mc.access_token}` }
  })
  if (profileRes.status === 404) {
    throw new AuthError(
      'This Microsoft account does not own Minecraft: Java Edition.',
      'Buy the game at minecraft.net, or use an Offline account for singleplayer and offline-mode servers.'
    )
  }
  if (!profileRes.ok) {
    throw new AuthError(`Could not read the Minecraft profile (HTTP ${profileRes.status}).`)
  }
  const profile = (await profileRes.json()) as {
    id: string
    name: string
    skins?: { url: string; state: string }[]
    capes?: { id: string; alias: string; url: string; state: string }[]
  }

  return {
    token: mc.access_token,
    expiresAt: Date.now() + mc.expires_in * 1000,
    uuid: profile.id,
    name: profile.name,
    skinUrl: profile.skins?.find((s) => s.state === 'ACTIVE')?.url,
    capes: (profile.capes ?? []).map((c) => ({
      id: c.id,
      alias: c.alias,
      url: c.url,
      active: c.state === 'ACTIVE'
    })),
    xuid: xsts.DisplayClaims.xui[0].xid
  }
}

export async function signInWithMicrosoft(clientId: string): Promise<Account | null> {
  if (!clientId) {
    throw new AuthError(
      'No Microsoft client ID is configured.',
      'Register a free Azure application, enable the "Mobile and desktop applications" platform, then paste its Application (client) ID into Settings → Accounts.'
    )
  }

  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())

  const code = await promptForCode(clientId, challenge)
  if (code === null) return null

  const tokenRes = await postForm(TOKEN, {
    client_id: clientId,
    scope: SCOPE,
    code,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
    code_verifier: verifier
  })
  const tokens = (await tokenRes.json()) as MsTokens
  const session = await xboxToMinecraft(tokens.access_token)

  return {
    id: randomUUID(),
    kind: 'microsoft',
    username: session.name,
    uuid: session.uuid,
    accessToken: session.token,
    refreshToken: tokens.refresh_token,
    expiresAt: session.expiresAt,
    xuid: session.xuid,
    skinUrl: session.skinUrl,
    capes: session.capes
  }
}

/** Refresh an expired Minecraft session using the stored MS refresh token. */
export async function refreshAccount(account: Account, clientId: string): Promise<Account> {
  if (account.kind !== 'microsoft') return account
  if (account.expiresAt && account.expiresAt - 60_000 > Date.now()) return account
  if (!account.refreshToken) {
    throw new AuthError(`Session for ${account.username} expired. Sign in again.`)
  }

  const res = await postForm(TOKEN, {
    client_id: clientId,
    scope: SCOPE,
    refresh_token: account.refreshToken,
    grant_type: 'refresh_token'
  })
  const tokens = (await res.json()) as MsTokens
  const session = await xboxToMinecraft(tokens.access_token)

  return {
    ...account,
    username: session.name,
    uuid: session.uuid,
    accessToken: session.token,
    refreshToken: tokens.refresh_token ?? account.refreshToken,
    expiresAt: session.expiresAt,
    xuid: session.xuid,
    skinUrl: session.skinUrl,
    capes: session.capes
  }
}


/* ---------------------------- device code flow ---------------------------- */

export interface DeviceCodePrompt {
  userCode: string
  verificationUri: string
  expiresInSeconds: number
  message: string
}

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
  message: string
}

/**
 * Sign in without a redirect URI: Microsoft issues a short code, the user types
 * it at microsoft.com/link, and we poll until they finish. Needs only "Allow
 * public client flows" on the Azure app, which makes setup far simpler than the
 * embedded browser flow.
 */
export async function signInWithDeviceCode(
  clientId: string,
  onPrompt: (prompt: DeviceCodePrompt) => void,
  shouldCancel: () => boolean = () => false
): Promise<Account | null> {
  if (!clientId) {
    throw new AuthError(
      'No Microsoft client ID is configured.',
      'Add one in Settings → Accounts, or bake one into BUILTIN_MS_CLIENT_ID so your builds need no setup.'
    )
  }

  const startRes = await postForm(DEVICE_CODE, { client_id: clientId, scope: SCOPE })
  const start = (await startRes.json()) as DeviceCodeResponse & { error?: string; error_description?: string }
  if (start.error) {
    throw new AuthError(
      `Microsoft refused to start sign-in: ${start.error_description ?? start.error}`,
      start.error === 'unauthorized_client'
        ? 'Enable "Allow public client flows" on the Azure app registration.'
        : undefined
    )
  }

  onPrompt({
    userCode: start.user_code,
    verificationUri: start.verification_uri,
    expiresInSeconds: start.expires_in,
    message: start.message
  })

  const deadline = Date.now() + start.expires_in * 1000
  // Microsoft dictates the poll interval and will tell us to back off further.
  let intervalMs = Math.max(1, start.interval || 5) * 1000

  while (Date.now() < deadline) {
    if (shouldCancel()) return null
    await new Promise((r) => setTimeout(r, intervalMs))

    const res = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: start.device_code
      }).toString()
    })
    const body = (await res.json()) as MsTokens & { error?: string; error_description?: string }

    if (res.ok && body.access_token) {
      const session = await xboxToMinecraft(body.access_token)
      return {
        id: randomUUID(),
        kind: 'microsoft',
        username: session.name,
        uuid: session.uuid,
        accessToken: session.token,
        refreshToken: body.refresh_token,
        expiresAt: session.expiresAt,
        xuid: session.xuid,
        skinUrl: session.skinUrl,
        capes: session.capes
      }
    }

    switch (body.error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        intervalMs += 5000
        continue
      case 'authorization_declined':
        throw new AuthError('Sign-in was declined in the browser.')
      case 'expired_token':
        throw new AuthError('The sign-in code expired. Start again.')
      default:
        throw new AuthError(body.error_description ?? `Sign-in failed: ${body.error ?? res.status}`)
    }
  }
  throw new AuthError('The sign-in code expired before it was used.')
}
