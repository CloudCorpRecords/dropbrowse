import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  API_BASE,
  CONTENT_BASE,
  getFileInfo,
  listFiles,
  readFile,
  searchFileContent,
  searchFiles,
} from "../src/dropbrowse.js";
import type { FetchFn, HttpResponse } from "../src/types.js";

/**
 * All tests run on a fake fetch: no live network calls are made.
 * The fake records every call (URL + init) and routes by URL to
 * canned Dropbox-API-shaped responses.
 */

interface RecordedCall {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: string;
}

function jsonResponse(body: unknown, status = 200): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function textResponse(text: string, status = 200): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error("not json");
    },
    text: async () => text,
  };
}

function fakeFetch(
  routes: Record<string, (call: RecordedCall) => HttpResponse>,
): { fetchFn: FetchFn; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const call: RecordedCall = {
      url,
      method: init?.method,
      headers: init?.headers ?? {},
      body: init?.body,
    };
    calls.push(call);
    const route = routes[url];
    if (!route) throw new Error(`unexpected URL ${url}`);
    return route(call);
  };
  return { fetchFn, calls };
}

const OPTS = { token: "test-token" };

const LIST_BODY = {
  entries: [
    { ".tag": "folder", name: "docs", path_display: "/docs", path_lower: "/docs" },
    {
      ".tag": "file",
      name: "report.pdf",
      path_display: "/report.pdf",
      path_lower: "/report.pdf",
      size: 12345,
      server_modified: "2026-01-02T03:04:05Z",
    },
    { ".tag": "file", name: "notes.txt", path_display: "/notes.txt", path_lower: "/notes.txt", size: 42 },
  ],
  cursor: "c1",
  has_more: false,
};

describe("auth", () => {
  it("names DROPBOX_ACCESS_TOKEN when no token is available, before any request", async () => {
    const saved = process.env.DROPBOX_ACCESS_TOKEN;
    delete process.env.DROPBOX_ACCESS_TOKEN;
    try {
      const { fetchFn, calls } = fakeFetch({});
      await assert.rejects(() => listFiles({}, { fetchFn }), /DROPBOX_ACCESS_TOKEN is not set/);
      assert.equal(calls.length, 0);
    } finally {
      if (saved !== undefined) process.env.DROPBOX_ACCESS_TOKEN = saved;
    }
  });
});

describe("listFiles", () => {
  it("posts to list_folder with bearer auth and maps entries", async () => {
    const { fetchFn, calls } = fakeFetch({
      [`${API_BASE}/2/files/list_folder`]: () => jsonResponse(LIST_BODY),
    });
    const out = await listFiles({}, { fetchFn, ...OPTS });
    assert.equal(out.count, 3);
    assert.equal(out.entries[0].type, "folder");
    assert.equal(out.entries[1].size, 12345);
    assert.equal(out.entries[1].modified, "2026-01-02T03:04:05Z");
    assert.equal(calls[0].headers.Authorization, "Bearer test-token");
    const sent = JSON.parse(calls[0].body ?? "{}") as Record<string, unknown>;
    assert.equal(sent.path, "");
    assert.equal(sent.limit, 20);
  });

  it("follows has_more pagination through list_folder/continue", async () => {
    const page1 = { entries: LIST_BODY.entries.slice(0, 1), cursor: "cur", has_more: true };
    const page2 = { entries: LIST_BODY.entries.slice(1), cursor: "c2", has_more: false };
    const { fetchFn, calls } = fakeFetch({
      [`${API_BASE}/2/files/list_folder`]: () => jsonResponse(page1),
      [`${API_BASE}/2/files/list_folder/continue`]: () => jsonResponse(page2),
    });
    const out = await listFiles({ folder_path: "/docs", max_files: 10 }, { fetchFn, ...OPTS });
    assert.equal(out.count, 3);
    assert.equal(calls.length, 2);
    const cont = JSON.parse(calls[1].body ?? "{}") as Record<string, unknown>;
    assert.equal(cont.cursor, "cur");
  });

  it("caps results at max_files and rejects a non-positive max_files", async () => {
    const { fetchFn } = fakeFetch({
      [`${API_BASE}/2/files/list_folder`]: () => jsonResponse(LIST_BODY),
    });
    const out = await listFiles({ max_files: 2 }, { fetchFn, ...OPTS });
    assert.equal(out.count, 2);
    await assert.rejects(() => listFiles({ max_files: 0 }, { fetchFn, ...OPTS }), /positive integer/);
  });

  it("throws a named error on an upstream failure status", async () => {
    const { fetchFn } = fakeFetch({
      [`${API_BASE}/2/files/list_folder`]: () => jsonResponse({}, 401),
    });
    await assert.rejects(() => listFiles({}, { fetchFn, ...OPTS }), /HTTP 401/);
  });
});

