export type BangumiImages = {
  small?: string
  grid?: string
  large?: string
  medium?: string
  common?: string
}

export type BangumiSubject = {
  id: number
  type: number
  name: string
  name_cn: string
  summary?: string
  date?: string
  platform?: string
  images?: BangumiImages | null
}

export type BangumiSubjectRating = {
  score?: number
  total?: number
}

export type BangumiSubjectDetail = BangumiSubject & {
  rating?: BangumiSubjectRating | null
}

export type BangumiPaged<T> = {
  total: number
  limit: number
  offset: number
  data: T[]
}

export type SearchAnimeResultItem = {
  subjectId: number
  name: string
  nameCn: string
  summary?: string
  date?: string
  coverUrl?: string
  platform?: string
  apiRatingScore?: number
}

const API_BASE = 'https://api.bgm.tv'

function getBestCoverUrl(images?: BangumiImages | null): string | undefined {
  if (!images) return undefined
  return images.grid || images.small || images.medium || images.large || images.common
}

export async function searchAnimeSubjects(params: {
  keyword: string
  limit?: number
  offset?: number
  signal?: AbortSignal
}): Promise<BangumiPaged<SearchAnimeResultItem>> {
  const limit = params.limit ?? 24
  const offset = params.offset ?? 0

  const url = new URL(API_BASE + '/v0/search/subjects')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('offset', String(offset))

  const body = {
    keyword: params.keyword,
    sort: 'match',
    filter: {
      type: [2],
    },
  }

  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: params.signal,
  })

  if (!resp.ok) {
    throw new Error(`Bangumi search failed: ${resp.status} ${resp.statusText}`)
  }

  const json = (await resp.json()) as BangumiPaged<BangumiSubject>

  return {
    total: json.total,
    limit: json.limit,
    offset: json.offset,
    data: (json.data ?? []).map((s) => ({
      subjectId: s.id,
      name: s.name,
      nameCn: s.name_cn,
      summary: s.summary,
      date: s.date,
      coverUrl: getBestCoverUrl(s.images),
      platform: s.platform,
    })),
  }
}

export async function getSubjectDetail(params: { subjectId: number; signal?: AbortSignal }): Promise<BangumiSubjectDetail> {
  const resp = await fetch(`${API_BASE}/v0/subjects/${params.subjectId}`, {
    headers: {
      Accept: 'application/json',
    },
    signal: params.signal,
  })

  if (!resp.ok) {
    throw new Error(`Bangumi subject detail failed: ${resp.status} ${resp.statusText}`)
  }

  return (await resp.json()) as BangumiSubjectDetail
}
