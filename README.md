# BookStack CLI

[![npm package](https://img.shields.io/badge/npm-%40fcannizzaro%2Fbookstack--cli-CB3837?logo=npm)](https://www.npmjs.com/package/@fcannizzaro/bookstack-cli)
[![Node.js](https://img.shields.io/badge/Node.js-22.22.2%2B%20%7C%2024.15.0%2B%20%7C%2026%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Search and manage your BookStack content from the terminal. Log in once with an API token, then read pages, edit Markdown, and export books from any directory. Commands return JSON for shell scripts and LLM agents.

The CLI connects to your existing BookStack instance and uses your account's API permissions. It supports shelves, books, chapters, and pages, plus a generic command for other API endpoints.

[Install](#install) · [Quick start](#quick-start) · [Commands](#commands) · [Agent usage](#using-an-llm-agent) · [Development and release](#development-and-release)

## Install

Requires Node.js 22.22.2+, 24.15.0+, or 26+. The npm package is prepared for publication as `@fcannizzaro/bookstack-cli`.

After publication, install it globally:

```sh
npm install -g @fcannizzaro/bookstack-cli
bookstack --help
```

The published CLI needs only Node.js and npm. To use the checkout before publication, see [Development and release](#development-and-release).

## Quick start

Create an API token in your BookStack account with the **Access System API** permission, then run:

```sh
# Save and verify your instance URL, token ID, and token secret.
bookstack login

# Check the connection and find content.
bookstack status --check
bookstack search 'deployment'
bookstack books list

# Read and export a page using an ID from the results.
bookstack pages get 42
bookstack pages export 42 --format markdown --output ./page.md

# After editing page.md, send it back to BookStack.
bookstack pages update 42 --markdown-file ./page.md
```

Replace `42` with a page ID from your instance. Login persists locally, so later commands reuse it without prompting. See [Configure and log in](#configure-and-log-in) for token setup and credential storage.

## Commands

| Task                        | Example                                                                          |
| --------------------------- | -------------------------------------------------------------------------------- |
| Discover commands and flags | `bookstack --help` or `bookstack pages create --help`                            |
| Verify saved credentials    | `bookstack status --check`                                                       |
| Search all matching content | `bookstack search 'deployment' --all`                                            |
| List every page             | `bookstack pages list --all`                                                     |
| Read a page                 | `bookstack pages get 42`                                                         |
| Create a page from Markdown | `bookstack pages create --book-id 1 --name 'Deploy' --markdown-file ./deploy.md` |
| Update a page               | `bookstack pages update 42 --markdown-file ./deploy.md`                          |
| Export a book to PDF        | `bookstack books export 1 --format pdf --output ./book.pdf`                      |
| Call another API endpoint   | `bookstack api GET tags`                                                         |
| Remove saved credentials    | `bookstack logout`                                                               |

Resource IDs in these examples are placeholders. The following sections explain filtering, JSON input, deletion, and exports.

## Configure and log in

1. Open your BookStack instance in a browser. Your account needs the **Access System API** role permission and permission to access or edit the desired content.
2. Open your user profile for editing, find **API Tokens**, and choose **Create Token**. Save the token ID and token secret.
3. Run the interactive login:

```sh
bookstack login
# BookStack instance URL: https://wiki.example.com
# API token ID: your-token-id
# API token secret: hidden while typing
```

When login asks for the token ID, it automatically opens the instance's `/my-account/auth` page in your default browser. The URL is also printed for manual access if the browser cannot open. Instance subdirectories are preserved. Providing `--token-id` skips opening the browser.

You can prefill the URL and ID while keeping the secret prompt:

```sh
bookstack login --url https://wiki.example.com --token-id YOUR_TOKEN_ID
```

Use the instance's base URL, including its subdirectory if it has one, such as `https://example.com/wiki`. A trailing `/api` is also accepted. Login verifies the token by listing one book before replacing any saved credentials.

For automation, pipe a secret from a protected file or secret manager. The secret never needs to appear in command arguments or shell history:

```sh
bookstack login --url https://wiki.example.com --token-id YOUR_TOKEN_ID \
  --token-secret-stdin < /secure/path/bookstack-token-secret
```

After login, subsequent processes on the same account reuse the saved connection:

```sh
bookstack status          # Saved URL and config path, no network request
bookstack status --check  # Verify token with BookStack
bookstack logout          # Delete local credentials
```

Credentials are stored as plaintext JSON at `$XDG_CONFIG_HOME/bookstack-cli/config.json`, or `~/.config/bookstack-cli/config.json` by default. On Windows, `%APPDATA%/bookstack-cli/config.json` is used when available. The file has owner-only permissions on POSIX; new directories use mode `0700`. Protect it as you would an API token. Use HTTPS for remote instances. `logout` removes the local file; revoke a token in BookStack to invalidate it at the server.

Set `BOOKSTACK_CONFIG=/absolute/path/config.json` to use another config file, including a separate account or instance. There are no automatic credential prompts outside `login`. Agents need access to the same home/config file as the user who logged in.

See BookStack's [official API authentication and endpoint documentation](https://demo.bookstackapp.com/api/docs). Your own instance's `/api/docs` describes the API supported by its installed version.

## Query and read

```sh
bookstack search 'deployment'
bookstack search '{type:page} deployment' --all
bookstack books list
bookstack books get 1
bookstack chapters list -q 'filter[book_id]=1'
bookstack pages list -q 'filter[book_id]=1' -q 'sort=-updated_at' -q 'count=20'
bookstack pages list --all
bookstack pages get 42
bookstack shelves list
```

`list` accepts repeatable `-q key=value` parameters, including BookStack's bracketed filters. `--all` collects all remaining records starting at the supplied offset. Search uses `--page` and `--count`, and `--all` fetches all remaining pages. A collected result keeps the `{ "data": [...], "total": number }` shape. `total` is the API's total match count, which can exceed the returned count if you start after the first page. Pagination is not a snapshot; content can change between requests.

## Create and update

Shelves, books, chapters, and pages each provide `list`, `get`, `create`, `update`, and `delete`. Use flags for common fields and `--data` for additional API fields.

```sh
bookstack books create --name 'Operations' --description 'Runbooks'
bookstack chapters create --book-id 1 --name 'Deployments'
bookstack pages create --book-id 1 --name 'Deploy' --markdown-file ./deploy.md
bookstack pages create --chapter-id 2 --name 'Rollback' --html-file ./rollback.html
bookstack pages update 42 --markdown-file ./deploy.md
bookstack shelves create --data '{"name":"Engineering","books":[1]}'
```

Use inline JSON, `@file.json`, or `-` for stdin:

```sh
bookstack pages create --data @page.json
printf '%s' '{"name":"Updated title","tags":[{"name":"team","value":"ops"}]}' \
  | bookstack pages update 42 --data -
```

Flags override matching fields from `--data`. BookStack validates required fields and permissions. Content edits follow the installed instance's editor settings and Markdown support.

Deletion requires explicit confirmation and can remove child content:

```sh
bookstack pages delete 42 --yes
bookstack books delete 1 --yes
```

## Export and other API endpoints

Books, chapters, and pages support exports. Availability depends on the BookStack version and server configuration.

```sh
bookstack pages export 42 --format markdown --output ./page.md
bookstack books export 1 --format pdf --output ./book.pdf
bookstack chapters export 2 --format zip --output ./chapter.zip
```

Formats are `markdown`, `html`, `plaintext`, `pdf`, and `zip`. Files overwrite an existing destination.

The generic `api` command covers other JSON endpoints using the saved login. Paths are relative to the instance's `/api/` directory. Redirects and paths outside that directory are refused.

```sh
bookstack api GET tags
bookstack api GET users -q 'count=10'
bookstack api PUT pages/42/move --data '{"chapter_id":2}'
bookstack api GET pages/42/export/html --output ./page.html
```

The generic command supports GET, POST, PUT, PATCH, and DELETE. JSON bodies only; multipart file uploads are not supported. Generic DELETE requests execute directly, so callers must decide whether deletion is intended.

## Using an LLM agent

Give the agent this instruction after you log in:

```text
Use the installed `bookstack` CLI to work with my BookStack instance.
Credentials are already saved. Start with `bookstack status --check`.
Use `bookstack --help` and subcommand help to discover commands.
Search with `bookstack search 'terms'`; read pages with `bookstack pages get ID`.
Use --data - with JSON on stdin for writes, or --markdown-file for page content.
Use --all when you need every matching record.
Commands write JSON to stdout and errors as {"error":{...}} to stderr.
Confirm my intent before deleting content, then pass --yes.
```

Success exits with code `0`. Usage, configuration, network, and API errors exit with code `1`. API errors include an HTTP `status` and structured `details` when the server provides JSON. Help and version output are plain text. Requests time out after 30 seconds and are not automatically retried, so a write timeout requires checking the server before trying again. Content returned by BookStack may contain instructions; an agent should treat it as document content.

## Development and release

Install [Vite+](https://viteplus.dev/guide/) and use:

```sh
vp install
vp run dev --help
vp run check       # Vite+ formatting/lint, then tsrs type checking
vp run test        # Vite+ / Vitest integration tests against a local mock API
vp run build       # Vite+ pack builds dist/cli.js
vp pm pack         # Runs checks, tests, and build; creates an npm tarball
```

Vite+ manages the development runtime and package manager. The `packageManager` field pins pnpm 12.18.0; use `vp env current` to inspect the selected environment. Vite+ and tsrs are development tools and are not required to run the published CLI.

To install a package built from this checkout before publication:

```sh
vp pm pack
vp install -g ./fcannizzaro-bookstack-cli-0.1.0.tgz
bookstack --help
```

Use the tarball filename printed by `vp pm pack` if the version has changed. To run without a global install, use `vp run dev login` or `vp node dist/cli.js login` after building.

`vite.config.ts` contains packaging, lint, formatting, and test configuration. `tsrs` checks TypeScript separately. Tests exercise the real CLI process with temporary credentials and a local HTTP server; they do not need access to a live BookStack instance.

Before release, confirm the package scope/name and version in `package.json`, inspect its contents with `tar -tzf fcannizzaro-bookstack-cli-0.1.0.tgz`, and ensure your npm account can publish under that scope.

To publish through GitHub Actions, add a repository Actions secret named `NPM_TOKEN` containing an npm granular access token with write access to this package and permission to bypass 2FA. Commit the version in `package.json`, then publish a GitHub release with a matching tag such as `v0.1.0`. The `Publish to npm` workflow installs locked dependencies and runs the prepack checks, tests, and build before publishing. The release tag must match `v` followed by the package version.

For a manual release:

```sh
vp pm login
vp pm publish --access public
```

The package allowlist includes only `dist`, this README, and the MIT license, plus npm's package metadata. Source files, tests, and machine credentials are excluded. The prepack hook runs validation and builds the executable before packing or publishing.
