import type { FileEntry } from './stripPlan.ts';

export interface DirNode {
  name: string;
  path: string;
  subdirs: Map<string, DirNode>;
  files: FileEntry[];
}

export function buildTree(allEntries: FileEntry[]): DirNode {
  const root: DirNode = { name: '', path: '', subdirs: new Map(), files: [] };
  for (const entry of allEntries) {
    const parts = entry.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!;
      if (!node.subdirs.has(seg)) {
        const p = node.path ? `${node.path}/${seg}` : seg;
        node.subdirs.set(seg, { name: seg, path: p, subdirs: new Map(), files: [] });
      }
      node = node.subdirs.get(seg)!;
    }
    node.files.push(entry);
  }
  return root;
}

export function collectEntries(node: DirNode): FileEntry[] {
  const result: FileEntry[] = [...node.files];
  for (const sub of node.subdirs.values()) result.push(...collectEntries(sub));
  return result;
}

/**
 * The node at `path` in a freshly built tree, or undefined if that directory no
 * longer exists. Lets long-lived callers hold a path rather than a node object,
 * which goes stale every time the tree is rebuilt.
 */
export function findNode(root: DirNode, path: string): DirNode | undefined {
  if (path === '') return root;
  let node: DirNode | undefined = root;
  for (const seg of path.split('/')) {
    node = node.subdirs.get(seg);
    if (!node) return undefined;
  }
  return node;
}

export function entriesUnder(entries: FileEntry[], path: string): FileEntry[] {
  return entries.filter(e => e.path.startsWith(path + '/'));
}
