import type { ResolvedNode, ResolvedParent, Source } from '../model/types';

export interface NodeTooltipContent {
  node: ResolvedNode;
  parent?: ResolvedNode;
  assignment?: ResolvedParent;
}

function sourceSummary(sources: readonly Source[] | undefined): string | undefined {
  if (!sources?.length) return undefined;
  return `Sources: ${sources.map(({ label }) => label).join('; ')}`;
}

function appendLine(container: HTMLElement, text: string | undefined, className: string): void {
  if (!text) return;
  const line = document.createElement('p');
  line.className = className;
  line.textContent = text;
  container.append(line);
}

export function showNodeTooltip(
  tooltip: HTMLElement,
  trigger: HTMLElement,
  content: NodeTooltipContent,
): void {
  tooltip.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = content.node.name;
  tooltip.append(title);
  appendLine(tooltip, content.node.note, 'org-delta-tooltip__note');
  appendLine(tooltip, sourceSummary(content.node.sources), 'org-delta-tooltip__sources');
  if (content.parent) {
    appendLine(tooltip, `Reports to ${content.parent.name}`, 'org-delta-tooltip__assignment');
    appendLine(tooltip, content.assignment?.note, 'org-delta-tooltip__note');
    appendLine(
      tooltip,
      sourceSummary(content.assignment?.sources),
      'org-delta-tooltip__sources',
    );
  }
  const describedBy = new Set((trigger.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
  describedBy.add(tooltip.id);
  trigger.setAttribute('aria-describedby', [...describedBy].join(' '));
  tooltip.hidden = false;

  const triggerRect = trigger.getBoundingClientRect();
  const workspaceRect = tooltip.parentElement!.getBoundingClientRect();
  tooltip.style.left = `${triggerRect.left - workspaceRect.left + triggerRect.width / 2}px`;
  tooltip.style.top = `${triggerRect.bottom - workspaceRect.top + 8}px`;
}

export function hideNodeTooltip(tooltip: HTMLElement, trigger: HTMLElement | undefined): void {
  if (trigger) {
    const describedBy = (trigger.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter((id) => id && id !== tooltip.id);
    if (describedBy.length) trigger.setAttribute('aria-describedby', describedBy.join(' '));
    else trigger.removeAttribute('aria-describedby');
  }
  tooltip.hidden = true;
  tooltip.replaceChildren();
}
