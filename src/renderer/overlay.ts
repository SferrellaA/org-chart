import { encodeHierarchyActivationId, type RenderNode, type RenderView } from './types';

export type ActivationKind =
  | 'node'
  | 'internal'
  | 'hierarchy'
  | 'relationship'
  | 'change';

export type ActivationHandler = (
  kind: ActivationKind,
  id: string,
  trigger: HTMLElement | SVGElement,
) => void;

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function number(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

function plainText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function connectorPath(source: DOMRect, target: DOMRect): string {
  const sourceX = source.left + source.width / 2;
  const sourceY = source.bottom;
  const targetX = target.left + target.width / 2;
  const targetY = target.top;
  const middleY = sourceY + (targetY - sourceY) / 2;
  return `M ${number(sourceX)} ${number(sourceY)} C ${number(sourceX)} ${number(middleY)}, ${number(targetX)} ${number(middleY)}, ${number(targetX)} ${number(targetY)}`;
}

export function relationshipPath(source: DOMRect, target: DOMRect): string {
  const sourceX = source.left + source.width / 2;
  const sourceY = source.top + source.height / 2;
  const targetX = target.left + target.width / 2;
  const targetY = target.top + target.height / 2;
  const middleX = sourceX + (targetX - sourceX) / 2;
  return `M ${number(sourceX)} ${number(sourceY)} C ${number(middleX)} ${number(sourceY)}, ${number(middleX)} ${number(targetY)}, ${number(targetX)} ${number(targetY)}`;
}

function escapeSelector(value: string): string {
  const escape = globalThis.CSS?.escape;
  if (escape) return escape(value);
  return value.replace(/[\0-\x1f\x7f"'\\]/g, (character) => {
    return `\\${character.codePointAt(0)?.toString(16) ?? '0'} `;
  });
}

function isVisible(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (
      (current instanceof HTMLElement && current.hidden) ||
      current.getAttribute('aria-hidden') === 'true' ||
      current.getAttribute('data-collapsed') === 'true' ||
      current.classList.contains('collapsed')
    ) {
      return false;
    }
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    current = current.parentElement;
  }
  return true;
}

