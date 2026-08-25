import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from './icons'

// Свой выпадающий список по токенам DESIGN.md — нативный select выглядит чужим.
export function Select({
  value,
  options,
  onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = options.find((o) => o.value === value)

  if (options.length < 2) {
    return (
      <span className="select-trigger static">
        <b>{current?.label ?? value}</b>
      </span>
    )
  }

  return (
    <div className="select" ref={rootRef}>
      <button className="select-trigger" onClick={() => setOpen(!open)}>
        <b>{current?.label ?? value}</b>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="select-menu">
          {options.map((o) => (
            <button
              key={o.value}
              className={`select-item${o.value === value ? ' active' : ''}`}
              onClick={() => {
                setOpen(false)
                onChange(o.value)
              }}
            >
              <span className="select-check">{o.value === value && <Check size={12} />}</span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
