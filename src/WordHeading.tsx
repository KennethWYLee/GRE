import { useLayoutEffect, useRef } from 'react'

export function WordHeading({ word, className = '' }: { word: string; className?: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const heading = headingRef.current
    const text = textRef.current
    if (!heading || !text) return

    let disposed = false
    const fit = () => {
      if (disposed || heading.clientWidth <= 2) return

      // Start from the responsive CSS size so shorter words can grow again.
      heading.style.fontSize = ''
      const availableWidth = heading.clientWidth - 2
      let fontSize = Number.parseFloat(getComputedStyle(heading).fontSize)
      // Remeasure once after shrinking to allow for font hinting and rounding.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const textWidth = text.getBoundingClientRect().width
        if (textWidth <= availableWidth) break
        fontSize = Math.floor(fontSize * availableWidth / textWidth * 100) / 100
        heading.style.fontSize = `${fontSize}px`
      }
    }

    fit()
    let previousWidth = heading.clientWidth
    const observer = new ResizeObserver(() => {
      // Font-size changes also change height; only width requires another fit.
      if (heading.clientWidth === previousWidth) return
      previousWidth = heading.clientWidth
      fit()
    })
    observer.observe(heading)
    window.addEventListener('resize', fit)
    document.fonts.addEventListener('loadingdone', fit)
    void document.fonts.ready.then(fit)

    return () => {
      disposed = true
      observer.disconnect()
      window.removeEventListener('resize', fit)
      document.fonts.removeEventListener('loadingdone', fit)
    }
  }, [word])

  return (
    <h2 className={`word-heading ${className}`.trim()} lang="en" ref={headingRef}>
      <span ref={textRef}>{word}</span>
    </h2>
  )
}
