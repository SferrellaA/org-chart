import { describe, expect, it } from 'vitest';

import {
  HierarchyController,
  type HierarchyEntry,
} from '../src/renderer/hierarchy-controller';

const entries: readonly HierarchyEntry[] = [
  { id: 'root', ownerId: 'root', name: 'Root', kind: 'node' },
  { id: 'office', ownerId: 'root', name: 'Office', kind: 'internal', parentId: 'root' },
  { id: 'child', ownerId: 'child', name: 'Child', kind: 'node', parentId: 'office' },
  { id: 'grandchild', ownerId: 'grandchild', name: 'Grandchild', kind: 'node', parentId: 'child' },
  { id: 'other', ownerId: 'other', name: 'Other', kind: 'node' },
];

describe('HierarchyController', () => {
  it('retains expansion for existing IDs and initializes only new IDs', () => {
    const controller = new HierarchyController();
    controller.reconcile(entries, ['root', 'office', 'child']);
    controller.toggle('child', false);

    controller.reconcile([
      ...entries,
      { id: 'new', ownerId: 'new', name: 'New', kind: 'node', parentId: 'root' },
    ], ['root', 'office', 'child', 'new']);

    expect(controller.isExpanded('child')).toBe(false);
    expect(controller.isExpanded('new')).toBe(true);
  });

  it('discards expansion state for removed IDs', () => {
    const controller = new HierarchyController();
    controller.reconcile(entries, entries.map(({ id }) => id));
    controller.reconcile(entries.filter(({ id }) => id !== 'grandchild'), []);

    expect(controller.has('grandchild')).toBe(false);
  });

  it('collapses descendants and leaves them collapsed when the parent reopens', () => {
    const controller = new HierarchyController();
    controller.reconcile(entries, entries.map(({ id }) => id));

    controller.toggle('root', false);
    controller.toggle('root', true);

    expect(controller.isExpanded('root')).toBe(true);
    expect(controller.isExpanded('office')).toBe(false);
    expect(controller.isExpanded('child')).toBe(false);
    expect(controller.visibleIds()).toEqual(new Set(['root', 'office', 'other']));
  });

  it('reveals a descendant by expanding every ancestor including internal owners', () => {
    const controller = new HierarchyController();
    controller.reconcile(entries, []);

    expect(controller.reveal('grandchild')).toBe(true);

    expect(controller.isExpanded('root')).toBe(true);
    expect(controller.isExpanded('office')).toBe(true);
    expect(controller.isExpanded('child')).toBe(true);
    expect(controller.visibleIds()).toEqual(new Set(entries.map(({ id }) => id)));
  });

  it('builds deterministic navigation entries with hierarchy levels', () => {
    const controller = new HierarchyController();
    controller.reconcile(entries, entries.map(({ id }) => id));

    expect(controller.navigationItems()).toEqual([
      expect.objectContaining({ id: 'root', level: 1, expandable: true, expanded: true }),
      expect.objectContaining({ id: 'office', level: 2, expandable: true, expanded: true }),
      expect.objectContaining({ id: 'child', level: 3, expandable: true, expanded: true }),
      expect.objectContaining({ id: 'grandchild', level: 4, expandable: false, expanded: false }),
      expect.objectContaining({ id: 'other', level: 1, expandable: false, expanded: false }),
    ]);
  });
});
