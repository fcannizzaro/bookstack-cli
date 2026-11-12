#!/usr/bin/env node
import { Command, CommanderError, Option } from 'commander';
import { input, password } from '@inquirer/prompts';
import open from 'open';
import { readFile, writeFile } from 'node:fs/promises';
import { Api, ApiError } from './api.js';
import { configPath, credentials, instanceUrl, loadConfig, logout, saveConfig } from './config.js';
import metadata from '../package.json' with { type: 'json' };

const print = (value: unknown): void => {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
};
const collect = (value: string, previous: string[]) => [...previous, value];
const client = async () => new Api(await loadConfig());

async function stdin(): Promise<string> {
  if (process.stdin.isTTY) throw new Error('Expected piped input on stdin.');
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function body(
  source: string | undefined,
  options: Record<string, string>,
): Promise<Record<string, unknown>> {
  let result: Record<string, unknown> = {};
  if (source !== undefined) {
    const text =
      source === '-'
        ? await stdin()
        : source.startsWith('@')
          ? await readFile(source.slice(1), 'utf8')
          : source;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error('Data must be valid JSON, @file.json, or - for stdin.');
    }
    if (!result || Array.isArray(result) || typeof result !== 'object')
      throw new Error('Data must be a JSON object.');
  }
  for (const key of ['name', 'description', 'bookId', 'chapterId']) {
    if (options[key] !== undefined) {
      const numeric = key.endsWith('Id');
      if (numeric && !/^[1-9]\d*$/.test(options[key]))
        throw new Error(`${key} must be a positive integer.`);
      result[key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())] = numeric
        ? Number(options[key])
        : options[key];
    }
  }
  if (options.markdownFile && options.htmlFile)
    throw new Error('Choose either --markdown-file or --html-file.');
  for (const format of ['markdown', 'html']) {
    if (options[`${format}File`]) result[format] = await readFile(options[`${format}File`], 'utf8');
  }
  if (Object.keys(result).length === 0) throw new Error('Provide --data or content flags.');
  return result;
}

const program = new Command()
  .name('bookstack')
  .description('BookStack API CLI. Login once, then use JSON commands from any directory.')
  .version(metadata.version)
  .showHelpAfterError()
  .exitOverride()
  .configureOutput({ writeErr: () => {} })
  .addHelpText(
    'after',
    `
Examples:
  bookstack login --url https://wiki.example.com
  bookstack shelves list --all
  bookstack shelves get 14
  bookstack shelves get 14 | jq '.books[] | {id, name}'
  bookstack books list --all
  bookstack search 'deployment' --all
  bookstack pages get 42
  bookstack pages create --book-id 1 --name 'Deploy' --markdown-file ./deploy.md

Shelf details include the books assigned to that shelf. jq examples require jq.
Use bookstack <command> --help for command-specific options and examples.`,
  );

program
  .command('login')
  .description('Validate and save an API token on this machine')
  .option('--url <url>', 'Instance URL, including any subdirectory')
  .option('--token-id <id>', 'API token ID')
  .option('--token-secret-stdin', 'Read the token secret from stdin instead of prompting')
  .addHelpText(
    'after',
    `
Examples:
  bookstack login
  bookstack login --url https://wiki.example.com
  bookstack login --url https://wiki.example.com --token-id YOUR_TOKEN_ID --token-secret-stdin < /secure/token-secret

Login opens the API token settings page before asking for the token ID.
Credentials are saved on this machine for subsequent commands.`,
  )
  .action(async (options) => {
    if ((!options.url || !options.tokenId || !options.tokenSecretStdin) && !process.stdin.isTTY) {
      throw new Error('Noninteractive login requires --url, --token-id, and --token-secret-stdin.');
    }
    const url = instanceUrl(options.url ?? (await input({ message: 'BookStack instance URL:' })));
    if (!options.tokenId) {
      const authUrl = new URL('my-account/auth', url).href;
      process.stderr.write(`Create an API token at ${authUrl}\n`);
      try {
        await open(authUrl);
      } catch {
        process.stderr.write(
          'Could not open your browser. Open the link above to create an API token.\n',
        );
      }
    }
    const config = credentials({
      url,
      tokenId: options.tokenId ?? (await input({ message: 'API token ID:' })),
      tokenSecret: options.tokenSecretStdin
        ? (await stdin()).trim()
        : await password({ message: 'API token secret:', mask: '*' }),
    });
    await new Api(config).request('GET', 'books', ['count=1']);
    await saveConfig(config);
    print({ authenticated: true, url: config.url, config: configPath() });
  });

program
  .command('status')
  .description('Show saved connection details without exposing credentials')
  .option('--check', 'Verify the saved token against the API')
  .action(async (options) => {
    const config = await loadConfig();
    if (options.check) await new Api(config).request('GET', 'books', ['count=1']);
    print({
      configured: true,
      url: config.url,
      config: configPath(),
      ...(options.check ? { authenticated: true } : {}),
    });
  });
program
  .command('logout')
  .description('Remove credentials saved on this machine')
  .action(async () => {
    await logout();
    print({ loggedOut: true });
  });

program
  .command('search <query>')
  .description('Search BookStack content using its search syntax')
  .option('--page <number>', 'Result page', '1')
  .option('--count <number>', 'Results per page, maximum 100', '100')
  .option('--all', 'Fetch all remaining pages')
  .addHelpText(
    'after',
    `
Examples:
  bookstack search 'deployment' --all
  bookstack search '{type:page} deployment' --count 20
  bookstack search 'runbook' --page 2 --count 10`,
  )
  .action(async (query, options) =>
    print(
      await (
        await client()
      ).list(
        'search',
        [`query=${query}`, `page=${options.page}`, `count=${options.count}`],
        !!options.all,
        true,
      ),
    ),
  );

