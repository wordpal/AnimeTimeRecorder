import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSubjectCharacters, getSubjectPersons } from '../api/bangumiExtras'
import { getSubjectDetail } from '../api/bangumi'
import { appDb } from '../db/appDb'
import type { SubjectCharacterLite, SubjectExtrasRecord, SubjectPersonLite } from '../db/extrasTypes'
import type { AnimeCacheRecord, EntryRecord, EntryStatus } from '../db/types'

export type SubjectLite = {
  subjectId: number
  name: string
  nameCn: string
  summary?: string
  date?: string
  coverUrl?: string
}

export type SubjectEditModalProps = {
  subject: SubjectLite
  initialEntry?: EntryRecord | null
  onClose: () => void
  onSaved?: () => void
}

type ActiveTab = 'edit' | 'detail'

const STATUS_OPTIONS: Array<{ value: EntryStatus; label: string }> = [
  { value: 'wish', label: '想看' },
  { value: 'doing', label: '在看' },
  { value: 'done', label: '看完' },
  { value: 'on_hold', label: '搁置' },
  { value: 'dropped', label: '弃坑' },
]

function getDisplayTitle(subject: SubjectLite, customTitleCn?: string) {
  const t = customTitleCn?.trim()
  if (t) return t
  const cn = subject.nameCn?.trim()
  if (cn) return cn
  return subject.name
}

async function ensureCoverBlob(subjectId: number, coverUrl?: string) {
  if (!coverUrl) return undefined

  const cached = await appDb.animeCache.get(subjectId)
  if (cached?.coverBlob) return cached.coverBlob

  const resp = await fetch(coverUrl)
  if (!resp.ok) {
    throw new Error(`下载封面失败：${resp.status} ${resp.statusText}`)
  }
  return await resp.blob()
}

function getBestCoverUrl(images?: {
  small?: string
  grid?: string
  large?: string
  medium?: string
  common?: string
} | null): string | undefined {
  if (!images) return undefined
  return images.grid || images.small || images.medium || images.large || images.common
}

const DEFAULT_DETAIL_CACHE_TTL_DAYS = 7
const CACHE_SETTING_DETAIL_TTL_DAYS_KEY = 'cache_detail_ttl_days'

