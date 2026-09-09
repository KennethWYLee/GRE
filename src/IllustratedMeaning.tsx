import { useState, type ReactNode } from 'react'
import { getWordIllustration } from './word-illustrations'

export function IllustratedMeaning({ wordId, children }: { wordId: string; children: ReactNode }) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const illustration = getWordIllustration(wordId)
  const showImage = illustration && failedSource !== illustration.src

  return (
    <div className={`detail-block meaning-block${showImage ? ' has-illustration' : ''}`}>
      <div className="meaning-copy">{children}</div>
      {showImage && (
        <img
          alt={illustration.alt}
          className="word-illustration"
          decoding="async"
          draggable={false}
          fetchPriority="low"
          height={480}
          onError={() => setFailedSource(illustration.src)}
          src={illustration.src}
          width={480}
        />
      )}
    </div>
  )
}
