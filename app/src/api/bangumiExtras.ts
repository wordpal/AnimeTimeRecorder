import type { SubjectCharacterLite, SubjectPersonLite } from '../db/extrasTypes'

const API_BASE = 'https://api.bgm.tv'

type RelatedPerson = {
  id: number
  name: string
  type?: number
  career?: string[]
  relation: string
}

type RelatedCharacter = {
  id: number
  name: string
  role?: string
  relation?: string
  actors?: Array<{ id: number; name: string }>
}

export async function getSubjectPersons(params: { subjectId: number; signal?: AbortSignal }): Promise<SubjectPersonLite[]> {
  const resp = await fetch(`${API_BASE}/v0/subjects/${params.subjectId}/persons`, {
    headers: { Accept: 'application/json' },
    signal: params.signal,
  })

  if (!resp.ok) {
    throw new Error(`Bangumi persons failed: ${resp.status} ${resp.statusText}`)
  }

  const json = (await resp.json()) as RelatedPerson[]
  return (json ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    relation: p.relation,
    career: p.career,
    type: p.type,
  }))
}

export async function getSubjectCharacters(params: {
  subjectId: number
  signal?: AbortSignal
}): Promise<SubjectCharacterLite[]> {
  const resp = await fetch(`${API_BASE}/v0/subjects/${params.subjectId}/characters`, {
    headers: { Accept: 'application/json' },
    signal: params.signal,
  })

  if (!resp.ok) {
    throw new Error(`Bangumi characters failed: ${resp.status} ${resp.statusText}`)
  }

  const json = (await resp.json()) as RelatedCharacter[]
  return (json ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    role: c.role,
    relation: c.relation,
    actors: c.actors?.map((a) => ({ id: a.id, name: a.name })) ?? [],
  }))
}
