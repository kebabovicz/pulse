import fs from 'node:fs'
import { parseDocument, type Document } from 'yaml'

/**
 * Updates `vars.<name>.default` in place, keeping comments and formatting:
 * the file stays the agent-authored document, only the values change.
 */
export function updateVarDefaults(absPath: string, values: Record<string, string>): { updated: string[] } {
  const raw = fs.readFileSync(absPath, 'utf8')
  const doc: Document = parseDocument(raw)
  const updated: string[] = []

  for (const [name, value] of Object.entries(values)) {
    if (!doc.hasIn(['vars', name])) continue // never introduce variables the scenario does not declare
    doc.setIn(['vars', name, 'default'], value)
    updated.push(name)
  }

  if (updated.length > 0) fs.writeFileSync(absPath, doc.toString())
  return { updated }
}
