import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

const mocks = vi.hoisted(() => ({
  input: vi.fn(),
  password: vi.fn(),
  open: vi.fn(),
  request: vi.fn(),
  save: vi.fn(),
}));
vi.mock('@inquirer/prompts', () => ({ input: mocks.input, password: mocks.password }));
vi.mock('open', () => ({ default: mocks.open }));
vi.mock('../src/api.js', () => ({
  Api: class {
    request = mocks.request;
  },
  ApiError: class extends Error {},
}));
vi.mock('../src/config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/config.js')>()),
  saveConfig: mocks.save,
}));

const originalArgv = process.argv;
const originalTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  mocks.password.mockResolvedValue('test-secret');
});
afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  if (originalTty) Object.defineProperty(process.stdin, 'isTTY', originalTty);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  vi.restoreAllMocks();
});

it('opens the account auth page before asking for the token ID, preserving the instance path', async () => {
  process.argv = ['node', 'bookstack', 'login'];
  mocks.input
    .mockResolvedValueOnce('https://wiki.example.com/wiki/api/')
    .mockResolvedValueOnce('test-id');
  await import('../src/cli.js');
  expect(mocks.open).toHaveBeenCalledWith('https://wiki.example.com/wiki/my-account/auth');
  expect(mocks.open.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.input.mock.invocationCallOrder[1],
  );
  expect(mocks.save).toHaveBeenCalledWith({
    url: 'https://wiki.example.com/wiki/',
    tokenId: 'test-id',
    tokenSecret: 'test-secret',
  });
});

it('continues prompting and prints a manual link if opening the browser fails', async () => {
  process.argv = ['node', 'bookstack', 'login', '--url', 'https://wiki.example.com'];
  mocks.open.mockRejectedValue(new Error('No browser available'));
  mocks.input.mockResolvedValue('test-id');
  await import('../src/cli.js');
  expect(process.stderr.write).toHaveBeenCalledWith(
    expect.stringContaining('https://wiki.example.com/my-account/auth'),
  );
  expect(process.stderr.write).toHaveBeenCalledWith(
    expect.stringContaining('Could not open your browser'),
  );
  expect(mocks.save).toHaveBeenCalledOnce();
});

it('skips the browser when the token ID was supplied', async () => {
  process.argv = [
    'node',
    'bookstack',
    'login',
    '--url',
    'https://wiki.example.com',
    '--token-id',
    'test-id',
  ];
  await import('../src/cli.js');
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.input).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledOnce();
});

it('rejects invalid instance URLs before opening the browser or asking for a token', async () => {
  process.argv = ['node', 'bookstack', 'login', '--url', 'file:///tmp/wiki'];
  await import('../src/cli.js');
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.input).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});
