export interface ComponentTemplate {
  shell: HTMLElement;
  workspace: HTMLElement;
  controlsSidebar: HTMLElement;
  controlsToggle: HTMLButtonElement;
  controlsBackdrop: HTMLButtonElement;
  title: HTMLHeadingElement;
  toolbar: HTMLElement;
  selectionStatus: HTMLElement;
  status: HTMLElement;
  canvas: HTMLElement;
  tooltip: HTMLElement;
  details: HTMLElement;
}

export function createTemplate(root: ShadowRoot): ComponentTemplate {
  const shell = document.createElement('section');
  shell.className = 'chart-shell';
  shell.setAttribute('aria-label', 'Organization chart');

  const mobileBar = document.createElement('div');
  mobileBar.className = 'mobile-controls-bar';
  const controlsToggle = document.createElement('button');
  controlsToggle.type = 'button';
  controlsToggle.dataset.controlsToggle = '';
  controlsToggle.setAttribute('aria-controls', 'org-delta-controls');
  controlsToggle.setAttribute('aria-expanded', 'false');
  controlsToggle.textContent = 'Controls';
  mobileBar.append(controlsToggle);

  const controlsSidebar = document.createElement('aside');
  controlsSidebar.id = 'org-delta-controls';
  controlsSidebar.className = 'controls-sidebar';
  controlsSidebar.setAttribute('aria-label', 'Chart controls');
  controlsSidebar.tabIndex = -1;
  const title = document.createElement('h1');
  title.textContent = 'Organization chart';
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.setAttribute('aria-label', 'Chart controls');
  const selectionStatus = document.createElement('div');
  selectionStatus.className = 'selection-status-host';
  controlsSidebar.append(title, selectionStatus, toolbar);

  const status = document.createElement('div');
  status.className = 'status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  controlsSidebar.append(status);

  const workspace = document.createElement('div');
  workspace.className = 'workspace';
  const canvas = document.createElement('div');
  canvas.className = 'canvas';
  const tooltip = document.createElement('div');
  tooltip.id = 'org-delta-node-tooltip';
  tooltip.className = 'org-delta-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  const details = document.createElement('aside');
  details.className = 'details';
  details.setAttribute('aria-label', 'Details');
  details.hidden = true;
  const controlsBackdrop = document.createElement('button');
  controlsBackdrop.type = 'button';
  controlsBackdrop.className = 'controls-backdrop';
  controlsBackdrop.dataset.controlsBackdrop = '';
  controlsBackdrop.setAttribute('aria-label', 'Close controls');
  controlsBackdrop.hidden = true;
  workspace.append(controlsSidebar, canvas, tooltip, controlsBackdrop, details);
  shell.append(mobileBar, workspace);
  root.append(shell);
  return {
    shell,
    workspace,
    controlsSidebar,
    controlsToggle,
    controlsBackdrop,
    title,
    toolbar,
    selectionStatus,
    status,
    canvas,
    tooltip,
    details,
  };
}
