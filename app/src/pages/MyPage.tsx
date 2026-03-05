import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SubjectEditModal, { type SubjectLite } from '../components/SubjectEditModal'
import { useObjectUrl } from '../hooks/useObjectUrl'
import { appDb } from '../db/appDb'
import type { SubjectExtrasRecord } from '../db/extrasTypes'
import type { AnimeCacheRecord, EntryRecord, EntryStatus } from '../db/types'

type MyItem = {
  entry: EntryRecord
  cache?: AnimeCacheRecord
  extras?: SubjectExtrasRecord
}

const STATUS_OPTIONS: Array<{ value: EntryStatus | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'wish', label: '想看' },
  { value: 'doing', label: '在看' },
  { value: 'done', label: '看完' },
  { value: 'on_hold', label: '搁置' },
  { value: 'dropped', label: '弃坑' },
]

function getDisplayTitle(entry: EntryRecord, cache?: AnimeCacheRecord) {
  const t = entry.customTitleCn?.trim()
  if (t) return t
  const cn = cache?.nameCn?.trim()
  if (cn) return cn
  return cache?.nameJp || String(entry.subjectId)
}

function getYearFromDate(date?: string): string {
  const y = date?.slice(0, 4)
  return y && /^\d{4}$/.test(y) ? y : '未知'
}

function includesKeyword(haystack: string, keyword: string): boolean {
  if (!keyword.trim()) return true
  return haystack.toLowerCase().includes(keyword.trim().toLowerCase())
}

function buildSearchHaystack(it: MyItem): string {
  const parts: string[] = []

  if (it.entry.customTitleCn) parts.push(it.entry.customTitleCn)
  if (it.cache?.nameCn) parts.push(it.cache.nameCn)
  if (it.cache?.nameJp) parts.push(it.cache.nameJp)
  if (it.cache?.summary) parts.push(it.cache.summary)

  if (it.extras) {
    for (const p of it.extras.persons) {
      parts.push(p.name)
      parts.push(p.relation)
      if (p.career?.length) parts.push(p.career.join(' '))
    }
    for (const c of it.extras.characters) {
      parts.push(c.name)
      if (c.role) parts.push(c.role)
      if (c.relation) parts.push(c.relation)
      if (c.actors?.length) parts.push(c.actors.map((a) => a.name).join(' '))
    }
  }

  return parts.join(' ')
}

function Cover(props: { cache?: AnimeCacheRecord; alt: string }) {
  const objectUrl = useObjectUrl(props.cache?.coverBlob)
  const src = objectUrl || props.cache?.coverUrl || ''
  return (
    <div className="aspect-[3/4] overflow-hidden rounded-md bg-slate-100">
      {src ? (
        <div
          className="h-full w-full bg-cover bg-center select-none"
          style={{
            backgroundImage: `url(${src})`,
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none',
            touchAction: 'manipulation',
          }}
          aria-label={props.alt}
        />
      ) : null}
    </div>
  )
}

