export const componentStyles = `
  :host { display: block; height: min(75vh, 720px); min-height: 420px; color: #172033; font: 14px/1.45 system-ui, sans-serif; }
  *, *::before, *::after { box-sizing: border-box; }
  .chart-shell { display: grid; grid-template-rows: auto auto minmax(0, 1fr); height: 100%; border: 1px solid #c6ccda; border-radius: 10px; overflow: hidden; background: #fff; }
  header { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 16px; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #dce0e9; }
  h1, h2 { margin: 0; line-height: 1.2; }
  h1 { font-size: 1.15rem; }
  h2 { font-size: 1.1rem; }
  .toolbar { display: flex; flex: 1 1 100%; align-items: end; flex-wrap: wrap; gap: 10px 14px; max-height: min(38vh, 320px); overflow: auto; }
  .view-control, .exploration-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; }
  .selection-status { margin: 0; font-weight: 650; }
  .selection-status-host { color: #475569; }
  fieldset { min-width: min(100%, 320px); margin: 0; padding: 6px 10px 8px; border: 1px solid #c6ccda; }
  .patch-group { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; }
  .patch-group__reason { flex-basis: 100%; color: #6b4f00; font-size: .9em; }
  .control-check { display: inline-flex; align-items: center; gap: 5px; }
  .search-results { display: flex; flex-wrap: wrap; gap: 4px; flex-basis: 100%; margin: 0; padding: 4px; list-style: none; border: 1px solid #c6ccda; background: #fff; }
  .view-control__invalid { text-decoration: underline wavy #b42318; }
  button, select, input { min-width: 44px; min-height: 44px; font: inherit; }
  :focus-visible { outline: 3px solid #155eef; outline-offset: 2px; }
  .status { min-height: 24px; padding: 3px 14px; color: #4b5565; }
  .workspace { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 28%); min-height: 0; }
  .canvas { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: #f7f8fb; }
  .details { overflow: auto; padding: 16px; border-left: 1px solid #dce0e9; background: #fff; }
  .details[hidden] { display: none; }
  .details__header { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
  .details__kind { color: #5d6678; font-weight: 700; }
  .details__note { white-space: pre-wrap; overflow-wrap: anywhere; }
  .details ul { padding-left: 20px; }
  .details a { overflow-wrap: anywhere; }
  .org-delta-renderer-root, .org-delta-overlay { position: relative; width: 100%; height: 100%; }
  .org-delta-minimap { color: #334155; border: 1px solid currentColor; background: rgba(255,255,255,.9); }
  .org-delta-node { border: 2px solid #64748b; border-radius: 8px; background: #fff; }
  .org-delta-node--added, .org-delta-internal--added { border-left: 8px solid #18794e; background-image: repeating-linear-gradient(135deg, transparent 0 7px, rgba(24,121,78,.12) 7px 10px); }
  .org-delta-node--removed, .org-delta-internal--removed { border-left: 8px double #b42318; text-decoration: line-through; }
  .org-delta-node--modified, .org-delta-internal--modified { border-left: 8px dashed #9a6700; background-image: repeating-linear-gradient(45deg, transparent 0 9px, rgba(154,103,0,.1) 9px 12px); }
  .org-delta-change { border-style: solid; font-weight: 700; text-transform: capitalize; }
  @media (max-width: 640px) {
    :host { min-height: 520px; }
    .workspace { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; }
    .details { max-height: 45vh; border-left: 0; border-top: 1px solid #dce0e9; box-shadow: 0 -8px 24px rgba(15,23,42,.12); }
    header { align-items: stretch; }
    .toolbar, .view-control, .exploration-controls { align-items: stretch; }
    .toolbar > *, .exploration-controls label { flex: 1 1 100%; }
    .toolbar button, .toolbar select, .toolbar input[type='search'] { max-width: 100%; }
  }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; } }
  @media (forced-colors: active) {
    .chart-shell, header, .details, .org-delta-node, .org-delta-minimap { border-color: CanvasText; }
    .org-delta-node--added, .org-delta-node--removed, .org-delta-node--modified { border-left-color: Highlight; }
  }
`;

export function installStyles(root: ShadowRoot): void {
  const style = document.createElement('style');
  style.textContent = componentStyles;
  root.append(style);
}
