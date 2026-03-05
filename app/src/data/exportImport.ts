import { appDb } from '../db/appDb'
import type { SubjectExtrasRecord } from '../db/extrasTypes'
import type { AnimeCacheRecord, AppSettingRecord, EntryRecord } from '../db/types'

export type ExportFileV1 = {
  version: 1
  exportedAt: number
  entries: EntryRecord[]
  animeCache: Array<Omit<AnimeCacheRecord, 'coverBlob'> & { coverBase64?: string }>
  subjectExtras?: SubjectExtrasRecord[]
  settings: Record<string, unknown>
}

function toCsvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  const escaped = s.replace(/"/g, '""')
  return `"${escaped}"`
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64ToBlob(base64: string): Blob {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes])
}

export async function buildExportJsonV1(): Promise<ExportFileV1> {
  const [entries, animeCache, subjectExtras, settings] = await Promise.all([
    appDb.entries.toArray(),
    appDb.animeCache.toArray(),
    appDb.subjectExtras.toArray(),
    appDb.appSettings.toArray(),
  ])

  const settingsObj: Record<string, unknown> = {}
  for (const s of settings) settingsObj[s.key] = s.value

  const exportedCache: ExportFileV1['animeCache'] = []
  for (const c of animeCache) {
    const { coverBlob, ...rest } = c
    exportedCache.push({
      ...rest,
      coverBase64: coverBlob ? await blobToBase64(coverBlob) : undefined,
    })
  }

  return {
    version: 1,
    exportedAt: Date.now(),
    entries,
    animeCache: exportedCache,
    subjectExtras,
    settings: settingsObj,
  }
}

export function buildExportCsv(entries: EntryRecord[], caches: AnimeCacheRecord[]): string {
  const cacheMap = new Map<number, AnimeCacheRecord>()
  for (const c of caches) cacheMap.set(c.subjectId, c)

  const header = ['subjectId', 'title', 'nameCn', 'nameJp', 'status', 'rating', 'updatedAt']

  const rows = entries
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((e) => {
      const c = cacheMap.get(e.subjectId)
      const title = e.customTitleCn?.trim() || c?.nameCn?.trim() || c?.nameJp || String(e.subjectId)
      return [
        e.subjectId,
        title,
        c?.nameCn ?? '',
        c?.nameJp ?? '',
        e.status,
        e.rating ?? '',
        e.updatedAt,
      ].map(toCsvCell)
    })

  return [header.map(toCsvCell).join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n'
}

export async function importFromJsonV1(file: ExportFileV1): Promise<void> {
  if (file.version !== 1) {
    throw new Error('不支持的导入文件版本')
  }

  const entries: EntryRecord[] = Array.isArray(file.entries) ? file.entries : []
  const caches = Array.isArray(file.animeCache) ? file.animeCache : []
  const extras: SubjectExtrasRecord[] = Array.isArray(file.subjectExtras) ? file.subjectExtras : []
  const settings = file.settings ?? {}

  await appDb.transaction('rw', appDb.entries, appDb.animeCache, appDb.subjectExtras, appDb.appSettings, async () => {
    await appDb.entries.clear()
    await appDb.animeCache.clear()
    await appDb.subjectExtras.clear()
    await appDb.appSettings.clear()

    if (entries.length) await appDb.entries.bulkPut(entries)

    const restoredCaches: AnimeCacheRecord[] = caches.map((c) => {
      const { coverBase64, ...rest } = c
      return {
        ...(rest as AnimeCacheRecord),
        coverBlob: coverBase64 ? base64ToBlob(coverBase64) : undefined,
      }
    })

    if (restoredCaches.length) await appDb.animeCache.bulkPut(restoredCaches)

    if (extras.length) await appDb.subjectExtras.bulkPut(extras)

    const settingsRecords: AppSettingRecord[] = Object.entries(settings).map(([k, v]) => ({ key: k, value: v }))
    if (settingsRecords.length) await appDb.appSettings.bulkPut(settingsRecords)
  })
}
