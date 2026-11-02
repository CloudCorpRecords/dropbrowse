/**
 * dropbrowse MCP server. Tools: list_files, search_files,
 * read_file, get_file_info, search_file_content.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys that
 * are not in this tool's public spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schemas as explicit literals, while zod still
 * validates every tools/call argument set.
 *
 * Authentication is the DROPBOX_ACCESS_TOKEN environment
 * variable; without it every tool returns an error naming the
 * variable, before any request.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  formatPayload,
  getFileInfo,
  listFiles,
  readFile,
  searchFileContent,
  searchFiles,
  VERSION,
} from "./dropbrowse.js";

const ListArgs = z.object({
  folder_path: z.string().optional(),
  max_files: z.number().int().min(1).optional(),
});

const SearchArgs = z.object({
  query: z.string().min(1),
  file_types: z.string().optional(),
  max_results: z.number().int().min(1).optional(),
});

const ReadArgs = z.object({
  file_path: z.string().min(1),
  max_length: z.number().int().min(0).optional(),
});

const InfoArgs = z.object({
  file_path: z.string().min(1),
});

const ContentArgs = z.object({
  file_paths: z.array(z.string()).min(1),
  query: z.string().min(1),
  context_chars: z.number().int().min(0).optional(),
});

const TOOLS = [
  {
    name: "list_files",
    description: "List files and folders in a Dropbox directory.",
    inputSchema: {
      type: "object" as const,
      properties: {
        folder_path: { type: "string", description: "Path to folder (empty for root)" },
        max_files: {
          type: "integer",
          description: "Maximum items to return (default: 20)",
          default: 20,
        },
      },
    },
  },
  {
    name: "search_files",
    description: "Search for files by name.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
        file_types: {
          type: "string",
          description: 'File types to search ("all", "pdf", "docx", "txt", or comma-separated)',
        },
        max_results: {
          type: "integer",
          description: "Maximum results (default: 10)",
          default: 10,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_file",
    description: "Read the full content of a file.",
    inputSchema: {
      type: "object" as const,
      properties: {
        file_path: { type: "string", description: "Full path to the file" },
        max_length: {
          type: "integer",
          description: "Maximum characters to return (default: 5000, 0 for unlimited)",
          default: 5000,
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "get_file_info",
    description: "Get detailed metadata about a file.",
    inputSchema: {
      type: "object" as const,
      properties: {
        file_path: { type: "string", description: "Full path to the file" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "search_file_content",
    description: "Search for text within specific files.",
    inputSchema: {
      type: "object" as const,
      properties: {
        file_paths: {
          type: "array",
          items: { type: "string" },
          description: "List of file paths to search",
        },
        query: { type: "string", description: "Text to search for" },
        context_chars: {
          type: "integer",
          description: "Characters of context around matches (default: 100)",
          default: 100,
        },
      },
      required: ["file_paths", "query"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "dropbrowse", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let out: unknown;
    if (name === "list_files") {
      out = await listFiles(ListArgs.parse(args ?? {}));
    } else if (name === "search_files") {
      out = await searchFiles(SearchArgs.parse(args ?? {}));
    } else if (name === "read_file") {
      out = await readFile(ReadArgs.parse(args ?? {}));
    } else if (name === "get_file_info") {
      out = await getFileInfo(InfoArgs.parse(args ?? {}));
    } else if (name === "search_file_content") {
      out = await searchFileContent(ContentArgs.parse(args ?? {}));
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
