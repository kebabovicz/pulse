// JSON tree as a table: type and value sit in fixed columns and only the key
// indent conveys hierarchy. The tree is flattened to the rows that are actually
// visible, so the zebra follows what the eye sees rather than the data shape.
import { useState } from 'react'
import { t } from './i18n'

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

const typeOf = (v: Json): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)

const CUT = 80

interface Row {
  path: string
  name: string
  value: Json
  depth: number
  branch: boolean
  count: number
  open: boolean
}

const entriesOf = (v: Json): (readonly [string, Json])[] =>
  Array.isArray(v) ? v.map((item, i) => [String(i), item] as const) : Object.entries(v as { [key: string]: Json })

/**
 * Walks the tree in display order, descending only into open branches.
 * Branches below the second level start collapsed; `toggled` inverts that default.
 */
function flatten(entries: (readonly [string, Json])[], toggled: Set<string>, parent: string, depth: number): Row[] {
  const rows: Row[] = []
  for (const [name, value] of entries) {
    const path = `${parent}/${name}`
    const branch = value !== null && typeof value === 'object'
    if (!branch) {
      rows.push({ path, name, value, depth, branch, count: 0, open: false })
      continue
    }
    const children = entriesOf(value)
    const open = toggled.has(path) ? depth >= 2 : depth < 2
    rows.push({ path, name, value, depth, branch, count: children.length, open })
    if (open) rows.push(...flatten(children, toggled, path, depth + 1))
  }
  return rows
}

function Value({ value }: { value: Json }) {
  const [full, setFull] = useState(false)
  if (typeof value === 'string') {
    const long = value.length > CUT
    const shown = full || !long ? value : `${value.slice(0, CUT)}…`
    return (
      <span
        className={`jt-string${long ? ' expandable' : ''}`}
        title={long && !full ? t('expandValue') : undefined}
        onClick={long ? () => setFull(!full) : undefined}
      >
        "{shown}"
      </span>
    )
  }
  return <span className="jt-literal">{value === null ? 'null' : JSON.stringify(value)}</span>
}

export function JsonTree({ text }: { text: string }) {
  const [toggled, setToggled] = useState<Set<string>>(new Set())
  let json: Json
  try {
    json = JSON.parse(text) as Json
  } catch {
    return <pre className="body-text">{text}</pre>
  }
  if (json === null || typeof json !== 'object') return <pre className="body-text">{text}</pre>

  const toggle = (path: string) =>
    setToggled((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  return (
    <div className="json-tree">
      {flatten(entriesOf(json), toggled, '', 0).map((row) => (
        <div
          key={row.path}
          className={`jt-row${row.branch ? ' jt-branch-row' : ''}`}
          onClick={row.branch ? () => toggle(row.path) : undefined}
        >
          <span className="jt-type">{typeOf(row.value)}</span>
          <span
            className={`jt-key${row.branch ? ' jt-branch' : ''}${row.open ? ' open' : ''}`}
            style={{ paddingLeft: row.depth * 16 }}
          >
            {row.name}
          </span>
          {row.branch ? <span className="jt-count">{row.count}</span> : <Value value={row.value} />}
        </div>
      ))}
    </div>
  )
}
