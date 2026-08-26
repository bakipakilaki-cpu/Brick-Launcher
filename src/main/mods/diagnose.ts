import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { paths } from '../paths.js'
import * as modrinth from './modrinth.js'
import { listContent } from './content.js'
import type { ModProject, ModVersion } from '../../shared/types.js'

/**
 * Reads a crashed launch and works out which mods are missing or conflicting.
 *
 * Fabric and Quilt already print a "potential solution" block naming exactly
 * what to install, so the parser leans on the loader's own conclusion rather
 * than trying to re-derive dependency resolution here. Forge and NeoForge use
 * a different, more machine-readable format which is handled alongside it.
 */

export type ProblemKind = 'missing' | 'replace' | 'remove' | 'incompatible'

export interface ModProblem {
  kind: ProblemKind
  /** Loader-side mod id, e.g. "sodium". */
  modId: string
  /** Version constraint as the loader phrased it: "0.9.x", "0.9.0", undefined = any. */
  versionHint?: string
  /** Human-readable display name of the mod that needs it. */
  requiredBy?: string
  raw: string
}

export interface ProposedFix {
  action: 'install' | 'replace' | 'remove'
  modId: string
  reason: string
  resolved: boolean
  project?: { id: string; title: string; iconUrl?: string; source: 'modrinth' }
  version?: ModVersion
  /** File to delete, for remove/replace. */
  targetFileName?: string
  /** Set when we had to compromise, e.g. no build matched the exact range. */
  note?: string
}

/* ------------------------------- parsing -------------------------------- */

/**
 * Game output is often wrapped in log4j XML. Flatten it to plain lines before
 * matching, otherwise the tags break the patterns.
 */
function normalise(text: string): string[] {
  return text
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/<[^>]+>/g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
}

const PATTERNS = {
  // " - Install sodium, any 0.9.x version."  /  " - Install fabric-api, any version."
  // The constraint is optional in two ways: the whole clause may be absent, and
  // "any version" carries no version token at all.
  install:
    /^\s*-\s*Install\s+([A-Za-z0-9_.\-+]+?)\s*(?:,\s*(?:any\s+(?:(\S+)\s+)?version|version\s+(\S+?)))?\s*\.?\s*$/i,
  // " - Replace mod 'Sodium' (sodium) 0.5.0 with version 0.9.1."
  replace: /^\s*-\s*Replace\s+mod\s+'([^']+)'\s*\(([A-Za-z0-9_.\-+]+)\)\s*(\S+)\s+with\s+version\s+(\S+?)\.?\s*$/i,
  // " - Remove mod 'Foo' (foo) 1.0."
  remove: /^\s*-\s*Remove\s+mod\s+'([^']+)'\s*\(([A-Za-z0-9_.\-+]+)\)/i,
  // " - Mod 'Iris' (iris) 1.11.2+mc26.2 requires any 0.9.x version of sodium, which is missing!"
  requires:
    /Mod\s+'([^']+)'\s*\([A-Za-z0-9_.\-+]+\)\s*\S*\s*requires\s+(?:any\s+(\S+?)\s+version|version\s+(\S+?))\s+of\s+([A-Za-z0-9_.\-+]+),\s*which\s+is\s+missing/i,
  // NeoForge/Forge: "Mod ID: 'jei', Requested by: 'x', Expected range: '[15,)', Actual version: '[MISSING]'"
  forgeMissing:
    /Mod ID:\s*'([^']+)',\s*Requested by:\s*'([^']*)',\s*Expected range:\s*'([^']*)',\s*Actual version:\s*'\[MISSING\]'/i
}

/** Turn a Maven-style range like "[0.9,1.0)" or "[15,)" into a loose hint. */
function hintFromMavenRange(range: string): string | undefined {
  const match = range.match(/(\d+(?:\.\d+)*)/)
  return match ? match[1] : undefined
}

