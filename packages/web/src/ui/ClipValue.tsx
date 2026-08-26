import { useState } from 'react'
import { t } from '../i18n'
import { useClipped } from './useClipped'

/**
 * A value that does not fit its column: clipped to one line, and expanded to as
 * many lines as it needs on click. Only actually clipped values react, so short
 * ones stay plain text — the pointer cursor is the only hint needed, no tooltip.
 * Selecting text never counts as a click, so a value can still be picked and copied.
 */
export function ClipValue({ text, className = '' }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [ref, clipped] = useClipped<HTMLSpanElement>(text, !open)

  const interactive = clipped || open
  return (
    <span
      ref={ref}
      className={`clip-value${className ? ` ${className}` : ''}${interactive ? ' expandable' : ''}${open ? ' open' : ''}`}
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
