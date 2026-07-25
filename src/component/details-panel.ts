import type { DetailsItem } from '../presentation/notes';

interface PanelState {
  trigger: HTMLElement | SVGElement;
  closeButton: HTMLButtonElement;
  clickHandler: (event: MouseEvent) => void;
  keyHandler: (event: KeyboardEvent) => void;
}

const states = new WeakMap<HTMLElement, PanelState>();

function safeHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

export function closeDetailsPanel(container: HTMLElement, restoreFocus = true): void {
  const state = states.get(container);
  if (state) {
    state.closeButton.removeEventListener('click', state.clickHandler);
    container.removeEventListener('keydown', state.keyHandler);
    states.delete(container);
  }
  container.replaceChildren();
  container.hidden = true;
  container.parentElement?.classList.remove('workspace--details-open');
  if (restoreFocus && state?.trigger.isConnected && typeof state.trigger.focus === 'function') {
    state.trigger.focus();
  }
}

export function renderDetailsPanel(
  container: HTMLElement,
  item: DetailsItem,
  trigger: HTMLElement | SVGElement,
  onClose?: () => void,
  focusHeading = true,
): void {
  closeDetailsPanel(container, false);
  const header = document.createElement('div');
  header.className = 'details__header';
  const title = document.createElement('h2');
  title.tabIndex = -1;
  title.textContent = item.title;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.setAttribute('aria-label', 'Close details');
  header.append(title, close);
  const kind = document.createElement('p');
  kind.className = 'details__kind';
  kind.textContent = item.kindLabel;
  container.append(header, kind);
  if (item.note !== undefined) {
    const note = document.createElement('p');
    note.className = 'details__note';
    note.textContent = item.note;
    container.append(note);
  }
  if (item.leadership && item.leadership.length > 0) {
    const heading = document.createElement('h3');
    heading.textContent = 'Leadership';
    const list = document.createElement('ul');
    for (const entry of item.leadership) {
      const row = document.createElement('li');
      row.textContent = entry;
      list.append(row);
    }
    container.append(heading, list);
  }
  if (item.change) {
    const heading = document.createElement('h3');
    heading.textContent = 'Changes';
    const summary = document.createElement('p');
    const fields = item.change.fields.length ? `: ${item.change.fields.join(', ')}` : '';
    summary.textContent = `${item.change.kind}${fields}`;
    container.append(heading, summary);
  }
  const sources = item.sources.flatMap((source) => {
    const url = safeHttpUrl(source.url);
    return url ? [{ ...source, url }] : [];
  });
  if (sources.length > 0) {
    const heading = document.createElement('h3');
    heading.textContent = 'Sources';
    const list = document.createElement('ul');
    for (const source of sources) {
      const row = document.createElement('li');
      const link = document.createElement('a');
      link.textContent = source.label;
      link.href = source.url.href;
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      row.append(link);
      list.append(row);
    }
    container.append(heading, list);
  }
  const closePanel = (): void => {
    closeDetailsPanel(container);
    onClose?.();
  };
  const clickHandler = (): void => closePanel();
  const keyHandler = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') closePanel();
  };
  close.addEventListener('click', clickHandler);
  container.addEventListener('keydown', keyHandler);
  states.set(container, { trigger, closeButton: close, clickHandler, keyHandler });
  container.hidden = false;
  container.parentElement?.classList.add('workspace--details-open');
  if (focusHeading) title.focus();
}
