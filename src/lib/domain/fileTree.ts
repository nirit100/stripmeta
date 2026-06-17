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

export function entriesUnder(entries: FileEntry[], path: string): FileEntry[] {
  return entries.filter(e => e.path.startsWith(path + '/'));
}
