# yucca-mcp

An accuracy-focused MCP server for local file analysis. Most file-reading MCP tools optimize for token efficiency — yucca-mcp optimizes for **giving the LLM the most accurate representation of your files**, so analysis results are reliable and nothing is missed.

See [overview](https://todorm85.github.io/yucca-mcp/overview.html)

Turns emails, PDFs, spreadsheets, and images into LLM-ready content. All-in-one file reader, not a file converter.

## Use case

You have a few files — some emails, a PDF or two, maybe a spreadsheet — and you need AI to help you make sense of them. Could be a vendor comparison at work, reviewing email quotes from contractors, or analyzing last month's bank statement.

yucca-mcp is built for this **analytical phase**: you already have the files, you need an AI agent to understand them **without losing information**. Other tools extract text and captions to save tokens — but that means the LLM never sees the actual charts, forms, inline images, or layout. When accuracy matters, that's not good enough.

yucca-mcp translates files directly into native MCP output (text + images) so the agent gets everything in one pass — no intermediate files, no multi-step extraction, no information loss.

### Why not just use...

| Alternative | Problem |
|-------------|---------|
| **Vendor platforms** (ChatGPT Projects, etc.) | Data leaves your machine, locked to one provider, limited context control |
| **Vendor MCP integrations** (Gmail, Outlook, Drive) | Auth complexity, API limits, multiple configs — and not every source has an MCP |
| **Let the agent parse files itself** | Writes its own converters on the fly — unreliable, slow, unpredictable |
| **Multiple separate MCP servers** | Different licenses, no clear support, none optimized for analysis accuracy |

### Design principles

- **Accuracy first** — this is the core differentiator. Every design decision prioritizes giving the LLM the most complete and faithful representation of the file, even at the cost of using more tokens. Token-efficient alternatives lose layout, miss images, and produce unreliable analysis.
- **Local parsing only** — all file processing happens on your machine using local libraries. No data sent to external services. (The LLM call itself depends on your agent's configuration.)
- **Lightweight** — minimal dependencies (pdf-to-img, read-excel-file). No heavy frameworks.
- **Right-sized** — designed for small-scale analysis workloads, not bulk data processing

## Tools

| Tool | Description |
|------|-------------|
| `read_eml` | Parse an `.eml` email file and return the full reply chain as interleaved text + inline images |
| `read_pdf` | Render each page of a PDF as a high-quality PNG image and return all pages as visual content |
| `read_xlsx` | Read an Excel `.xlsx` spreadsheet and return its contents as markdown tables |
| `read_image` | Read an image file (PNG, JPG, GIF, WEBP, BMP, SVG) and return it as visual content |

### How each tool works

- **read_eml**: Parses the entire reply chain, extracts **actual inline images** (not just captions), and gives the LLM everything in one pass. Existing MCP tools fail on nested attachments and only provide image captions, forcing the LLM to decide nondeterministically what to extract — leading to missed points and hallucinations. yucca-mcp ensures the LLM sees exactly what a human would see reading the email.
- **read_pdf**: Renders each page as a PNG (200 DPI default) — the LLM sees the page exactly as it looks. All popular PDF MCP servers do text extraction, which loses layout, charts, forms, and scanned content. For random PDFs from various sources with no predictable structure, text extraction produces unreliable analysis. Rendering preserves everything.
- **read_xlsx**: Converts spreadsheet data into clean markdown tables the LLM can reason over directly — no manual copy-paste, no structural loss.
- **read_image**: Base64 encoding for 7 image formats. Fallback for agents without built-in image support.

## Requirements

```
npm install
```

All tools use Node.js packages only — no Python or system dependencies required.

## Setup in VS Code (mcp.json)

```json
{
  "servers": {
    "yucca-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["<absolute-path-to>/yucca-mcp/index.js"]
    }
  }
}
```

## Usage examples

```
read_eml    path="C:/mail/thread.eml"
read_pdf    path="C:/docs/report.pdf"
read_pdf    path="C:/docs/report.pdf"  dpi=300
read_xlsx   path="C:/data/expenses.xlsx"
read_xlsx   path="C:/data/expenses.xlsx"  sheet="Sheet2"
read_image  path="C:/screenshots/diagram.png"
```

## Trade-offs

- PDF-as-image uses more tokens than text extraction — but the LLM actually sees what's on the page
- .eml parsing focuses on body + inline images — attachment inlining coming soon
- Designed for small-scale analysis workloads, not bulk data processing

## Roadmap

- Inline .eml attachments directly in the response
- Support for additional file formats
