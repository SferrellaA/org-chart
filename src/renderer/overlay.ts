import type { RenderNode, RenderRelationship } from './types';

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

export class ConnectorOverlay {
  private svg: SVGSVGElement | undefined;
  private listenerCleanup: Array<() => void> = [];
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

  sync(nodes: readonly RenderNode[], relationships: readonly RenderRelationship[]): void {
    for (const cleanup of this.listenerCleanup) cleanup();
    this.listenerCleanup = [];
    this.svg?.remove();
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.classList.add('org-delta-connectors');
    svg.setAttribute('aria-hidden', 'false');
    svg.style.position = 'absolute';
    svg.style.inset = '0';
    svg.style.overflow = 'visible';
    svg.style.pointerEvents = 'none';
    svg.style.width = `${Math.max(this.host.scrollWidth, this.host.clientWidth)}px`;
    svg.style.height = `${Math.max(this.host.scrollHeight, this.host.clientHeight)}px`;
    this.host.append(svg);
    this.svg = svg;

    const hostRect = this.host.getBoundingClientRect();
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    for (const node of nodes) {
      if (node.connectorSourceId === undefined) continue;
      const internalSource = this.findAnchor('data-internal-id', node.connectorSourceId);
      const source = internalSource
        ? { element: internalSource, id: node.connectorSourceId }
        : this.findOuterParentAnchor(node.parentId, nodesById);
      const target = this.findAnchor('data-node-id', node.id);
      if (!source || !target) continue;
      const id = `${node.connectorSourceId}->${node.id}`;
      const aggregated = source.id !== node.connectorSourceId;
      const path = connectorPath(
        relativeRect(source.element.getBoundingClientRect(), hostRect, this.host),
        relativeRect(target.getBoundingClientRect(), hostRect, this.host),
      );
      this.appendPathPair(svg, path, 'hierarchy', id, {
        'data-hierarchy-id': id,
        'data-connector-source-id': source.id,
        'data-connector-target-id': node.id,
        ...(aggregated ? { 'data-aggregated': 'true' } : {}),
      }, aggregated);
    }

    for (const relationship of relationships) {
      const source = this.findLineageAnchor(relationship.sourceAncestors);
      const target = this.findLineageAnchor(relationship.targetAncestors);
      if (!source || !target) continue;
      const aggregated =
        relationship.aggregated ||
        source.id !== relationship.sourceAncestors[0] ||
        target.id !== relationship.targetAncestors[0];
      if (aggregated && source.id === target.id) continue;
      const path = relationshipPath(
        relativeRect(source.element.getBoundingClientRect(), hostRect, this.host),
        relativeRect(target.element.getBoundingClientRect(), hostRect, this.host),
      );
      this.appendPathPair(svg, path, 'relationship', relationship.id, {
        'data-relationship-id': relationship.id,
        'data-relationship-source-id': source.id,
        'data-relationship-target-id': target.id,
        ...(aggregated ? { 'data-aggregated': 'true' } : {}),
      }, aggregated, relationship.label);
    }
  }

  destroy(): void {
    for (const cleanup of this.listenerCleanup) cleanup();
    this.listenerCleanup = [];
    this.svg?.remove();
    this.svg = undefined;
    if (this.positionedHost) this.host.style.position = this.originalPosition;
  }

  private findAnchor(attribute: 'data-node-id' | 'data-internal-id', id: string): HTMLElement | undefined {
    const selector = `[${attribute}="${escapeSelector(id)}"]`;
    const element = this.host.querySelector<HTMLElement>(selector);
    return element && isVisible(element) ? element : undefined;
  }

  private findLineageAnchor(lineage: readonly string[]): Anchor | undefined {
    for (const id of lineage) {
      const element =
        this.findAnchor('data-internal-id', id) ?? this.findAnchor('data-node-id', id);
      if (element) return { element, id };
    }
    return undefined;
  }

  private findOuterParentAnchor(
    parentId: string | undefined,
    nodesById: ReadonlyMap<string, RenderNode>,
  ): Anchor | undefined {
    const visited = new Set<string>();
    let current = parentId;
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      const element = this.findAnchor('data-node-id', current);
      if (element) return { element, id: current };
      current = nodesById.get(current)?.parentId;
    }
    return undefined;
  }

  private appendPathPair(
    svg: SVGSVGElement,
    pathData: string,
    kind: 'hierarchy' | 'relationship',
    id: string,
    attributes: Readonly<Record<string, string>>,
    aggregated = false,
    accessibleLabel?: string,
  ): void {
    const visible = document.createElementNS(SVG_NAMESPACE, 'path');
    visible.classList.add('org-delta-connector', `org-delta-connector--${kind}`);
    if (aggregated) visible.classList.add('org-delta-connector--aggregated');
    visible.setAttribute('d', pathData);
    visible.setAttribute('fill', 'none');
    visible.setAttribute('stroke', 'currentColor');
    visible.setAttribute('stroke-width', '2');
    visible.setAttribute('aria-hidden', 'true');
    visible.style.pointerEvents = 'none';

    const hit = visible.cloneNode(false) as SVGPathElement;
    hit.classList.add('org-delta-connector-hit');
    hit.removeAttribute('aria-hidden');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '12');
    hit.setAttribute('role', kind === 'relationship' ? 'link' : 'button');
    hit.setAttribute('tabindex', '0');
    if (accessibleLabel !== undefined) hit.setAttribute('aria-label', accessibleLabel);
    hit.style.pointerEvents = 'stroke';
    for (const [name, value] of Object.entries(attributes)) {
      visible.setAttribute(name, value);
      hit.setAttribute(name, value);
    }
    const activate = (): void => this.onActivate(kind, id, hit);
    const activateByKeyboard = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activate();
    };
    hit.addEventListener('click', activate);
    hit.addEventListener('keydown', activateByKeyboard);
    this.listenerCleanup.push(() => {
      hit.removeEventListener('click', activate);
      hit.removeEventListener('keydown', activateByKeyboard);
    });
    if (accessibleLabel !== undefined) {
      const title = document.createElementNS(SVG_NAMESPACE, 'title');
      title.textContent = accessibleLabel;
      visible.append(title);
    }
    svg.append(visible, hit);
  }
}
