import { extname, resolve, isAbsolute } from "path";
import { existsSync } from "fs";
import { z } from "zod";
import readXlsxFile, { readSheetNames } from "read-excel-file/node";

function mdCell(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

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

export function registerReadXlsx(server) {
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

      let sheetsToRead;
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
}
