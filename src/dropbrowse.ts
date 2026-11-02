/**
 * dropbrowse core: read-only Dropbox access via the Dropbox API.
 *
 *   listFiles          POST <api>/2/files/list_folder
 *   searchFiles        POST <api>/2/files/search_v2
 *   readFile           POST <content>/2/files/download
 *   getFileInfo        POST <api>/2/files/get_metadata
 *   searchFileContent  downloads each named file and scans its text
 *
 * The upstream README publishes no base URL (calls go through the
 * Dropbox SDK); targeting the standard Dropbox API v2 HTTPS
 * endpoints with the same bearer-token model is a documented
 * local choice. Auth is the DROPBOX_ACCESS_TOKEN environment
 * variable; a missing token is an error naming the variable,
 * raised before any request — never a fabricated result.
 *
 * Text extraction: plain-text family files (TXT, MD, PY, JS, HTML,
 * CSS, JSON, CSV and other UTF-8 text) are returned as text.
 * PDF/DOCX text extraction (which the original performs with
 * PyPDF2 / python-docx) is NOT implemented in this build: reading
 * or content-searching a .pdf/.doc/.docx file returns a named
 * error for that file instead of pretending to extract it. That
 * gap is recorded in BUILD-REPORT.md.
 *
 * Upstream answers are validated: a non-2xx status or a body of
 * an unexpected shape is a named error. Folder listing follows
 * list_folder/continue pagination until the upstream reports no
 * more pages or max_files is reached.
 */
