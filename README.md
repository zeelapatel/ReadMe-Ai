# Code Handover Doc Generator (static)

A static page to paste code and generate a handover-style Markdown document for developers leaving a project. It supports both local-only heuristic generation and optional AI-powered generation.

## How to use

- Open `index.html` in your browser, or serve the folder with any static server.
- Fill optional fields (project name, repo URL, owner, context).
- Paste code (or drag & drop a file) into the code box.
- Optionally enable AI mode and provide provider, model, and API key.
- Click "Generate Documentation".
- Use Copy or Download to export the Markdown.

## Privacy

- Local mode: No data leaves your browser.
- AI mode: Your pasted code and context will be sent to the selected provider to generate improved documentation.

## AI mode

- Providers: OpenAI (`https://api.openai.com/v1/chat/completions`) or OpenRouter (`https://openrouter.ai/api/v1/chat/completions`).
- You must provide your API key and a model name (e.g., `gpt-4o-mini`).
- Temperature controls creativity (0.0–1.0, default 0.2).
- The prompt includes a baseline local doc plus a compact static analysis of imports, functions, classes, routes, env vars, and dependency hints.
- Output is a single Markdown document.

## Notes

- Language detection is heuristic; you can override via the select.
- The analyzer scans for imports, functions, classes, routes, env vars, and common package hints.
- Generated content is a starting point; review and refine before sharing.
