import type { Credentials } from './config.js';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

export class Api {
  constructor(private config: Credentials) {}

  async request(
    method: string,
    path: string,
    query: string[] = [],
    data?: unknown,
    binary = false,
  ): Promise<unknown> {
    const base = new URL('api/', this.config.url);
    const relative = path.replace(/^\/?api\//, '').replace(/^\//, '');
    const url = new URL(relative, base);
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(base.pathname) ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new Error('API path must stay within the configured instance /api/ directory.');
    }
    for (const pair of query) {
      const index = pair.indexOf('=');
      if (index < 1) throw new Error('Query parameters must use key=value.');
      url.searchParams.set(pair.slice(0, index), pair.slice(index + 1));
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Token ${this.config.tokenId}:${this.config.tokenSecret}`,
          Accept: binary ? '*/*' : 'application/json',
          ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
    } catch {
      throw new Error(
        'Request failed. Check the instance URL, network, and TLS certificate. Requests time out after 30 seconds; redirects are refused.',
      );
    }
    if (response.ok && binary) return Buffer.from(await response.arrayBuffer());
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      // Only return structured API errors; HTML proxy/login responses can contain private data.
      const safe =
        body === null
          ? undefined
          : JSON.parse(
              JSON.stringify(body, (_key, value) =>
                typeof value === 'string'
                  ? value
                      .replaceAll(this.config.tokenSecret, '[REDACTED]')
                      .replaceAll(this.config.tokenId, '[REDACTED]')
                  : value,
              ),
            );
      throw new ApiError(`BookStack returned HTTP ${response.status}.`, response.status, safe);
    }
    if (text && body === null)
      throw new Error('Expected JSON from BookStack. Check the instance URL.');
    return body;
  }

  async list(path: string, query: string[], all: boolean, search = false): Promise<unknown> {
    if (!all) return this.request('GET', path, query);
    const params = new URLSearchParams();
    for (const pair of query) {
      const i = pair.indexOf('=');
      if (i < 1) throw new Error('Query parameters must use key=value.');
      params.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const count = Number(params.get('count') ?? (search ? 100 : 500));
    let position = Number(params.get(search ? 'page' : 'offset') ?? (search ? 1 : 0));
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > (search ? 100 : 500) ||
      !Number.isInteger(position) ||
      position < (search ? 1 : 0)
    ) {
      throw new Error('Invalid pagination parameters.');
    }
    const data: unknown[] = [];
    let total = 0;
    while (true) {
      params.set('count', String(count));
      params.set(search ? 'page' : 'offset', String(position));
      const result = (await this.request(
        'GET',
        path,
        [...params].map(([k, v]) => `${k}=${v}`),
      )) as { data: unknown[]; total: number };
      if (!Array.isArray(result?.data) || !Number.isFinite(result.total)) {
        throw new Error('Expected a paginated BookStack response.');
      }
      total = result.total;
      data.push(...result.data);
      position += search ? 1 : result.data.length;
      const consumed = search ? (position - 1) * count : position;
      if (result.data.length === 0 || consumed >= total) break;
    }
    return { data, total };
  }
}
