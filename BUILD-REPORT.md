# dropbrowse — Build Report

MCP Rebuild 1000 (Tranche #101+ Batch 10). Clean-room rebuild of
cindyloo/dropbox-mcp-server (rank 585, 0★, Tier C), built from
the public spec in `specs-batch9/dropbox.md` and recorded in
`harness/fixtures/dropbox-tools-original.json`. That fixture is
docs-derived: the spec enumerates exactly 5 read-only tools, each
with a parameter list marking required vs optional and giving
defaults, so parity proves the rebuild matches this program's
defined spec, labelled docs-derived. No original code was read
and no original server was probed. Local build only — nothing
pushed or published.

Identity: repo `dropbrowse`, npm `@reneturcios/dropbrowse`,
MCP name `io.github.CloudCorpRecords/dropbrowse`, version
`0.1.0`, bin `dropbrowse` → `dist/cli.js`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `dropbrowse: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Read-only Dropbox: list, search by
  name or content, read files, and inspect metadata." (≤100
  chars); npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/dropbrowse:0.1.0` carries **no**
  `version` field
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/dropbrowse"`
- `tsconfig.json`, `.gitignore`, `LICENSE` (MIT, Copyright (c)
  2026 Rene Turcios), `README.md` (fresh text), `CHANGELOG.md`
  (single 0.1.0 entry, 2026-10-27)
- `src/index.ts`, `src/cli.ts` (`list`, `search`, `read`, `info`,
  `grep`, `mcp`, `--version`; exit 2 usage / 1 runtime error,
  argument validation before the token check and before any
  network request), `src/mcp.ts`, `src/types.ts`,
  `src/dropbrowse.ts` (core logic, `VERSION = "0.1.0"`)
- `test/dropbrowse.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (image name and smoke-test server name set to dropbrowse)

## Tools implemented (5)

The full documented set, with the spec's exact descriptions:

- `list_files` — "List files and folders in a Dropbox directory."
  `folder_path` (string, optional), `max_files` (integer,
  optional, default 20).
- `search_files` — "Search for files by name." `query` (string,
  required), `file_types` (string, optional — "all", "pdf",
  "docx", "txt", or comma-separated), `max_results` (integer,
  optional, default 10).
- `read_file` — "Read the full content of a file." `file_path`
  (string, required), `max_length` (integer, optional, default
  5000, 0 for unlimited).
- `get_file_info` — "Get detailed metadata about a file."
  `file_path` (string, required).
- `search_file_content` — "Search for text within specific
  files." `file_paths` (array of strings, required), `query`
  (string, required), `context_chars` (integer, optional,
  default 100).

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with explicit
  inputSchema literals exactly matching the fixture, per the
  standing fleet rule; zod still validates every `tools/call`.
- The upstream calls go through the official Dropbox SDK and the
  README publishes no base URL; the rebuild targets the standard
  Dropbox API v2 HTTPS endpoints (`api.dropboxapi.com`,
  `content.dropboxapi.com`) with the same bearer-token model — a
  documented local choice. Wire shapes follow the public Dropbox
  API: `files/list_folder` (+ `/continue` pagination),
  `files/search_v2` (nested match metadata unwrapped),
  `files/download` (path in the `Dropbox-API-Arg` header),
  `files/get_metadata`. These shapes are reconstructions from
  the public Dropbox API contract, not probed against a live
  account.
- Auth: `DROPBOX_ACCESS_TOKEN` env var. A missing token is an
  error naming the variable, raised before any request — in the
  CLI, argument validation runs before the token check (bad usage
  exits 2 even with no token set).
- All upstream access goes through an injectable `FetchFn` plus
  injectable base URLs, so tests run entirely on fake fetch
  responses — no live network calls were made and no live
  behaviour is claimed.

## Spec ambiguities resolved

- **Parameter types:** the README prints required/optional and
  defaults but mostly not explicit type words. The fixture and
  schemas use the natural types the spec notes record (string
  for paths/queries, integer for counts, array of strings for
  `file_paths`).
- **Output shapes:** the spec documents no output schema. The
  rebuild's normalised shapes (`FileEntry` lists, `ReadFileResult`
  with `truncated`, per-file content results with `error`) are
  documented local choices, recorded in the README and above.
- **Search filtering:** `file_types` filtering is applied to the
  search_v2 results client-side by file extension, matching the
  documented accepted values.

## Verification (foreground, coordinator re-run)

- `tsc --noEmit` exit 0; `npm run build` exit 0 (`dist/cli.js`)
- `npm test`: **16 tests, 16 pass, 0 fail** — missing-token error
  naming DROPBOX_ACCESS_TOKEN with zero requests; list_folder
  request shape + bearer header, entry mapping, pagination via
  list_folder/continue, max_files cap and validation, upstream
  401 named; search_v2 mapping, file_types filter, blank query
  rejected pre-request; download header shape, truncation and
  unlimited (0) reads, PDF extraction error with zero requests;
  get_metadata mapping and blank-path rejection; content search
  snippets/context, per-file unsupported-type errors, empty list
  and blank query rejection
- `dist/cli.js --version` → `0.1.0`
- Parity: `harness/parity.py` vs
  `harness/fixtures/dropbox-tools-original.json` →
  **PASS, parity 100.0, identical_tools 5/5**

## Lockfile status

`package-lock.json` generated clean via Route 3 (temp copy with
only `package.json`, offline `npm install --package-lock-only
--ignore-scripts --offline`), verified: parses, name
`@reneturcios/dropbrowse`, **128 package entries**. Local
`node_modules` is a symlink to the sibling burnmeter tree, used
only for the local build/test; gitignored.

## Gaps / honest notes

- Docs-derived spec: parity proves the rebuild matches this
  program's defined spec, not a hand-probed original server.
- **PDF/DOC/DOCX text extraction is NOT implemented** (the
  original extracts via PyPDF2 / python-docx): `read_file` on
  such a file returns a named error, and `search_file_content`
  records a per-file error for them. Plain-text formats are fully
  implemented.
- No live Dropbox call was performed or claimed; the Dropbox API
  wire shapes are public-contract reconstructions and live
  behaviour (token scopes, exact search_v2 match nesting) is
  unproven until a smoke run with a real token.
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.
