import { useEffect, useState } from 'react'

export function useObjectUrl(blob?: Blob) {
  const [url, setUrl] = useState<string>('')

  useEffect(() => {
    if (!blob) {
      setUrl('')
      return
    }

    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => {
      URL.revokeObjectURL(u)
    }
  }, [blob])

  return url
}
