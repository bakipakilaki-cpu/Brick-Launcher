import { motion } from 'framer-motion'
import { Check, Download, ExternalLink, Package, Blocks } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Modal, Spinner, formatBytes, formatCount, timeAgo } from './ui'
import { api, type ContentType } from '../lib/api'
import { useStore } from '../store/useStore'
import type { ModProject, ModVersion } from '../../shared/types'

/** Where each project type gets installed inside an instance. */
const TYPE_TO_CONTENT: Record<string, ContentType> = {
  mod: 'mod',
  shader: 'shader',
  resourcepack: 'resourcepack',
  datapack: 'datapack'
}

export function ProjectModal({
  project,
  onClose,
  onError
}: {
  project: ModProject | null
  onClose: () => void
  onError: (message: string) => void
}) {
  const instances = useStore((s) => s.instances)
  const toast = useStore((s) => s.toast)

  const [versions, setVersions] = useState<ModVersion[] | null>(null)
  const [instanceId, setInstanceId] = useState('')
  const [installing, setInstalling] = useState<string | null>(null)
  const [installed, setInstalled] = useState<Set<string>>(new Set())
  const [filterToInstance, setFilterToInstance] = useState(true)

  const instance = instances.find((i) => i.id === instanceId)
  const isModpack = project?.projectType === 'modpack'

  useEffect(() => {
    if (!project) {
      setVersions(null)
      setInstalled(new Set())
      return
    }
    if (!instanceId && instances.length) setInstanceId(instances[0].id)
  }, [project, instances, instanceId])

  useEffect(() => {
    if (!project) return
    let cancelled = false
    setVersions(null)

    const gameVersion = filterToInstance && instance && !isModpack ? instance.mcVersion : undefined
    const loader =
      filterToInstance && instance && project.projectType === 'mod' ? instance.loader : undefined

    api
      .projectVersions(project.source, project.id, gameVersion, loader)
      .then((list) => {
        if (!cancelled) setVersions(list)
      })
      .catch((err) => {
        if (cancelled) return
        setVersions([])
        onError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [project, instance, filterToInstance, isModpack, onError])

  const install = async (version: ModVersion): Promise<void> => {
    if (!project) return
    setInstalling(version.id)
    try {
      if (isModpack) {
        if (version.source !== 'modrinth') {
          throw new Error(
            'CurseForge modpacks are not supported yet — install it from Modrinth, or download the pack and add its mods manually.'
          )
        }
        await api.installModpack({
          name: project.title,
          packUrl: version.fileUrl,
          packSha1: version.sha1,
          icon: project.iconUrl
        })
        toast('success', `${project.title} installed as a new instance`)
        onClose()
        return
      }

      if (!instanceId) throw new Error('Create an instance first, then install content into it.')
      const contentType = TYPE_TO_CONTENT[project.projectType] ?? 'mod'

      await api.installContent({
        instanceId,
        type: contentType,
        version: { ...version, projectId: project.id } as ModVersion,
        projectTitle: project.title,
        iconUrl: project.iconUrl
      })
      setInstalled((prev) => new Set(prev).add(version.id))
      toast('success', `${project.title} added to ${instance?.name ?? 'the instance'}`)
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling(null)
    }
  }

  const webUrl = project
    ? project.source === 'modrinth'
      ? `https://modrinth.com/${project.projectType}/${project.slug}`
      : `https://www.curseforge.com/minecraft/mc-mods/${project.slug}`
    : ''

  return (
    <Modal
      open={Boolean(project)}
      onClose={onClose}
      wide
      title={project?.title ?? ''}
      icon={
        project?.iconUrl ? (
          <img
            src={project.iconUrl}
            alt=""
            style={{ width: 30, height: 30, borderRadius: 7, objectFit: 'cover' }}
          />
        ) : (
          <Package size={19} />
        )
      }
    >
      {project && (
        <>
          <div className="stack sm">
            <div className="muted">{project.description}</div>
            <div className="hstack md" style={{ flexWrap: 'wrap', gap: 16 }}>
              <span className="stat faint small">
                <Download size={13} /> {formatCount(project.downloads)} downloads
              </span>
              {project.author && <span className="faint small">by {project.author}</span>}
              <button className="btn ghost sm" onClick={() => api.openExternal(webUrl)}>
                <ExternalLink size={13} /> Open page
              </button>
            </div>
            {project.categories.length > 0 && (
              <div className="tag-row">
                {project.categories.map((category) => (
                  <span key={category} className="tag">
                    {category}
                  </span>
                ))}
              </div>
            )}
          </div>

          {isModpack ? (
            <div className="banner info">
              <Blocks size={15} />
              <div>
                Installing a modpack creates a brand-new instance with its own mods, config and
                version — your existing instances are untouched.
              </div>
            </div>
          ) : instances.length === 0 ? (
            <div className="banner warn">
              <Blocks size={15} />
              <div>Create an instance first — content has to be installed into one.</div>
            </div>
          ) : (
            <div className="hstack md" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: 1, minWidth: 220 }}>
                <span className="field-label">Install into</span>
                <select
                  className="select"
                  value={instanceId}
                  onChange={(e) => setInstanceId(e.target.value)}
                >
                  {instances.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} · {entry.loader} {entry.mcVersion}
                    </option>
                  ))}
                </select>
              </div>
              <label className="hstack sm field-hint" style={{ cursor: 'pointer', paddingBottom: 10 }}>
                <input
                  type="checkbox"
                  checked={filterToInstance}
                  onChange={(e) => setFilterToInstance(e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                Only compatible versions
              </label>
            </div>
          )}

          <div className="stack sm">
            <div className="field-label">Versions</div>

            {versions === null ? (
              <div className="stack sm">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="skeleton" style={{ height: 54 }} />
                ))}
              </div>
            ) : versions.length === 0 ? (
              <div className="banner warn">
                <Package size={15} />
                <div>
                  No compatible release found
                  {instance && filterToInstance
                    ? ` for ${instance.loader} ${instance.mcVersion}.`
                    : '.'}{' '}
                  {filterToInstance && 'Untick “Only compatible versions” to see everything.'}
                </div>
              </div>
            ) : (
              versions.slice(0, 30).map((version, index) => {
                const done = installed.has(version.id)
                return (
                  <motion.div
                    key={version.id}
                    className="row"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(index, 8) * 0.03 }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row-title truncate">{version.name}</div>
                      <div className="row-sub hstack sm" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <span
                          className={`tag ${version.releaseType === 'release' ? 'accent' : version.releaseType === 'beta' ? 'warn' : 'danger'}`}
                        >
                          {version.releaseType}
                        </span>
                        <span>{version.gameVersions.slice(0, 3).join(', ')}</span>
                        {version.loaders.length > 0 && <span>· {version.loaders.join(', ')}</span>}
                        <span>· {formatBytes(version.fileSize)}</span>
                        <span>· {timeAgo(Date.parse(version.datePublished))}</span>
                      </div>
                    </div>

                    <button
                      className={`btn sm${done ? '' : ' primary'}`}
                      onClick={() => install(version)}
                      disabled={installing !== null || (!isModpack && !instanceId)}
                    >
                      {installing === version.id ? (
                        <Spinner size={14} />
                      ) : done ? (
                        <Check size={14} />
                      ) : (
                        <Download size={14} />
                      )}
                      {done ? 'Installed' : isModpack ? 'Install pack' : 'Install'}
                    </button>
                  </motion.div>
                )
              })
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
