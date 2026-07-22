const VIEWER_PARAMETERS = [
  'initial-view',
  'compare-to',
  'show-internal',
  'show-relationships',
] as const;

function parameters(search: string | URLSearchParams): URLSearchParams {
  return typeof search === 'string' ? new URLSearchParams(search) : search;
}

function singleValue(query: URLSearchParams, name: string): string | undefined {
  const values = query.getAll(name);
  if (values.length === 0) return undefined;
  if (values.length !== 1 || values[0] === '') {
    throw new Error(`Viewer query parameter "${name}" must have one non-empty value.`);
  }
  return values[0];
}

export function readViewerSource(search: string | URLSearchParams): string {
  const source = singleValue(parameters(search), 'src');
  if (!source) throw new Error('Viewer query parameter "src" is required.');
  if (source.trim() !== source || /[\\\u0000-\u001f\u007f]/u.test(source)) {
    throw new Error('Viewer query parameter "src" contains unsafe characters.');
  }
  if (source.startsWith('//')) {
    throw new Error('Viewer query parameter "src" must not be protocol-relative.');
  }
  if (source.startsWith('/') || source.startsWith('./') || source.startsWith('../')) {
    return source;
  }
  if (/^https?:\/\//iu.test(source)) {
    const url = new URL(source);
    if (url.protocol === 'http:' || url.protocol === 'https:') return source;
  }
  throw new Error('Viewer query parameter "src" must be a relative, HTTP, or HTTPS URL.');
}

function validatedParameter(name: string, value: string): string {
  if (name === 'show-internal' || name === 'show-relationships') {
    if (!/^(?:true|false|1|0|yes|no)$/iu.test(value)) {
      throw new Error(`Viewer query parameter "${name}" must be a boolean value.`);
    }
  } else if (!/^[a-z0-9._:-]+$/iu.test(value)) {
    throw new Error(`Viewer query parameter "${name}" contains invalid characters.`);
  }
  return value;
}

export function applyViewerQuery(
  search: string | URLSearchParams,
  chart: Element,
): void {
  const query = parameters(search);
  const attributes = new Map<string, string>([['src', readViewerSource(query)]]);
  for (const name of VIEWER_PARAMETERS) {
    const value = singleValue(query, name);
    if (value !== undefined) attributes.set(name, validatedParameter(name, value));
  }
  for (const [name, value] of attributes) chart.setAttribute(name, value);
}

export async function startViewer(
  search = window.location.search,
  chart = document.querySelector('org-delta-chart'),
  register: () => Promise<unknown> = () => import('./index'),
): Promise<void> {
  if (chart) {
    try {
      applyViewerQuery(search, chart);
    } catch (error) {
      const message = document.createElement('p');
      message.setAttribute('role', 'alert');
      message.textContent = error instanceof Error ? error.message : 'Unable to start viewer.';
      chart.replaceWith(message);
    }
  }
  await register();
}

void startViewer();
