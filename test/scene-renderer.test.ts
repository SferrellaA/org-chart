import { afterEach, describe, expect, it, vi } from 'vitest';

import { SceneRenderer, type SceneAdapter } from '../src/renderer/scene-renderer';
import type { RenderScene } from '../src/renderer/scene-types';

interface View {
  names: Readonly<Record<string, string>>;
  initialExpansionIds: readonly string[];
}

const adapter: SceneAdapter<View> = {
  className: 'test-layout',
  hierarchy: (view) => [
    { id: 'root', ownerId: 'root', name: view.names.root ?? 'Root', kind: 'node' },
    { id: 'child', ownerId: 'child', name: view.names.child ?? 'Child', kind: 'node', parentId: 'root' },
    { id: 'grandchild', ownerId: 'grandchild', name: view.names.grandchild ?? 'Grandchild', kind: 'node', parentId: 'child' },
  ],
  initialExpansionIds: (view) => view.initialExpansionIds,
  layout: (view, visibleIds): RenderScene => {
    const ids = ['root', 'child', 'grandchild'].filter((id) => visibleIds.has(id));
    return {
      width: 250,
      height: ids.length * 120,
      nodes: ids.map((id, index) => ({
        key: id,
        id,
        ownerId: id,
        ...(id === 'child' ? { parentId: 'root' } : {}),
        ...(id === 'grandchild' ? { parentId: 'child' } : {}),
        name: view.names[id] ?? id,
        kind: 'node',
        left: 0,
        top: index * 120,
        width: 250,
        height: 72,
        markup: `<button type="button" data-activate-kind="node" data-activate-id="${id}">${view.names[id] ?? id}</button>`,
      })),
      connectors: ids.includes('child') ? [{
        key: 'relationship:coordination',
        kind: 'relationship',
        source: { id: 'root', kind: 'node' },
        target: { id: 'child', kind: 'node' },
        activationId: 'coordination',
        label: 'Coordinates work',
      }] : [],
      decorations: [],
    };
  },
};

function view(initialExpansionIds = ['root', 'child']): View {
  return { names: { root: 'Root', child: 'Child', grandchild: 'Grandchild' }, initialExpansionIds };
}

describe('SceneRenderer', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
  });

  it('renders shared cards, expansion controls, navigation, and minimap', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new SceneRenderer(host, adapter, { onActivate: vi.fn() });

    renderer.render(view());

    expect(host.querySelectorAll('[data-scene-node]')).toHaveLength(3);
    expect(host.querySelector('[data-hierarchy-toggle="root"]')).not.toBeNull();
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(3);
    expect(host.querySelectorAll('[data-minimap-node-id]')).toHaveLength(3);
    expect(host.querySelectorAll('[data-minimap-link]')).toHaveLength(2);
    expect(host.querySelector('.org-delta-scene-world')?.getAttribute('role')).toBe('group');
    expect(host.querySelector('.org-delta-scene-world')?.getAttribute('aria-label'))
      .toBe('Interactive organization diagram');
    expect(host.querySelector('[data-relationship-id="coordination"][tabindex="0"]'))
      .not.toBeNull();
    expect(host.querySelector('.org-delta-relationship-descriptions')?.textContent)
      .toContain('Coordinates work');
  });

  it('uses one recursive collapse operation for visual and semantic controls', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new SceneRenderer(host, adapter, { onActivate: vi.fn() });
    renderer.render(view());

    host.querySelector<HTMLButtonElement>('[data-hierarchy-toggle="root"]')!.click();
    host.querySelector<HTMLButtonElement>('[data-hierarchy-toggle="root"]')!.click();

    expect(host.querySelector('[data-scene-key="child"]')).not.toBeNull();
    expect(host.querySelector('[data-scene-key="grandchild"]')).toBeNull();
    expect(host.querySelector('[role="treeitem"][data-activate-id="child"]')
      ?.getAttribute('aria-expanded')).toBe('false');
  });

  it('delegates activation once with side context when present', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const onActivate = vi.fn();
    const renderer = new SceneRenderer(host, adapter, { onActivate });
    renderer.render(view());
    const button = host.querySelector<HTMLButtonElement>('[data-activate-id="child"]')!;
    button.dataset.viewSide = 'proposed';

    button.click();

    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate).toHaveBeenCalledWith('node', 'child', button, { side: 'proposed' });
  });

  it('retains keyed connector elements across redraws so keyboard focus survives', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new SceneRenderer(host, adapter, { onActivate: vi.fn() });
    renderer.render(view());
    const connector = host.querySelector<SVGPathElement>(
      '[data-relationship-id="coordination"]',
    )!;
    connector.focus();

    renderer.render({ ...view(), names: { ...view().names, child: 'Updated Child' } });

    expect(host.querySelector('[data-relationship-id="coordination"]')).toBe(connector);
    expect(document.activeElement).toBe(connector);
  });

  it('preserves the current viewport across external data rerenders', async () => {
    const host = document.createElement('div');
    host.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);
    document.body.append(host);
    const renderer = new SceneRenderer(host, adapter, { onActivate: vi.fn() });
    renderer.render(view());
    await Promise.resolve();
    renderer.reveal('child');
    const centered = host.querySelector<HTMLElement>('.org-delta-scene-world')!.style.transform;

    renderer.render({ ...view(), names: { ...view().names, child: 'Updated Child' } });
    await Promise.resolve();
    await Promise.resolve();

    expect(host.querySelector<HTMLElement>('.org-delta-scene-world')!.style.transform)
      .toBe(centered);
  });

  it('uses the same keyed transition for retained cards and disables it for reduced motion', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new SceneRenderer(host, adapter, {
      onActivate: vi.fn(), transitionDurationMs: 900,
    });
    renderer.render(view());
    expect(animate).not.toHaveBeenCalled();

    renderer.render({ ...view(), names: { ...view().names, child: 'Updated Child' } });

    expect(animate).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ duration: 900 }));
  });
});
