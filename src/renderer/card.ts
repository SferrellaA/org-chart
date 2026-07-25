import type { DiffKind } from '../model/diff';
import { bundledMarker } from '../markers/catalog';
import type { LeadershipPosition, RankDisplay, RankMarker } from '../model/types';
import type { ActivationKind } from './overlay';
import type { RenderNode } from './types';

export type ComparisonSide = 'baseline' | 'proposed';

export interface TaxonomyCardData {
  id: string;
  name: string;
  tierId: string;
  internal: boolean;
  leadership?: readonly LeadershipPosition[];
  diffKind: DiffKind;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function safeDiffKind(value: unknown): DiffKind {
  return value === 'added' || value === 'removed' || value === 'modified' || value === 'unchanged'
    ? value
    : 'unchanged';
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function safeDepth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export function activationAttributes(
  kind: ActivationKind,
  id: string,
  side?: ComparisonSide,
): string {
  return `data-activate-kind="${kind}" data-activate-id="${escapeHtml(id)}"${side ? ` data-view-side="${side}"` : ''}`;
}

export function renderExpansionIcon(expanded: boolean): string {
  const modifier = expanded ? 'expanded' : 'collapsed';
  const points = expanded ? '3,5 8,10 13,5' : '5,3 10,8 5,13';
  return `<span class="org-delta-expansion-control" aria-hidden="true"><span class="org-delta-expansion-chevron org-delta-expansion-chevron--${modifier}"><svg viewBox="0 0 16 16" focusable="false"><polyline points="${points}"></polyline></svg></span></span>`;
}

function rankText(rank: RankDisplay | undefined): string {
  if (!rank) return '';
  if (rank.label) return rank.label;
  const marker = rank.marker;
  if (!marker) return '';
  if (marker.type === 'text') return marker.text;
  if (marker.type === 'emoji') return marker.label;
  if (marker.type === 'image') return marker.alt;
  return bundledMarker(marker.id)?.label ?? marker.id;
}

function renderMarker(marker: RankMarker | undefined): string {
  if (!marker) return '';
  if (marker.type === 'bundled') {
    const bundled = bundledMarker(marker.id);
    const label = escapeHtml(bundled?.label ?? marker.id);
    return `<span class="org-delta-rank-marker org-delta-rank-marker--bundled" data-marker-id="${escapeHtml(marker.id)}" role="img" aria-label="${label}">${bundled?.svg ?? ''}</span>`;
  }
  if (marker.type === 'image') {
    return `<img class="org-delta-rank-marker" src="${escapeHtml(marker.url)}" alt="${escapeHtml(marker.alt)}" loading="lazy">`;
  }
  if (marker.type === 'text') {
    return `<span class="org-delta-rank-marker org-delta-rank-marker--text">${escapeHtml(marker.text)}</span>`;
  }
  return `<span class="org-delta-rank-marker org-delta-rank-marker--emoji" role="img" aria-label="${escapeHtml(marker.label)}">${escapeHtml(marker.emoji)}</span>`;
}

function renderRank(rank: RankDisplay | undefined): string {
  if (!rank) return '';
  const label = rank.label ? `<span class="org-delta-rank-label">${escapeHtml(rank.label)}</span>` : '';
  return `${renderMarker(rank.marker)}${label}`;
}

export function renderLeadership(
  leadership: readonly LeadershipPosition[] | undefined,
): string {
  return (leadership ?? []).map((position) => {
    const primaryText = [rankText(position.authorizedRank), position.title].filter(Boolean).join(' ');
    const primary = primaryText
      ? `<span class="org-delta-leadership-primary">${renderRank(position.authorizedRank)}${position.title ? `<span class="org-delta-leadership-title">${escapeHtml(position.title)}</span>` : ''}</span>`
      : '';
    const occupantText = position.occupant
      ? [
          position.occupant.acting ? 'Acting' : undefined,
          rankText(position.occupant.rank),
          position.occupant.name,
        ].filter(Boolean).join(' ')
      : '';
    const occupant = position.occupant
      ? `<span class="org-delta-leadership-occupant">${position.occupant.acting ? '<span class="org-delta-leadership-badge">Acting</span>' : ''}${renderRank(position.occupant.rank)}<span>${escapeHtml(position.occupant.name)}</span></span>`
      : '';
    const vacant = position.vacant ? '<span class="org-delta-leadership-badge">Vacant</span>' : '';
    const label = [primaryText, occupantText, position.vacant ? 'Vacant' : undefined].filter(Boolean).join('; ');
    return `<span class="org-delta-leadership" aria-label="${escapeHtml(label)}">${primary}${occupant}${vacant}</span>`;
  }).join('');
}

interface UnitCardData {
  id: string;
  name: string;
  kind: ActivationKind;
  diffKind: DiffKind;
  side?: ComparisonSide;
  leadership?: readonly LeadershipPosition[];
  classes?: readonly string[];
  nameClass?: string;
  ariaLabel?: string;
  content?: string;
}

function renderUnitCard(data: UnitCardData): string {
  const classes = [
    'org-delta-node',
    'org-delta-unit-card',
    `org-delta-node--${data.diffKind}`,
    ...(data.classes ?? []),
  ].join(' ');
  const ariaLabel = data.ariaLabel ? ` aria-label="${escapeHtml(data.ariaLabel)}"` : '';
  return `<button type="button" class="${classes}" ${activationAttributes(data.kind, data.id, data.side)}${ariaLabel}><span class="${data.nameClass ?? 'org-delta-node-name'}">${escapeHtml(data.name)}</span>${data.content ?? ''}${renderLeadership(data.leadership)}</button>`;
}

export function renderDepthNodeContent(node: RenderNode): string {
  const nodeId = escapeHtml(node.id);
  const nodeDiffKind = safeDiffKind(node.diffKind);
  const rows = node.internalRows.map((row) => {
    const rowId = escapeHtml(row.id);
    const rowDiffKind = safeDiffKind(row.diffKind);
    const internalLabel = `${row.name}, internal unit, depth ${safeDepth(row.depth)}${row.hasSubordinateChildren ? ', contains subordinate organizations' : ''}`;
    const card = renderUnitCard({
      id: row.id,
      name: row.name,
      kind: 'internal',
      diffKind: rowDiffKind,
      ...(row.leadership ? { leadership: row.leadership } : {}),
      classes: ['org-delta-internal', `org-delta-internal--${rowDiffKind}`],
      nameClass: 'org-delta-node-name org-delta-internal-name',
      ariaLabel: internalLabel,
      content: row.hasSubordinateChildren
        ? '<span class="org-delta-subordinate-marker" aria-label="Has subordinate children"></span>'
        : '',
    });
    return card.replace('<button ', `<button data-internal-id="${rowId}" data-depth="${safeDepth(row.depth)}" `);
  }).join('');
  const internalCount = safeCount(node.hiddenInternalCount);
  const changeCount = safeCount(node.hiddenChangeCount);
  const hiddenInternal = internalCount > 0
    ? `<span class="org-delta-hidden-count" data-hidden-internal-count="${internalCount}">${internalCount} hidden</span>`
    : '';
  const hiddenChanges = changeCount > 0
    ? `<span class="org-delta-hidden-changes" data-hidden-change-count="${changeCount}">${changeCount} changed</span>`
    : '';
  const card = renderUnitCard({
    id: node.id,
    name: node.name,
    kind: 'node',
    diffKind: nodeDiffKind,
    ...(node.leadership ? { leadership: node.leadership } : {}),
    classes: node.ghost ? ['org-delta-node--ghost'] : [],
    content: `${hiddenInternal}${hiddenChanges}`,
  });
  return `<article class="org-delta-node-shell" data-node-id="${nodeId}" data-diff-kind="${nodeDiffKind}">${card}<div class="org-delta-internal-rows">${rows}</div></article>`;
}

export function renderTaxonomyCard(
  node: TaxonomyCardData,
  side: ComparisonSide,
): string {
  const kind = node.internal ? 'internal' : 'node';
  const diffKind = safeDiffKind(node.diffKind);
  const wrapperClasses = `org-delta-taxonomy-card${node.internal ? ' org-delta-taxonomy-card--internal' : ''}`;
  const card = renderUnitCard({
    id: node.id,
    name: node.name,
    kind,
    diffKind,
    side,
    ...(node.leadership ? { leadership: node.leadership } : {}),
    classes: node.internal ? ['org-delta-taxonomy-unit-card--internal'] : [],
  });
  return `<article class="${wrapperClasses}" data-node-id="${escapeHtml(node.id)}" data-tier-id="${escapeHtml(node.tierId)}" data-view-side="${side}" data-diff-kind="${diffKind}">${card}</article>`;
}
