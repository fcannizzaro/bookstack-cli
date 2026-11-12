import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Credentials {
  url: string;
  tokenId: string;
  tokenSecret: string;
}

export function configPath(): string {
  if (process.env.BOOKSTACK_CONFIG) return process.env.BOOKSTACK_CONFIG;
  const root =
    process.env.XDG_CONFIG_HOME ||
    (process.platform === 'win32' ? process.env.APPDATA : undefined) ||
    join(homedir(), '.config');
  return join(root, 'bookstack-cli', 'config.json');
}

export function credentials(value: unknown): Credentials {
  const c = value as Partial<Credentials> | null;
  if (
    !c ||
    typeof c.url !== 'string' ||
    typeof c.tokenId !== 'string' ||
    typeof c.tokenSecret !== 'string' ||
    !c.tokenId.trim() ||
    !c.tokenSecret.trim()
  ) {
    throw new Error('URL, token ID, and token secret are required. Run bookstack login.');
  }
  if (/[:\s]/.test(c.tokenId) || /[\r\n]/.test(c.tokenSecret)) {
    throw new Error('Invalid token ID or token secret.');
  }
  return { url: instanceUrl(c.url), tokenId: c.tokenId.trim(), tokenSecret: c.tokenSecret.trim() };
}

export async function loadConfig(): Promise<Credentials> {
  try {
    return credentials(JSON.parse(await readFile(configPath(), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Not logged in. Run bookstack login.');
    }
    throw new Error('Cannot read saved credentials. Run bookstack login to configure again.');
  }
}

export async function saveConfig(config: Credentials): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function logout(): Promise<void> {
  await rm(configPath(), { force: true });
}

export function instanceUrl(value: string): string {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Use an HTTP(S) instance URL without credentials, query, or fragment.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/api$/, '') + '/';
  return url.href;
}