export default function SubjectEditModal(props: SubjectEditModalProps) {
  const initial = props.initialEntry

  const [status, setStatus] = useState<EntryStatus>(initial?.status ?? 'wish')
  const [rating, setRating] = useState<number>(initial?.rating ?? 0)
  const [customTitleCn, setCustomTitleCn] = useState<string>(initial?.customTitleCn ?? '')
  const [saving, setSaving] = useState<boolean>(false)
  const [error, setError] = useState<string>('')

  const [activeTab, setActiveTab] = useState<ActiveTab>('edit')
  const [summaryExpanded, setSummaryExpanded] = useState<boolean>(false)

  const [extrasLoading, setExtrasLoading] = useState<boolean>(false)
  const [extrasError, setExtrasError] = useState<string>('')
  const [persons, setPersons] = useState<SubjectPersonLite[]>([])
  const [characters, setCharacters] = useState<SubjectCharacterLite[]>([])

  const [detailCache, setDetailCache] = useState<AnimeCacheRecord | null>(null)
  const [detailCacheLoading, setDetailCacheLoading] = useState<boolean>(false)

  const [detailCacheTtlMs, setDetailCacheTtlMs] = useState<number | null>(DEFAULT_DETAIL_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000)

  const extrasAbortRef = useRef<AbortController | null>(null)

  const prefetchDetailAbortRef = useRef<AbortController | null>(null)
  const prefetchExtrasAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  useEffect(() => {
    return () => {
      extrasAbortRef.current?.abort()
      prefetchDetailAbortRef.current?.abort()
      prefetchExtrasAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rec = await appDb.appSettings.get(CACHE_SETTING_DETAIL_TTL_DAYS_KEY)
        const days = typeof rec?.value === 'number' ? rec.value : DEFAULT_DETAIL_CACHE_TTL_DAYS
        if (cancelled) return
        if (days <= 0) {
          setDetailCacheTtlMs(null)
        } else {
          setDetailCacheTtlMs(days * 24 * 60 * 60 * 1000)
        }
      } catch {
        if (!cancelled) setDetailCacheTtlMs(DEFAULT_DETAIL_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const prefetchDetailAndCache = useCallback(async () => {
    if (!navigator.onLine) return

    prefetchDetailAbortRef.current?.abort()
    const ac = new AbortController()
    prefetchDetailAbortRef.current = ac

    try {
      const cached = await appDb.animeCache.get(props.subject.subjectId)
      const now = Date.now()
      if (detailCacheTtlMs !== null && cached?.lastFetchedAt && now - cached.lastFetchedAt < detailCacheTtlMs) {
        return
      }

      const detail = await getSubjectDetail({ subjectId: props.subject.subjectId, signal: ac.signal })
      const coverUrl = props.subject.coverUrl || getBestCoverUrl(detail.images)
      const coverBlob = await ensureCoverBlob(props.subject.subjectId, coverUrl)

      await appDb.animeCache.put({
        subjectId: props.subject.subjectId,
        nameCn: detail.name_cn || props.subject.nameCn,
        nameJp: detail.name || props.subject.name,
        coverUrl,
        coverBlob,
        type: detail.type,
        date: detail.date,
        summary: detail.summary,
        platform: detail.platform,
        apiRatingScore: detail.rating?.score,
        lastFetchedAt: now,
      })

      setDetailCache({
        subjectId: props.subject.subjectId,
        nameCn: detail.name_cn || props.subject.nameCn,
        nameJp: detail.name || props.subject.name,
        coverUrl,
        coverBlob,
        type: detail.type,
        date: detail.date,
        summary: detail.summary,
        platform: detail.platform,
        apiRatingScore: detail.rating?.score,
        lastFetchedAt: now,
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      // ignore prefetch errors
    }
  }, [detailCacheTtlMs, props.subject.coverUrl, props.subject.name, props.subject.nameCn, props.subject.subjectId])

  const prefetchExtrasAndCache = useCallback(async () => {
    if (!navigator.onLine) return

    prefetchExtrasAbortRef.current?.abort()
    const ac = new AbortController()
    prefetchExtrasAbortRef.current = ac

    try {
      const cached = await appDb.subjectExtras.get(props.subject.subjectId)
      const now = Date.now()
      if (detailCacheTtlMs !== null && cached?.lastFetchedAt && now - cached.lastFetchedAt < detailCacheTtlMs) {
        return
      }

      const [p, c] = await Promise.all([
        getSubjectPersons({ subjectId: props.subject.subjectId, signal: ac.signal }),
        getSubjectCharacters({ subjectId: props.subject.subjectId, signal: ac.signal }),
      ])

      const rec: SubjectExtrasRecord = {
        subjectId: props.subject.subjectId,
        persons: p,
        characters: c,
        lastFetchedAt: now,
      }
      await appDb.subjectExtras.put(rec)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      // ignore prefetch errors
    }
  }, [detailCacheTtlMs, props.subject.subjectId])

  useEffect(() => {
    void prefetchDetailAndCache()
    void prefetchExtrasAndCache()
  }, [prefetchDetailAndCache, prefetchExtrasAndCache])

  const loadDetailCache = useCallback(async () => {
    setDetailCacheLoading(true)
    try {
      const cached = await appDb.animeCache.get(props.subject.subjectId)
      setDetailCache(cached ?? null)
    } finally {
      setDetailCacheLoading(false)
    }
  }, [props.subject.subjectId])

  useEffect(() => {
    void loadDetailCache()
  }, [loadDetailCache])

  const displayTitle = useMemo(() => getDisplayTitle(props.subject, customTitleCn), [props.subject, customTitleCn])

  const displaySummary = useMemo(() => {
    return props.subject.summary || detailCache?.summary || ''
  }, [detailCache?.summary, props.subject.summary])

  const detailCacheTimeText = useMemo(() => {
    if (!detailCache?.lastFetchedAt) return ''
    return new Date(detailCache.lastFetchedAt).toLocaleString()
  }, [detailCache?.lastFetchedAt])

  const loadExtras = useCallback(async () => {
    setExtrasLoading(true)
    setExtrasError('')

    extrasAbortRef.current?.abort()
    const ac = new AbortController()
    extrasAbortRef.current = ac

    try {
      const cached = await appDb.subjectExtras.get(props.subject.subjectId)
      if (cached) {
        setPersons(cached.persons)
        setCharacters(cached.characters)
        setExtrasLoading(false)
        return
      }

      if (!navigator.onLine) {
        setExtrasError('离线且本地无缓存，请联网后再试')
        setExtrasLoading(false)
        return
      }

      const [p, c] = await Promise.all([
        getSubjectPersons({ subjectId: props.subject.subjectId, signal: ac.signal }),
        getSubjectCharacters({ subjectId: props.subject.subjectId, signal: ac.signal }),
      ])

      const rec: SubjectExtrasRecord = {
        subjectId: props.subject.subjectId,
        persons: p,
        characters: c,
        lastFetchedAt: Date.now(),
      }

      await appDb.subjectExtras.put(rec)
      setPersons(p)
      setCharacters(c)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setExtrasError(e instanceof Error ? e.message : String(e))
    } finally {
      setExtrasLoading(false)
    }
  }, [props.subject.subjectId])

  useEffect(() => {
    if (activeTab !== 'detail') return
    void loadExtras()
  }, [activeTab, loadExtras])

  const onSave = useCallback(async () => {
    setSaving(true)
    setError('')
    try {
      const now = Date.now()
      const entry: EntryRecord = {
        subjectId: props.subject.subjectId,
        status,
        rating: rating > 0 ? rating : undefined,
        customTitleCn: customTitleCn.trim() ? customTitleCn.trim() : undefined,
        updatedAt: now,
      }

      const coverBlob = await ensureCoverBlob(props.subject.subjectId, props.subject.coverUrl)

      await appDb.transaction('rw', appDb.entries, appDb.animeCache, async () => {
        await appDb.entries.put(entry)

        await appDb.animeCache.put({
          subjectId: props.subject.subjectId,
          nameCn: props.subject.nameCn,
          nameJp: props.subject.name,
          coverUrl: props.subject.coverUrl,
          coverBlob,
          date: props.subject.date,
          summary: props.subject.summary,
          lastFetchedAt: now,
        })
      })

      props.onSaved?.()
      props.onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [customTitleCn, props, rating, status])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <div className="w-full max-w-md rounded-t-2xl bg-white px-4 pb-6 pt-4 max-h-[85vh] overflow-y-auto">
        <div className="sticky top-0 -mx-4 bg-white px-4 pt-0 pb-2">
          <div className="flex items-start justify-between gap-3 pt-0">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-slate-900">{displayTitle}</div>
            <div className={summaryExpanded ? 'mt-1 text-xs text-slate-600' : 'mt-1 line-clamp-2 text-xs text-slate-600'}>
              {displaySummary || '无简介'}
            </div>
            {displaySummary ? (
              <button
                type="button"
                className="mt-1 text-xs font-medium text-slate-700"
                onClick={() => setSummaryExpanded((v) => !v)}
              >
                {summaryExpanded ? '收起' : '展开'}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-md px-2 py-1 text-sm font-medium text-slate-500"
          >
            关闭
          </button>
          </div>

          <div className="mt-3 flex gap-2">
          <button
            type="button"
            className={[
              'rounded-md px-3 py-1.5 text-sm font-medium',
              activeTab === 'edit' ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-900',
            ].join(' ')}
            onClick={() => setActiveTab('edit')}
          >
            记录
          </button>
          <button
            type="button"
            className={[
              'rounded-md px-3 py-1.5 text-sm font-medium',
              activeTab === 'detail' ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-900',
            ].join(' ')}
            onClick={() => setActiveTab('detail')}
          >
            详情
          </button>
          </div>
        </div>

        {activeTab === 'detail' ? (
          <div className="mt-4">
            <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  {!navigator.onLine ? (
                    <div className="font-medium text-slate-900">当前离线：仅能查看本地缓存</div>
                  ) : (
                    <div className="font-medium text-slate-900">详情来自本地缓存（自动后台更新）</div>
                  )}
                  <div className="mt-0.5 text-slate-600">
                    {detailCacheLoading ? '读取缓存中…' : detailCacheTimeText ? `缓存时间：${detailCacheTimeText}` : '暂无缓存'}
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-md bg-white px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-50"
                  onClick={() => {
                    void prefetchDetailAndCache()
                    void prefetchExtrasAndCache()
                    void loadDetailCache()
                    if (activeTab === 'detail') void loadExtras()
                  }}
                  disabled={!navigator.onLine}
                >
                  刷新缓存
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                <div>
                  <span className="text-slate-500">平台：</span>
                  <span>{detailCache?.platform || '未知'}</span>
                </div>
                <div>
                  <span className="text-slate-500">评分：</span>
                  <span>{detailCache?.apiRatingScore ? detailCache.apiRatingScore.toFixed(1) : '未知'}</span>
                </div>
                <div>
                  <span className="text-slate-500">放送：</span>
                  <span>{detailCache?.date || props.subject.date || '未知'}</span>
                </div>
              </div>
            </div>

            {extrasError ? <div className="text-sm text-red-600">{extrasError}</div> : null}
            {extrasLoading ? <div className="text-sm text-slate-600">加载中…</div> : null}

            <div className="mt-3">
              <div className="text-sm font-semibold text-slate-900">制作人员 / 公司 / 声优</div>
              <div className="mt-2 grid gap-2">
                {persons.length === 0 && !extrasLoading ? (
                  <div className="text-sm text-slate-600">暂无数据</div>
                ) : null}
                {persons.slice(0, 40).map((p) => (
                  <div key={p.id} className="text-sm text-slate-800">
                    <span className="font-medium">{p.relation}</span>
                    <span className="text-slate-500">：</span>
                    <span>{p.name}</span>
                  </div>
                ))}
                {persons.length > 40 ? <div className="text-xs text-slate-500">仅显示前 40 条</div> : null}
              </div>
            </div>

            <div className="mt-5">
              <div className="text-sm font-semibold text-slate-900">角色 & 声优</div>
              <div className="mt-2 grid gap-2">
                {characters.length === 0 && !extrasLoading ? (
                  <div className="text-sm text-slate-600">暂无数据</div>
                ) : null}
                {characters.slice(0, 40).map((c) => (
                  <div key={c.id} className="text-sm text-slate-800">
                    <div className="font-medium">{c.name}</div>
                    {c.actors && c.actors.length ? (
                      <div className="text-xs text-slate-600">CV：{c.actors.map((a) => a.name).join(' / ')}</div>
                    ) : null}
                  </div>
                ))}
                {characters.length > 40 ? <div className="text-xs text-slate-500">仅显示前 40 条</div> : null}
              </div>
            </div>
          </div>
        ) : (
          <>

        <div className="mt-4">
          <div className="text-sm font-semibold text-slate-900">状态</div>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStatus(opt.value)}
                className={[
                  'rounded-md border px-2 py-2 text-xs',
                  status === opt.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700',
                ].join(' ')}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <div className="text-sm font-semibold text-slate-900">评分（1-10，可空）</div>
          <div className="mt-2 flex items-center gap-2">
            <input
              className="w-20 rounded-md border border-slate-300 px-2 py-2 text-sm"
              type="number"
              min={0}
              max={10}
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
            />
            <div className="text-xs text-slate-600">填 0 表示不评分</div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-sm font-semibold text-slate-900">自定义中文标题（可选）</div>
          <input
            className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={customTitleCn}
            onChange={(e) => setCustomTitleCn(e.target.value)}
            placeholder="例如：团子大家族"
          />
        </div>

        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void onSave()}
            disabled={saving}
          >
            {saving ? '保存中…' : '保存到我的记录'}
          </button>
        </div>
          </>
        )}
      </div>
    </div>
  )
}
