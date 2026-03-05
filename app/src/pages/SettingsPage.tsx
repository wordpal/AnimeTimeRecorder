import { useCallback, useMemo, useRef, useState } from 'react'
import { appDb } from '../db/appDb'
import { buildExportCsv, buildExportJsonV1, importFromJsonV1, type ExportFileV1 } from '../data/exportImport'

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function SettingsPage() {
  const [busy, setBusy] = useState<boolean>(false)
  const [message, setMessage] = useState<string>('')
  const [error, setError] = useState<string>('')

  const [detailCacheTtlDays, setDetailCacheTtlDays] = useState<number>(7)

  const [bgPreview, setBgPreview] = useState<string>('')

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const bgFileInputRef = useRef<HTMLInputElement | null>(null)

  const nowStr = useMemo(() => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  }, [])

  const confirmAction = useCallback((msg: string) => {
    return confirm(msg)
  }, [])

  const loadBackgroundSettings = useCallback(async () => {
    try {
      const rec = await appDb.appSettings.get('ui_bg_image_dataurl')
      setBgPreview(typeof rec?.value === 'string' ? rec.value : '')
    } catch {
      setBgPreview('')
    }
  }, [])

  useMemo(() => {
    void loadBackgroundSettings()
  }, [loadBackgroundSettings])

  const loadCacheSettings = useCallback(async () => {
    try {
      const rec = await appDb.appSettings.get('cache_detail_ttl_days')
      const days = typeof rec?.value === 'number' ? rec.value : 7
      setDetailCacheTtlDays(days)
    } catch {
      setDetailCacheTtlDays(7)
    }
  }, [])

  useMemo(() => {
    void loadCacheSettings()
  }, [loadCacheSettings])

  const saveDetailCacheTtlDays = useCallback(async (days: number) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await appDb.appSettings.put({ key: 'cache_detail_ttl_days', value: days })
      setDetailCacheTtlDays(days)
      setMessage('已保存缓存策略')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const exportJson = useCallback(async () => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const data = await buildExportJsonV1()
      downloadTextFile(`comic_time_recorder_${nowStr}.json`, JSON.stringify(data), 'application/json')
      setMessage('已导出 JSON')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [nowStr])

  const exportCsv = useCallback(async () => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const [entries, caches] = await Promise.all([appDb.entries.toArray(), appDb.animeCache.toArray()])
      const csv = buildExportCsv(entries, caches)
      downloadTextFile(`comic_time_recorder_${nowStr}.csv`, csv, 'text/csv;charset=utf-8')
      setMessage('已导出 CSV')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [nowStr])

  const onPickImport = useCallback(() => {
    if (!confirmAction('确认导入 JSON 备份？\n\n导入会覆盖当前本地数据（记录/缓存/设置）。建议先导出一份 JSON 备份。')) return
    fileInputRef.current?.click()
  }, [])

  const onImportSelected = useCallback(async (file: File | null) => {
    if (!file) return

    setBusy(true)
    setError('')
    setMessage('')
    try {
      const text = await file.text()
      const json = JSON.parse(text) as ExportFileV1
      await importFromJsonV1(json)
      setMessage('导入完成')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [])

  const clearAll = useCallback(async () => {
    if (!confirmAction('确认清空本地数据？\n\n将删除：记录、缓存、人物/角色缓存、设置。此操作不可撤销。')) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await appDb.entries.clear()
      await appDb.animeCache.clear()
      await appDb.subjectExtras.clear()
      await appDb.appSettings.clear()
      setMessage('已清空本地数据')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const clearCacheOnly = useCallback(async () => {
    if (!confirmAction('确认清理缓存（保留记录）？\n\n将删除：条目缓存、人物/角色缓存。记录不会删除。')) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await appDb.animeCache.clear()
      await appDb.subjectExtras.clear()
      setMessage('已清理缓存（不删除记录）')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const clearCoversOnly = useCallback(async () => {
    if (!confirmAction('确认仅清理封面缓存？\n\n将删除所有条目的封面离线缓存。')) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const caches = await appDb.animeCache.toArray()
      const updated = caches.map((c) => ({ ...c, coverBlob: undefined }))
      if (updated.length) await appDb.animeCache.bulkPut(updated)
      setMessage('已清理封面缓存（不删除详情字段）')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const clearDetailFieldsOnly = useCallback(async () => {
    if (!confirmAction('确认仅清理条目详情缓存（保留封面）？\n\n将删除简介/平台/评分等详情字段缓存，并在下次打开条目时重新补全。')) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const caches = await appDb.animeCache.toArray()
      const updated = caches.map((c) => ({
        ...c,
        aliasesCn: undefined,
        type: undefined,
        date: undefined,
        summary: undefined,
        platform: undefined,
        apiRatingScore: undefined,
        lastFetchedAt: 0,
      }))
      if (updated.length) await appDb.animeCache.bulkPut(updated)
      setMessage('已清理条目详情缓存（保留封面）')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const clearExtrasOnly = useCallback(async () => {
    if (!confirmAction('确认仅清理人物/角色缓存？\n\n将删除制作人员/角色/声优等缓存，下次打开条目时需联网重新补全。')) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await appDb.subjectExtras.clear()
      setMessage('已清理人物/角色缓存')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const clearSearchHistory = useCallback(async () => {
    if (!confirmAction('确认清空搜索历史？')) return
    setError('')
    setMessage('')
    try {
      localStorage.removeItem('ctr_search_history_v1')
      setMessage('已清空搜索历史')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const onPickBackground = useCallback(() => {
    bgFileInputRef.current?.click()
  }, [])

  const onBackgroundSelected = useCallback(async (file: File | null) => {
    if (!file) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onerror = () => reject(new Error('读取图片失败'))
        fr.onload = () => resolve(String(fr.result || ''))
        fr.readAsDataURL(file)
      })
      await appDb.appSettings.put({ key: 'ui_bg_image_dataurl', value: dataUrl })
      setBgPreview(dataUrl)
      setMessage('已保存背景图')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (bgFileInputRef.current) bgFileInputRef.current.value = ''
    }
  }, [])

  const clearBackground = useCallback(async () => {
    if (!confirmAction('确认清除背景图并恢复默认纯白？')) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await appDb.appSettings.put({ key: 'ui_bg_image_dataurl', value: '' })
      setBgPreview('')
      setMessage('已清除背景图')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [confirmAction])

  return (
    <div className="px-4 py-3">
      <div className="text-lg font-semibold">设置</div>

      <div className="mt-2 text-sm text-slate-600">导入/导出（JSON/CSV）与数据管理。</div>

      <div className="mt-5">
        <div className="text-sm font-semibold text-slate-900">缓存策略</div>
        <div className="mt-2 grid gap-2">
          <div className="text-sm text-slate-700">条目详情缓存有效期（影响打开条目时的自动预取/刷新频率）</div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
              value={detailCacheTtlDays}
              disabled={busy}
              onChange={(e) => void saveDetailCacheTtlDays(Number(e.target.value))}
            >
              <option value={0}>永不过期（不自动刷新）</option>
              <option value={1}>1 天</option>
              <option value={7}>7 天（默认）</option>
              <option value={30}>30 天</option>
            </select>
            <button
              type="button"
              className="rounded-md bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
              onClick={() => void loadCacheSettings()}
              disabled={busy}
            >
              重新读取
            </button>
          </div>
          <div className="text-xs text-slate-500">提示：设置会同步到导入/导出的 JSON 备份中。</div>
        </div>
      </div>

      <div className="mt-5">
        <div className="text-sm font-semibold text-slate-900">外观</div>
        <div className="mt-2 grid gap-2">
          <div className="text-sm text-slate-700">自定义背景图（会轻微透明显示，默认纯白）</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
              onClick={() => void onPickBackground()}
              disabled={busy}
            >
              导入背景图
            </button>
            <button
              type="button"
              className="rounded-md bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
              onClick={() => void clearBackground()}
              disabled={busy || !bgPreview}
            >
              清除背景图
            </button>
          </div>
          {bgPreview ? <div className="text-xs text-slate-500">已设置背景图（应用刷新后生效）</div> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        <button
          type="button"
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={() => void exportJson()}
          disabled={busy}
        >
          导出 JSON（完整备份）
        </button>

        <button
          type="button"
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={() => void exportCsv()}
          disabled={busy}
        >
          导出 CSV（表格）
        </button>

        <button
          type="button"
          className="rounded-md bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
          onClick={() => void onPickImport()}
          disabled={busy}
        >
          导入 JSON（会覆盖当前本地数据）
        </button>

        <button
          type="button"
          className="rounded-md bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
          onClick={() => void clearAll()}
          disabled={busy}
        >
          清空本地数据
        </button>

        <button
          type="button"
          className="rounded-md bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
          onClick={() => void clearCacheOnly()}
          disabled={busy}
        >
          清理缓存（保留记录）
        </button>

        <button
          type="button"
          className="rounded-md bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
          onClick={() => void clearCoversOnly()}
          disabled={busy}
        >
          仅清理封面缓存
        </button>

        <button
          type="button"
          className="rounded-md bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
          onClick={() => void clearDetailFieldsOnly()}
          disabled={busy}
        >
          仅清理条目详情缓存（保留封面）
        </button>

        <button
          type="button"
          className="rounded-md bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
          onClick={() => void clearExtrasOnly()}
          disabled={busy}
        >
          仅清理人物/角色缓存
        </button>

        <button
          type="button"
          className="rounded-md bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
          onClick={() => void clearSearchHistory()}
          disabled={busy}
        >
          清空搜索历史
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => void onImportSelected(e.target.files?.[0] ?? null)}
      />

      <input
        ref={bgFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onBackgroundSelected(e.target.files?.[0] ?? null)}
      />

      {message ? <div className="mt-3 text-sm text-emerald-700">{message}</div> : null}
      {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
      {busy ? <div className="mt-3 text-sm text-slate-600">处理中…</div> : null}

      <div className="mt-6 text-xs text-slate-500">
        离线使用：
        <br />
        - “我的记录”完全离线可用。
        <br />
        - “搜索”离线时会在本地缓存/记录中搜索；要获得更多结果请联网。
        <br />
        JSON 备份会包含条目信息与封面（base64）。文件可能较大。
      </div>
    </div>
  )
}
