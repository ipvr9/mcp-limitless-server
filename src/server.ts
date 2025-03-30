import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpError, ErrorCode, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getLifelogs, getLifelogById, LimitlessApiError, Lifelog, LifelogParams } from "./limitless-client.js";
import { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { z } from "zod";

// --- Constants ---
const MAX_LIFELOG_LIMIT = 100;
const MAX_SEARCH_FETCH_LIMIT = 100;
const DEFAULT_SEARCH_FETCH_LIMIT = 20;

// --- Environment Variable Checks ---
const limitlessApiKey = process.env.LIMITLESS_API_KEY;
if (!limitlessApiKey) {
    console.error("Error: LIMITLESS_API_KEY environment variable not set.");
    console.error("Ensure the client configuration provides LIMITLESS_API_KEY in the 'env' section.");
    process.exit(1);
}

// --- Tool Argument Schemas ---

const CommonListArgsSchema = {
    limit: z.number().int().positive().max(MAX_LIFELOG_LIMIT).optional().describe(`Maximum number of lifelogs to return (Max: ${MAX_LIFELOG_LIMIT}). Fetches in batches from the API if needed.`),
    timezone: z.string().optional().describe("IANA timezone for date/time parameters (defaults to server's local timezone)."),
    includeMarkdown: z.boolean().optional().default(true).describe("Include markdown content in the response."),
    includeHeadings: z.boolean().optional().default(true).describe("Include headings content in the response."),
    direction: z.enum(["asc", "desc"]).optional().describe("Sort order ('asc' for oldest first, 'desc' for newest first)."),
};
const GetByIdArgsSchema = {
    lifelog_id: z.string().describe("The unique identifier of the lifelog to retrieve."),
    includeMarkdown: z.boolean().optional().default(true).describe("Include markdown content in the response."),
    includeHeadings: z.boolean().optional().default(true).describe("Include headings content in the response."),
};
const ListByDateArgsSchema = {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.").describe("The date to retrieve lifelogs for, in YYYY-MM-DD format."),
    ...CommonListArgsSchema
};
const ListByRangeArgsSchema = {
    start: z.string().describe("Start datetime filter (YYYY-MM-DD or YYYY-MM-DD HH:mm:SS)."),
    end: z.string().describe("End datetime filter (YYYY-MM-DD or YYYY-MM-DD HH:mm:SS)."),
    ...CommonListArgsSchema
};
const ListRecentArgsSchema = {
    limit: z.number().int().positive().max(MAX_LIFELOG_LIMIT).optional().default(10).describe(`Number of recent lifelogs to retrieve (Max: ${MAX_LIFELOG_LIMIT}). Defaults to 10.`),
    timezone: CommonListArgsSchema.timezone,
    includeMarkdown: CommonListArgsSchema.includeMarkdown,
    includeHeadings: CommonListArgsSchema.includeHeadings,
};
const SearchArgsSchema = {
    search_term: z.string().describe("The text to search for within lifelog titles and content."),
    fetch_limit: z.number().int().positive().max(MAX_SEARCH_FETCH_LIMIT).optional().default(DEFAULT_SEARCH_FETCH_LIMIT).describe(`How many *recent* lifelogs to fetch from the API to search within (Default: ${DEFAULT_SEARCH_FETCH_LIMIT}, Max: ${MAX_SEARCH_FETCH_LIMIT}). This defines the scope of the search, NOT the number of results returned.`),
    limit: CommonListArgsSchema.limit,
    timezone: CommonListArgsSchema.timezone,
    includeMarkdown: CommonListArgsSchema.includeMarkdown,
    includeHeadings: CommonListArgsSchema.includeHeadings,
};


// --- MCP Server Setup ---

const server = new McpServer({
    name: "LimitlessMCP",
    version: "0.1.0",
}, {
    capabilities: {
        tools: {}
    },
    instructions: `
This server connects to the Limitless API (https://limitless.ai) to interact with your lifelogs using specific tools.
NOTE: As of March 2025, the Limitless Lifelog API primarily surfaces data recorded via the Limitless Pendant. Queries may return limited or no data if the Pendant is not used.

**Tool Usage Strategy:**
- To find conceptual information like **summaries, action items, to-dos, key topics, decisions, etc.**, first use a **list tool** (list_by_date, list_by_range, list_recent) to retrieve the relevant log entries. Then, **analyze the returned text content** to extract the required information.
- Use the **search tool** (\`limitless_search_lifelogs\`) **ONLY** when looking for logs containing **specific keywords or exact phrases**.

Available Tools:

1.  **limitless_get_lifelog_by_id**: Retrieves a single lifelog or Pendant recording by its specific ID.
    - Args: lifelog_id (req), includeMarkdown, includeHeadings

2.  **limitless_list_lifelogs_by_date**: Lists logs/recordings for a specific date. Best for getting raw log data which you can then analyze for summaries, action items, topics, etc.
    - Args: date (req, YYYY-MM-DD), limit (max ${MAX_LIFELOG_LIMIT}), timezone, includeMarkdown, includeHeadings, direction ('asc'/'desc', default 'asc')

3.  **limitless_list_lifelogs_by_range**: Lists logs/recordings within a date/time range. Best for getting raw log data which you can then analyze for summaries, action items, topics, etc.
    - Args: start (req), end (req), limit (max ${MAX_LIFELOG_LIMIT}), timezone, includeMarkdown, includeHeadings, direction ('asc'/'desc', default 'asc')

4.  **limitless_list_recent_lifelogs**: Lists the most recent logs/recordings (sorted newest first). Best for getting raw log data which you can then analyze for summaries, action items, topics, etc.
    - Args: limit (opt, default 10, max ${MAX_LIFELOG_LIMIT}), timezone, includeMarkdown, includeHeadings

5.  **limitless_search_lifelogs**: Performs a simple text search for specific keywords/phrases within the title and content of *recent* logs/Pendant recordings.
    - **USE ONLY FOR KEYWORDS:** Good for finding mentions of "Project X", "Company Name", specific names, etc.
    - **DO NOT USE FOR CONCEPTS:** Not suitable for finding general concepts like 'action items', 'summaries', 'key decisions', 'to-dos', or 'main topics'. Use a list tool first for those tasks, then analyze the results.
    - **LIMITATION**: Only searches the 'fetch_limit' most recent logs (default ${DEFAULT_SEARCH_FETCH_LIMIT}, max ${MAX_SEARCH_FETCH_LIMIT}). NOT a full history search.
    - Args: search_term (req), fetch_limit (opt, default ${DEFAULT_SEARCH_FETCH_LIMIT}, max ${MAX_SEARCH_FETCH_LIMIT}), limit (opt, max ${MAX_LIFELOG_LIMIT} for results), timezone, includeMarkdown, includeHeadings
`
});

// --- Tool Implementations ---

// Helper to handle common API call errors and format results
async function handleToolApiCall<T>(apiCall: () => Promise<T>, requestedLimit?: number): Promise<CallToolResult> {
    try {
        const result = await apiCall();
        let resultText = "";

        if (Array.isArray(result)) {
            if (result.length === 0) {
                resultText = "No lifelogs found matching the criteria.";
            } else if (requestedLimit !== undefined) {
                // Case 1: A specific limit was requested by the user/LLM
                if (result.length < requestedLimit) {
                    resultText = `Found ${result.length} lifelogs (requested up to ${requestedLimit}).\n\n${JSON.stringify(result, null, 2)}`;
                } else {
                    // Found exactly the number requested, or potentially more were available but capped by the limit
                    resultText = `Found ${result.length} lifelogs (limit was ${requestedLimit}).\n\n${JSON.stringify(result, null, 2)}`;
                }
            } else {
                 // Case 2: No specific limit was requested (requestedLimit is undefined)
                 // Report the actual number found. Assume getLifelogs fetched all available up to internal limits.
                 resultText = `Found ${result.length} lifelogs matching the criteria.\n\n${JSON.stringify(result, null, 2)}`;
            }
        } else if (result) { // Handle single object result (e.g., getById)
             resultText = JSON.stringify(result, null, 2);
        } else {
             resultText = "Operation successful, but no specific data returned.";
        }

        return { content: [{ type: "text", text: resultText }] };
    } catch (error) {
        console.error("[Server Tool Error]", error); // Log actual errors to stderr
        let errorMessage = "Failed to execute tool.";
        let mcpErrorCode = ErrorCode.InternalError;
        if (error instanceof LimitlessApiError) {
            errorMessage = `Limitless API Error (Status ${error.status ?? 'N/A'}): ${error.message}`;
            if (error.status === 401) mcpErrorCode = ErrorCode.InvalidRequest;
            if (error.status === 404) mcpErrorCode = ErrorCode.InvalidParams;
            if (error.status === 504) mcpErrorCode = ErrorCode.InternalError;
        } else if (error instanceof Error) { errorMessage = error.message; }
        return { content: [{ type: "text", text: `Error: ${errorMessage}` }], isError: true };
    }
}

// Register tools (Callbacks remain the same)
server.tool( "limitless_get_lifelog_by_id",
    "Retrieves a single lifelog or Pendant recording by its specific ID.",
    GetByIdArgsSchema,
    async (args, _extra) => handleToolApiCall(() => getLifelogById(limitlessApiKey, args.lifelog_id, { includeMarkdown: args.includeMarkdown, includeHeadings: args.includeHeadings }))
);
server.tool( "limitless_list_lifelogs_by_date",
    "Lists logs/recordings for a specific date. Best for getting raw log data which you can then analyze for summaries, action items, topics, etc.",
    ListByDateArgsSchema,
    async (args, _extra) => {
        const apiOptions: LifelogParams = { date: args.date, limit: args.limit, timezone: args.timezone, includeMarkdown: args.includeMarkdown, includeHeadings: args.includeHeadings, direction: args.direction ?? 'asc' };
        return handleToolApiCall(() => getLifelogs(limitlessApiKey, apiOptions), args.limit); // Pass requestedLimit to helper
    }
);
server.tool( "limitless_list_lifelogs_by_range",
    "Lists logs/recordings within a date/time range. Best for getting raw log data which you can then analyze for summaries, action items, topics, etc.",
    ListByRangeArgsSchema,
    async (args, _extra) => {
         const apiOptions: LifelogParams = { start: args.start, end: args.end, limit: args.limit, timezone: args.timezone, includeMarkdown: args.includeMarkdown, includeHeadings: args.includeHeadings, direction: args.direction ?? 'asc' };
        return handleToolApiCall(() => getLifelogs(limitlessApiKey, apiOptions), args.limit); // Pass requestedLimit to helper
    }
);
server.tool( "limitless_list_recent_lifelogs",
    "Lists the most recent logs/recordings (sorted newest first). Best for getting raw log data which you can then analyze for summaries, action items, topics, etc.",
    ListRecentArgsSchema,
    async (args, _extra) => {
         const apiOptions: LifelogParams = { limit: args.limit, timezone: args.timezone, includeMarkdown: args.includeMarkdown, includeHeadings: args.includeHeadings, direction: 'desc' };
        return handleToolApiCall(() => getLifelogs(limitlessApiKey, apiOptions), args.limit); // Pass requestedLimit to helper
    }
);
server.tool( "limitless_search_lifelogs",
    "Performs a simple text search for specific keywords/phrases within the title and content of *recent* logs/Pendant recordings. Use ONLY for keywords, NOT for concepts like 'action items' or 'summaries'. Searches only recent logs (limited scope).",
    SearchArgsSchema,
    async (args, _extra) => {
        const fetchLimit = args.fetch_limit ?? DEFAULT_SEARCH_FETCH_LIMIT;
        console.error(`[Server Tool] Search initiated for term: "${args.search_term}", fetch_limit: ${fetchLimit}`);
        try {
            const logsToSearch = await getLifelogs(limitlessApiKey, { limit: fetchLimit, direction: 'desc', timezone: args.timezone, includeMarkdown: true, includeHeadings: args.includeHeadings });
            if (logsToSearch.length === 0) return { content: [{ type: "text", text: "No recent lifelogs found to search within." }] };
            const searchTermLower = args.search_term.toLowerCase();
            const matchingLogs = logsToSearch.filter(log => log.title?.toLowerCase().includes(searchTermLower) || (log.markdown && log.markdown.toLowerCase().includes(searchTermLower)));
            const finalLimit = args.limit; // This limit applies to the *results*
            const limitedResults = finalLimit ? matchingLogs.slice(0, finalLimit) : matchingLogs;
            if (limitedResults.length === 0) return { content: [{ type: "text", text: `No matches found for "${args.search_term}" within the ${logsToSearch.length} most recent lifelogs searched.` }] };
            // Report count based on limitedResults length and the requested result limit
            let resultPrefix = `Found ${limitedResults.length} match(es) for "${args.search_term}" within the ${logsToSearch.length} most recent lifelogs searched`;
            if (finalLimit !== undefined) {
                resultPrefix += ` (displaying up to ${finalLimit})`;
            }
            resultPrefix += ':\n\n';
            const resultText = `${resultPrefix}${JSON.stringify(limitedResults, null, 2)}`;
            return { content: [{ type: "text", text: resultText }] };
        } catch (error) { return handleToolApiCall(() => Promise.reject(error)); }
    }
);

// --- Server Startup ---

async function main() {
    const transport = new StdioServerTransport();
    console.error("Limitless MCP Server starting...");
    server.server.onclose = () => { console.error("Connection closed."); };
    server.server.onerror = (error: Error) => { console.error("MCP Server Error:", error); };
    server.server.oninitialized = () => { console.error("Client initialized."); };
    try {
        await server.server.connect(transport);
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
}

main();