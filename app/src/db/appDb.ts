import Dexie, { type Table } from 'dexie'
import type { AnimeCacheRecord, AppSettingRecord, EntryRecord } from './types'
import type { SubjectExtrasRecord } from './extrasTypes'

export class AppDb extends Dexie {
  entries!: Table<EntryRecord, number>
  animeCache!: Table<AnimeCacheRecord, number>
  appSettings!: Table<AppSettingRecord, string>
  subjectExtras!: Table<SubjectExtrasRecord, number>

  constructor() {
    super('comic_time_recorder')

    this.version(1).stores({
      entries: 'subjectId, status, updatedAt',
      animeCache: 'subjectId, lastFetchedAt',
      appSettings: 'key',
    })

    this.version(2).stores({
      entries: 'subjectId, status, updatedAt',
      animeCache: 'subjectId, lastFetchedAt',
      appSettings: 'key',
      subjectExtras: 'subjectId, lastFetchedAt',
    })
  }
}

export const appDb = new AppDb()
