// Таблица-дерево JSON: тип и значение в фиксированных колонках,
// иерархию показывает только отступ ключа. Сворачивание — нативный <details>.
import { useState } from 'react'

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

const typeOf = (v: Json): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)

const CUT = 80

function Value({ value }: { value: Json }) {
  const [full, setFull] = useState(false)
  if (typeof value === 'string') {
    const long = value.length > CUT
    const shown = full || !long ? value : `${value.slice(0, CUT)}…`
    return (
      <span
        className={`jt-string${long ? ' expandable' : ''}`}
        title={long && !full ? 'показать целиком' : undefined}
        onClick={long ? () => setFull(!full) : undefined}
      >
        "{shown}"
      </span>
    )
  }
  return <span className="jt-literal">{String(value)}</span>
}

function Node({ name, value, depth }: { name: string; value: Json; depth: number }) {
  const indent = { paddingLeft: depth * 16 }
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value)
    return (
      <details open={depth < 2}>
        <summary className="jt-row">
          <span className="jt-type">{typeOf(value)}</span>
          <span className="jt-key jt-branch" style={indent}>
            {name}
          </span>
          <span className="jt-count">{entries.length}</span>
        </summary>
        {entries.map(([k, v]) => (
          <Node key={k} name={k} value={v} depth={depth + 1} />
        ))}
      </details>
    )
  }
  return (
    <div className="jt-row">
      <span className="jt-type">{typeOf(value)}</span>
      <span className="jt-key" style={indent}>
        {name}
      </span>
      <Value value={value} />
    </div>
  )
}

export function JsonTree({ text }: { text: string }) {
  let json: Json
  try {
    json = JSON.parse(text) as Json
  } catch {
    return <pre className="body-text">{text}</pre>
  }
  if (json === null || typeof json !== 'object') return <pre className="body-text">{text}</pre>
  const entries = Array.isArray(json) ? json.map((v, i) => [String(i), v] as const) : Object.entries(json)
  return (
    <div className="json-tree">
      {entries.map(([k, v]) => (
        <Node key={k} name={k} value={v} depth={0} />
      ))}
    </div>
  )
}
