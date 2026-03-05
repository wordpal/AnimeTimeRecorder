export type SubjectPersonLite = {
  id: number
  name: string
  relation: string
  career?: string[]
  type?: number
}

export type SubjectCharacterLite = {
  id: number
  name: string
  role?: string
  relation?: string
  actors?: Array<{ id: number; name: string }>
}

export type SubjectExtrasRecord = {
  subjectId: number
  persons: SubjectPersonLite[]
  characters: SubjectCharacterLite[]
  lastFetchedAt: number
}
