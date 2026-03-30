# yucca-mcp

An MCP server that reads files from the filesystem and returns them as visual or structured content for LLM consumption.

## Tools

| Tool | Description |
|------|-------------|
| `read_image` | Read an image file (PNG, JPG, GIF, WEBP, BMP, SVG) and return it as visual content |
| `read_eml` | Parse an `.eml` email file and return the full reply chain as interleaved text + inline images |
| `read_pdf` | Render each page of a PDF as a high-quality PNG image and return all pages as visual content |
| `read_xlsx` | Read an Excel `.xlsx` spreadsheet and return its contents as markdown tables |

## Requirements

### Node.js dependencies
```
npm install
```

### System dependencies (`read_pdf` only)

`read_pdf` uses [PyMuPDF](https://pymupdf.readthedocs.io/) to render PDF pages. It requires:

1. **Python 3.8+** — https://www.python.org/downloads/ (ensure it is added to PATH)
2. **pymupdf** Python package:
   ```
   pip install pymupdf
   ```

The server checks for these at startup and on every `read_pdf` call. If they are missing, a clear error message with install instructions is shown. The other tools (`read_image`, `read_eml`) have no Python dependency and work without it.

## Setup in VS Code (mcp.json)

```json
{
  "servers": {
    "file-reader": {
      "type": "stdio",
      "command": "node",
      "args": ["<absolute-path-to>/file-reader-mcp/index.js"]
    }
  }
}
```

## Usage examples

```
read_image  path="C:/screenshots/diagram.png"
read_eml    path="C:/mail/message.eml"
read_pdf    path="C:/docs/report.pdf"
read_pdf    path="C:/docs/report.pdf"  dpi=300
read_xlsx   path="C:/data/spreadsheet.xlsx"
read_xlsx   path="C:/data/spreadsheet.xlsx"  sheet="Sheet2"
read_xlsx   path="C:/data/spreadsheet.xlsx"  sheet=1
```
