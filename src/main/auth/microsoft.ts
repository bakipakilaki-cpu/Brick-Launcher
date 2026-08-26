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
