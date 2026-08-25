import { randomUUID } from 'node:crypto'

export interface VarEntry {
  value: string
  fromStep: string | null // null — из vars
  secret: boolean
}

const TEMPLATE = /\{\{\s*([^{}]+?)\s*\}\}/g

const randomDigits = (n: number): string =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')

// Плоское пространство переменных прогона + генераторы {{random.*}} (SPEC.md).
// Генератор вычисляется один раз на прогон на выражение.
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

  /** Подставляет шаблоны; used — имена использованных переменных (без генераторов). */
  render(input: string): { text: string; used: string[] } {
    const used: string[] = []
    const text = input.replace(TEMPLATE, (match, expr: string) => {
      const generated = this.generate(expr)
      if (generated !== null) return generated
      const entry = this.values.get(expr)
      if (!entry) return match // валидация не пропустит; на всякий случай оставляем как есть
      used.push(expr)
      return entry.value
    })
    return { text, used }
  }

  /** Прячет значения секретных переменных в тексте для снимков и событий. */
  mask(text: string): string {
    let out = text
    for (const { value, secret } of this.values.values()) {
      if (secret && value) out = out.replaceAll(value, '•••')
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
            : Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')
      }
    }
    if (value !== null) this.generated.set(expr, value)
    return value
  }
}
