export interface BundledMarker {
  id: string;
  label: string;
  svg: string;
}

const grades = [
  ['usaf-e1', 'Airman Basic'],
  ['usaf-e2', 'Airman'],
  ['usaf-e3', 'Airman First Class'],
  ['usaf-e4', 'Senior Airman'],
  ['usaf-e5', 'Staff Sergeant'],
  ['usaf-e6', 'Technical Sergeant'],
  ['usaf-e7', 'Master Sergeant'],
  ['usaf-e8', 'Senior Master Sergeant'],
  ['usaf-e9', 'Chief Master Sergeant'],
  ['usaf-o1', 'Second Lieutenant'],
  ['usaf-o2', 'First Lieutenant'],
  ['usaf-o3', 'Captain'],
  ['usaf-o4', 'Major'],
  ['usaf-o5', 'Lieutenant Colonel'],
  ['usaf-o6', 'Colonel'],
  ['usaf-o7', 'Brigadier General'],
  ['usaf-o8', 'Major General'],
  ['usaf-o9', 'Lieutenant General'],
  ['usaf-o10', 'General'],
] as const;

function placeholderSvg(label: string): string {
  return `<svg viewBox="0 0 24 24" role="img" aria-label="${label}"><rect x="2" y="2" width="20" height="20" rx="3" fill="currentColor" opacity="0.12"/><path d="M4 12h16M12 4v16" stroke="currentColor" stroke-width="2"/></svg>`;
}

export const bundledMarkers: readonly BundledMarker[] = grades.map(([id, label]) => ({
  id,
  label,
  svg: placeholderSvg(label),
}));

export const bundledMarkerIds = new Set(bundledMarkers.map((marker) => marker.id));

export function bundledMarker(id: string): BundledMarker | undefined {
  return bundledMarkers.find((marker) => marker.id === id);
}
