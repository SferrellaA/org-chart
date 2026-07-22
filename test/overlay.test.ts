import { describe, expect, it, vi } from 'vitest';
import {
  ConnectorOverlay,
  connectorPath,
  relationshipPath,
  syncOverlay,
} from '../src/renderer/overlay';
import type { RenderNode, RenderRelationship, RenderView } from '../src/renderer/types';
import { syncOverlay as publicSyncOverlay } from '../src/index';

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    bottom: y + height,
    height,
    left: x,
    right: x + width,
    top: y,
    width,
    x,
    y,
    toJSON: () => ({}),
  };
}

function node(id: string, connectorSourceId?: string): RenderNode {
  return {
    id,
    ...(connectorSourceId === undefined ? {} : { connectorSourceId }),
    name: id,
    internalRows: [],
    hiddenInternalCount: 0,
    hiddenChangeCount: 0,
    diffKind: 'unchanged',
    ghost: false,
  };
}

function relationship(
  sourceAncestors: readonly string[],
  targetAncestors: readonly string[],
): RenderRelationship {
  return {
    id: 'rel',
    source: sourceAncestors[0]!,
    target: targetAncestors[0]!,
    sourceAncestors,
    targetAncestors,
    label: 'works with',
    type: 'coordination',
    aggregated: false,
    diffKind: 'unchanged',
  };
}

function anchor(
  host: HTMLElement,
  attribute: 'data-node-id' | 'data-internal-id',
  id: string,
  bounds: DOMRect,
): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute(attribute, id);
  element.getBoundingClientRect = () => bounds;
  host.append(element);
  return element;
}

describe('overlay geometry', () => {
  it('exports the stateless overlay synchronizer publicly', () => {
    expect(publicSyncOverlay).toBe(syncOverlay);
  });

  it('routes internal connectors from source bottom center to target top center', () => {
    expect(connectorPath(rect(10, 10, 80, 20), rect(200, 100, 80, 40))).toBe(
      'M 50 30 C 50 65, 240 65, 240 100',
    );
  });

  it('returns finite paths for zero-sized anchors', () => {
    expect(connectorPath(rect(10, 10, 0, 0), rect(20, 20, 0, 0))).toBe(
      'M 10 10 C 10 15, 20 15, 20 20',
    );
    expect(relationshipPath(rect(10, 10, 0, 0), rect(20, 20, 0, 0))).toBe(
      'M 10 10 C 15 10, 15 20, 20 20',
    );
  });
});

