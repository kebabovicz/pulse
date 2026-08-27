import { JSONPath } from 'jsonpath-plus'

/**
 * jsonpath-plus reads "@==" as a single token and throws on the canonical way
 * of picking a value out of an array of scalars — `$.roles[?(@=='Admin')]`.
 * The same filter with a space around the operator works, so the operator gets
 * its space here instead of every scenario author learning the quirk.
 */
const BARE_OPERATOR = /@(?=[=!<>~])/g

/** A filter dies on the first element that is not an object — a null in the collection is enough. */
const NOT_AN_OBJECT = /Cannot read properties of (null|undefined)/

/** Every JSONPath of a scenario goes through here: same dialect, same errors. */
export function jsonQuery(path: string, json: unknown): unknown[] {
  try {
    return JSONPath({ path: path.replace(BARE_OPERATOR, '@ '), json: json ?? null, wrap: true })
  } catch (e) {
    const message = (e as Error).message
    const hint = NOT_AN_OBJECT.test(message)
      ? ` — an element of the collection is null or a scalar, so guard the filter: [?(@ && @.field=='x')]`
      : ''
    throw new Error(`JSONPath ${JSON.stringify(path)}: ${message}${hint}`, { cause: e })
  }
}
