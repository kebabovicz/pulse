import type { ScenarioListItem } from '@pulse/shared'

/**
 * The sidebar as a tree: folders nest, and each folder knows every scenario
 * below it — including the ones in its subfolders, so "run this folder" means
 * what a reader expects.
 */
export interface TreeFolder {
  /** path with a trailing slash, e.g. "references/crud/" — also the collapse key */
  path: string
  name: string
  depth: number
  folders: TreeFolder[]
  scenarios: ScenarioListItem[]
  /** everything runnable below this folder, subfolders included */
  runnable: string[]
}

const emptyFolder = (path: string, name: string, depth: number): TreeFolder => ({
  path,
  name,
  depth,
  folders: [],
  scenarios: [],
  runnable: [],
})

/** Finds or creates the folder a path points at, building the chain on the way. */
function folderAt(root: TreeFolder, parts: string[]): TreeFolder {
  let folder = root
  let prefix = ''
  for (const part of parts) {
    prefix += `${part}/`
    const existing = folder.folders.find((f) => f.path === prefix)
    if (existing) {
      folder = existing
    } else {
      const created = emptyFolder(prefix, part, folder.depth + 1)
      folder.folders.push(created)
      folder = created
    }
  }
  return folder
}

/**
 * Builds the tree from flat paths; the root holds files at the top level.
 * Folders are passed in separately so an empty one still shows up.
 */
export function buildTree(items: ScenarioListItem[], folders: string[] = []): TreeFolder {
  const root = emptyFolder('', '', -1)
  for (const folder of folders) folderAt(root, folder.split('/'))
  for (const item of items) {
    const parts = item.path.split('/')
    const fileName = parts.pop()
    if (fileName === undefined) continue
    folderAt(root, parts).scenarios.push(item)
  }
  sortFolder(root)
  collectRunnable(root)
  return root
}

function sortFolder(folder: TreeFolder): void {
  folder.folders.sort((a, b) => a.name.localeCompare(b.name))
  folder.scenarios.sort((a, b) => a.path.localeCompare(b.path))
  for (const child of folder.folders) sortFolder(child)
}

function collectRunnable(folder: TreeFolder): string[] {
  const own = folder.scenarios.filter((s) => s.valid).map((s) => s.path)
  const nested = folder.folders.flatMap(collectRunnable)
  folder.runnable = [...own, ...nested]
  return folder.runnable
}
