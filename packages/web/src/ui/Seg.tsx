import { useState } from 'react'

/** Segmented control used for view modes. */
export function Seg({
  modes,
  mode,
  onPick,
}: {
  modes: { id: string; label: string; enabled: boolean }[]
  mode: string
  onPick: (m: string) => void
}) {
  return (
    <span className="seg">
      {modes.map((m) => (
        <button
          key={m.id}
          className={`seg-item${mode === m.id ? ' active' : ''}`}
          disabled={!m.enabled}
          onClick={() => onPick(m.id)}
        >
          {m.label}
        </button>
      ))}
    </span>
  )
}

// The view mode is remembered per project (DESIGN.md, "View modes").
export function useViewMode(projectId: string, kind: string, initial: string) {
  const key = `pulse.mode.${projectId}.${kind}`
  const [mode, setMode] = useState(() => localStorage.getItem(key) ?? initial)
  return [
    mode,
    (m: string) => {
      setMode(m)
      localStorage.setItem(key, m)
    },
  ] as const
}
