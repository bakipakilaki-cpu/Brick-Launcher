import { arch, platform, release } from 'node:os'
import type { Library, Rule } from './manifest.js'

export type OsName = 'windows' | 'osx' | 'linux'

export function currentOs(): OsName {
  switch (platform()) {
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'osx'
    default:
      return 'linux'
  }
}

export function currentArch(): string {
  // Mojang manifests use x86 / x86_64 / arm64 rather than Node's naming.
  switch (arch()) {
    case 'x64':
      return 'x86_64'
    case 'ia32':
      return 'x86'
    case 'arm64':
      return 'arm64'
    default:
      return arch()
  }
}

/**
 * Mojang rules are evaluated in order; the last matching rule wins. A list that
 * contains only "disallow" entries defaults to allowed until one matches.
 */
export function rulesAllow(rules: Rule[] | undefined, features: Record<string, boolean> = {}): boolean {
  if (!rules || rules.length === 0) return true

  let allowed = false
  // If no rule ever mentions our OS but the first rule is a plain allow, that
  // allow still applies — so start from "denied" and let matches decide.
  for (const rule of rules) {
    if (!ruleMatches(rule, features)) continue
    allowed = rule.action === 'allow'
  }
  return allowed
}

function ruleMatches(rule: Rule, features: Record<string, boolean>): boolean {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== currentOs()) return false
    if (rule.os.arch && rule.os.arch !== currentArch() && rule.os.arch !== arch()) return false
    if (rule.os.version) {
      try {
        if (!new RegExp(rule.os.version).test(release())) return false
      } catch {
        /* a malformed pattern should not block the launch */
      }
    }
  }
  if (rule.features) {
    for (const [key, expected] of Object.entries(rule.features)) {
      if ((features[key] ?? false) !== expected) return false
    }
  }
  return true
}

export function libraryApplies(lib: Library, features: Record<string, boolean> = {}): boolean {
  return rulesAllow(lib.rules, features)
}

/** Classifier key for a legacy natives-style library, e.g. "natives-osx". */
export function nativeClassifier(lib: Library): string | null {
  if (!lib.natives) return null
  const template = lib.natives[currentOs()]
  if (!template) return null
  return template.replace('${arch}', arch() === 'ia32' ? '32' : '64')
}
