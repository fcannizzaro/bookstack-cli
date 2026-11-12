import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Api } from '../src/api.js';
import { credentials } from '../src/config.js';

let directory: string;
let url: string;
let lastBody: unknown;
let requests: string[] = [];
const server = createServer(async (req, res) => {
  requests.push(req.url!);
  res.setHeader('Content-Type', 'application/json');
  if (req.headers.authorization !== 'Token test-id:test-secret') {
    res.writeHead(401).end(JSON.stringify({ error: { message: 'Invalid token' } }));
    return;
  }
  const target = new URL(req.url!, 'http://localhost');
  if (target.pathname.endsWith('/redirect')) {
    res.writeHead(302, { Location: '/wiki/api/books' }).end();
  } else if (target.pathname.endsWith('/export/markdown')) {
    res.setHeader('Content-Type', 'text/markdown');
    res.end('# Exported page\n');
  } else if (target.pathname.endsWith('/pages/404')) {
    res
      .writeHead(404)
      .end(JSON.stringify({ error: { message: 'Missing', secret: 'test-secret' } }));
  } else if (req.method === 'DELETE') {
    res.writeHead(204).end();
  } else if (req.method === 'POST' || req.method === 'PUT') {
    let text = '';
    for await (const chunk of req) text += chunk;
    lastBody = JSON.parse(text);
    res.end(JSON.stringify({ id: 12, ...(lastBody as object) }));
  } else {
    const start = target.pathname.endsWith('/search')
      ? (Number(target.searchParams.get('page') || 1) - 1) *
        Number(target.searchParams.get('count') || 1)
      : Number(target.searchParams.get('offset') || 0);
    const count = Number(target.searchParams.get('count') || 1);
    res.end(
      JSON.stringify({
        data: [{ id: 1 }, { id: 2 }, { id: 3 }].slice(start, start + count),
        total: 3,
      }),
    );
  }
});

function cli(
  args: string[],
  input = '',
): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'vite-plus/register', 'src/cli.ts', ...args],
      {
        env: { ...process.env, BOOKSTACK_CONFIG: join(directory, 'config.json') },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let out = '',
      err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.end(input);
  });
}
const login = (secret = 'test-secret') =>
  cli(['login', '--url', url, '--token-id', 'test-id', '--token-secret-stdin'], secret);

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/wiki`;
});
beforeEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = await mkdtemp(join(tmpdir(), 'bookstack-test-'));
  requests = [];
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(directory, { recursive: true, force: true });
});

describe('CLI against the BookStack API', () => {
  it('saves a verified login, reuses it, hides credentials, and logs out', async () => {
    const result = await login();
    expect(result.code).toBe(0);
    expect(result.out + result.err).not.toContain('test-secret');
    if (process.platform !== 'win32')
      expect((await stat(join(directory, 'config.json'))).mode & 0o777).toBe(0o600);
    expect((await cli(['books', 'list'])).code).toBe(0);
    expect(requests).toEqual(['/wiki/api/books?count=1', '/wiki/api/books']);
    expect((await cli(['status', '--check'])).out).toContain('"authenticated": true');
    expect((await cli(['logout'])).code).toBe(0);
    expect((await cli(['books', 'list'])).err).toContain('Not logged in');
  });
  it('does not overwrite a working login when verification fails', async () => {
    await login();
    const result = await login('bad');
    expect(result.code).toBe(1);
    expect(JSON.parse(result.err).error.status).toBe(401);
    expect((await cli(['status', '--check'])).code).toBe(0);
  });
  it('creates and updates pages from files and piped JSON', async () => {
    await login();
    const markdown = join(directory, 'page.md');
    await writeFile(markdown, '# Hello\n');
    expect(
      (
        await cli([
          'pages',
          'create',
          '--name',
          'Hello',
          '--book-id',
          '1',
          '--markdown-file',
          markdown,
        ])
      ).code,
    ).toBe(0);
    expect(lastBody).toEqual({ name: 'Hello', book_id: 1, markdown: '# Hello\n' });
    expect(
      (await cli(['pages', 'update', '12', '--data', '-'], '{"name":"Updated","tags":[]}')).code,
    ).toBe(0);
    expect(lastBody).toEqual({ name: 'Updated', tags: [] });
  });
  it('paginates lists by offset and searches by page', async () => {
    await login();
    const list = await cli(['pages', 'list', '--all', '-q', 'count=2', '-q', 'filter[book_id]=1']);
    expect(list.code).toBe(0);
    expect(JSON.parse(list.out).data).toHaveLength(3);
    const search = await cli(['search', 'hello & world', '--all', '--count', '2']);
    expect(search.code).toBe(0);
    expect(JSON.parse(search.out).data).toHaveLength(3);
    expect(requests.some((path) => path.includes('page=2'))).toBe(true);
    expect(requests.some((path) => path.includes('offset=2'))).toBe(true);
    expect(requests.some((path) => path.includes('hello+%26+world'))).toBe(true);
  });
  it('exports raw content and supports generic API writes', async () => {
    await login();
    const output = join(directory, 'page.md');
    expect((await cli(['pages', 'export', '12', '--output', output])).code).toBe(0);
    expect(await readFile(output, 'utf8')).toBe('# Exported page\n');
    expect((await cli(['api', 'PUT', 'pages/12/move', '--data', '{"chapter_id":2}'])).code).toBe(0);
    expect(lastBody).toEqual({ chapter_id: 2 });
  });
  it('requires deletion confirmation and returns structured redacted errors', async () => {
    await login();
    expect((await cli(['pages', 'delete', '12'])).code).toBe(1);
    expect((await cli(['pages', 'delete', '12', '--yes'])).code).toBe(0);
    const result = await cli(['pages', 'get', '404']);
    expect(result.code).toBe(1);
    expect(result.out).toBe('');
    expect(JSON.parse(result.err).error.status).toBe(404);
    expect(result.err).not.toContain('test-secret');
  });
  it('rejects invalid JSON, IDs, unknown flags, and missing noninteractive credentials', async () => {
    await login();
    for (const args of [
      ['pages', 'create', '-d', 'invalid'],
      ['pages', 'get', '../books'],
      ['--unknown'],
      ['login'],
    ]) {
      const result = await cli(args);
      expect(result.code).toBe(1);
      expect(JSON.parse(result.err).error.message).toBeTruthy();
    }
  });
  it('refuses redirects rather than forwarding credentials', async () => {
    await login();
    requests = [];
    const result = await cli(['api', 'GET', 'redirect']);
    expect(result.code).toBe(1);
    expect(result.err).toContain('redirects are refused');
    expect(requests).toEqual(['/wiki/api/redirect']);
  });
  it('refuses paths outside the API without sending credentials', async () => {
    const api = new Api(credentials({ url, tokenId: 'test-id', tokenSecret: 'test-secret' }));
    for (const path of [
      'https://example.org/api/books',
      '../login',
      '/../../login',
      '//example.org/api/books',
    ]) {
      await expect(api.request('GET', path)).rejects.toThrow('API path');
    }
    expect(requests).toEqual([]);
  });
});
