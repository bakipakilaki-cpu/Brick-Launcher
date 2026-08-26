import { AnimatePresence, motion } from 'framer-motion'
import { Download, Heart, Key, Package, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ProjectModal } from '../components/ProjectModal'
import { Empty, Page, Spinner, formatCount, timeAgo } from '../components/ui'
import { api } from '../lib/api'
import { useStore } from '../store/useStore'
import { LOADERS, type LoaderId, type ModProject, type ProjectType } from '../../shared/types'

const TITLES: Record<string, { title: string; sub: string }> = {
  mod: { title: 'Mods', sub: 'Change and extend the game' },
  modpack: { title: 'Modpacks', sub: 'Curated collections, installed in one click' },
  resourcepack: { title: 'Resource packs', sub: 'New textures, models and sounds' },
  shader: { title: 'Shaders', sub: 'Lighting, water and weather overhauls' }
}

const SORTS = [
  { id: 'relevance', label: 'Relevance' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'follows', label: 'Follows' },
  { id: 'updated', label: 'Recently updated' },
  { id: 'newest', label: 'Newest' }
]

const PAGE_SIZE = 20

export function BrowsePage({ type }: { type: ProjectType }) {
  const versions = useStore((s) => s.versions)
  const toast = useStore((s) => s.toast)

  const [source, setSource] = useState<'modrinth' | 'curseforge'>('modrinth')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sort, setSort] = useState('relevance')
  const [loader, setLoader] = useState<LoaderId | ''>('')
  const [gameVersion, setGameVersion] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const [hits, setHits] = useState<ModProject[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cfReady, setCfReady] = useState(true)
  const [selected, setSelected] = useState<ModProject | null>(null)

  const sentinel = useRef<HTMLDivElement>(null)
  const requestId = useRef(0)

  useEffect(() => {
    api.curseforgeReady().then(setCfReady)
  }, [source])

  // Debounce typing so we do not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 280)
    return () => clearTimeout(timer)
  }, [query])

  const runSearch = useCallback(
    async (nextOffset: number): Promise<void> => {
      const id = ++requestId.current
      if (nextOffset === 0) setLoading(true)
      else setLoadingMore(true)
      setError(null)

      try {
        const result = await api.search({
          query: debounced,
          source,
          projectType: type,
          loader: loader || undefined,
          gameVersion: gameVersion || undefined,
          sort,
          offset: nextOffset,
          limit: PAGE_SIZE
        })
        // A slower earlier request must not overwrite a newer one's results.
        if (id !== requestId.current) return
        setHits((prev) => (nextOffset === 0 ? result.hits : [...prev, ...result.hits]))
        setTotal(result.total)
        setOffset(nextOffset)
      } catch (err) {
        if (id !== requestId.current) return
        setError(err instanceof Error ? err.message : String(err))
        if (nextOffset === 0) setHits([])
      } finally {
        if (id === requestId.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [debounced, source, type, loader, gameVersion, sort]
  )

  useEffect(() => {
    runSearch(0)
  }, [runSearch])

  const hasMore = hits.length < total

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasMore || loading || loadingMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) runSearch(offset + PAGE_SIZE)
      },
      { rootMargin: '400px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, offset, runSearch])

  const releases = useMemo(() => versions.filter((v) => v.type === 'release'), [versions])
  const meta = TITLES[type] ?? TITLES.mod
  const showLoaderFilter = type === 'mod' || type === 'modpack'

  return (
    <Page>
      <div className="hstack md" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h1 className="page-title">{meta.title}</h1>
          <p className="page-sub">{meta.sub}</p>
        </div>
      </div>

      <div className="hstack md" style={{ marginTop: 20, flexWrap: 'wrap' }}>
        <div className="search-box">
          <Search size={15} />
          <input
            className="input"
            placeholder={`Search ${meta.title.toLowerCase()}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="chip-row">
          <button
            className={`chip${source === 'modrinth' ? ' active' : ''}`}
            onClick={() => setSource('modrinth')}
          >
            Modrinth
          </button>
          <button
            className={`chip${source === 'curseforge' ? ' active' : ''}`}
            onClick={() => setSource('curseforge')}
          >
            CurseForge
          </button>
        </div>

        <button
          className={`btn${showFilters ? ' primary' : ''}`}
          onClick={() => setShowFilters((v) => !v)}
        >
          <SlidersHorizontal size={15} /> Filters
        </button>
      </div>

      <AnimatePresence>
        {showFilters && (
          <motion.div
            className="card pad"
            style={{ marginTop: 14, overflow: 'hidden' }}
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: 'auto', marginTop: 14 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="hstack md" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field" style={{ minWidth: 180 }}>
                <span className="field-label">Sort by</span>
                <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
                  {SORTS.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field" style={{ minWidth: 170 }}>
                <span className="field-label">Minecraft version</span>
                <select
                  className="select"
                  value={gameVersion}
                  onChange={(e) => setGameVersion(e.target.value)}
                >
                  <option value="">Any version</option>
                  {releases.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id}
                    </option>
                  ))}
                </select>
              </div>

              {showLoaderFilter && (
                <div className="field" style={{ minWidth: 160 }}>
                  <span className="field-label">Loader</span>
                  <select
                    className="select"
                    value={loader}
                    onChange={(e) => setLoader(e.target.value as LoaderId | '')}
                  >
                    <option value="">Any loader</option>
                    {LOADERS.filter((l) => l.id !== 'vanilla').map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                className="btn ghost"
                onClick={() => {
                  setSort('relevance')
                  setGameVersion('')
                  setLoader('')
                }}
              >
                <RefreshCw size={14} /> Reset
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {source === 'curseforge' && !cfReady && (
        <div className="banner warn" style={{ marginTop: 16 }}>
          <Key size={15} />
          <div>
            CurseForge needs a free API key. Add one in <strong>Settings → Integrations</strong> to
            browse their library. Modrinth works without any setup.
          </div>
        </div>
      )}

      {!loading && !error && hits.length > 0 && (
        <div className="faint small" style={{ marginTop: 16 }}>
          {formatCount(total)} result{total === 1 ? '' : 's'}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {loading ? (
          <div className="grid projects">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="skeleton" style={{ height: 110 }} />
            ))}
          </div>
        ) : error ? (
          <Empty
            icon={<Package size={26} />}
            title="Could not load results"
            hint={error}
            action={
              <button className="btn" onClick={() => runSearch(0)}>
                <RefreshCw size={15} /> Try again
              </button>
            }
          />
        ) : hits.length === 0 ? (
          <Empty
            icon={<Search size={26} />}
            title="Nothing found"
            hint="Try a different search, or loosen the filters."
          />
        ) : (
          <>
            <div className="grid projects">
              {hits.map((project, index) => (
                <ProjectCard
                  key={`${project.source}-${project.id}`}
                  project={project}
                  index={index}
                  onOpen={() => setSelected(project)}
                />
              ))}
            </div>

            <div ref={sentinel} style={{ height: 1 }} />

            {loadingMore && (
              <div className="hstack sm faint" style={{ justifyContent: 'center', padding: 24 }}>
                <Spinner /> Loading more…
              </div>
            )}
          </>
        )}
      </div>

      <ProjectModal project={selected} onClose={() => setSelected(null)} onError={(m) => toast('error', m)} />
    </Page>
  )
}

function ProjectCard({
  project,
  index,
  onOpen
}: {
  project: ModProject
  index: number
  onOpen: () => void
}) {
  return (
    <motion.button
      className="project-card"
      onClick={onOpen}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      // Stagger only within a page so later pages appear immediately.
      transition={{ delay: Math.min(index % PAGE_SIZE, 10) * 0.025, duration: 0.26 }}
      whileHover={{ y: -2, borderColor: 'var(--accent-line)' }}
    >
      {project.iconUrl ? (
        <img className="project-icon" src={project.iconUrl} alt="" loading="lazy" />
      ) : (
        <div className="project-icon" style={{ display: 'grid', placeItems: 'center' }}>
          <Package size={22} style={{ color: 'var(--ink-faint)' }} />
        </div>
      )}

      <div className="project-body">
        <div className="hstack sm" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="project-title">{project.title}</span>
          {project.author && <span className="project-author">by {project.author}</span>}
        </div>

        <div className="project-desc">{project.description}</div>

        <div className="project-stats">
          <span className="stat">
            <Download size={12} /> {formatCount(project.downloads)}
          </span>
          {project.follows > 0 && (
            <span className="stat">
              <Heart size={12} /> {formatCount(project.follows)}
            </span>
          )}
          {project.updated && <span className="stat">Updated {timeAgo(Date.parse(project.updated))}</span>}
          <span className="tag" style={{ marginLeft: 'auto' }}>
            {project.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}
          </span>
        </div>

        {project.categories.length > 0 && (
          <div className="tag-row" style={{ marginTop: 8 }}>
            {project.categories.slice(0, 4).map((category) => (
              <span key={category} className="tag">
                {category}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.button>
  )
}
