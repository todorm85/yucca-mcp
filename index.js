import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile, writeFile, unlink } from "fs/promises";
import { extname, resolve, isAbsolute } from "path";
import { existsSync } from "fs";
import { execFile } from "child_process";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { z } from "zod";
import readXlsxFile, { readSheetNames } from "read-excel-file/node";

const MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

const server = new McpServer({
  name: "file-reader",
  version: "1.0.0",
});

server.tool(
  "read_image",
  "Read an image file from the filesystem and return it as visual content. Supports PNG, JPG, GIF, WEBP, BMP, and SVG.",
  { path: z.string().describe("Absolute path to the image file") },
  async ({ path: filePath }) => {
    const resolved = isAbsolute(filePath) ? filePath : resolve(filePath);

    if (!existsSync(resolved)) {
      return {
        content: [{ type: "text", text: `File not found: ${resolved}` }],
        isError: true,
      };
    }

    const ext = extname(resolved).toLowerCase();
    const mimeType = MIME_TYPES[ext];

    if (!mimeType) {
      return {
        content: [
          {
            type: "text",
            text: `Unsupported image format: ${ext}. Supported: ${Object.keys(MIME_TYPES).join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    const data = await readFile(resolved);
    const base64 = data.toString("base64");

    return {
      content: [{ type: "image", data: base64, mimeType }],
    };
  }
);

// ─── MCP Tool: read_xlsx ──────────────────────────────────────────────────────

/**
 * Escape pipe characters for markdown table cells and trim whitespace.
 */
function mdCell(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

/**
 * Convert a 2-D array of rows (first row = header) into a markdown table string.
 */
function rowsToMarkdown(rows) {
  if (!rows || rows.length === 0) return "_(empty sheet)_";

  const header = rows[0].map(mdCell);
  const separator = header.map(() => "---");
  const body = rows.slice(1).map((row) => row.map(mdCell));

  const lines = [
    "| " + header.join(" | ") + " |",
    "| " + separator.join(" | ") + " |",
    ...body.map((row) => "| " + row.join(" | ") + " |"),
  ];
  return lines.join("\n");
}

server.tool(
  "read_xlsx",
  "Read an Excel .xlsx spreadsheet and return its contents as markdown tables. By default reads all sheets. Can target a specific sheet by name or 1-based index.",
  {
    path: z.string().describe("Absolute path to the .xlsx file"),
    sheet: z
      .union([z.string(), z.number()])
      .optional()
      .describe(
        "Sheet name (string) or 1-based sheet index (number). Omit to read all sheets."
      ),
  },
  async ({ path: xlsxPath, sheet }) => {
    const resolved = isAbsolute(xlsxPath) ? xlsxPath : resolve(xlsxPath);

    if (!existsSync(resolved)) {
      return {
        content: [{ type: "text", text: `File not found: ${resolved}` }],
        isError: true,
      };
    }
    if (extname(resolved).toLowerCase() !== ".xlsx") {
      return {
        content: [{ type: "text", text: `Not an .xlsx file: ${resolved}` }],
        isError: true,
      };
    }

    const sheetNames = await readSheetNames(resolved);

    // Determine which sheets to read
    let sheetsToRead; // array of { name, index }
    if (sheet !== undefined) {
      if (typeof sheet === "number") {
        if (sheet < 1 || sheet > sheetNames.length) {
          return {
            content: [
              {
                type: "text",
                text: `Sheet index ${sheet} out of range. File has ${sheetNames.length} sheet(s): ${sheetNames.join(", ")}`,
              },
            ],
            isError: true,
          };
        }
        sheetsToRead = [{ name: sheetNames[sheet - 1], index: sheet }];
      } else {
        // sheet is a string name
        const idx = sheetNames.indexOf(sheet);
        if (idx === -1) {
          return {
            content: [
              {
                type: "text",
                text: `Sheet "${sheet}" not found. Available sheets: ${sheetNames.join(", ")}`,
              },
            ],
            isError: true,
          };
        }
        sheetsToRead = [{ name: sheet, index: idx + 1 }];
      }
    } else {
      sheetsToRead = sheetNames.map((name, i) => ({ name, index: i + 1 }));
    }

    const content = [];
    content.push({
      type: "text",
      text: `Excel file: ${resolved}\nSheets: ${sheetNames.join(", ")} (${sheetNames.length} total)\n`,
    });

    for (const { name, index } of sheetsToRead) {
      const rows = await readXlsxFile(resolved, { sheet: index });
      const md = rowsToMarkdown(rows);
      content.push({
        type: "text",
        text: `### Sheet: ${name}\n\n${md}`,
      });
    }

    return { content };
  }
);

// ─── EML parsing helpers ──────────────────────────────────────────────────────

/** Decode quoted-printable encoding. */
function decodeQP(str) {
  return str
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Decode RFC 2047 encoded-word sequences (=?charset?Q/B?...?=). */
function decodeRFC2047(str) {
  return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, _charset, enc, text) => {
    if (enc.toUpperCase() === "B") {
      return Buffer.from(text, "base64").toString("utf8");
    }
    return decodeQP(text.replace(/_/g, " "));
  });
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseHeaders(text) {
  const map = new Map();
  const unfolded = text.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    map.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return map;
}

/**
 * Recursively walk MIME parts of a raw EML string (latin-1 decoded).
 * Returns an array of { headers: Map, body: string }.
 */
function parseMimeParts(raw) {
  const parts = [];
  const boundaryMatch = raw.match(/boundary="([^"]+)"/i) || raw.match(/boundary=([^\s;]+)/i);
  if (!boundaryMatch) {
    parts.push({ headers: new Map(), body: raw });
    return parts;
  }
  const boundary = boundaryMatch[1];
  const delimRe = new RegExp(`--${escapeRegex(boundary)}(?:--)?`, "g");
  const segments = raw.split(delimRe).slice(1);
  for (const seg of segments) {
    if (!seg || seg.trim() === "--" || seg.trim() === "") continue;
    const blankLine = seg.match(/\r?\n\r?\n/);
    if (!blankLine) continue;
    const headers = parseHeaders(seg.slice(0, blankLine.index));
    const body = seg.slice(blankLine.index + blankLine[0].length);
    parts.push({ headers, body });
    if ((headers.get("content-type") || "").startsWith("multipart/")) {
      parts.push(...parseMimeParts(seg));
    }
  }
  return parts;
}

