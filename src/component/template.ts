export interface ComponentTemplate {
  shell: HTMLElement;
  title: HTMLHeadingElement;
  toolbar: HTMLElement;
  selectionStatus: HTMLElement;
  status: HTMLElement;
  canvas: HTMLElement;
  details: HTMLElement;
}

export function createTemplate(root: ShadowRoot): ComponentTemplate {
  const shell = document.createElement('section');
  shell.className = 'chart-shell';
  shell.setAttribute('aria-label', 'Organization chart');

  const header = document.createElement('header');
  const title = document.createElement('h1');
  title.textContent = 'Organization chart';
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.setAttribute('aria-label', 'Chart controls');
  const selectionStatus = document.createElement('div');
  selectionStatus.className = 'selection-status-host';
  header.append(title, selectionStatus, toolbar);

  const status = document.createElement('div');
  status.className = 'status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const workspace = document.createElement('div');
  workspace.className = 'workspace';
  const canvas = document.createElement('div');
  canvas.className = 'canvas';
  canvas.tabIndex = 0;
  const details = document.createElement('aside');
  details.className = 'details';
  details.setAttribute('aria-label', 'Details');
  details.hidden = true;
  workspace.append(canvas, details);
  shell.append(header, status, workspace);
  root.append(shell);
  return { shell, title, toolbar, selectionStatus, status, canvas, details };
}