function relativeRect(rect: DOMRect, hostRect: DOMRect, host: HTMLElement): DOMRect {
  const left = rect.left - hostRect.left + host.scrollLeft;
  const top = rect.top - hostRect.top + host.scrollTop;
  return {
    bottom: top + rect.height,
    height: rect.height,
    left,
    right: left + rect.width,
    top,
    width: rect.width,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

interface Anchor {
  element: HTMLElement;
  id: string;
}

function findAnchor(
  host: HTMLElement,
  attribute: 'data-node-id' | 'data-internal-id',
  id: string,
): HTMLElement | undefined {
  const selector = `[${attribute}="${escapeSelector(id)}"]`;
  const element = host.querySelector<HTMLElement>(selector);
  return element && isVisible(element) ? element : undefined;
}

function findLineageAnchor(host: HTMLElement, lineage: readonly string[]): Anchor | undefined {
  for (const id of lineage) {
    const element = findAnchor(host, 'data-internal-id', id) ?? findAnchor(host, 'data-node-id', id);
    if (element) return { element, id };
  }
  return undefined;
}

function findOuterParentAnchor(
  host: HTMLElement,
  parentId: string | undefined,
  nodesById: ReadonlyMap<string, RenderNode>,
): Anchor | undefined {
  const visited = new Set<string>();
  let current = parentId;
  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    const element = findAnchor(host, 'data-node-id', current);
    if (element) return { element, id: current };
    current = nodesById.get(current)?.parentId;
  }
  return undefined;
}

function appendPathPair(
  svg: SVGSVGElement,
  existing: ReadonlyMap<string, SVGPathElement>,
  retained: Set<string>,
  pathData: string,
  kind: 'hierarchy' | 'relationship',
  id: string,
  attributes: Readonly<Record<string, string>>,
  aggregated = false,
  accessibleLabel?: string,
): void {
    const key = `${kind}:${id}`;
    const visibleKey = `${key}:visible`;
    const hitKey = `${key}:hit`;
    const visible = existing.get(visibleKey) ?? document.createElementNS(SVG_NAMESPACE, 'path');
    visible.setAttribute('class', `org-delta-connector org-delta-connector--${kind}`);
    if (aggregated) visible.classList.add('org-delta-connector--aggregated');
    visible.dataset.overlayKey = visibleKey;
    visible.setAttribute('d', pathData);
    visible.setAttribute('fill', 'none');
    visible.setAttribute('stroke', 'currentColor');
    visible.setAttribute('stroke-width', '2');
    visible.setAttribute('aria-hidden', 'true');
    visible.style.pointerEvents = 'none';

    const hit = existing.get(hitKey) ?? visible.cloneNode(false) as SVGPathElement;
    hit.setAttribute('class', `org-delta-connector org-delta-connector--${kind} org-delta-connector-hit`);
    if (aggregated) hit.classList.add('org-delta-connector--aggregated');
    hit.dataset.overlayKey = hitKey;
    hit.removeAttribute('aria-hidden');
    hit.setAttribute('d', pathData);
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '12');
    const label = accessibleLabel === undefined ? '' : plainText(accessibleLabel);
    if (label) {
      hit.setAttribute('role', kind === 'relationship' ? 'link' : 'button');
      hit.setAttribute('tabindex', '0');
    } else {
      hit.removeAttribute('role');
      hit.removeAttribute('tabindex');
    }
    hit.dataset.overlayKind = kind;
    hit.dataset.overlayId = id;
    if (label) hit.setAttribute('aria-label', label);
    else hit.removeAttribute('aria-label');
    hit.style.pointerEvents = 'stroke';
    for (const path of [visible, hit]) {
      for (const name of [
        'data-hierarchy-id',
        'data-connector-source-id',
        'data-connector-target-id',
        'data-relationship-id',
        'data-relationship-source-id',
        'data-relationship-target-id',
        'data-aggregated',
      ]) path.removeAttribute(name);
    }
    for (const [name, value] of Object.entries(attributes)) {
      visible.setAttribute(name, value);
      hit.setAttribute(name, value);
    }
    if (label) {
      const title = visible.querySelector('title') ?? document.createElementNS(SVG_NAMESPACE, 'title');
      title.textContent = label;
      if (!title.isConnected) visible.append(title);
    } else visible.querySelector('title')?.remove();
    if (!visible.isConnected) svg.append(visible);
    if (!hit.isConnected) svg.append(hit);
    retained.add(visibleKey);
    retained.add(hitKey);
}

function overlayTarget(svg: SVGSVGElement, event: Event): SVGPathElement | undefined {
  const target = event.target;
  if (!(target instanceof Element)) return undefined;
  const hit = target.closest<SVGPathElement>('.org-delta-connector-hit');
  return hit && svg.contains(hit) ? hit : undefined;
}