describe('ConnectorOverlay', () => {
  it('updates keyed paths in place without duplicating listeners', () => {
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(0, 0, 500, 500);
    anchor(host, 'data-node-id', 'source', rect(0, 0, 100, 50));
    anchor(host, 'data-node-id', 'target', rect(200, 200, 100, 50));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    host.append(svg);
    const activate = vi.fn();
    const view: RenderView = {
      nodes: [],
      relationships: [relationship(['source'], ['target'])],
      searchEntries: [],
      initialExpansionIds: [],
    };

    syncOverlay(svg, host, view, activate);
    const original = svg.querySelector<SVGPathElement>('.org-delta-connector-hit')!;
    syncOverlay(svg, host, view, activate);
    const updated = svg.querySelector<SVGPathElement>('.org-delta-connector-hit')!;
    updated.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(updated === original).toBe(true);
    expect(activate).toHaveBeenCalledOnce();
    expect(svg.querySelectorAll('[data-relationship-id="rel"]')).toHaveLength(2);
  });

  it('omits relationships whose endpoint lineage has no visible anchor', () => {
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(0, 0, 500, 500);
    anchor(host, 'data-node-id', 'source', rect(0, 0, 100, 50));
    const overlay = new ConnectorOverlay(host, vi.fn());

    overlay.sync([], [relationship(['source'], ['missing'])]);

    expect(host.querySelectorAll('[data-relationship-id]')).toHaveLength(0);
  });

  it('uses the first visible ancestor and marks an aggregated relationship', () => {
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(10, 20, 500, 500);
    const hidden = anchor(host, 'data-node-id', 'source', rect(20, 30, 100, 50));
    hidden.style.display = 'none';
    anchor(host, 'data-node-id', 'source-parent', rect(30, 40, 100, 50));
    anchor(host, 'data-node-id', 'target', rect(200, 200, 100, 50));
    const overlay = new ConnectorOverlay(host, vi.fn());

    overlay.sync([], [relationship(['source', 'source-parent'], ['target'])]);

    const paths = host.querySelectorAll<SVGPathElement>('[data-relationship-id="rel"]');
    expect(paths).toHaveLength(2);
    expect(paths[0]?.dataset.aggregated).toBe('true');
    expect(paths[0]?.classList.contains('org-delta-connector--aggregated')).toBe(true);
  });

  it('treats anchors inside collapsed branches as invisible', () => {
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(0, 0, 500, 500);
    const collapsed = document.createElement('div');
    collapsed.dataset.collapsed = 'true';
    host.append(collapsed);
    const hidden = anchor(collapsed, 'data-node-id', 'source', rect(0, 0, 100, 50));
    hidden.hidden = false;
    anchor(host, 'data-node-id', 'parent', rect(0, 0, 100, 50));
    anchor(host, 'data-node-id', 'target', rect(200, 200, 100, 50));
    const overlay = new ConnectorOverlay(host, vi.fn());

    overlay.sync([], [relationship(['source', 'parent'], ['target'])]);

    expect(host.querySelector('[data-relationship-id="rel"]')?.getAttribute('data-aggregated')).toBe(
      'true',
    );
  });

  it('omits a relationship when aggregation produces a self-loop', () => {
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(0, 0, 500, 500);
    anchor(host, 'data-node-id', 'parent', rect(0, 0, 100, 50));
    const overlay = new ConnectorOverlay(host, vi.fn());

    overlay.sync([], [relationship(['missing-source', 'parent'], ['missing-target', 'parent'])]);

    expect(host.querySelectorAll('[data-relationship-id]')).toHaveLength(0);
  });

  it('retains an explicit relationship self-loop when no aggregation occurred', () => {
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(0, 0, 500, 500);
    anchor(host, 'data-node-id', 'same', rect(0, 0, 100, 50));
    const overlay = new ConnectorOverlay(host, vi.fn());

    overlay.sync([], [relationship(['same'], ['same'])]);

    expect(host.querySelectorAll('[data-relationship-id="rel"]')).toHaveLength(2);
  });

  it('routes a subordinate connector from its internal row', () => {
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(10, 20, 500, 500);
    anchor(host, 'data-internal-id', 'internal', rect(30, 40, 80, 20));
    anchor(host, 'data-node-id', 'child', rect(200, 200, 100, 50));
    const overlay = new ConnectorOverlay(host, vi.fn());

    overlay.sync([node('child', 'internal')], []);

    const path = host.querySelector<SVGPathElement>('[data-hierarchy-id="internal->child"]');
    expect(path?.getAttribute('d')).toBe('M 60 40 C 60 110, 240 110, 240 180');
    expect(path?.getAttribute('stroke')).toBe('currentColor');
  });

  it('labels focusable internal hierarchy connectors from source and target names', () => {
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(0, 0, 500, 500);
    anchor(host, 'data-internal-id', 'hr', rect(20, 20, 100, 50));
    anchor(host, 'data-node-id', 'child', rect(200, 200, 100, 50));
    const owner = {
      ...node('owner'),
      internalRows: [{
        id: 'hr',
        name: 'HR Office',
        depth: 1,
        diffKind: 'unchanged' as const,
        hasSubordinateChildren: true,
      }],
    };
    const child = { ...node('child', 'hr'), name: 'Child Office', parentId: 'owner' };
    const overlay = new ConnectorOverlay(host, vi.fn());

    overlay.sync([owner, child], []);

    const paths = host.querySelectorAll<SVGPathElement>('[data-hierarchy-id="hr->child"]');
    const visible = paths[0]!;
    const hit = paths[1]!;
    expect(hit.getAttribute('aria-label')).toBe('HR Office contains reporting line to Child Office');
    expect(hit.getAttribute('role')).toBe('button');
    expect(hit.getAttribute('tabindex')).toBe('0');
    expect(visible.querySelector('title')?.textContent).toBe(
      'HR Office contains reporting line to Child Office',
    );
  });

  it('does not expose an unlabeled internal connector as a focus target', () => {
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(0, 0, 500, 500);
    anchor(host, 'data-internal-id', 'unknown', rect(20, 20, 100, 50));
    anchor(host, 'data-node-id', 'child', rect(200, 200, 100, 50));
    const overlay = new ConnectorOverlay(host, vi.fn());

    overlay.sync([node('child', 'unknown')], []);

    const paths = host.querySelectorAll<SVGPathElement>('[data-hierarchy-id="unknown->child"]');
    expect(paths[1]?.hasAttribute('tabindex')).toBe(false);
    expect(paths[1]?.hasAttribute('role')).toBe(false);
    expect(paths[1]?.hasAttribute('aria-label')).toBe(false);
    expect(paths[0]?.querySelector('title')).toBeNull();
  });

  it('falls back through visible outer parents when the internal source is unavailable', () => {
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(0, 0, 500, 500);
    anchor(host, 'data-node-id', 'outer', rect(20, 20, 100, 50));
    anchor(host, 'data-node-id', 'child', rect(200, 200, 100, 50));
    const overlay = new ConnectorOverlay(host, vi.fn());
    const child = { ...node('child', 'hidden-internal'), parentId: 'outer' };

    overlay.sync([node('outer'), child], []);

    const path = host.querySelector<SVGPathElement>(
      '[data-hierarchy-id="hidden-internal->child"]',
    );
    expect(path?.dataset.connectorSourceId).toBe('outer');
    expect(path?.dataset.aggregated).toBe('true');
    expect(path?.classList.contains('org-delta-connector--aggregated')).toBe(true);
  });

  it('activates relationship hit paths by click and keyboard without leaking old listeners', () => {
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(0, 0, 500, 500);
    anchor(host, 'data-node-id', 'source', rect(0, 0, 100, 50));
    anchor(host, 'data-node-id', 'target', rect(200, 200, 100, 50));
    const activate = vi.fn();
    const overlay = new ConnectorOverlay(host, activate);

    overlay.sync([], [relationship(['source'], ['target'])]);
    const oldHit = host.querySelector<SVGPathElement>('.org-delta-connector-hit')!;
    overlay.sync([], [relationship(['source'], ['target'])]);
    oldHit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const hit = host.querySelector<SVGPathElement>('.org-delta-connector-hit')!;
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    hit.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));

    expect(activate).toHaveBeenCalledTimes(3);
    expect(activate.mock.calls[0]?.[0]).toBe('relationship');
    expect(activate.mock.calls[0]?.[1]).toBe('rel');
    expect(activate.mock.calls[0]?.[2]).toBe(hit);
  });

  it('labels one focusable relationship hit target and supports Space activation', () => {
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(0, 0, 500, 500);
    anchor(host, 'data-node-id', 'source', rect(0, 0, 100, 50));
    anchor(host, 'data-node-id', 'target', rect(200, 200, 100, 50));
    const activate = vi.fn();
    const overlay = new ConnectorOverlay(host, activate);

    overlay.sync([], [relationship(['source'], ['target'])]);

    const paths = host.querySelectorAll<SVGPathElement>('[data-relationship-id="rel"]');
    const visible = paths[0]!;
    const hit = paths[1]!;
    expect(visible.querySelector('title')?.textContent).toBe('works with');
    expect(visible.getAttribute('aria-hidden')).toBe('true');
    expect(visible.hasAttribute('tabindex')).toBe(false);
    expect(hit.getAttribute('aria-label')).toBe('works with');
    expect(hit.getAttribute('role')).toBe('link');
    expect(hit.hasAttribute('aria-hidden')).toBe(false);
    expect(hit.getAttribute('tabindex')).toBe('0');
    expect(host.querySelectorAll('[data-relationship-id="rel"][tabindex="0"]')).toHaveLength(1);

    hit.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }));
    expect(activate).toHaveBeenCalledOnce();
  });

  it('positions against the host and restores its inline positioning on destroy', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const overlay = new ConnectorOverlay(host, vi.fn());

    expect(host.style.position).toBe('relative');
    overlay.destroy();
    expect(host.style.position).toBe('');
  });
});
