#!/usr/bin/env node
/**
 * dropbrowse CLI.
 *
 *   dropbrowse list [folder_path] [--max-files <n>]
 *   dropbrowse search <query> [--types <t>] [--max-results <n>]
 *   dropbrowse read <file_path> [--max-length <n>]
 *   dropbrowse info <file_path>
 *   dropbrowse grep <query> <file_path> [more paths...] [--context <n>]
 *   dropbrowse mcp
 *
 * Read-only Dropbox access. Needs DROPBOX_ACCESS_TOKEN in the
 * environment. Argument validation happens before the token check
 * and before any network request.
 * Exit codes: 0 success, 1 upstream/runtime error (including a
 * missing token), 2 usage error.
 */
import {
  DEFAULT_CONTEXT,
  DEFAULT_LIST_MAX,
  DEFAULT_READ_MAX,
  DEFAULT_SEARCH_MAX,
  formatPayload,
  getFileInfo,
  listFiles,
  readFile,
  searchFileContent,
  searchFiles,
  VERSION,
} from "./dropbrowse.js";

function usage(): never {
  console.error(`Usage:
  dropbrowse list [folder_path] [--max-files <n>]
  dropbrowse search <query> [--types <t>] [--max-results <n>]
  dropbrowse read <file_path> [--max-length <n>]
  dropbrowse info <file_path>
  dropbrowse grep <query> <file_path> [more paths...] [--context <n>]
  dropbrowse mcp
  dropbrowse --version

Requires the DROPBOX_ACCESS_TOKEN environment variable.`);
  process.exit(2);
}

function flag(rest: string[], name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

function positionalArgs(rest: string[], valueFlags: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (valueFlags.includes(rest[i])) {
      i++;
    } else {
      out.push(rest[i]);
    }
  }
  return out;
}

function intFlag(rest: string[], name: string, min: number): number | undefined {
  if (!rest.includes(name)) return undefined;
  const raw = flag(rest, name);
  if (raw === undefined) usage();
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) usage();
  return n;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  const known = ["list", "search", "read", "info", "grep"];
  if (!cmd || !known.includes(cmd)) usage();

  // ---- Argument validation (before token check / network) ----
  let run: () => Promise<unknown>;
  if (cmd === "list") {
    const maxFiles = intFlag(rest, "--max-files", 1) ?? DEFAULT_LIST_MAX;
    const pos = positionalArgs(rest, ["--max-files"]);
    if (pos.length > 1) usage();
    if (rest.some((a) => a.startsWith("--") && a !== "--max-files")) usage();
    const folder = pos[0] ?? "";
    run = () => listFiles({ folder_path: folder, max_files: maxFiles });
  } else if (cmd === "search") {
    const types = flag(rest, "--types");
    const maxResults = intFlag(rest, "--max-results", 1) ?? DEFAULT_SEARCH_MAX;
    const pos = positionalArgs(rest, ["--types", "--max-results"]);
    if (pos.length !== 1 || !pos[0].trim()) usage();
    run = () => searchFiles({ query: pos[0], file_types: types, max_results: maxResults });
  } else if (cmd === "read") {
    const maxLength = intFlag(rest, "--max-length", 0) ?? DEFAULT_READ_MAX;
    const pos = positionalArgs(rest, ["--max-length"]);
    if (pos.length !== 1 || !pos[0].trim()) usage();
    run = () => readFile({ file_path: pos[0], max_length: maxLength });
  } else if (cmd === "info") {
    if (rest.length !== 1 || !rest[0].trim() || rest[0].startsWith("--")) usage();
    run = () => getFileInfo({ file_path: rest[0] });
  } else {
    // grep
    const context = intFlag(rest, "--context", 0) ?? DEFAULT_CONTEXT;
    const pos = positionalArgs(rest, ["--context"]);
    if (pos.length < 2 || !pos[0]) usage();
    const [query, ...paths] = pos;
    run = () => searchFileContent({ file_paths: paths, query, context_chars: context });
  }

  try {
    const out = await run();
    console.log(formatPayload(out));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