for (const resource of ['shelves', 'books', 'chapters', 'pages']) {
  const group = program
    .command(resource)
    .description(`Manage ${resource}`)
    .addHelpText(
      'after',
      `
Examples:
  bookstack ${resource} list --all
  bookstack ${resource} get 14${
    resource === 'shelves'
      ? `
  bookstack shelves get 14 | jq '.books[] | {id, name}'

Shelf details include the shelf's books. The last example requires jq.`
      : ''
  }`,
    );
  group
    .command('list')
    .description('List content with optional filters and pagination')
    .option('-q, --query <key=value>', 'API query parameter, repeatable', collect, [])
    .option('--all', 'Fetch all remaining records')
    .addHelpText(
      'after',
      `
Examples:
  bookstack ${resource} list --all
  bookstack ${resource} list -q 'count=20' -q 'sort=-updated_at'${
    resource === 'pages' || resource === 'chapters'
      ? `
  bookstack ${resource} list -q 'filter[book_id]=1' --all`
      : ''
  }`,
    )
    .action(async (options) =>
      print(await (await client()).list(resource, options.query, !!options.all)),
    );
  group
    .command('get <id>')
    .description(
      resource === 'shelves' ? 'Read a shelf, including its books' : 'Read content by ID',
    )
    .addHelpText(
      'after',
      `
Examples:
  bookstack ${resource} get 14${
    resource === 'shelves'
      ? `
  bookstack shelves get 14 | jq '.books'
  bookstack shelves get 14 | jq '.books[] | {id, name}'

jq examples require jq.`
      : ''
  }`,
    )
    .action(async (id) =>
      print(await (await client()).request('GET', `${resource}/${entityId(id)}`)),
    );
  for (const action of ['create', 'update']) {
    const command = group
      .command(action === 'create' ? 'create' : 'update <id>')
      .description(
        `${action === 'create' ? 'Create' : 'Update'} content; use --data for any API fields`,
      )
      .option('-d, --data <json|@file|->', 'JSON object, file, or stdin')
      .option('--name <name>', 'Content name')
      .option('--description <text>', 'Content description');
    if (resource === 'pages' || resource === 'chapters')
      command.option('--book-id <id>', 'Parent book ID');
    if (resource === 'pages')
      command
        .option('--chapter-id <id>', 'Parent chapter ID')
        .option('--markdown-file <path>', 'Read Markdown content from a file')
        .option('--html-file <path>', 'Read HTML content from a file');
    command.action(async (...args) => {
      const options = args[action === 'create' ? 0 : 1];
      const path = action === 'create' ? resource : `${resource}/${entityId(args[0])}`;
      const payload = await body(options.data, options);
      print(
        await (await client()).request(action === 'create' ? 'POST' : 'PUT', path, [], payload),
      );
    });
  }
  group
    .command('delete <id>')
    .description('Delete content, including children where applicable')
    .requiredOption('--yes', 'Confirm deletion, including child content')
    .action(async (id) => {
      const path = `${resource}/${entityId(id)}`;
      await (await client()).request('DELETE', path);
      print({ deleted: true, resource, id: Number(id) });
    });
  if (resource !== 'shelves')
    group
      .command('export <id>')
      .description('Export content to a file')
      .addOption(
        new Option('--format <format>', 'Export format')
          .choices(['markdown', 'html', 'plaintext', 'pdf', 'zip'])
          .default('markdown'),
      )
      .requiredOption('-o, --output <path>', 'Destination file')
      .action(async (id, options) => {
        const result = await (
          await client()
        ).request(
          'GET',
          `${resource}/${entityId(id)}/export/${options.format}`,
          [],
          undefined,
          true,
        );
        await writeFile(options.output, result as Buffer);
        print({ output: options.output });
      });
}

program
  .command('api <method> <path>')
  .description('Call any JSON API endpoint, such as GET users or PUT pages/1/move')
  .addHelpText(
    'after',
    `
Examples:
  bookstack api GET tags/names
  bookstack api GET users -q 'count=10'
  bookstack api PUT pages/42/move --data '{"chapter_id":2}'
  bookstack api GET pages/42/export/html --output ./page.html`,
  )
  .option('-q, --query <key=value>', 'Query parameter, repeatable', collect, [])
  .option('-d, --data <json|@file|->', 'JSON object, file, or stdin')
  .option('-o, --output <path>', 'Save a raw response, including binary exports, to a file')
  .action(async (method, path, options) => {
    method = method.toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
      throw new Error('Unsupported HTTP method.');
    if (options.data !== undefined && method === 'GET')
      throw new Error('GET requests cannot include --data.');
    const data = options.data === undefined ? undefined : await body(options.data, {});
    const result = await (
      await client()
    ).request(method, path, options.query, data, !!options.output);
    if (options.output) {
      await writeFile(options.output, result as Buffer);
      print({ output: options.output });
    } else print(result);
  });

function entityId(value: string): string {
  if (!/^[1-9]\d*$/.test(value)) throw new Error('ID must be a positive integer.');
  return value;
}

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof CommanderError && error.exitCode === 0) {
    process.exitCode = 0;
  } else {
    const message = error instanceof Error ? error.message : 'Unknown error';
    process.stderr.write(
      JSON.stringify({
        error: {
          message,
          ...(error instanceof ApiError ? { status: error.status, details: error.details } : {}),
        },
      }) + '\n',
    );
    process.exitCode = 1;
  }
}