export function parseProblems(logText: string): ModProblem[] {
  const lines = normalise(logText)
  const problems: ModProblem[] = []
  const seen = new Set<string>()

  const push = (p: ModProblem): void => {
    const key = `${p.kind}:${p.modId}:${p.versionHint ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    problems.push(p)
  }

  for (const line of lines) {
    let m: RegExpMatchArray | null

    if ((m = line.match(PATTERNS.replace))) {
      push({
        kind: 'replace',
        modId: m[2],
        versionHint: m[4],
        requiredBy: m[1],
        raw: line.trim()
      })
      continue
    }

    if ((m = line.match(PATTERNS.install))) {
      // "any version" leaves both capture groups empty, which means no constraint.
      push({ kind: 'missing', modId: m[1], versionHint: m[2] ?? m[3], raw: line.trim() })
      continue
    }

    if ((m = line.match(PATTERNS.remove))) {
      push({ kind: 'remove', modId: m[2], requiredBy: m[1], raw: line.trim() })
      continue
    }

    if ((m = line.match(PATTERNS.requires))) {
      push({
        kind: 'missing',
        modId: m[4],
        versionHint: m[2] ?? m[3],
        requiredBy: m[1],
        raw: line.trim()
      })
      continue
    }

    if ((m = line.match(PATTERNS.forgeMissing))) {
      push({
        kind: 'missing',
        modId: m[1],
        versionHint: hintFromMavenRange(m[3]),
        requiredBy: m[2] || undefined,
        raw: line.trim()
      })
    }
  }

  return problems
}

export function looksLikeModCrash(logText: string): boolean {
  return /Incompatible mods found|FormattedException|Missing or unsupported mandatory dependencies|requires .* which is missing/i.test(
    logText
  )
}

/* ------------------------------ resolution ------------------------------- */

/** Every dotted numeric run in a version string: "0.6.13+mc1.21.4" → 0.6.13, 1.21.4. */
function versionTokens(value: string): string[] {
  return [...value.matchAll(/\d+(?:\.\d+)+/g)].map((match) => match[0])
}

/**
 * Loose constraint check against the loader's phrasing. "0.9.x" means the 0.9
 * line; a bare "0.9.0" is treated as a prefix so build metadata like
 * "0.9.0+mc26.2" still counts.
 */
export function satisfiesHint(versionNumber: string, hint?: string): boolean {
  if (!hint || /^any$/i.test(hint)) return true
  const prefix = hint.endsWith('.x') ? hint.slice(0, -1) : hint
  return versionTokens(versionNumber).some(
    (token) => token === hint || token.startsWith(prefix)
  )
}

/**
 * Map a loader mod id onto a Modrinth project. The slug matches the mod id for
 * most projects, so try that first and fall back to search.
 */
async function findProject(modId: string): Promise<ModProject | null> {
  try {
    return await modrinth.getProject(modId)
  } catch {
    /* not a slug — fall through to search */
  }

  try {
    const result = await modrinth.search({
      query: modId,
      source: 'modrinth',
      projectType: 'mod',
      limit: 10
    })
    const needle = modId.replace(/[^a-z0-9]/gi, '').toLowerCase()
    // Prefer an exact slug/title match over whatever search ranked first.
    return (
      result.hits.find((h) => h.slug.replace(/[^a-z0-9]/gi, '').toLowerCase() === needle) ??
      result.hits.find((h) => h.title.replace(/[^a-z0-9]/gi, '').toLowerCase() === needle) ??
      result.hits[0] ??
      null
    )
  } catch {
    return null
  }
}

export interface DiagnoseArgs {
  instanceId: string
  gameVersion: string
  loader: string
  logText: string
}

/** Read the newest log file this instance produced, as a fallback source. */
export async function latestLogFor(instanceId: string): Promise<string> {
  try {
    const files = (await readdir(paths.logs))
      .filter((f) => f.startsWith(`${instanceId}-`) && f.endsWith('.log'))
      .sort()
    const newest = files[files.length - 1]
    if (!newest) return ''
    return await readFile(join(paths.logs, newest), 'utf8')
  } catch {
    return ''
  }
}

export async function diagnose(args: DiagnoseArgs): Promise<{
  problems: ModProblem[]
  fixes: ProposedFix[]
}> {
  const text = args.logText?.trim() ? args.logText : await latestLogFor(args.instanceId)
  const problems = parseProblems(text)
  if (!problems.length) return { problems, fixes: [] }

  const installed = await listContent(args.instanceId, 'mod').catch(() => [])
  const fixes: ProposedFix[] = []

  for (const problem of problems) {
    if (problem.kind === 'remove') {
      const target = matchInstalledFile(installed, problem.modId)
      fixes.push({
        action: 'remove',
        modId: problem.modId,
        reason: problem.raw,
        resolved: Boolean(target),
        targetFileName: target,
        note: target ? undefined : 'Could not tell which file provides this mod.'
      })
      continue
    }

    const project = await findProject(problem.modId)
    if (!project) {
      fixes.push({
        action: problem.kind === 'replace' ? 'replace' : 'install',
        modId: problem.modId,
        reason: problem.raw,
        resolved: false,
        note: `Not found on Modrinth — install ${problem.modId} manually.`
      })
      continue
    }

    // Ask only for builds that already match this instance's version + loader,
    // then narrow to the constraint the loader gave us.
    const candidates = await modrinth
      .listVersions(project.id, args.gameVersion, args.loader)
      .catch(() => [] as ModVersion[])

    const matching = candidates.filter((v) => satisfiesHint(v.versionNumber, problem.versionHint))
    const chosen = matching[0] ?? candidates[0]

    fixes.push({
      action: problem.kind === 'replace' ? 'replace' : 'install',
      modId: problem.modId,
      reason: problem.raw,
      resolved: Boolean(chosen),
      project: {
        id: project.id,
        title: project.title,
        iconUrl: project.iconUrl,
        source: 'modrinth'
      },
      version: chosen,
      targetFileName:
        problem.kind === 'replace' ? matchInstalledFile(installed, problem.modId) : undefined,
      note: !chosen
        ? `No build of ${project.title} for ${args.loader} ${args.gameVersion}.`
        : matching.length === 0 && problem.versionHint
          ? `No build matched ${problem.versionHint}; offering ${chosen.versionNumber}, the newest compatible one.`
          : undefined
    })
  }

  return { problems, fixes }
}

/** Best-effort match from a loader mod id back to the jar that provides it. */
function matchInstalledFile(
  installed: { fileName: string; name: string }[],
  modId: string
): string | undefined {
  const needle = modId.replace(/[^a-z0-9]/gi, '').toLowerCase()
  const flat = (value: string): string => value.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return (
    installed.find((f) => flat(f.fileName).includes(needle))?.fileName ??
    installed.find((f) => flat(f.name).includes(needle))?.fileName
  )
}
