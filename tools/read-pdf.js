import { writeFile, unlink } from "fs/promises";
import { extname, resolve, isAbsolute } from "path";
import { existsSync } from "fs";
import { execFile } from "child_process";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { z } from "zod";

function runProcess(cmd, args) {
  return new Promise((res, rej) => {
    execFile(cmd, args, { maxBuffer: 200 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return rej(err);
      }
      res({ stdout, stderr });
    });
  });
}

export async function checkPythonDeps() {
  try {
    await runProcess("python", ["--version"]);
  } catch {
    return (
      "Python is not found on PATH.\n" +
      "Install Python 3.8+ from https://www.python.org/downloads/ " +
      "and ensure it is added to PATH."
    );
  }
  try {
    await runProcess("python", ["-c", "import pymupdf"]);
  } catch (err) {
    const detail = (err.stderr || "").trim();
    return (
      "Python package 'pymupdf' is not installed.\n" +
      "Install it with:  pip install pymupdf\n" +
      (detail ? `Detail: ${detail}` : "")
    );
  }
  return null;
}

export function registerReadPdf(server) {
  server.tool(
    "read_pdf",
    "Render each page of a PDF file as a high-quality PNG image and return all pages as visual content. Uses PyMuPDF for pixel-perfect rendering. Ideal for PDFs with complex layouts, charts, or forms where text extraction loses formatting. Returns one image content block per page.",
    {
      path: z.string().describe("Absolute path to the .pdf file"),
      dpi: z.number().optional().describe("Resolution in DPI (default 200). Use 150 for faster/smaller, 300 for print quality."),
    },
    async ({ path: pdfPath, dpi }) => {
      const depError = await checkPythonDeps();
      if (depError) {
        return { content: [{ type: "text", text: depError }], isError: true };
      }

      const resolved = isAbsolute(pdfPath) ? pdfPath : resolve(pdfPath);
      const renderDpi = dpi || 200;

      if (!existsSync(resolved)) {
        return { content: [{ type: "text", text: `File not found: ${resolved}` }], isError: true };
      }
      if (extname(resolved).toLowerCase() !== ".pdf") {
        return { content: [{ type: "text", text: `Not a .pdf file: ${resolved}` }], isError: true };
      }

      const pyScript = [
        "import sys, json, pymupdf, base64",
        "pdf_path = sys.argv[1]",
        "dpi = int(sys.argv[2])",
        "zoom = dpi / 72.0",
        "mat = pymupdf.Matrix(zoom, zoom)",
        "doc = pymupdf.open(pdf_path)",
        "pages = []",
        "for page in doc:",
        "    pix = page.get_pixmap(matrix=mat)",
        "    pages.append(base64.b64encode(pix.tobytes('png')).decode('ascii'))",
        "json.dump({'total': len(doc), 'pages': pages}, sys.stdout)",
      ].join("\n");

      const scriptPath = resolve(tmpdir(), `mcp_pdf_${randomUUID()}.py`);
      await writeFile(scriptPath, pyScript, "utf8");

      try {
        const { stdout, stderr } = await runProcess("python", [scriptPath, resolved, String(renderDpi)]);

        let result;
        try {
          result = JSON.parse(stdout);
        } catch {
          return {
            content: [{ type: "text", text: `Failed to parse pymupdf output.\nStdout: ${stdout.slice(0, 500)}\nStderr: ${stderr.slice(0, 500)}` }],
            isError: true,
          };
        }

        const content = [];
        content.push({
          type: "text",
          text: `PDF: ${resolved}\nPages: ${result.total}, rendered at ${renderDpi} DPI`,
        });

        for (let i = 0; i < result.pages.length; i++) {
          content.push({
            type: "text",
            text: `── Page ${i + 1} of ${result.total} ──`,
          });
          content.push({
            type: "image",
            data: result.pages[i],
            mimeType: "image/png",
          });
        }

        return { content };
      } catch (err) {
        const stderr = err.stderr || "";
        return {
          content: [{ type: "text", text: `PDF rendering failed: ${err.message}\n${stderr}` }],
          isError: true,
        };
      } finally {
        await unlink(scriptPath).catch(() => {});
      }
    }
  );
}
