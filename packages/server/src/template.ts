import { randomUUID } from 'node:crypto'

export interface VarEntry {
  value: string
  fromStep: string | null // null means the value came from vars
  secret: boolean
}

const TEMPLATE = /\{\{\s*([^{}]+?)\s*\}\}/g

const randomDigits = (n: number): string => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')

// Flat variable namespace of a run plus {{random.*}} generators (SPEC.md).
// Each generator expression is evaluated once per run.
/** What a secret looks like once it leaves the runner. */
export const MASK = '•••'

export class TemplateSpace {
  private values = new Map<string, VarEntry>()
  private generated = new Map<string, string>()
  private readonly runTimestamp = String(Math.floor(Date.now() / 1000))
  private readonly runStartedAt = new Date().toISOString()

  set(name: string, entry: VarEntry): void {
    this.values.set(name, entry)
  }

  get(name: string): VarEntry | undefined {
    return this.values.get(name)
  }

  /** Interpolates templates; `used` lists referenced variables (generators excluded). */
  render(input: string): { text: string; used: string[] } {
    const used: string[] = []
    const text = input.replace(TEMPLATE, (match, expr: string) => {
      const generated = this.generate(expr)
      if (generated !== null) return generated
      const entry = this.values.get(expr)
      if (!entry) return match // validation rejects unknown names; keep the raw text just in case
      used.push(expr)
      return entry.value
    })
    return { text, used }
  }

  /** Masks secret values in text before it goes into snapshots and events. */
  mask(text: string): string {
    let out = text
    for (const { value, secret } of this.values.values()) {
      if (secret && value) out = out.replaceAll(value, MASK)
    }
    return out
  }

  private generate(expr: string): string | null {
    if (expr === 'timestamp') return this.runTimestamp
    if (expr === 'runStartedAt') return this.runStartedAt
    if (!expr.startsWith('random.')) return null
    const cached = this.generated.get(expr)
    if (cached !== undefined) return cached
    let value: string | null = null
    if (expr === 'random.phone') value = `+79${randomDigits(9)}`
    else if (expr === 'random.uuid') value = randomUUID()
    else {
      const m = /^random\.(digits|string)\((\d+)\)$/.exec(expr)
      if (m) {
        const n = Number(m[2])
        value =
          m[1] === 'digits'
            ? randomDigits(n)
            : Array.from(
                { length: n },
                () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)],
              ).join('')
      }
    }
    if (value !== null) this.generated.set(expr, value)
    return value
  }
}
