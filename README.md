# Daily Notes Digest (Obsidian Plugin)

This plugin checks once per day for a daily note named `yyyy-mm-dd.md` in a configured folder, sends it to an LLM for summarization, and writes the summary to another folder as `yyyy-mm-dd_summary.md`.

## Features

- Scheduled checks (configurable interval, processes at most once per day)
- Configurable daily notes folder and summary output folder
- Configurable instruction prompt template (supports `{{date}}`)
- Daily note content is sent in a separate chat message to reduce prompt-injection risk
- Configurable OpenAI-compatible endpoint, API key, and model
- Manual command: **Generate today's digest now**

## Development

By default, dependabot creates patch releases, and devs create minor releases. If you want to create a major release, prepend your PR with the string `Major: `.

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Copy `main.js`, `manifest.json`, and optionally `styles.css` into your Obsidian vault plugin folder. `manifest.json` is generated from `manifest.template.json` during release packaging.

## Release package

```bash
npm run release
```

This produces:

- `release/daily-notes-digest-<version>.zip`
- `release/release-manifest.json` (SHA-256 hashes for the zip and included files)