import type {
  ContentMatch,
  DropbrowseOptions,
  FileContentResult,
  FileEntry,
  FetchFn,
  ListFilesResult,
  ReadFileResult,
  SearchContentResult,
  SearchFilesResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const API_BASE = "https://api.dropboxapi.com";
export const CONTENT_BASE = "https://content.dropboxapi.com";

export const DEFAULT_LIST_MAX = 20;
export const DEFAULT_SEARCH_MAX = 10;
export const DEFAULT_READ_MAX = 5000;
export const DEFAULT_CONTEXT = 100;

const USER_AGENT = "dropbrowse/0.1.0 (https://github.com/CloudCorpRecords/dropbrowse)";

const EXTRACTION_UNSUPPORTED = new Set([".pdf", ".doc", ".docx"]);

function resolveFetch(options: DropbrowseOptions): FetchFn {
  return options.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
}

function resolveToken(options: DropbrowseOptions): string {
  const token = options.token ?? process.env.DROPBOX_ACCESS_TOKEN;
  if (!token || !token.trim()) {
    throw new Error(
      "DROPBOX_ACCESS_TOKEN is not set: dropbrowse needs a Dropbox access token in the DROPBOX_ACCESS_TOKEN environment variable",
    );
  }
  return token.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

function toEntry(value: unknown): FileEntry | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === "string" ? value.name : null;
  const path =
    typeof value.path_display === "string"
      ? value.path_display
      : typeof value.path_lower === "string"
        ? value.path_lower
        : null;
  if (!name || !path) return null;
  const entry: FileEntry = {
    type: typeof value[".tag"] === "string" ? (value[".tag"] as string) : "unknown",
    name,
    path,
  };
  if (typeof value.size === "number") entry.size = value.size;
  if (typeof value.server_modified === "string") entry.modified = value.server_modified;
  return entry;
}

/** One authenticated JSON POST to the API host. */
async function apiPost(
  options: DropbrowseOptions,
  token: string,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fetchFn = resolveFetch(options);
  const base = (options.baseUrl ?? API_BASE).replace(/\/+$/, "");
  let res;
  try {
    res = await fetchFn(`${base}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `request to the Dropbox API failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new Error(`Dropbox API returned HTTP ${res.status} for ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new Error(`Dropbox API returned a non-JSON body for ${path}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`Dropbox API returned an unexpected body shape for ${path}`);
  }
  return parsed;
}

/** Download one file's raw text from the content host. */
async function downloadText(
  options: DropbrowseOptions,
  token: string,
  filePath: string,
): Promise<string> {
  const fetchFn = resolveFetch(options);
  const base = (options.contentBaseUrl ?? CONTENT_BASE).replace(/\/+$/, "");
  let res;
  try {
    res = await fetchFn(`${base}/2/files/download`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Dropbox-API-Arg": JSON.stringify({ path: filePath }),
        "User-Agent": USER_AGENT,
      },
    });
  } catch (err) {
    throw new Error(
      `request to the Dropbox content API failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new Error(`Dropbox content API returned HTTP ${res.status} for ${filePath}`);
  }
  try {
    return await res.text();
  } catch {
    throw new Error(`Dropbox content API returned an unreadable body for ${filePath}`);
  }
}

function requirePath(value: unknown, label: string): string {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path) throw new Error(`${label} is required`);
  return path;
}

/** List files and folders in a Dropbox directory. */
export async function listFiles(
  args: { folder_path?: string; max_files?: number },
  options: DropbrowseOptions = {},
): Promise<ListFilesResult> {
  const token = resolveToken(options);
  const folderPath = typeof args.folder_path === "string" ? args.folder_path : "";
  const maxFiles = args.max_files ?? DEFAULT_LIST_MAX;
  if (!Number.isInteger(maxFiles) || maxFiles < 1) {
    throw new Error("max_files must be a positive integer");
  }
  const entries: FileEntry[] = [];
  let body = await apiPost(options, token, "/2/files/list_folder", {
    path: folderPath,
    recursive: false,
    include_deleted: false,
    limit: maxFiles,
  });
  for (;;) {
    const raw = Array.isArray(body.entries) ? body.entries : [];
    for (const item of raw) {
      const entry = toEntry(item);
      if (entry) entries.push(entry);
      if (entries.length >= maxFiles) break;
    }
    if (entries.length >= maxFiles || body.has_more !== true || typeof body.cursor !== "string") {
      break;
    }
    body = await apiPost(options, token, "/2/files/list_folder/continue", {
      cursor: body.cursor,
    });
  }
  return { folder_path: folderPath, count: entries.length, entries };
}

/** Search for files by name. */
export async function searchFiles(
  args: { query: string; file_types?: string; max_results?: number },
  options: DropbrowseOptions = {},
): Promise<SearchFilesResult> {
  const token = resolveToken(options);
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) throw new Error("query is required");
  const fileTypes = (args.file_types ?? "all").trim().toLowerCase() || "all";
  const maxResults = args.max_results ?? DEFAULT_SEARCH_MAX;
  if (!Number.isInteger(maxResults) || maxResults < 1) {
    throw new Error("max_results must be a positive integer");
  }
  const body = await apiPost(options, token, "/2/files/search_v2", {
    query,
    options: { max_results: maxResults, file_name_only: true },
  });
  const matches: FileEntry[] = [];
  const raw = Array.isArray(body.matches) ? body.matches : [];
  for (const item of raw) {
    if (!isRecord(item) || !isRecord(item.metadata)) continue;
    const entry = toEntry(item.metadata.metadata ?? item.metadata);
    if (!entry || entry.type !== "file") continue;
    if (fileTypes !== "all") {
      const wanted = fileTypes.split(",").map((t) => t.trim().replace(/^\./, ""));
      if (!wanted.includes(extensionOf(entry.path).replace(/^\./, ""))) continue;
    }
    matches.push(entry);
    if (matches.length >= maxResults) break;
  }
  return { query, file_types: fileTypes, count: matches.length, files: matches };
}

/** Read the full content of a file (text formats; see header note). */
export async function readFile(
  args: { file_path: string; max_length?: number },
  options: DropbrowseOptions = {},
): Promise<ReadFileResult> {
  const token = resolveToken(options);
  const filePath = requirePath(args.file_path, "file_path");
  const maxLength = args.max_length ?? DEFAULT_READ_MAX;
  if (!Number.isInteger(maxLength) || maxLength < 0) {
    throw new Error("max_length must be a non-negative integer (0 for unlimited)");
  }
  if (EXTRACTION_UNSUPPORTED.has(extensionOf(filePath))) {
    throw new Error(
      `text extraction for ${extensionOf(filePath)} files is not implemented in this build of dropbrowse`,
    );
  }
  const text = await downloadText(options, token, filePath);
  const truncated = maxLength > 0 && text.length > maxLength;
  const content = truncated ? text.slice(0, maxLength) : text;
  return { file_path: filePath, content, truncated, length: content.length };
}

/** Get detailed metadata about a file. */
export async function getFileInfo(
  args: { file_path: string },
  options: DropbrowseOptions = {},
): Promise<Record<string, unknown>> {
  const token = resolveToken(options);
  const filePath = requirePath(args.file_path, "file_path");
  const body = await apiPost(options, token, "/2/files/get_metadata", {
    path: filePath,
    include_media_info: false,
  });
  const entry = toEntry(body);
  if (!entry) {
    throw new Error(`Dropbox API returned an unexpected metadata shape for ${filePath}`);
  }
  const info: Record<string, unknown> = { ...entry };
  if (typeof body.id === "string") info.id = body.id;
  if (typeof body.client_modified === "string") info.client_modified = body.client_modified;
  if (typeof body.rev === "string") info.rev = body.rev;
  if (typeof body.content_hash === "string") info.content_hash = body.content_hash;
  return info;
}

/** Search for text within specific files. */
export async function searchFileContent(
  args: { file_paths: string[]; query: string; context_chars?: number },
  options: DropbrowseOptions = {},
): Promise<SearchContentResult> {
  const token = resolveToken(options);
  if (!Array.isArray(args.file_paths) || args.file_paths.length === 0) {
    throw new Error("file_paths is required and must be a non-empty list of file paths");
  }
  const query = typeof args.query === "string" ? args.query : "";
  if (!query) throw new Error("query is required");
  const context = args.context_chars ?? DEFAULT_CONTEXT;
  if (!Number.isInteger(context) || context < 0) {
    throw new Error("context_chars must be a non-negative integer");
  }
  const files: FileContentResult[] = [];
  for (const rawPath of args.file_paths) {
    const filePath = typeof rawPath === "string" ? rawPath : String(rawPath);
    if (EXTRACTION_UNSUPPORTED.has(extensionOf(filePath))) {
      files.push({
        file_path: filePath,
        match_count: 0,
        matches: [],
        error: `text extraction for ${extensionOf(filePath)} files is not implemented in this build of dropbrowse`,
      });
      continue;
    }
    try {
      const text = await downloadText(options, token, filePath);
      const matches: ContentMatch[] = [];
      let from = 0;
      for (;;) {
        const index = text.indexOf(query, from);
        if (index < 0) break;
        const start = Math.max(0, index - context);
        const end = Math.min(text.length, index + query.length + context);
        matches.push({ index, snippet: text.slice(start, end) });
        from = index + Math.max(1, query.length);
      }
      files.push({ file_path: filePath, match_count: matches.length, matches });
    } catch (err) {
      files.push({
        file_path: filePath,
        match_count: 0,
        matches: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { query, files };
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}
