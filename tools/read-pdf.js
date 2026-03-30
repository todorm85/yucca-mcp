import { readFile } from "fs/promises";
import { extname, resolve, isAbsolute } from "path";
import { existsSync } from "fs";
import { z } from "zod";

export function registerReadPdf(server) {
  server.tool(
    "read_pdf",
    "Render each page of a PDF file as a high-quality PNG image and return all pages as visual content. Uses pdf.js for pixel-perfect rendering. Ideal for PDFs with complex layouts, charts, or forms where text extraction loses formatting. Returns one image content block per page.",
    {
      path: z.string().describe("Absolute path to the .pdf file"),
      dpi: z.number().optional().describe("Resolution in DPI (default 200). Use 150 for faster/smaller, 300 for print quality."),
    },
    async ({ path: pdfPath, dpi }) => {
      const resolved = isAbsolute(pdfPath) ? pdfPath : resolve(pdfPath);
      const renderDpi = dpi || 200;
      const scale = renderDpi / 72;

      if (!existsSync(resolved)) {
        return { content: [{ type: "text", text: `File not found: ${resolved}` }], isError: true };
      }
      if (extname(resolved).toLowerCase() !== ".pdf") {
        return { content: [{ type: "text", text: `Not a .pdf file: ${resolved}` }], isError: true };
      }

      try {
        const { pdf } = await import("pdf-to-img");
        const doc = await pdf(resolved, { scale });
        const total = doc.length;

        const content = [];
        content.push({
          type: "text",
          text: `PDF: ${resolved}\nPages: ${total}, rendered at ${renderDpi} DPI`,
        });

        let pageNum = 0;
        for await (const image of doc) {
          pageNum++;
          content.push({
            type: "text",
            text: `── Page ${pageNum} of ${total} ──`,
          });
          content.push({
            type: "image",
            data: Buffer.from(image).toString("base64"),
            mimeType: "image/png",
          });
        }

        return { content };
      } catch (err) {
        return {
          content: [{ type: "text", text: `PDF rendering failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );
}
