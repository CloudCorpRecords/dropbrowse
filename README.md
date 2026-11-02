# dropbrowse

Read-only access to a Dropbox account for AI clients: browse
folders, find files by name, search inside files for text, read
file content, and inspect file metadata. dropbrowse never writes
to Dropbox.

Authentication is a Dropbox access token in the
`DROPBOX_ACCESS_TOKEN` environment variable. Create one in the
Dropbox App Console: create an app with "Scoped access" and "Full
Dropbox", enable the `files.metadata.read` and
`files.content.read` permissions, then generate an access token.
Without the variable, every command fails with an error naming
it — before any request is made.

## CLI

```bash
export DROPBOX_ACCESS_TOKEN=…

npx @reneturcios/dropbrowse list /documents --max-files 50
npx @reneturcios/dropbrowse search invoice --types pdf --max-results 5
npx @reneturcios/dropbrowse read /documents/notes.txt --max-length 0
npx @reneturcios/dropbrowse info /documents/report.pdf
npx @reneturcios/dropbrowse grep "important keyword" /documents/file1.txt /documents/file2.md
npx @reneturcios/dropbrowse --version
```

Exit codes: `0` on success, `1` on a runtime error (including a
missing token or an upstream failure), `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/dropbrowse mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "dropbrowse": {
      "command": "npx",
      "args": ["-y", "@reneturcios/dropbrowse", "mcp"],
      "env": { "DROPBOX_ACCESS_TOKEN": "your_access_token_here" }
    }
  }
}
```

### Tools

- `list_files` — List files and folders in a Dropbox directory.
  `folder_path` (optional; empty for root), `max_files` (optional,
  default 20).
- `search_files` — Search for files by name. `query` (required),
  `file_types` (optional: `"all"`, `"pdf"`, `"docx"`, `"txt"`, or
  comma-separated), `max_results` (optional, default 10).
- `read_file` — Read the full content of a file. `file_path`
  (required), `max_length` (optional, default 5000; 0 for
  unlimited).
- `get_file_info` — Get detailed metadata about a file.
  `file_path` (required).
- `search_file_content` — Search for text within specific files.
  `file_paths` (required list), `query` (required),
  `context_chars` (optional, default 100).

### Text extraction — honest limit

Plain-text family files (TXT, MD, PY, JS, HTML, CSS, JSON, CSV,
and other UTF-8 text) are read and searched as text. Reading or
content-searching a PDF, DOC, or DOCX file returns a named error:
binary-format text extraction is not implemented in this build.

## Docker

```bash
docker run -i -e DROPBOX_ACCESS_TOKEN ghcr.io/cloudcorprecords/dropbrowse
docker run --rm -e DROPBOX_ACCESS_TOKEN ghcr.io/cloudcorprecords/dropbrowse list /documents
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (fake fetch only, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