/**
 * Parse an EML raw buffer (latin-1).
 * Returns:
 *   headers   - top-level email headers (Map)
 *   plainText - decoded plain-text body (full reply chain)
 *   htmlText  - decoded HTML body (for cid reference extraction)
 *   images    - Map<cid, { data: string (base64), mimeType: string }>
 */
function parseEml(rawBytes) {
  const raw = rawBytes.toString("latin1");

  // Top-level headers
  const headerEnd = raw.search(/\r?\n\r?\n/);
  const topHeaders = parseHeaders(raw.slice(0, headerEnd).replace(/\r?\n[ \t]+/g, " "));

  const parts = parseMimeParts(raw);
  const images = new Map();
  let plainText = "";
  let htmlText = "";

  for (const part of parts) {
    const ct = part.headers.get("content-type") || "";
    const cte = (part.headers.get("content-transfer-encoding") || "").toLowerCase();
    const cid = (part.headers.get("content-id") || "").replace(/^<|>$/g, "");

    // Collect inline images by Content-ID
    if (ct.startsWith("image/") && cid) {
      const mimeType = ct.split(";")[0].trim();
      const data = part.body.replace(/\s+/g, ""); // already base64 from EML
      images.set(cid, { data, mimeType });
    }

    // Grab the first text/plain part
    if (!plainText && ct.startsWith("text/plain")) {
      if (cte === "quoted-printable") {
        plainText = decodeQP(part.body);
      } else if (cte === "base64") {
        plainText = Buffer.from(part.body.replace(/\s+/g, ""), "base64").toString("latin1");
      } else {
        plainText = part.body;
      }
    }

    // Grab the first text/html part (for cid reference positions)
    if (!htmlText && ct.startsWith("text/html")) {
      if (cte === "quoted-printable") {
        htmlText = decodeQP(part.body);
      } else if (cte === "base64") {
        htmlText = Buffer.from(part.body.replace(/\s+/g, ""), "base64").toString("latin1");
      } else {
        htmlText = part.body;
      }
    }
  }

  return { topHeaders, plainText, htmlText, images };
}

