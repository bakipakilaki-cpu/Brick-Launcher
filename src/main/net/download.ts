import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { paths } from '../paths.js'

export interface DownloadJob {
  url: string
  dest: string
  sha1?: string
  size?: number
}

const USER_AGENT = 'BrickLauncher/1.0.0 (github.com/brick/launcher)'

async function sha1OfFile(path: string): Promise<string> {
  const hash = createHash('sha1')
  hash.update(await readFile(path))
  return hash.digest('hex')
}

/** True when the file is already on disk and matches the expected hash/size. */
async function isSatisfied(job: DownloadJob): Promise<boolean> {
  try {
    const info = await stat(job.dest)
    if (!info.isFile()) return false
    if (job.sha1) return (await sha1OfFile(job.dest)) === job.sha1.toLowerCase()
    if (job.size !== undefined) return info.size === job.size
    return info.size > 0
  } catch {
    return false
  }
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  retries = 4
): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) }
      })
      // 4xx (other than 429) will not get better by trying again.
      if (!res.ok && res.status < 500 && res.status !== 429) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return res
    } catch (err) {
      lastError = err
      if (attempt === retries) break
      await new Promise((r) => setTimeout(r, 350 * 2 ** attempt))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithRetry(url, init)
  return (await res.json()) as T
}

export async function getText(url: string, init: RequestInit = {}): Promise<string> {
  const res = await fetchWithRetry(url, init)
  return await res.text()
}

/** Fetch JSON through an on-disk cache so repeated browsing stays instant. */
export async function getJsonCached<T>(url: string, ttlMs: number, init: RequestInit = {}): Promise<T> {
  const key = createHash('sha1').update(url).digest('hex')
  const file = join(paths.cache, `${key}.json`)
  try {
    const info = await stat(file)
    if (Date.now() - info.mtimeMs < ttlMs) {
      return JSON.parse(await readFile(file, 'utf8')) as T
    }
  } catch {
    /* cache miss — fall through */
  }
  const data = await getJson<T>(url, init)
  await mkdir(paths.cache, { recursive: true })
  await writeFile(file, JSON.stringify(data))
  return data
}

export async function downloadFile(job: DownloadJob): Promise<void> {
  if (await isSatisfied(job)) return

  await mkdir(dirname(job.dest), { recursive: true })
  // Unique scratch name per attempt: two jobs targeting the same destination
  // must never share a temp file, or their writes interleave into a corrupt
  // result that then fails checksum verification.
  const tmp = `${job.dest}.${randomUUID().slice(0, 8)}.part`

  const res = await fetchWithRetry(job.url)
  if (!res.body) throw new Error(`Empty response body for ${job.url}`)
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp))

  if (job.sha1) {
    const actual = await sha1OfFile(tmp)
    if (actual !== job.sha1.toLowerCase()) {
      await unlink(tmp).catch(() => {})
      throw new Error(`Checksum mismatch for ${job.url}: expected ${job.sha1}, got ${actual}`)
    }
  }
  await rename(tmp, job.dest)
}

export interface BatchProgress {
  completed: number
  total: number
  bytesDone: number
  bytesTotal: number
  current: string
}

/**
 * Download many files at once with a fixed worker pool. Progress is reported by
 * file count and by bytes when the manifest told us sizes up front.
 */
export async function downloadAll(
  rawJobs: DownloadJob[],
  concurrency: number,
  onProgress?: (p: BatchProgress) => void
): Promise<void> {
  // Loader manifests routinely name the same library twice (install_profile
  // and version.json both list it). Fetching one destination from two workers
  // at once is wasted bandwidth at best and a corrupt file at worst.
  const byDest = new Map<string, DownloadJob>()
  for (const job of rawJobs) {
    if (!byDest.has(job.dest)) byDest.set(job.dest, job)
  }
  const jobs = [...byDest.values()]

  const bytesTotal = jobs.reduce((sum, j) => sum + (j.size ?? 0), 0)
  let completed = 0
  let bytesDone = 0
  let cursor = 0
  const errors: Error[] = []

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++
      if (index >= jobs.length) return
      const job = jobs[index]
      try {
        await downloadFile(job)
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)))
      }
      completed++
      bytesDone += job.size ?? 0
      onProgress?.({
        completed,
        total: jobs.length,
        bytesDone,
        bytesTotal,
        current: job.dest.split(/[\\/]/).pop() ?? ''
      })
    }
  }

  const pool = Math.max(1, Math.min(concurrency, jobs.length || 1))
  await Promise.all(Array.from({ length: pool }, worker))

  if (errors.length) {
    throw new Error(
      `${errors.length} download(s) failed. First error: ${errors[0].message}`
    )
  }
}
