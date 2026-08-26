import { AnimatePresence } from 'framer-motion'
import { Blocks, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CreateInstanceModal } from '../components/CreateInstanceModal'
import { InstanceCard } from '../components/InstanceCard'
import { Empty, Page } from '../components/ui'
import { useStore } from '../store/useStore'

type SortKey = 'played' | 'name' | 'created'

export function InstancesPage({ onOpen }: { onOpen: (id: string) => void }) {
  const instances = useStore((s) => s.instances)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('played')
  const [creating, setCreating] = useState(false)

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? instances.filter(
          (i) =>
            i.name.toLowerCase().includes(needle) ||
            i.mcVersion.includes(needle) ||
            i.loader.includes(needle)
        )
      : instances

    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'created') return b.createdAt - a.createdAt
      return (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)
    })
  }, [instances, query, sort])

  return (
    <Page>
      <div className="hstack md" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h1 className="page-title">Instances</h1>
          <p className="page-sub">
            {instances.length === 0
              ? 'Each instance keeps its own version, mods and worlds.'
              : `${instances.length} instance${instances.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> New instance
        </button>
      </div>

      {instances.length > 0 && (
        <div className="hstack md" style={{ marginTop: 22 }}>
          <div className="search-box">
            <Search size={15} />
            <input
              className="input"
              placeholder="Search instances"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            className="select"
            style={{ width: 180 }}
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="played">Recently played</option>
            <option value="created">Newest first</option>
            <option value="name">Name (A–Z)</option>
          </select>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        {instances.length === 0 ? (
          <Empty
            icon={<Blocks size={26} />}
            title="No instances yet"
            hint="Create one to pick a Minecraft version and mod loader. You can make as many as you like — they stay completely separate."
            action={
              <button className="btn primary" onClick={() => setCreating(true)}>
                <Plus size={16} /> Create your first instance
              </button>
            }
          />
        ) : visible.length === 0 ? (
          <Empty icon={<Search size={26} />} title="Nothing matches that search" />
        ) : (
          <div className="grid instances">
            <AnimatePresence mode="popLayout">
              {visible.map((instance) => (
                <InstanceCard key={instance.id} instance={instance} onOpen={onOpen} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <CreateInstanceModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={onOpen}
      />
    </Page>
  )
}