/**
 * Extract the ordered list of CIDs as they appear in the HTML body via
 * <img src="cid:..."> references.  Returns string[] of CID values.
 */
function extractCidOrderFromHtml(html) {
  const cids = [];
  const re = /src=["']cid:([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    cids.push(m[1].trim());
  }
  return cids;
}

/**
 * Split a plain-text email reply chain into individual messages.
 * Returns an array of { from, date, body } objects, newest first.
 */
function splitReplyChain(text) {
  // Common Outlook / Gmail separator patterns:
  //   "From: Name <email>\nSent: ..."  preceded by a line of underscores
  //   "On Mon, 12 Mar 2026 ... wrote:"
  const separatorRe = /(?:^|\n)_{3,}\r?\n(?=From:\s)/gm;
  const chunks = text.split(separatorRe);

  const messages = [];
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    // Try to extract From / Sent / Date header from the chunk start
    const fromMatch = trimmed.match(/^From:\s*(.+)/m);
    const dateMatch = trimmed.match(/^(?:Sent|Date):\s*(.+)/m);

    // Strip the internal "From/Sent/To/Cc/Subject" header block from the body
    let body = trimmed;
    const headerBlockEnd = trimmed.search(/^Subject:\s*.+$/m);
    if (headerBlockEnd !== -1) {
      const afterSubject = trimmed.indexOf("\n", headerBlockEnd);
      body = afterSubject !== -1 ? trimmed.slice(afterSubject + 1).trim() : trimmed;
    }

    messages.push({
      from: fromMatch ? fromMatch[1].trim() : null,
      date: dateMatch ? dateMatch[1].trim() : null,
      body,
    });
  }

  return messages;
}

// ─── MCP Tool: read_eml ───────────────────────────────────────────────────────

