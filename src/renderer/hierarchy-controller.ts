export interface HierarchyEntry {
  id: string;
  ownerId: string;
  name: string;
  kind: 'node' | 'internal';
  parentId?: string;
  expansionChild?: boolean;
}

export interface HierarchyNavigationItem extends HierarchyEntry {
  level: number;
  expandable: boolean;
  expanded: boolean;
}

export class HierarchyController {
  private entries: readonly HierarchyEntry[] = [];
  private readonly byId = new Map<string, HierarchyEntry>();
  private readonly children = new Map<string, string[]>();
  private readonly expansion = new Map<string, boolean>();

  reconcile(entries: readonly HierarchyEntry[], initialExpansionIds: readonly string[]): void {
    const retained = new Set(entries.map(({ id }) => id));
    const initial = new Set(initialExpansionIds);
    for (const id of this.expansion.keys()) {
      if (!retained.has(id)) this.expansion.delete(id);
    }
    this.entries = entries.map((entry) => ({ ...entry }));
    this.byId.clear();
    this.children.clear();
    for (const entry of this.entries) {
      this.byId.set(entry.id, entry);
      if (!this.expansion.has(entry.id)) {
        this.expansion.set(entry.id, entry.kind === 'internal' || initial.has(entry.id));
      }
      if (entry.parentId !== undefined) {
        const siblings = this.children.get(entry.parentId) ?? [];
        siblings.push(entry.id);
        this.children.set(entry.parentId, siblings);
      }
    }
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  isExpanded(id: string): boolean {
    return this.expansion.get(id) ?? false;
  }

  isExpandable(id: string): boolean {
    return (this.children.get(id) ?? []).some((childId) =>
      this.byId.get(childId)?.expansionChild !== false
    );
  }

  toggle(id: string, expanded = !this.isExpanded(id)): boolean {
    if (!this.byId.has(id) || !this.isExpandable(id)) return false;
    this.expansion.set(id, expanded);
    if (!expanded) {
      const stack = [...(this.children.get(id) ?? [])];
      const seen = new Set<string>();
      while (stack.length > 0) {
        const descendant = stack.pop()!;
        if (seen.has(descendant)) continue;
        seen.add(descendant);
        this.expansion.set(descendant, false);
        stack.push(...(this.children.get(descendant) ?? []));
      }
    }
    return true;
  }

  reveal(id: string): boolean {
    if (!this.byId.has(id)) return false;
    let changed = false;
    let current = this.byId.get(id)?.parentId;
    const seen = new Set<string>();
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      if (!this.isExpanded(current)) {
        this.expansion.set(current, true);
        changed = true;
      }
      current = this.byId.get(current)?.parentId;
    }
    return changed;
  }

  visibleIds(): Set<string> {
    const visible = new Set<string>();
    for (const entry of this.entries) {
      let parentId = entry.parentId;
      const seen = new Set<string>();
      let shown = true;
      while (parentId !== undefined && !seen.has(parentId)) {
        seen.add(parentId);
        if (this.isExpandable(parentId) && !this.isExpanded(parentId)) {
          shown = false;
          break;
        }
        parentId = this.byId.get(parentId)?.parentId;
      }
      if (shown) visible.add(entry.id);
    }
    return visible;
  }

  navigationItems(): HierarchyNavigationItem[] {
    const visible = this.visibleIds();
    return this.entries.filter(({ id }) => visible.has(id)).map((entry) => {
      let level = 1;
      let parentId = entry.parentId;
      const seen = new Set<string>();
      while (parentId !== undefined && !seen.has(parentId)) {
        seen.add(parentId);
        level += 1;
        parentId = this.byId.get(parentId)?.parentId;
      }
      const expandable = this.isExpandable(entry.id);
      return {
        ...entry,
        level,
        expandable,
        expanded: expandable && this.isExpanded(entry.id),
      };
    });
  }
}
