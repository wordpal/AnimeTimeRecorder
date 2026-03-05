import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { searchAnimeSubjects, type SearchAnimeResultItem } from '../api/bangumi'
import SubjectEditModal, { type SubjectLite } from '../components/SubjectEditModal'
import { appDb } from '../db/appDb'
import type { EntryRecord } from '../db/types'

const SEARCH_HISTORY_KEY = 'ctr_search_history_v1'
const SEARCH_HISTORY_LIMIT = 5

function loadSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .map((x) => String(x))
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, SEARCH_HISTORY_LIMIT)
  } catch {
    return []
  }
}

function saveSearchHistory(list: string[]) {
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(list.slice(0, SEARCH_HISTORY_LIMIT)))
  } catch {
    // ignore
  }
}

function addToSearchHistory(list: string[], value: string): string[] {
  const v = value.trim()
  if (!v) return list
  const next = [v, ...list.filter((x) => x !== v)].slice(0, SEARCH_HISTORY_LIMIT)
  return next
}

function getYearFromDate(date?: string): string {
  const y = date?.slice(0, 4)
  return y && /^\d{4}$/.test(y) ? y : '未知'
}

function buildResultHaystack(item: SearchAnimeResultItem): string {
  return [item.nameCn, item.name, item.summary].filter(Boolean).join(' ').toLowerCase()
}

function TitleLine(props: { item: SearchAnimeResultItem }) {
  const title = props.item.nameCn?.trim() || props.item.name
  return (
    <div className="mt-1 line-clamp-2 text-xs leading-snug text-slate-900">{title}</div>
  )
}