server.tool(
  "read_eml",
  "Parse an .eml email file and return the complete email chain as structured text with inline images. Does not include attachments! Each message in the reply chain is clearly delimited. Images are labelled with sequential indices and context snippets so the LLM can reason about them. Returns interleaved text + image content blocks for full multimodal comprehension in a single tool call.",
  {
    path: z.string().describe("Absolute path to the .eml file"),
  },
  async ({ path: emlPath }) => {
    const resolved = isAbsolute(emlPath) ? emlPath : resolve(emlPath);

    if (!existsSync(resolved)) {
      return { content: [{ type: "text", text: `File not found: ${resolved}` }], isError: true };
    }
    if (extname(resolved).toLowerCase() !== ".eml") {
      return { content: [{ type: "text", text: `Not an .eml file: ${resolved}` }], isError: true };
    }

    const rawBytes = await readFile(resolved);
    const { topHeaders, plainText, htmlText, images } = parseEml(rawBytes);

    // Build a header summary so the LLM has immediate context
    const subject  = decodeRFC2047(topHeaders.get("subject") || "(no subject)");
    const from     = decodeRFC2047(topHeaders.get("from") || "");
    const to       = decodeRFC2047(topHeaders.get("to") || "");
    const cc       = decodeRFC2047(topHeaders.get("cc") || "");
    const date     = topHeaders.get("date") || "";

    const headerSummary = [
      `Subject: ${subject}`,
      `From:    ${from}`,
      `To:      ${to}`,
      cc ? `Cc:      ${cc}` : null,
      `Date:    ${date}`,
      `Inline images found: ${images.size}`,
      "─".repeat(60),
    ].filter(Boolean).join("\n") + "\n\n";

    // Determine the ordered sequence of CIDs.
    // Prefer [cid:...] refs in plain text; fall back to <img src="cid:..."> in HTML.
    const plainCidRe = /\[cid:([^\]]+)\]/g;
    const plainCids = [];
    let m;
    while ((m = plainCidRe.exec(plainText)) !== null) plainCids.push(m[1].trim());
    const cidOrder = plainCids.length > 0 ? plainCids : extractCidOrderFromHtml(htmlText);

    // Split the reply chain into individual messages
    const messages = splitReplyChain(plainText);
    const totalMessages = messages.length;

    // Build structured text with clear per-message boundaries
    let structuredText = headerSummary;
    if (totalMessages > 1) {
      structuredText += `Thread contains ${totalMessages} messages (newest first).\n\n`;
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (totalMessages > 1) {
        structuredText += "═".repeat(60) + "\n";
        structuredText += `MESSAGE ${i + 1} of ${totalMessages}`;
        const metaParts = [];
        if (msg.from) metaParts.push(`From: ${msg.from}`);
        if (msg.date) metaParts.push(`Date: ${msg.date}`);
        if (metaParts.length) structuredText += "\n" + metaParts.join(" | ");
        structuredText += "\n" + "═".repeat(60) + "\n\n";
      }
      structuredText += msg.body + "\n\n";
    }

    // Now build the interleaved content array with labelled images.
    const content = [];

    if (plainCids.length > 0) {
      // Images are referenced as [cid:...] in plain text — split and interleave
      const marker = "\x00IMG_MARKER:";
      let processed = structuredText;
      for (const cid of cidOrder) {
        processed = processed.replace(`[cid:${cid}]`, `${marker}${cid}\x00`);
      }

      const segments = processed.split(marker);
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (i === 0) {
          if (seg.trim()) content.push({ type: "text", text: seg });
          continue;
        }

        const nullIdx = seg.indexOf("\x00");
        const cid = seg.slice(0, nullIdx);
        const textAfter = seg.slice(nullIdx + 1);

        const img = images.get(cid);
        if (img) {
          content.push({ type: "image", data: img.data, mimeType: img.mimeType });
        }

        if (textAfter.trim()) {
          content.push({ type: "text", text: textAfter });
        }
      }
    } else if (cidOrder.length > 0) {
      // Images referenced only in HTML (src="cid:...") — emit text, then images in order
      content.push({ type: "text", text: structuredText });

      for (let i = 0; i < cidOrder.length; i++) {
        const img = images.get(cidOrder[i]);
        if (!img) continue;
        content.push({ type: "image", data: img.data, mimeType: img.mimeType });
      }
    } else if (images.size > 0) {
      // No cid references at all — append all images at the end
      content.push({ type: "text", text: structuredText });
      content.push({ type: "text", text: `\n${"─".repeat(60)}\n${images.size} embedded image(s) found (no positional references in text):\n` });

      for (const [, img] of images) {
        content.push({ type: "image", data: img.data, mimeType: img.mimeType });
      }
    } else {
      // No images at all
      content.push({ type: "text", text: structuredText });
    }

    return { content };
  }
);

// ─── MCP Tool: read_pdf ───────────────────────────────────────────────────────

/**
 * Run a command and return { stdout, stderr } as a promise.
 */
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

/**
 * Check that Python is on PATH and pymupdf is importable.
 * Returns null if OK, or an error string with install instructions.
 */
async function checkPythonDeps() {
  // Check python exists
  try {
    await runProcess("python", ["--version"]);
  } catch {
    return (
      "Python is not found on PATH.\n" +
      "Install Python 3.8+ from https://www.python.org/downloads/ " +
      "and ensure it is added to PATH."
    );
  }
  // Check pymupdf is importable
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

server.tool(
  "read_pdf",
  "Render each page of a PDF file as a high-quality PNG image and return all pages as visual content. Uses PyMuPDF for pixel-perfect rendering. Ideal for PDFs with complex layouts, charts, or forms where text extraction loses formatting. Returns one image content block per page.",
  {
    path: z.string().describe("Absolute path to the .pdf file"),
    dpi: z.number().optional().describe("Resolution in DPI (default 200). Use 150 for faster/smaller, 300 for print quality."),
  },
  async ({ path: pdfPath, dpi }) => {
    // Preflight: verify Python + pymupdf before doing any file work
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

    // Python script renders each page to PNG and outputs all as base64 JSON
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

// ─── Startup dependency check ─────────────────────────────────────────────────
// Warn immediately if optional dependencies are missing so the issue is visible
// in the MCP client's output panel rather than surfacing only on first tool call.
checkPythonDeps().then((err) => {
  if (err) {
    process.stderr.write(
      `[file-reader-mcp] WARNING: read_pdf tool will not work.\n${err}\n`
    );
  }
});

// ─── Transport ────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