export function syncOverlay(
  svg: SVGSVGElement,
  host: HTMLElement,
  view: RenderView,
  onActivate?: ActivationHandler,
): void {
  const existing = new Map(
    [...svg.querySelectorAll<SVGPathElement>('path[data-overlay-key]')]
      .map((path) => [path.dataset.overlayKey!, path]),
  );
  const retained = new Set<string>();
  svg.classList.add('org-delta-connectors');
  svg.setAttribute('aria-hidden', 'false');
  svg.style.position = 'absolute';
  svg.style.inset = '0';
  svg.style.overflow = 'visible';
  svg.style.pointerEvents = 'none';
  svg.style.width = `${Math.max(host.scrollWidth, host.clientWidth)}px`;
  svg.style.height = `${Math.max(host.scrollHeight, host.clientHeight)}px`;
  svg.onclick = onActivate ? (event) => {
    const hit = overlayTarget(svg, event);
    const kind = hit?.dataset.overlayKind as 'hierarchy' | 'relationship' | undefined;
    const id = hit?.dataset.overlayId;
    if (hit && kind && id !== undefined) onActivate(kind, id, hit);
  } : null;
  svg.onkeydown = onActivate ? (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const hit = overlayTarget(svg, event);
    const kind = hit?.dataset.overlayKind as 'hierarchy' | 'relationship' | undefined;
    const id = hit?.dataset.overlayId;
    if (!hit || !kind || id === undefined) return;
    event.preventDefault();
    onActivate(kind, id, hit);
  } : null;

  const hostRect = host.getBoundingClientRect();
  const nodesById = new Map(view.nodes.map((node) => [node.id, node]));
  const internalNames = new Map(
    view.nodes.flatMap((node) => node.internalRows.map((row) => [row.id, row.name] as const)),
  );
  for (const node of view.nodes) {
    if (node.connectorSourceId === undefined) continue;
    const internalSource = findAnchor(host, 'data-internal-id', node.connectorSourceId);
    const source = internalSource
      ? { element: internalSource, id: node.connectorSourceId }
      : findOuterParentAnchor(host, node.parentId, nodesById);
    const target = findAnchor(host, 'data-node-id', node.id);
    if (!source || !target) continue;
    const id = encodeHierarchyActivationId(node.connectorSourceId, node.id);
    const aggregated = source.id !== node.connectorSourceId;
    const sourceName = plainText(internalNames.get(node.connectorSourceId) ?? '');
    const targetName = plainText(node.name);
    const label = sourceName && targetName
      ? `${sourceName} contains reporting line to ${targetName}`
      : undefined;
    appendPathPair(svg, existing, retained, connectorPath(
      relativeRect(source.element.getBoundingClientRect(), hostRect, host),
      relativeRect(target.getBoundingClientRect(), hostRect, host),
    ), 'hierarchy', id, {
      'data-hierarchy-id': id,
      'data-connector-source-id': source.id,
      'data-connector-target-id': node.id,
      ...(aggregated ? { 'data-aggregated': 'true' } : {}),
    }, aggregated, label);
  }

  for (const relationship of view.relationships) {
    const source = findLineageAnchor(host, relationship.sourceAncestors);
    const target = findLineageAnchor(host, relationship.targetAncestors);
    if (!source || !target) continue;
    const aggregated = relationship.aggregated ||
      source.id !== relationship.sourceAncestors[0] ||
      target.id !== relationship.targetAncestors[0];
    if (aggregated && source.id === target.id) continue;
    appendPathPair(svg, existing, retained, relationshipPath(
      relativeRect(source.element.getBoundingClientRect(), hostRect, host),
      relativeRect(target.element.getBoundingClientRect(), hostRect, host),
    ), 'relationship', relationship.id, {
      'data-relationship-id': relationship.id,
      'data-relationship-source-id': source.id,
      'data-relationship-target-id': target.id,
      ...(aggregated ? { 'data-aggregated': 'true' } : {}),
    }, aggregated, relationship.label);
  }
  for (const [key, path] of existing) if (!retained.has(key)) path.remove();
}

export class ConnectorOverlay {
  private readonly svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  private readonly originalPosition: string;
  private readonly positionedHost: boolean;

  constructor(
    private readonly host: HTMLElement,
    private readonly onActivate: ActivationHandler,
  ) {
    this.originalPosition = host.style.position;
    const position = getComputedStyle(host).position;
    this.positionedHost = position === '' || position === 'static';
    if (this.positionedHost) host.style.position = 'relative';
  }

  sync(nodes: RenderView['nodes'], relationships: RenderView['relationships']): void {
    if (!this.svg.isConnected) this.host.append(this.svg);
    syncOverlay(this.svg, this.host, {
      nodes,
      relationships,
      searchEntries: [],
      initialExpansionIds: [],
    }, this.onActivate);
  }

  destroy(): void {
    this.svg.onclick = null;
    this.svg.onkeydown = null;
    this.svg.remove();
    if (this.positionedHost) this.host.style.position = this.originalPosition;
  }
}
