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
  .org-delta-visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  .org-delta-tree-navigation { position: absolute; z-index: 10; top: 8px; left: 8px; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .org-delta-tree-navigation:focus-within { width: min(360px, calc(100% - 16px)); height: auto; max-height: calc(100% - 16px); padding: 8px; overflow: auto; clip: auto; white-space: normal; border: 2px solid currentColor; background: Canvas; }
  .org-delta-tree-navigation [role='treeitem'] { display: block; min-height: 44px; padding: 10px 12px; border: 1px solid currentColor; background: Canvas; color: CanvasText; }
  .org-delta-minimap { color: #334155; border: 1px solid currentColor; background: rgba(255,255,255,.9); }
  .org-delta-node { border: 2px solid #64748b; border-radius: 8px; background: #fff; }
  .org-delta-leadership { display: grid; gap: 2px; margin: 6px 8px; padding: 6px; border-radius: 6px; background: rgba(15,23,42,.04); }
  .org-delta-leadership-primary, .org-delta-leadership-occupant { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .org-delta-leadership-title, .org-delta-leadership-occupant span:last-child { overflow-wrap: anywhere; }
  .org-delta-rank-marker { display: inline-grid; place-items: center; flex: 0 0 24px; width: 24px; height: 24px; object-fit: contain; border: 1px solid currentColor; border-radius: 4px; color: #334155; font-size: .78rem; line-height: 1; }
  .org-delta-rank-marker svg { width: 100%; height: 100%; }
  .org-delta-rank-label { font-weight: 700; white-space: nowrap; }
  .org-delta-leadership-badge { display: inline-block; padding: 1px 5px; border: 1px solid currentColor; border-radius: 999px; font-size: .78rem; font-weight: 700; }
  .org-delta-node--added, .org-delta-internal--added { border-left: 8px solid #18794e; background-image: repeating-linear-gradient(135deg, transparent 0 7px, rgba(24,121,78,.12) 7px 10px); }
  .org-delta-node--removed, .org-delta-internal--removed { border-left: 8px double #b42318; text-decoration: line-through; }
  .org-delta-node--modified, .org-delta-internal--modified { border-left: 8px dashed #9a6700; background-image: repeating-linear-gradient(45deg, transparent 0 9px, rgba(154,103,0,.1) 9px 12px); }
  .org-delta-change { border-style: solid; font-weight: 700; text-transform: capitalize; }
  .org-delta-taxonomy-renderer { position: relative; width: 100%; height: 100%; overflow: hidden; touch-action: none; }
  .org-delta-taxonomy-world { display: grid; position: absolute; top: 0; left: 0; min-width: 100%; width: max-content; transform-origin: 0 0; }
  .org-delta-taxonomy-world[data-taxonomy-comparison='true'] { grid-template-columns: max-content minmax(320px, max-content) 120px minmax(320px, max-content) max-content; min-width: 1500px; }
  .org-delta-taxonomy-world[data-taxonomy-comparison='false'] { grid-template-columns: 120px minmax(420px, max-content) max-content; min-width: 780px; }
  .org-delta-taxonomy-header { display: flex; grid-column: 1 / -1; justify-content: space-around; gap: 120px; padding: 8px 180px; background: #e9edf5; border-bottom: 2px solid #94a3b8; }
  .org-delta-taxonomy-side-heading { min-width: 320px; text-align: center; }
  .org-delta-taxonomy-tier { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; position: relative; align-items: start; gap: 18px; min-height: 150px; padding: 24px 18px; border-bottom: 1px solid #cbd5e1; }
  [data-taxonomy-comparison='true'] .org-delta-taxonomy-tier { min-width: 1500px; }
  [data-taxonomy-comparison='false'] .org-delta-taxonomy-tier { min-width: 780px; }
  .org-delta-taxonomy-tier--added { background: rgba(24,121,78,.06); }
  .org-delta-taxonomy-tier--removed { background: rgba(180,35,24,.06); }
  .org-delta-taxonomy-tier-label { position: sticky; top: 4px; z-index: 2; margin: 0; padding: 4px; text-align: center; font-size: .86rem; color: #475569; background: rgba(247,248,251,.9); }
  .org-delta-taxonomy-systems { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(140px, max-content); gap: 8px; }
  .org-delta-taxonomy-system { display: grid; align-content: start; gap: 4px; min-height: 72px; padding: 8px; border: 1px solid #94a3b8; border-radius: 6px; background: #f8fafc; }
  .org-delta-taxonomy-system span { color: #475569; }
  .org-delta-taxonomy-node-lane { display: flex; position: relative; z-index: 1; align-items: flex-start; gap: 18px; min-height: 96px; }
  .org-delta-taxonomy-card { position: relative; flex: 0 0 260px; width: 260px; padding: 8px; box-shadow: 0 3px 12px rgba(15,23,42,.12); }
  .org-delta-taxonomy-card--internal { flex-basis: 210px; width: 210px; border-width: 1px; background: #f1f5f9; color: #475569; box-shadow: none; }
  .org-delta-taxonomy-card--revealed { outline: 4px solid #155eef; outline-offset: 4px; }
  .org-delta-taxonomy-toggle { position: absolute; right: 4px; bottom: 4px; min-width: 32px; min-height: 32px; }
  .org-delta-taxonomy-gutter { position: relative; z-index: 1; min-height: 72px; }
  .org-delta-taxonomy-connectors { position: absolute; z-index: 0; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
  .org-delta-taxonomy-connectors path { fill: none; stroke: #64748b; stroke-width: 2; pointer-events: stroke; }
  .org-delta-taxonomy-connectors [data-taxonomy-relationship] { stroke: #7c3aed; stroke-dasharray: 6 4; }
  .org-delta-taxonomy-connectors [data-taxonomy-movement] { stroke: #9a6700; stroke-width: 3; stroke-dasharray: 8 5; }
  .org-delta-taxonomy-movement { display: block; width: 100%; border-top: 2px dashed #9a6700; }
  @media (max-width: 640px) {
    :host { min-height: 520px; }
    .workspace { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; }
    .details { max-height: 45vh; border-left: 0; border-top: 1px solid #dce0e9; box-shadow: 0 -8px 24px rgba(15,23,42,.12); }
    header { align-items: stretch; }
    .toolbar, .view-control, .exploration-controls { align-items: stretch; }
    .toolbar > *, .exploration-controls label { flex: 1 1 100%; }
    .toolbar button, .toolbar select, .toolbar input[type='search'] { max-width: 100%; }
  }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0s !important; animation-duration: 0s !important; } }
  @media (forced-colors: active) {
    :host { --org-delta-forced-colors: active; }
    .chart-shell, header, .details, .org-delta-node, .org-delta-minimap, .org-delta-taxonomy-system { border-color: CanvasText; color: CanvasText; }
    .org-delta-node { background: Canvas; forced-color-adjust: auto; }
    .org-delta-node--added { border-left: 8px solid Highlight; }
    .org-delta-node--removed { border-left: 8px double Highlight; }
    .org-delta-node--modified { border-left: 8px dashed Highlight; }
    .org-delta-connector--hierarchy, .org-delta-connector--relationship, path.link, .org-delta-taxonomy-connectors path { color: CanvasText; stroke: currentColor; forced-color-adjust: auto; }
  }
`;

export function installStyles(root: ShadowRoot): void {
  const style = document.createElement('style');
  style.textContent = componentStyles;
  root.append(style);
}