describe("searchFiles", () => {
  const SEARCH_BODY = {
    matches: [
      {
        metadata: {
          ".tag": "metadata",
          metadata: {
            ".tag": "file",
            name: "invoice-2026.pdf",
            path_display: "/invoice-2026.pdf",
            path_lower: "/invoice-2026.pdf",
          },
        },
      },
      {
        metadata: {
          ".tag": "metadata",
          metadata: {
            ".tag": "file",
            name: "invoice-notes.txt",
            path_display: "/invoice-notes.txt",
            path_lower: "/invoice-notes.txt",
          },
        },
      },
    ],
    has_more: false,
  };

  it("posts to search_v2 and maps the nested match metadata", async () => {
    const { fetchFn, calls } = fakeFetch({
      [`${API_BASE}/2/files/search_v2`]: () => jsonResponse(SEARCH_BODY),
    });
    const out = await searchFiles({ query: "invoice" }, { fetchFn, ...OPTS });
    assert.equal(out.count, 2);
    assert.equal(out.files[0].name, "invoice-2026.pdf");
    const sent = JSON.parse(calls[0].body ?? "{}") as { options: { file_name_only: boolean } };
    assert.equal(sent.options.file_name_only, true);
  });

  it("filters by file_types when it is not 'all'", async () => {
    const { fetchFn } = fakeFetch({
      [`${API_BASE}/2/files/search_v2`]: () => jsonResponse(SEARCH_BODY),
    });
    const out = await searchFiles({ query: "invoice", file_types: "pdf" }, { fetchFn, ...OPTS });
    assert.equal(out.count, 1);
    assert.equal(out.files[0].name, "invoice-2026.pdf");
  });

  it("rejects a blank query before any request", async () => {
    const { fetchFn, calls } = fakeFetch({});
    await assert.rejects(() => searchFiles({ query: " " }, { fetchFn, ...OPTS }), /query is required/);
    assert.equal(calls.length, 0);
  });
});

describe("readFile", () => {
  it("downloads from the content host with the Dropbox-API-Arg header", async () => {
    const { fetchFn, calls } = fakeFetch({
      [`${CONTENT_BASE}/2/files/download`]: () => textResponse("hello dropbox world"),
    });
    const out = await readFile({ file_path: "/notes.txt" }, { fetchFn, ...OPTS });
    assert.equal(out.content, "hello dropbox world");
    assert.equal(out.truncated, false);
    assert.deepEqual(JSON.parse(calls[0].headers["Dropbox-API-Arg"]), { path: "/notes.txt" });
  });

  it("truncates at max_length and reports it; 0 means unlimited", async () => {
    const { fetchFn } = fakeFetch({
      [`${CONTENT_BASE}/2/files/download`]: () => textResponse("0123456789"),
    });
    const cut = await readFile({ file_path: "/n.txt", max_length: 4 }, { fetchFn, ...OPTS });
    assert.equal(cut.content, "0123");
    assert.equal(cut.truncated, true);
    const full = await readFile({ file_path: "/n.txt", max_length: 0 }, { fetchFn, ...OPTS });
    assert.equal(full.content, "0123456789");
    assert.equal(full.truncated, false);
  });

  it("returns the named extraction error for PDF files without any request", async () => {
    const { fetchFn, calls } = fakeFetch({});
    await assert.rejects(
      () => readFile({ file_path: "/report.pdf" }, { fetchFn, ...OPTS }),
      /text extraction for \.pdf files is not implemented/,
    );
    assert.equal(calls.length, 0);
  });
});

describe("getFileInfo", () => {
  it("posts to get_metadata and returns normalised info with id/rev", async () => {
    const body = {
      ".tag": "file",
      name: "report.pdf",
      path_display: "/report.pdf",
      path_lower: "/report.pdf",
      size: 999,
      id: "id:abc",
      rev: "015e",
      content_hash: "hash",
      client_modified: "2026-01-01T00:00:00Z",
    };
    const { fetchFn } = fakeFetch({
      [`${API_BASE}/2/files/get_metadata`]: () => jsonResponse(body),
    });
    const out = await getFileInfo({ file_path: "/report.pdf" }, { fetchFn, ...OPTS });
    assert.equal(out.name, "report.pdf");
    assert.equal(out.id, "id:abc");
    assert.equal(out.rev, "015e");
    assert.equal(out.size, 999);
  });

  it("rejects a blank file_path before any request", async () => {
    const { fetchFn, calls } = fakeFetch({});
    await assert.rejects(() => getFileInfo({ file_path: "" }, { fetchFn, ...OPTS }), /file_path is required/);
    assert.equal(calls.length, 0);
  });
});

describe("searchFileContent", () => {
  it("finds matches with the configured context around them", async () => {
    const { fetchFn } = fakeFetch({
      [`${CONTENT_BASE}/2/files/download`]: () => textResponse("the important keyword appears here"),
    });
    const out = await searchFileContent(
      { file_paths: ["/a.txt"], query: "important keyword", context_chars: 4 },
      { fetchFn, ...OPTS },
    );
    assert.equal(out.files[0].match_count, 1);
    assert.equal(out.files[0].matches[0].index, 4);
    assert.equal(out.files[0].matches[0].snippet, "the important keyword app");
  });

  it("reports per-file errors for unsupported types and keeps searching others", async () => {
    const { fetchFn } = fakeFetch({
      [`${CONTENT_BASE}/2/files/download`]: () => textResponse("needle"),
    });
    const out = await searchFileContent(
      { file_paths: ["/doc.pdf", "/a.txt"], query: "needle" },
      { fetchFn, ...OPTS },
    );
    assert.match(out.files[0].error ?? "", /not implemented/);
    assert.equal(out.files[1].match_count, 1);
  });

  it("rejects an empty file list and a blank query", async () => {
    const { fetchFn } = fakeFetch({});
    await assert.rejects(
      () => searchFileContent({ file_paths: [], query: "x" }, { fetchFn, ...OPTS }),
      /file_paths is required/,
    );
    await assert.rejects(
      () => searchFileContent({ file_paths: ["/a.txt"], query: "" }, { fetchFn, ...OPTS }),
      /query is required/,
    );
  });
});
