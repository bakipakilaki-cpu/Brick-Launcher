import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { join } from 'node:path'
import { instanceDir } from './paths.js'
import { readNbt, writeNbt, TAG, type NbtFile, type NbtTagged } from './nbt.js'

/**
 * Server list backed by the instance's real `servers.dat`, so anything added
 * here shows up in Minecraft's own multiplayer screen — and vice versa.
 */

export interface ServerEntry {
  name: string
  address: string
  /** Base64 PNG favicon as Minecraft stores it. */
  icon?: string
  acceptTextures?: number
}

export interface ServerStatus {
  online: boolean
  motd?: string
  playersOnline?: number
  playersMax?: number
  version?: string
  protocol?: number
  latencyMs?: number
  favicon?: string
  error?: string
}

function datPath(instanceId: string): string {
  return join(instanceDir(instanceId), 'servers.dat')
}

function emptyFile(): NbtFile {
  return {
    rootName: '',
    root: { servers: { type: TAG.List, value: [], listType: TAG.Compound } },
    gzipped: false
  }
}

export async function listServers(instanceId: string): Promise<ServerEntry[]> {
  const path = datPath(instanceId)
  if (!existsSync(path)) return []

  try {
    const file = readNbt(await readFile(path))
    const list = file.root.servers?.value as Record<string, NbtTagged>[] | undefined
    if (!Array.isArray(list)) return []

    return list.map((entry) => ({
      name: String(entry.name?.value ?? 'Server'),
      address: String(entry.ip?.value ?? ''),
      icon: entry.icon ? String(entry.icon.value) : undefined,
      acceptTextures:
        entry.acceptTextures !== undefined ? Number(entry.acceptTextures.value) : undefined
    }))
  } catch {
    // A corrupt or unexpected servers.dat should not break the tab.
    return []
  }
}

async function save(instanceId: string, servers: ServerEntry[]): Promise<ServerEntry[]> {
  const path = datPath(instanceId)

  // Preserve whatever else the file held (and its compression) if it exists.
  let file: NbtFile
  try {
    file = existsSync(path) ? readNbt(await readFile(path)) : emptyFile()
  } catch {
    file = emptyFile()
  }

  const encoded = servers.map((server) => {
    const entry: Record<string, NbtTagged> = {
      name: { type: TAG.String, value: server.name },
      ip: { type: TAG.String, value: server.address }
    }
    if (server.icon) entry.icon = { type: TAG.String, value: server.icon }
    if (server.acceptTextures !== undefined) {
      entry.acceptTextures = { type: TAG.Byte, value: server.acceptTextures }
    }
    return entry
  })

  file.root.servers = { type: TAG.List, value: encoded as never, listType: TAG.Compound }
  await writeFile(path, writeNbt(file))
  return listServers(instanceId)
}

export async function addServer(
  instanceId: string,
  entry: ServerEntry
): Promise<ServerEntry[]> {
  const name = entry.name.trim()
  const address = entry.address.trim()
  if (!name) throw new Error('Give the server a name.')
  if (!address) throw new Error('Enter the server address.')

  const servers = await listServers(instanceId)
  if (servers.some((s) => s.address.toLowerCase() === address.toLowerCase())) {
    throw new Error(`${address} is already in this instance's server list.`)
  }
  return save(instanceId, [...servers, { name, address }])
}

export async function updateServer(
  instanceId: string,
  index: number,
  patch: Partial<ServerEntry>
): Promise<ServerEntry[]> {
  const servers = await listServers(instanceId)
  if (!servers[index]) throw new Error('Server not found.')
  servers[index] = { ...servers[index], ...patch }
  return save(instanceId, servers)
}

export async function removeServer(instanceId: string, index: number): Promise<ServerEntry[]> {
  const servers = await listServers(instanceId)
  if (!servers[index]) throw new Error('Server not found.')
  servers.splice(index, 1)
  return save(instanceId, servers)
}

/** Move an entry up or down — Minecraft shows them in file order. */
export async function moveServer(
  instanceId: string,
  index: number,
  delta: number
): Promise<ServerEntry[]> {
  const servers = await listServers(instanceId)
  const target = index + delta
  if (!servers[index] || target < 0 || target >= servers.length) return servers
  const [entry] = servers.splice(index, 1)
  servers.splice(target, 0, entry)
  return save(instanceId, servers)
}

/* ----------------------------- status pings ------------------------------ */

