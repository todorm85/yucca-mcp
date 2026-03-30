import { readFile } from "fs/promises";
import { extname, resolve, isAbsolute } from "path";
import { existsSync } from "fs";
import { z } from "zod";

const MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

export function registerReadImage(server) {
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
}
