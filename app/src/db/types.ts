export type EntryStatus = 'wish' | 'doing' | 'done' | 'on_hold' | 'dropped'

export type EntryRecord = {
  subjectId: number
  status: EntryStatus
  rating?: number
  customTitleCn?: string
  updatedAt: number
}

export type AnimeCacheRecord = {
  subjectId: number
  nameCn?: string
  nameJp?: string
  aliasesCn?: string[]
  coverUrl?: string
  coverBlob?: Blob
  type?: number
  date?: string
  summary?: string
  platform?: string
  apiRatingScore?: number
  lastFetchedAt: number
}

export type AppSettingRecord = {
  key: string
  value: unknown
}
