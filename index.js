import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerReadImage } from "./tools/read-image.js";
import { registerReadXlsx } from "./tools/read-xlsx.js";
import { registerReadEml } from "./tools/read-eml.js";
import { registerReadPdf, checkPythonDeps } from "./tools/read-pdf.js";

const server = new McpServer({
  name: "file-reader",
  version: "1.0.0",
});

registerReadImage(server);
registerReadXlsx(server);
registerReadEml(server);
registerReadPdf(server);

// Warn immediately if optional dependencies are missing so the issue is visible
// in the MCP client's output panel rather than surfacing only on first tool call.
checkPythonDeps().then((err) => {
  if (err) {
    process.stderr.write(
      `[file-reader-mcp] WARNING: read_pdf tool will not work.\n${err}\n`
    );
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