export default function MyPage() {
  const [items, setItems] = useState<MyItem[]>([])
  const [statusFilter, setStatusFilter] = useState<EntryStatus | 'all'>('all')
  const [yearFilter, setYearFilter] = useState<string>('all')
  const [keyword, setKeyword] = useState<string>('')
  const [selected, setSelected] = useState<SubjectLite | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<EntryRecord | null>(null)

  const [batchMode, setBatchMode] = useState<boolean>(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const pressTimerRef = useRef<number | null>(null)
  const pressStartRef = useRef<{ x: number; y: number } | null>(null)
  const suppressClickRef = useRef<boolean>(false)

  const refresh = useCallback(async () => {
    const entries = await appDb.entries.orderBy('updatedAt').reverse().toArray()
    const caches = await appDb.animeCache.bulkGet(entries.map((e) => e.subjectId))
    const extras = await appDb.subjectExtras.bulkGet(entries.map((e) => e.subjectId))
    setItems(
      entries.map((e, idx) => ({
        entry: e,
        cache: caches[idx] ?? undefined,
        extras: extras[idx] ?? undefined,
      })),
    )
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const clearAll = useCallback(async () => {
    await appDb.entries.clear()
    await appDb.animeCache.clear()
    await appDb.subjectExtras.clear()
    await refresh()
  }, [refresh])

  const exitBatchMode = useCallback(() => {
    setBatchMode(false)
    setSelectedIds([])
  }, [])

  const toggleSelected = useCallback((subjectId: number) => {
    setSelectedIds((prev) => {
      if (prev.includes(subjectId)) return prev.filter((x) => x !== subjectId)
      return [...prev, subjectId]
    })
  }, [])

  const applyBatchStatus = useCallback(
    async (status: EntryStatus) => {
      if (selectedIds.length === 0) return
      const now = Date.now()
      await appDb.entries.bulkPut(
        selectedIds.map((id) => ({
          subjectId: id,
          status,
          updatedAt: now,
        })),
      )
      await refresh()
      exitBatchMode()
    },
    [exitBatchMode, refresh, selectedIds],
  )

  const clearBatchRating = useCallback(async () => {
    if (selectedIds.length === 0) return
    const now = Date.now()
    const existing = await appDb.entries.bulkGet(selectedIds)
    await appDb.entries.bulkPut(
      existing
        .filter((x): x is EntryRecord => Boolean(x))
        .map((e) => ({ ...e, rating: undefined, updatedAt: now })),
    )
    await refresh()
    exitBatchMode()
  }, [exitBatchMode, refresh, selectedIds])

  const deleteBatchEntries = useCallback(async () => {
    if (selectedIds.length === 0) return
    if (!confirm(`确认删除已选 ${selectedIds.length} 条记录？（仅删除记录，不会清缓存）`)) return
    await appDb.entries.bulkDelete(selectedIds)
    await refresh()
    exitBatchMode()
  }, [exitBatchMode, refresh, selectedIds])

  const setBatchRating = useCallback(async () => {
    if (selectedIds.length === 0) return
    const raw = prompt('批量设置评分（0-10，可小数）。留空取消。')
    if (raw == null) return
    const trimmed = raw.trim()
    if (!trimmed) return
    const value = Number(trimmed)
    if (!Number.isFinite(value) || value < 0 || value > 10) {
      alert('评分必须是 0-10 的数字（可小数）')
      return
    }
    const now = Date.now()
    const existing = await appDb.entries.bulkGet(selectedIds)
    await appDb.entries.bulkPut(
      existing
        .filter((x): x is EntryRecord => Boolean(x))
        .map((e) => ({ ...e, rating: value, updatedAt: now })),
    )
    await refresh()
    exitBatchMode()
  }, [exitBatchMode, refresh, selectedIds])

  const yearOptions = useMemo(() => {
    const years = new Set<string>()
    for (const it of items) {
      years.add(getYearFromDate(it.cache?.date))
    }
    return Array.from(years)
      .sort((a, b) => {
        if (a === '未知' && b === '未知') return 0
        if (a === '未知') return 1
        if (b === '未知') return -1
        return Number(b) - Number(a)
      })
      .map((y) => ({ value: y, label: y }))
  }, [items])

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (statusFilter !== 'all' && it.entry.status !== statusFilter) return false
      if (yearFilter !== 'all' && getYearFromDate(it.cache?.date) !== yearFilter) return false
      if (keyword.trim()) {
        const haystack = buildSearchHaystack(it)
        if (!includesKeyword(haystack, keyword)) return false
      }
      return true
    })
  }, [items, keyword, statusFilter, yearFilter])

  return (
    <div
      className="px-4 py-3"
      onClick={(e) => {
        if (!batchMode) return
        if (e.target === e.currentTarget) exitBatchMode()
      }}
    >
      <button
        type="button"
        className="text-lg font-semibold"
        onClick={() => {
          if (batchMode) exitBatchMode()
        }}
      >
        我的记录
      </button>
      <div className="mt-2 text-sm text-slate-600">离线可用。本地记录数：{items.length}</div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as EntryStatus | 'all')}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
        >
          <option value="all">全部年份</option>
          {yearOptions.map((y) => (
            <option key={y.value} value={y.value}>
              {y.label}
            </option>
          ))}
        </select>

        <input
          className="min-w-[10rem] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="筛选：标题/声优/公司/角色…"
        />

        <button
          className="ml-auto rounded-md bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900"
          onClick={() => void clearAll()}
          type="button"
        >
          清空本地数据
        </button>
      </div>

      <div className="mt-2 text-xs text-slate-600">当前显示：{filtered.length}</div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {filtered.map((it) => {
          const title = getDisplayTitle(it.entry, it.cache)
          const isSelected = selectedSet.has(it.entry.subjectId)
          return (
            <button
              key={it.entry.subjectId}
              type="button"
              className="text-left"
              onContextMenu={(e) => {
                e.preventDefault()
                suppressClickRef.current = true
                setBatchMode(true)
                setSelectedIds([it.entry.subjectId])
                window.setTimeout(() => {
                  suppressClickRef.current = false
                }, 0)
              }}
              style={{
                WebkitTouchCallout: 'none',
                WebkitUserSelect: 'none',
                userSelect: 'none',
                touchAction: 'manipulation',
              }}
              onPointerDown={(e) => {
                if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current)
                pressStartRef.current = { x: e.clientX, y: e.clientY }
                pressTimerRef.current = window.setTimeout(() => {
                  suppressClickRef.current = true
                  setBatchMode(true)
                  setSelectedIds([it.entry.subjectId])
                  window.setTimeout(() => {
                    suppressClickRef.current = false
                  }, 0)
                }, 500)
              }}
              onPointerMove={(e) => {
                const start = pressStartRef.current
                if (!start) return
                const dx = Math.abs(e.clientX - start.x)
                const dy = Math.abs(e.clientY - start.y)
                if (dx > 10 || dy > 10) {
                  if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current)
                  pressTimerRef.current = null
                }
              }}
              onPointerUp={() => {
                if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current)
                pressTimerRef.current = null
              }}
              onPointerCancel={() => {
                if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current)
                pressTimerRef.current = null
              }}
              onTouchStart={(e) => {
                if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current)
                const t = e.touches[0]
                if (!t) return
                pressStartRef.current = { x: t.clientX, y: t.clientY }
                pressTimerRef.current = window.setTimeout(() => {
                  suppressClickRef.current = true
                  setBatchMode(true)
                  setSelectedIds([it.entry.subjectId])
                  window.setTimeout(() => {
                    suppressClickRef.current = false
                  }, 0)
                }, 500)
              }}
              onTouchMove={(e) => {
                const start = pressStartRef.current
                if (!start) return
                const t = e.touches[0]
                if (!t) return
                const dx = Math.abs(t.clientX - start.x)
                const dy = Math.abs(t.clientY - start.y)
                if (dx > 10 || dy > 10) {
                  if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current)
                  pressTimerRef.current = null
                }
              }}
              onTouchEnd={() => {
                if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current)
                pressTimerRef.current = null
              }}
              onTouchCancel={() => {
                if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current)
                pressTimerRef.current = null
              }}
              onClick={() => {
                if (suppressClickRef.current) return
                if (batchMode) {
                  toggleSelected(it.entry.subjectId)
                  return
                }
                // Desktop fallback: Shift + click enters multi-select mode
                if (window.event instanceof MouseEvent && window.event.shiftKey) {
                  suppressClickRef.current = true
                  setBatchMode(true)
                  setSelectedIds([it.entry.subjectId])
                  window.setTimeout(() => {
                    suppressClickRef.current = false
                  }, 0)
                  return
                }
                setSelectedEntry(it.entry)
                setSelected({
                  subjectId: it.entry.subjectId,
                  name: it.cache?.nameJp || String(it.entry.subjectId),
                  nameCn: it.cache?.nameCn || '',
                  summary: it.cache?.summary,
                  date: it.cache?.date,
                  coverUrl: it.cache?.coverUrl,
                })
              }}
            >
              <div className="relative">
                <Cover cache={it.cache} alt={title} />
                {batchMode ? (
                  <div
                    className={
                      'absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-md border text-xs ' +
                      (isSelected
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 bg-white text-transparent')
                    }
                  >
                    ✓
                  </div>
                ) : null}
              </div>
              <div className="mt-1 line-clamp-2 text-xs leading-snug text-slate-900">{title}</div>
            </button>
          )
        })}
      </div>

      {batchMode ? (
        <div className="fixed bottom-16 left-0 right-0 z-40">
          <div className="mx-auto max-w-md border-t border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-slate-700">
              <div className="flex-1">已选：{selectedIds.length}</div>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-slate-600"
                onClick={() => exitBatchMode()}
              >
                退出
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-900"
                onClick={() => void applyBatchStatus('wish')}
                disabled={selectedIds.length === 0}
              >
                想看
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-900"
                onClick={() => void applyBatchStatus('doing')}
                disabled={selectedIds.length === 0}
              >
                在看
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-900"
                onClick={() => void applyBatchStatus('done')}
                disabled={selectedIds.length === 0}
              >
                看完
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-900"
                onClick={() => void applyBatchStatus('on_hold')}
                disabled={selectedIds.length === 0}
              >
                搁置
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-900"
                onClick={() => void applyBatchStatus('dropped')}
                disabled={selectedIds.length === 0}
              >
                弃坑
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-900"
                onClick={() => void clearBatchRating()}
                disabled={selectedIds.length === 0}
              >
                清评分
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-900"
                onClick={() => void setBatchRating()}
                disabled={selectedIds.length === 0}
              >
                设评分
              </button>
              <button
                type="button"
                className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white"
                onClick={() => void deleteBatchEntries()}
                disabled={selectedIds.length === 0}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selected ? (
        <SubjectEditModal
          subject={selected}
          initialEntry={selectedEntry}
          onSaved={() => void refresh()}
          onClose={() => {
            setSelected(null)
            setSelectedEntry(null)
          }}
        />
      ) : null}
    </div>
  )
}
