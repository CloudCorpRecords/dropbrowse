/**
 * dropbrowse types.
 *
 * dropbrowse gives read-only access to a Dropbox account through
 * the Dropbox API v2 HTTPS endpoints, authenticated with the
 * DROPBOX_ACCESS_TOKEN environment variable. It lists folders,
 * searches files by name, reads file content, returns file
 * metadata, and searches for text inside specific files.
 *
 * HTTP access is described by a minimal injectable fetch function
 * so tests can run entirely on fake responses with no network.
 */

/** One file or folder entry, normalised from the Dropbox shape. */
export interface FileEntry {
  /** ".tag" in the upstream shape: "file", "folder", or "deleted". */
  type: string;
  name: string;
  /** Display path (path_display, falling back to path_lower). */
  path: string;
  /** Byte size; present for files when the upstream reports it. */
  size?: number;
  /** Server-modified timestamp (ISO string); files only, when reported. */
  modified?: string;
}

/** Result of listing a folder. */
export interface ListFilesResult {
  folder_path: string;
  count: number;
  entries: FileEntry[];
}

/** Result of a by-name file search. */
export interface SearchFilesResult {
  query: string;
  file_types: string;
  count: number;
  files: FileEntry[];
}

/** Result of reading one file's content. */
export interface ReadFileResult {
  file_path: string;
  /** The extracted text content (possibly truncated, see below). */
  content: string;
  /** True when the content was cut at max_length. */
  truncated: boolean;
  /** Characters returned. */
  length: number;
}

/** One text match inside a file. */
export interface ContentMatch {
  /** Character index of the match start in the file's text. */
  index: number;
  /** The matched text with the configured context around it. */
  snippet: string;
}

/** Content-search outcome for one file. */
export interface FileContentResult {
  file_path: string;
  match_count: number;
  matches: ContentMatch[];
  /** Set when this file could not be searched (e.g. extraction unsupported). */
  error?: string;
}

/** Result of searching text across specific files. */
export interface SearchContentResult {
  query: string;
  files: FileContentResult[];
}

/** Minimal HTTP response surface dropbrowse needs from a fetch call. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** Injectable fetch: same call shape as the global fetch subset used here. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<HttpResponse>;

/** Options shared by every dropbrowse operation. */
export interface DropbrowseOptions {
  /** Injectable fetch; defaults to the global fetch. */
  fetchFn?: FetchFn;
  /** API base URL; defaults to https://api.dropboxapi.com. */
  baseUrl?: string;
  /** Content base URL; defaults to https://content.dropboxapi.com. */
  contentBaseUrl?: string;
  /** Access token; defaults to the DROPBOX_ACCESS_TOKEN env var. */
  token?: string;
}
