import { readFile } from "fs/promises";
import { extname, resolve, isAbsolute } from "path";
import { existsSync } from "fs";
import { z } from "zod";

// ─── EML parsing helpers ──────────────────────────────────────────────────────

function decodeQP(str) {
  return str
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

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

function parseEml(rawBytes) {
  const raw = rawBytes.toString("latin1");

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

    if (ct.startsWith("image/") && cid) {
      const mimeType = ct.split(";")[0].trim();
      const data = part.body.replace(/\s+/g, "");
      images.set(cid, { data, mimeType });
    }

    if (!plainText && ct.startsWith("text/plain")) {
      if (cte === "quoted-printable") {
        plainText = decodeQP(part.body);
      } else if (cte === "base64") {
        plainText = Buffer.from(part.body.replace(/\s+/g, ""), "base64").toString("latin1");
      } else {
        plainText = part.body;
      }
    }

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

function extractCidOrderFromHtml(html) {
  const cids = [];
  const re = /src=["']cid:([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    cids.push(m[1].trim());
  }
  return cids;
}

function splitReplyChain(text) {
  const separatorRe = /(?:^|\n)_{3,}\r?\n(?=From:\s)/gm;
  const chunks = text.split(separatorRe);

  const messages = [];
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    const fromMatch = trimmed.match(/^From:\s*(.+)/m);
    const dateMatch = trimmed.match(/^(?:Sent|Date):\s*(.+)/m);

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

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerReadEml(server) {
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

      const plainCidRe = /\[cid:([^\]]+)\]/g;
      const plainCids = [];
      let m;
      while ((m = plainCidRe.exec(plainText)) !== null) plainCids.push(m[1].trim());
      const cidOrder = plainCids.length > 0 ? plainCids : extractCidOrderFromHtml(htmlText);

      const messages = splitReplyChain(plainText);
      const totalMessages = messages.length;

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

      const content = [];

      if (plainCids.length > 0) {
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
        content.push({ type: "text", text: structuredText });

        for (let i = 0; i < cidOrder.length; i++) {
          const img = images.get(cidOrder[i]);
          if (!img) continue;
          content.push({ type: "image", data: img.data, mimeType: img.mimeType });
        }
      } else if (images.size > 0) {
        content.push({ type: "text", text: structuredText });
        content.push({ type: "text", text: `\n${"─".repeat(60)}\n${images.size} embedded image(s) found (no positional references in text):\n` });

        for (const [, img] of images) {
          content.push({ type: "image", data: img.data, mimeType: img.mimeType });
        }
      } else {
        content.push({ type: "text", text: structuredText });
      }

      return { content };
    }
  );
}