export default function SearchPage() {
  const [keyword, setKeyword] = useState<string>('')
  const [items, setItems] = useState<SearchAnimeResultItem[]>([])
  const [total, setTotal] = useState<number>(0)
  const [offset, setOffset] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')

  const [history, setHistory] = useState<string[]>(() => loadSearchHistory())

  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine)

  const [yearFilter, setYearFilter] = useState<string>('all')
  const [platformFilter, setPlatformFilter] = useState<string>('all')
  const [filterKeyword, setFilterKeyword] = useState<string>('')

  const [selected, setSelected] = useState<SubjectLite | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<EntryRecord | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<number | null>(null)
  const lastAutoSearchKwRef = useRef<string>('')

  const runLocalRecommend = useCallback(async () => {
    const kw = filterKeyword.trim().toLowerCase()

    const entries = await appDb.entries.toArray()
    const caches = await appDb.animeCache.bulkGet(entries.map((e) => e.subjectId))

    const baseCandidates = entries
      .map((e, idx) => ({ entry: e, cache: caches[idx] ?? undefined }))
      .filter((it) => {
        if (yearFilter !== 'all' && getYearFromDate(it.cache?.date) !== yearFilter) return false
        if (platformFilter !== 'all' && (it.cache?.platform || '未知') !== platformFilter) return false
        if (kw) {
          const hay = [it.entry.customTitleCn, it.cache?.nameCn, it.cache?.nameJp, it.cache?.summary]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
          if (!hay.includes(kw)) return false
        }
        return true
      })

    if (baseCandidates.length === 0) {
      setItems([])
      setTotal(0)
      setOffset(0)
      setError('没有符合“年份/类型/关键词”条件的本地记录')
      return
    }

    const joined = baseCandidates.slice()

    joined.sort((a, b) => {
      return b.entry.updatedAt - a.entry.updatedAt
    })

    setItems(
      joined.map((it) => ({
        subjectId: it.entry.subjectId,
        name: it.cache?.nameJp || String(it.entry.subjectId),
        nameCn: it.cache?.nameCn || it.entry.customTitleCn || '',
        summary: it.cache?.summary,
        date: it.cache?.date,
        coverUrl: it.cache?.coverUrl,
        platform: it.cache?.platform,
      })),
    )
    setTotal(joined.length)
    setOffset(joined.length)
  }, [filterKeyword, platformFilter, yearFilter])

  const runLocalCacheSearch = useCallback(
    async (kwRaw: string) => {
      const kw = kwRaw.trim().toLowerCase()
      if (!kw) {
        await runLocalRecommend()
        return
      }

      setLoading(true)
      setError('')
      try {
        const [caches, entries, extras] = await Promise.all([
          appDb.animeCache.toArray(),
          appDb.entries.toArray(),
          appDb.subjectExtras.toArray(),
        ])

        const entryById = new Map<number, EntryRecord>()
        for (const e of entries) entryById.set(e.subjectId, e)

        const extrasById = new Map<number, { persons: Array<{ name: string; relation: string; career?: string[] }>; characters: Array<{ name: string; role?: string; relation?: string; actors?: Array<{ name: string }> }> }>()
        for (const ex of extras) {
          extrasById.set(ex.subjectId, {
            persons: ex.persons,
            characters: ex.characters,
          })
        }

        const filterKw = filterKeyword.trim().toLowerCase()

        const matched = caches.filter((c) => {
          const e = entryById.get(c.subjectId)

          if (yearFilter !== 'all' && getYearFromDate(c.date) !== yearFilter) return false
          if (platformFilter !== 'all' && (c.platform || '未知') !== platformFilter) return false

          const parts: string[] = []
          if (e?.customTitleCn) parts.push(e.customTitleCn)
          if (c.nameCn) parts.push(c.nameCn)
          if (c.nameJp) parts.push(c.nameJp)
          if (c.aliasesCn?.length) parts.push(c.aliasesCn.join(' '))
          if (c.summary) parts.push(c.summary)

          const ex = extrasById.get(c.subjectId)
          if (ex) {
            for (const p of ex.persons) {
              parts.push(p.name)
              parts.push(p.relation)
              if (p.career?.length) parts.push(p.career.join(' '))
            }
            for (const ch of ex.characters) {
              parts.push(ch.name)
              if (ch.role) parts.push(ch.role)
              if (ch.relation) parts.push(ch.relation)
              if (ch.actors?.length) parts.push(ch.actors.map((a) => a.name).join(' '))
            }
          }

          const hay = parts.filter(Boolean).join(' ').toLowerCase()
          if (!hay.includes(kw)) return false
          if (filterKw && !hay.includes(filterKw)) return false
          return true
        })

        setItems(
          matched.map((c) => {
            const e = entryById.get(c.subjectId)
            return {
              subjectId: c.subjectId,
              name: c.nameJp || String(c.subjectId),
              nameCn: e?.customTitleCn?.trim() || c.nameCn || '',
              summary: c.summary,
              date: c.date,
              coverUrl: c.coverUrl,
              platform: c.platform,
            }
          }),
        )
        setTotal(matched.length)
        setOffset(matched.length)

        if (matched.length === 0) {
          setError('离线：本地缓存中没有匹配结果（可先联网搜索并打开条目以缓存）')
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [runLocalRecommend],
  )

  const runSearch = useCallback(async (overrideKeyword?: string) => {
    const kw = (overrideKeyword ?? keyword).trim()
    if (!kw) {
      abortRef.current?.abort()
      setLoading(true)
      setError('')
      try {
        const hasFilters = yearFilter !== 'all' || platformFilter !== 'all' || filterKeyword.trim()
        if (!hasFilters) {
          setItems([])
          setTotal(0)
          setOffset(0)
          return
        }
        await runLocalRecommend()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
      return
    }

    if (!navigator.onLine) {
      await runLocalCacheSearch(kw)
      return
    }

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setLoading(true)
    setError('')
    try {
      const res = await searchAnimeSubjects({ keyword: kw, limit: 24, offset: 0, signal: ac.signal })
      setItems(res.data)
      setTotal(res.total)
      setOffset(res.data.length)

      setHistory((prev) => {
        const next = addToSearchHistory(prev, kw)
        saveSearchHistory(next)
        return next
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return
      }
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [filterKeyword, keyword, platformFilter, runLocalCacheSearch, runLocalRecommend, yearFilter])

  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    if (isOnline) return
    if (keyword.trim()) return
    void runLocalRecommend()
  }, [filterKeyword, isOnline, keyword, platformFilter, runLocalRecommend, yearFilter])

  useEffect(() => {
    if (!isOnline) return
    const kw = keyword.trim()
    if (!kw) return
    if (kw === lastAutoSearchKwRef.current) return

    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      lastAutoSearchKwRef.current = kw
      void runSearch(kw)
    }, 500)

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [isOnline, keyword, runSearch])

  const loadMore = useCallback(async () => {
    const kw = keyword.trim()
    if (!kw) return
    if (loading) return
    if (offset >= total) return

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setLoading(true)
    setError('')
    try {
      const res = await searchAnimeSubjects({ keyword: kw, limit: 24, offset, signal: ac.signal })
      setItems((prev) => [...prev, ...(res.data ?? [])])
      setTotal(res.total)
      setOffset(offset + (res.data?.length ?? 0))
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return
      }
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [keyword, loading, offset, total])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const yearOptions = useMemo(() => {
    const years = new Set<string>()
    for (const it of items) years.add(getYearFromDate(it.date))
    return Array.from(years)
      .sort((a, b) => {
        if (a === '未知' && b === '未知') return 0
        if (a === '未知') return 1
        if (b === '未知') return -1
        return Number(b) - Number(a)
      })
      .map((y) => ({ value: y, label: y }))
  }, [items])

  const platformOptions = useMemo(() => {
    const platforms = new Set<string>()
    for (const it of items) platforms.add(it.platform || '未知')
    return Array.from(platforms)
      .sort((a, b) => {
        if (a === '未知' && b === '未知') return 0
        if (a === '未知') return 1
        if (b === '未知') return -1
        return a.localeCompare(b)
      })
      .map((p) => ({ value: p, label: p }))
  }, [items])

  const filteredItems = useMemo(() => {
    const kw = filterKeyword.trim().toLowerCase()
    return items.filter((it) => {
      if (yearFilter !== 'all' && getYearFromDate(it.date) !== yearFilter) return false
      if (platformFilter !== 'all' && (it.platform || '未知') !== platformFilter) return false
      if (kw) {
        const hay = buildResultHaystack(it)
        if (!hay.includes(kw)) return false
      }
      return true
    })
  }, [filterKeyword, items, platformFilter, yearFilter])

  return (
    <div className="px-4 py-3">
      <div className="text-lg font-semibold">在线搜索</div>

      <div className="mt-3 flex gap-2">
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          placeholder="输入番剧名（中文/日文）"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch()
          }}
        />
        <button
          className="shrink-0 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          type="button"
          onClick={() => void runSearch()}
          disabled={loading}
        >
          {isOnline ? '搜索' : '离线搜索'}
        </button>
      </div>

      {!isOnline ? (
        <div className="mt-2 text-xs text-amber-700">
          当前离线：将只在本地缓存/记录中搜索。若需要更多结果，请联网后再搜索。
        </div>
      ) : null}

      {history.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="text-xs text-slate-600">历史：</div>
          {history.map((h) => (
            <button
              key={h}
              type="button"
              className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-800"
              onClick={() => {
                setKeyword(h)
                void runSearch(h)
              }}
            >
              {h}
            </button>
          ))}
          <button
            type="button"
            className="ml-auto rounded-md px-2 py-1 text-xs text-slate-600"
            onClick={() => {
              setHistory([])
              saveSearchHistory([])
            }}
          >
            清空
          </button>
        </div>
      ) : null}

      {keyword.trim() && !loading && !error && items.length > 0 && offset < total ? (
        <div className="mt-3 text-xs text-slate-600">可继续下拉查看或在底部点击“加载更多”。</div>
      ) : null}

      {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}

      {loading ? <div className="mt-3 text-sm text-slate-600">加载中…</div> : null}

      {!loading && !error && items.length === 0 && keyword.trim() ? (
        <div className="mt-3 text-sm text-slate-600">没有结果</div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
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

        <select
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
        >
          <option value="all">全部类型</option>
          {platformOptions.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>

        <input
          className="min-w-[10rem] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={filterKeyword}
          onChange={(e) => setFilterKeyword(e.target.value)}
          placeholder="过滤：标题/简介"
        />

        <div className="ml-auto text-xs text-slate-600">
          当前显示：{filteredItems.length}
          {keyword.trim() ? ` / 总计：${total}` : ''}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {filteredItems.map((item) => (
          <button
            key={item.subjectId}
            type="button"
            className="text-left"
            onContextMenu={(e) => e.preventDefault()}
            style={{
              WebkitTouchCallout: 'none',
              WebkitUserSelect: 'none',
              userSelect: 'none',
              touchAction: 'manipulation',
            }}
            onClick={() => {
              void (async () => {
                const entry = await appDb.entries.get(item.subjectId)
                setSelectedEntry(entry ?? null)
                setSelected({
                  subjectId: item.subjectId,
                  name: item.name,
                  nameCn: item.nameCn,
                  summary: item.summary,
                  date: item.date,
                  coverUrl: item.coverUrl,
                })
              })()
            }}
          >
            <div className="aspect-[3/4] overflow-hidden rounded-md bg-slate-100">
              {item.coverUrl ? (
                <div
                  className="h-full w-full bg-cover bg-center"
                  style={{
                    backgroundImage: `url(${item.coverUrl})`,
                    WebkitTouchCallout: 'none',
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    touchAction: 'manipulation',
                  }}
                  aria-label={item.nameCn || item.name}
                />
              ) : null}
            </div>
            <TitleLine item={item} />
          </button>
        ))}
      </div>

      {keyword.trim() && !loading && !error && items.length > 0 && offset < total ? (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            className="rounded-md bg-slate-200 px-4 py-2 text-sm font-medium text-slate-900"
            onClick={() => void loadMore()}
          >
            加载更多
          </button>
        </div>
      ) : null}

      {selected ? (
        <SubjectEditModal
          subject={selected}
          initialEntry={selectedEntry}
          onClose={() => {
            setSelected(null)
            setSelectedEntry(null)
          }}
        />
      ) : null}
    </div>
  )
}