function writeVarInt(value: number): Buffer {
  const bytes: number[] = []
  let v = value >>> 0
  do {
    let byte = v & 0x7f
    v >>>= 7
    if (v !== 0) byte |= 0x80
    bytes.push(byte)
  } while (v !== 0)
  return Buffer.from(bytes)
}

function readVarInt(buf: Buffer, offset: number): { value: number; size: number } | null {
  let result = 0
  let shift = 0
  let size = 0
  for (;;) {
    if (offset + size >= buf.length) return null
    const byte = buf[offset + size]
    result |= (byte & 0x7f) << shift
    size++
    if ((byte & 0x80) === 0) break
    shift += 7
    if (shift > 35) return null
  }
  return { value: result >>> 0, size }
}

function packet(id: number, payload: Buffer): Buffer {
  const body = Buffer.concat([writeVarInt(id), payload])
  return Buffer.concat([writeVarInt(body.length), body])
}

function mcString(value: string): Buffer {
  const data = Buffer.from(value, 'utf8')
  return Buffer.concat([writeVarInt(data.length), data])
}

/** Flatten Minecraft's nested chat-component MOTD into plain text. */
function flattenMotd(description: unknown): string {
  if (typeof description === 'string') return description
  if (!description || typeof description !== 'object') return ''
  const node = description as { text?: string; extra?: unknown[]; translate?: string }
  let out = node.text ?? node.translate ?? ''
  for (const child of node.extra ?? []) out += flattenMotd(child)
  return out
}

/** Strip Minecraft's §-prefixed colour codes for display. */
function stripFormatting(text: string): string {
  return text.replace(/§[0-9a-fk-orA-FK-OR]/g, '')
}

/**
 * Server List Ping (1.7+): handshake with next-state=status, then a status
 * request; the server replies with a JSON blob describing itself.
 */
export function pingServer(address: string, timeoutMs = 5000): Promise<ServerStatus> {
  return new Promise((resolve) => {
    let host = address.trim()
    let port = 25565

    // Strip a scheme if the user pasted one, then split host:port (IPv6 aware).
    host = host.replace(/^[a-z]+:\/\//i, '')
    const lastColon = host.lastIndexOf(':')
    if (lastColon !== -1 && !host.includes(']') && host.indexOf(':') === lastColon) {
      const maybePort = Number(host.slice(lastColon + 1))
      if (Number.isInteger(maybePort) && maybePort > 0 && maybePort < 65536) {
        port = maybePort
        host = host.slice(0, lastColon)
      }
    }

    const started = Date.now()
    const chunks: Buffer[] = []
    let settled = false

    const finish = (status: ServerStatus): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(status)
    }

    const socket = connect({ host, port, timeout: timeoutMs })

    socket.on('connect', () => {
      const handshake = packet(
        0x00,
        Buffer.concat([
          writeVarInt(47), // any modern protocol number works for status
          mcString(host),
          (() => {
            const b = Buffer.alloc(2)
            b.writeUInt16BE(port)
            return b
          })(),
          writeVarInt(1)
        ])
      )
      socket.write(Buffer.concat([handshake, packet(0x00, Buffer.alloc(0))]))
    })

    socket.on('data', (chunk) => {
      chunks.push(chunk)
      const buf = Buffer.concat(chunks)

      // Wait until the declared packet length has actually arrived.
      const outer = readVarInt(buf, 0)
      if (!outer) return
      if (buf.length < outer.size + outer.value) return

      let cursor = outer.size
      const id = readVarInt(buf, cursor)
      if (!id) return
      cursor += id.size
      const strLen = readVarInt(buf, cursor)
      if (!strLen) return
      cursor += strLen.size

      try {
        const json = JSON.parse(buf.toString('utf8', cursor, cursor + strLen.value)) as {
          description?: unknown
          players?: { online?: number; max?: number }
          version?: { name?: string; protocol?: number }
          favicon?: string
        }
        finish({
          online: true,
          motd: stripFormatting(flattenMotd(json.description)).trim(),
          playersOnline: json.players?.online,
          playersMax: json.players?.max,
          version: json.version?.name,
          protocol: json.version?.protocol,
          favicon: json.favicon,
          latencyMs: Date.now() - started
        })
      } catch {
        finish({ online: false, error: 'Server sent an unreadable status response.' })
      }
    })

    socket.on('timeout', () => finish({ online: false, error: 'Timed out' }))
    socket.on('error', (err: NodeJS.ErrnoException) => {
      const reason =
        err.code === 'ENOTFOUND'
          ? 'Address not found'
          : err.code === 'ECONNREFUSED'
            ? 'Connection refused'
            : err.message
      finish({ online: false, error: reason })
    })
  })
}
