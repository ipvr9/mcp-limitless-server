# Limitless MCP Server (v0.1.0)

This project implements a Model Context Protocol (MCP) server that acts as a bridge to the [Limitless API](https://limitless.ai/developers). It allows MCP clients (like LLM chat interfaces or agents) to interact with your Limitless Lifelog data through standardized MCP tools.

**IMPORTANT NOTE:** As of March 2025, the Limitless API **requires data recorded via the Limitless Pendant**. This server **will not function or return useful data** if you are not actively using the Limitless Pendant for recording. Ensure your Pendant is connected and recording.

**API Status & Future Plans:**
*   The official Limitless API is currently in **beta**. As such, it may occasionally be unreliable, subject to change, or experience temporary outages.
*   Requesting large amounts of data (e.g., listing or searching hundreds of logs) may sometimes result in **timeout errors (like 504 Gateway Time-out)** due to API or network constraints. The server includes a 120-second timeout per API call to mitigate this, but very large requests might still fail.
*   The Limitless API is under **active development**. This MCP server will be updated with new features and improvements as they become available in the official API.
*   **Version 0.2.0** of this MCP server is already under development, with plans to add more robust features and potentially new tools in the near future!

## Features (v0.1.0)

*   **List/Get Lifelogs:** Retrieve Pendant recordings by ID, date, date range, or list recent entries. Includes control over sort direction (`asc`/`desc`).
*   **Search Recent Logs:** Perform simple text searches within the content of a configurable number of recent Pendant recordings (*limitation: does not search entire history*).

## Prerequisites

*   Node.js (v18 or later required)
*   npm or yarn
*   A Limitless account and API key ([Get one here](https://limitless.ai/developers))
*   **A Limitless Pendant (Required for data)**
*   An MCP Client application (e.g., Claude, Windsurf, Cursor, ChatWise, ChatGPT (coming soon!)) capable of spawning stdio servers and passing environment variables.

## Setup

1.  **Clone or download this project.**
2.  **Navigate to the directory:**
    ```bash
    cd mcp-limitless-server
    ```
3.  **Install dependencies:**
    ```bash
    npm install
    ```
4.  **Build the code:**
    ```bash
    npm run build
    ```

## Configuration (Client-Side)

This server expects the `LIMITLESS_API_KEY` to be provided as an **environment variable** when it is launched by your MCP client.

You need to add a server configuration block to your MCP client's settings file. Below are two examples depending on whether you are adding this as your first server or adding it alongside existing servers.

**Example A: Adding as the first/only server**

If your client's configuration file currently has an empty `mcpServers` object (`"mcpServers": {}`), replace it with this:

```json
{
  "mcpServers": {
    "limitless": {
      "command": "node",
      "args": ["<FULL_FILE_PATH_TO_DIST_SERVER.js>"],
      "env": {
        "LIMITLESS_API_KEY": "<YOUR_LIMITLESS_API_KEY_HERE>"
      }
    }
  }
}
```

**Example B: Adding to existing servers**

If your `mcpServers` object already contains other servers (like `"notion": {...}`), add the `"limitless"` block alongside them, ensuring correct JSON syntax (commas between entries):

```json
{
  "mcpServers": {
    "some_other_server": {
      "command": "...",
      "args": ["..."],
      "env": { ... }
    },
    "limitless": {
      "command": "node",
      "args": ["<FULL_FILE_PATH_TO_DIST_SERVER.js>"],
      "env": {
        "LIMITLESS_API_KEY": "<YOUR_LIMITLESS_API_KEY_HERE>"
      }
    }
  }
}
```

**Important:**
*   Replace `<FULL_FILE_PATH_TO_DIST_SERVER.js>` with the correct, **absolute path** to the built server script (e.g., `/Users/yourname/Documents/MCP/mcp-limitless-server/dist/server.js`). Relative paths might not work reliably depending on the client.
*   Replace `<YOUR_LIMITLESS_API_KEY_HERE>` with your actual Limitless API key.
*   MCP config files **cannot contain comments**. Remove any placeholder text like `<YOUR_LIMITLESS_API_KEY_HERE>` and replace it with your actual key.

## Running the Server (via Client)

**Do not run `npm start` directly.**

1.  Ensure the server is built successfully (`npm run build`).
2.  Configure your MCP client as shown above.
3.  Start your MCP client application. It will launch the `mcp-limitless-server` process automatically when needed.

## Exposed MCP Tools (v0.1.0)

(Refer to the `instructions` in `src/server.ts` or ask the server via your client for full details.)

1.  **`limitless_get_lifelog_by_id`**: Retrieves a single Pendant recording by its specific ID.
2.  **`limitless_list_lifelogs_by_date`**: Lists Pendant recordings for a specific date.
3.  **`limitless_list_lifelogs_by_range`**: Lists Pendant recordings within a date/time range.
4.  **`limitless_list_recent_lifelogs`**: Lists the most recent Pendant recordings.
5.  **`limitless_search_lifelogs`**: Searches title/content of *recent* Pendant recordings (limited scope!).

## Notes & Limitations

*   **Pendant Required:** This server **requires** data generated by the Limitless Pendant to function.
*   **API Beta Status:** The Limitless API is in beta and may experience occasional instability or rate limiting. Large requests might result in timeouts (e.g., 504 errors).
*   **Search Scope:** Search (`limitless_search_lifelogs`) **only** scans a limited number of *recent* logs (default 20, max 100 via `fetch_limit`). It does **not** search your entire history. Use list tools first if you need to analyze broader concepts like action items or summaries across logs.
*   **Error Handling:** Limitless API errors are translated into MCP error results. Timeouts (120s per API call) are handled.
*   **Transport:** Uses `stdio`, designed to be launched by a client application.

## Contributing

Feel free to open issues or pull requests on the GitHub repository: [https://github.com/ipvr9/mcp-limitless-server](https://github.com/ipvr9/mcp-limitless-server)