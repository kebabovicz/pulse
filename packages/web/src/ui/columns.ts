import type { CSSProperties } from 'react'

/**
 * Column widths for the app's tables, in characters of the monospace grid.
 *
 * A column is as wide as the longest value in the whole table, so it keeps its
 * width in rows where the value is missing and the columns after it never shift.
 * `cap` bounds a column that would otherwise crowd out the flexible one; `min`
 * keeps an empty column from collapsing.
 */
export function colWidth(values: (string | null | undefined)[], cap: number, min = 0): string {
  const longest = values.reduce<number>((max, v) => Math.max(max, v?.length ?? 0), min)
  return `${Math.min(longest, cap)}ch`
}

/** Builds the custom properties the grid reads, e.g. `cols({ key: [...], value: [...] })`. */
export function cols(widths: Record<string, string>): CSSProperties {
  return Object.fromEntries(Object.entries(widths).map(([name, width]) => [`--${name}`, width]))
}
