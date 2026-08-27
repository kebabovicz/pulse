import { JSONPath } from 'jsonpath-plus'
import type { BodyCheck, CheckResult, RequestStep, StepResult } from '@pulse/shared'

const PREVIEW_LIMIT = 120
/** A regex from a scenario can be malformed or interpolated at run time: never let it throw. */
function matches(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern).test(text)
  } catch {
    return false
  }
}

/** Ordered comparison for gt/lt; null when the value cannot be compared to the bound. */
function compareOrdered(value: unknown, expected: string, numericBound: boolean): number | null {
  if (numericBound) {
    if (typeof value !== 'number' || Number.isNaN(value)) return null
    return value - Number(expected)
  }
  if (typeof value !== 'string') return null
  return value < expected ? -1 : value > expected ? 1 : 0
}

const preview = (s: string): string => (s.length > PREVIEW_LIMIT ? `${s.slice(0, PREVIEW_LIMIT)}…` : s)

/** Evaluates every check of a step; all of them run even after the first failure. */
export function evalChecks(
  expect: RequestStep['expect'],
  res: Response,
  text: string,
  json: unknown,
  render: (s: string) => string,
): CheckResult[] {
  const results: CheckResult[] = []
  const statuses = Array.isArray(expect.status) ? expect.status : [expect.status]
  results.push({
    kind: 'status',
    expected: statuses.join(' | '),
    actual: String(res.status),
    passed: statuses.includes(res.status),
  })
  for (const [name, want] of Object.entries(expect.headers ?? {})) {
    const actual = res.headers.get(name)
    if (want === null) {
      results.push({ kind: 'header', name, expected: 'absent', actual, passed: actual === null })
    } else {
      const expected = render(want)
      results.push({ kind: 'header', name, expected, actual, passed: actual !== null && actual.includes(expected) })
    }
  }
  for (const check of expect.body ?? []) {
    results.push(evalBodyCheck(check, text, json, render))
  }
  return results
}

function evalBodyCheck(check: BodyCheck, text: string, json: unknown, render: (s: string) => string): CheckResult {
  if ('text' in check) {
    const expected = render(check.matches)
    return { kind: 'body-text', expected, actual: preview(text), passed: matches(expected, text) }
  }
  // the path may reference captured values: "$.items[?(@.id=='{{orderId}}')]"
  const path = render(check.path)
  const found: unknown[] = json === undefined ? [] : JSONPath({ path, json, wrap: true })
  const value = found[0]
  const actual = found.length === 0 ? null : typeof value === 'string' ? value : JSON.stringify(value)
  if (check.exists !== undefined) {
    return {
      kind: 'body-path',
      path,
      predicate: 'exists',
      expected: String(check.exists),
      actual,
      passed: found.length > 0 === check.exists,
    }
  }
  if (check.equals !== undefined) {
    const expected = typeof check.equals === 'string' ? render(check.equals) : String(check.equals)
    return {
      kind: 'body-path',
      path,
      predicate: 'equals',
      expected,
      actual,
      passed: found.length > 0 && String(value) === expected,
    }
  }
  if (check.notEquals !== undefined) {
    const expected = typeof check.notEquals === 'string' ? render(check.notEquals) : String(check.notEquals)
    return {
      kind: 'body-path',
      path,
      predicate: 'notEquals',
      expected: `≠ ${expected}`,
      actual,
      passed: found.length > 0 && String(value) !== expected,
    }
  }
  if (check.equalsPath !== undefined) {
    const otherPath = render(check.equalsPath)
    const otherFound: unknown[] = json === undefined ? [] : JSONPath({ path: otherPath, json, wrap: true })
    const other = otherFound.length === 0 ? null : otherFound[0]
    const expected = `${otherPath} = ${other === null ? '—' : typeof other === 'string' ? other : JSON.stringify(other)}`
    return {
      kind: 'body-path',
      path,
      predicate: 'equalsPath',
      expected,
      actual,
      passed: found.length > 0 && otherFound.length > 0 && String(value) === String(other),
    }
  }
  if (check.matches !== undefined) {
    const expected = render(check.matches)
    return {
      kind: 'body-path',
      path,
      predicate: 'matches',
      expected,
      actual,
      passed: found.length > 0 && matches(expected, String(value)),
    }
  }
  if (check.gt !== undefined || check.lt !== undefined) {
    const op = check.gt !== undefined ? 'gt' : 'lt'
    const raw = check.gt ?? check.lt
    const expected = typeof raw === 'string' ? render(raw) : String(raw)
    // Numbers compare numerically, strings lexicographically (ISO dates work).
    // Anything else — null, objects, a value of the wrong type — fails: a bound
    // check must never pass just because String() produced something comparable.
    const numericBound = expected.trim() !== '' && !Number.isNaN(Number(expected))
    const cmp = compareOrdered(value, expected, numericBound)
    return {
      kind: 'body-path',
      path,
      predicate: op,
      expected: `${op === 'gt' ? '>' : '<'} ${expected}`,
      actual,
      passed: found.length > 0 && cmp !== null && (op === 'gt' ? cmp > 0 : cmp < 0),
    }
  }
  if (check.length !== undefined || check.minLength !== undefined || check.maxLength !== undefined) {
    const size = typeof value === 'string' || Array.isArray(value) ? value.length : null
    const predicate = check.length !== undefined ? 'length' : check.minLength !== undefined ? 'minLength' : 'maxLength'
    const bound = check.length ?? check.minLength ?? check.maxLength ?? 0
    const expected =
      predicate === 'length' ? `length ${bound}` : predicate === 'minLength' ? `length ≥ ${bound}` : `length ≤ ${bound}`
    const passed =
      size !== null &&
      (predicate === 'length' ? size === bound : predicate === 'minLength' ? size >= bound : size <= bound)
    return {
      kind: 'body-path',
      path,
      predicate,
      expected,
      actual: size === null ? actual : `length ${size}`,
      passed,
    }
  }
  const actualType = found.length === 0 ? null : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  return {
    kind: 'body-path',
    path,
    predicate: 'type',
    expected: String(check.type),
    actual: actualType,
    passed: actualType === check.type,
  }
}

/** Labels of failed checks, reported in step-retry events. */
export function failedLabels(outcome: Pick<StepResult, 'checks' | 'error'>): string[] {
  if (outcome.error) return [outcome.error.message]
  const labels: string[] = []
  let bodyIndex = 0
  for (const check of outcome.checks ?? []) {
    const isBody = check.kind === 'body-path' || check.kind === 'body-text'
    const label =
      check.kind === 'status' ? 'status' : check.kind === 'header' ? `headers.${check.name}` : `body[${bodyIndex}]`
    if (isBody) bodyIndex++
    if (!check.passed) labels.push(label)
  }
  return labels
}
