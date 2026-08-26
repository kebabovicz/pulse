import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Whether the element's text does not fit its box. Re-measured when the text
 * changes and when the element resizes, so window width and zoom are covered.
 */
export function useClipped<T extends HTMLElement>(text: string, enabled = true): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [clipped, setClipped] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const measure = () => setClipped(el.scrollWidth > el.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, enabled])

  return [ref, clipped]
}
