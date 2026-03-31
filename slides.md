---
marp: true
theme: default
paginate: true
---

<style>
section.lead h1 {
  color: #2d6a4f;
}
h2 {
  color: #2d6a4f;
}
table th {
  background-color: #2d6a4f;
  color: white;
}
blockquote {
  border-left: 4px solid #2d6a4f;
}
</style>

# 🌵 YUCCA-MCP

**Accuracy-focused MCP server for local file analysis**

https://github.com/todorm85/yucca-mcp

---

## 📁 The common scenario (outside coding)

You have a few files — some emails, a PDF or two, maybe a spreadsheet data you`ve prepared.

You need to **make a decision** or **understand something**.

- Work: vendor comparison, expense review, competitive analysis
- Personal: which appliance machine to buy, last month's banks statements and personal ledger

You want AI to help. **Quickly and reliably. Without heavy setup.**

---

## 🔄 The common approaches

| Approach |  |
|----------|----------|
| **Use Online Vendor platform** | Like ChatGPT Projects etc. Everything online in vendor platform. |
| **Vendor MCP integrations to pull data** | Run and iterate over insights with the agent on local text files but use data from different online sources like Office365, GDrive etc. |
| **Local-first analysis** | Let the agent work entirely with local files itself alongside you. |

---

## 💡 Local-first analysis

```
You already have files
        ↓
   Analyze locally        ← agent uses built in tools or MCP to read/edit the files
   with AI agent
        ↓
   Capture insights       ← usually saved as .md files
        ↓
   Iterate & share        ← context persists, provider-agnostic
```

---

## ✨ Why local-first?

- 🔒 **Privacy** — data and insights stay on your machine
- 🔄 **Portability** — not locked into any single AI provider. Your context is just files
- 🎛️ **Control** — you curate what goes into the LLM context
- 💾 **Persistence** — sessions don't expire, nothing is lost
- ⚡ **Speed** — nearly instant for small workloads, no API round-trips
- 🌐 **Access** — works with any file you can download, not just what vendor MCPs expose
- 📐 **Right-sized** — no heavy platform needed for a 10-minute decision

---

<!-- _class: invert -->

## ⚠️ When you need guaranteed accuracy and completeness

General-purpose MCP file readers optimize for token efficiency — not for preserving every detail. When your task demands that **nothing is lost or misrepresented**, they fall short.

---

### 📧 Email (.eml)

Existing MCP tools:
- Fail on nested attachments (e.g. eml inside eml)
- Give the LLM **text + image captions**, not actual images
- LLM must decide to extract attachments separately → **nondeterministic**
- Leads to **missed points and hallucinations**

---

### 📄 PDF

All popular PDF MCP servers do **text extraction**.

- Fine for well-structured documents
- **Fails** on random PDFs with no defined structure — exactly what you get from various sources
- Layout, charts, forms, scanned images — **all lost**

---

### 📊 Spreadsheets & images

- **xlsx**: copy-pasting into chat is tedious and error-prone. Other MCPs exist, but that's yet another separate tool.
- **images**: built into most agents already — but not all.

---

### 🧩 The meta-problem

You end up needing **multiple separate MCP servers**:
- Different licenses
- No clear support commitments
- None optimized for **analysis** where accuracy matters more than token efficiency

---

## 🌵 yucca-mcp

> *"Accuracy focused file reader for MCP — not a file converter."*

Most file-reading tools optimize for token efficiency. 
YUCCA-MCP optimizes for **giving the LLM the most accurate and full representation of your files** — so nothing is missed.
Designed for the analytical phase where every bit of information you feed the model matters.
The LLM sees what's actually on the page, not a lossy text extraction. No missed charts, forms, or inline images.

---

### How it handles each format

| Format | Approach | Why |
|--------|----------|-----|
| **.eml** | Full reply chain + real inline images in one pass | Accuracy over token savings |
| **.pdf** | Each page rendered as PNG (200dpi) | Preserves layout, charts, forms |
| **.xlsx** | Clean markdown tables | Structured, LLM-ready |
| **images** | Base64 for 7 formats | Fallback for agents without built-in support |

---

### Design principles

- **Accuracy over token efficiency** — the LLM sees what's actually on the page
- **One server, lightweight deps** — pdf-to-img, read-excel-file. No heavy frameworks.
- **Local parsing only** — file processing happens on your machine. No data sent to external services for conversion.

*(The LLM call itself depends on your agent's configuration)*

---

<!-- _class: invert -->

# 🎬 Live demos

---

# 📧 Demo: Email Thread Analysis

**Task:** Read an email thread with an inline image. Ask a follow-up question requiring the image.

| | Without yucca-mcp | With yucca-mcp |
|---|---|---|
| Read .eml | ❌ Text only — inline image missing from context | ✅ `read_eml` — full thread + inline images, one call |
| Follow-up on image | ❌ Long detour to identify, extract, and load it | ✅ Answered immediately — image already in context |

---

# 🖥️ Demo: Monitor Comparison

**Task:** Compare 4 monitors — prices, matrix type, size, resolution — from mixed files.

| | Without yucca-mcp | With yucca-mcp |
|---|---|---|
| .eml | ❌ Raw text, 7 chunked reads — image missed | ✅ `read_eml` — body + inline image, one call |
| .xlsx | ❌ Python script (installs openpyxl on the fly) | ✅ `read_xlsx` — clean markdown table |
| .pdf | ❌ Python script (installs pdfminer on the fly, only text extracted) | ✅ `read_pdf` — rendered pages, layout intact |
| Result | ⚠️ Correct table — after many extra steps | ✅ Complete table — one pass, no detours |

---


## 🏗️ Architecture

```
Any MCP-compatible agent
      ↓ (MCP stdio)
  yucca-mcp
      ↓
  [file parsers]
      ↓
  agent output → .md insights
```

---

## ⚖️ Honest trade-offs

- Not a silver bullet all in one solution
- YUCCA mcp tools are suitable for use **after** data gathering/research — it's about analyzing and iterating over what has already been scoped and mostly relevant for the task at hand.
- Small scale or end phases tasks of large projects where you want quick, iterative, manual control over context.
- PDF-as-image **uses more tokens** than text extraction
- .eml parsing focuses on body + inline images — **attachments not processed, should be saved seaprately if relevant**

---

## 🗺️ Roadmap

🚧 **Work in progress**

- **More file formats**
    - docx
    - pptx
    - suggestions?

---

## 🚀 Try it yourself

**Install:**
Make sure you have node.js (https://nodejs.org/en/download) installed then
```
git clone https://github.com/todorm85/yucca-mcp
cd yucca-mcp
npm install
```

**VS Code mcp.json:**
```json
{ "servers": 
    { "yucca-mcp": {
        "type": "stdio",
        "command": "node",
        "args": ["<path-to>/yucca-mcp/index.js"]
}}}
```

---

# Questions?
