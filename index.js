import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerReadImage } from "./tools/read-image.js";
import { registerReadXlsx } from "./tools/read-xlsx.js";
import { registerReadEml } from "./tools/read-eml.js";
import { registerReadPdf } from "./tools/read-pdf.js";

const server = new McpServer({
  name: "file-reader",
  version: "1.0.0",
});

registerReadImage(server);
registerReadXlsx(server);
registerReadEml(server);
registerReadPdf(server);

const transport = new StdioServerTransport();
await server.connect(transport);
