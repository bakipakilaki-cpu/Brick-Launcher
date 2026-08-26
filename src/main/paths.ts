import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

/**
 * Everything the launcher owns lives under one root so an instance is a
 * self-contained folder you can zip up and move to another machine.
 *
 * The folder is named explicitly rather than via `userData`, because that
 * resolves through the app name — which differs between a dev run and a
 * packaged build, and would leave a user's instances behind on the first
 * upgrade out of development.
 */
const root = join(app.getPath('appData'), 'Brick Launcher', 'data')

export const paths = {
  root,
  /** Shared vanilla asset/library/version store, mirrors the .minecraft layout. */
  shared: join(root, 'shared'),
  versions: join(root, 'shared', 'versions'),
  libraries: join(root, 'shared', 'libraries'),
  assets: join(root, 'shared', 'assets'),
  natives: join(root, 'shared', 'natives'),
  /** One folder per instance; this is the game directory Minecraft sees. */
  instances: join(root, 'instances'),
  java: join(root, 'java'),
  skins: join(root, 'skins'),
  cache: join(root, 'cache'),
  logs: join(root, 'logs')
}

export function instanceDir(id: string): string {
  return join(paths.instances, id)
}

export function ensureDirs(): void {
  for (const dir of Object.values(paths)) mkdirSync(dir, { recursive: true })
}

/** Turn "net.fabricmc:fabric-loader:0.16.9" into libraries/net/fabricmc/... */
export function mavenToPath(coord: string): string {
  const [group, artifact, versionAndClassifier, ...rest] = coord.split(':')
  let version = versionAndClassifier
  let classifier = rest[0]
  let ext = 'jar'

  // Coordinates may carry an @extension suffix, e.g. "a:b:1.0@zip".
  const at = (classifier ?? version).lastIndexOf('@')
  if (at !== -1) {
    if (classifier) {
      ext = classifier.slice(at + 1)
      classifier = classifier.slice(0, at)
    } else {
      ext = version.slice(at + 1)
      version = version.slice(0, at)
    }
  }

  const file = classifier
    ? `${artifact}-${version}-${classifier}.${ext}`
    : `${artifact}-${version}.${ext}`
  return join(...group.split('.'), artifact, version, file)
}
