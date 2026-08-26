import { useLayoutEffect, useRef, useState } from 'react'
import { t } from '../i18n'

/**
 * A value that does not fit its column: clipped to one line, and expanded to as
 * many lines as it needs on click. Only actually clipped values react, so short
 * ones stay plain text. Selecting text never counts as a click, so a value can
 * still be picked with the mouse and copied.
 */
export function ClipValue({ text, className = '' }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [clipped, setClipped] = useState(false)
  const [open, setOpen] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const measure = () => setClipped(el.scrollWidth > el.clientWidth + 1)
    measure()
    // the column width follows the window and the zoom level, so re-measure on resize
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, open])

  const interactive = clipped || open
  return (
    <span
      ref={ref}
      className={`clip-value${className ? ` ${className}` : ''}${interactive ? ' expandable' : ''}${open ? ' open' : ''}`}
      title={clipped && !open ? text : undefined}
      onClick={
        interactive
          ? () => {
              // a click that ends a selection must not collapse what was just selected
              if (!window.getSelection()?.isCollapsed) return
              setOpen(!open)
            }
          : undefined
      }
      aria-label={interactive ? (open ? t('collapseValue') : t('expandValue')) : undefined}
    >
      {text}
    </span>
  )
}
