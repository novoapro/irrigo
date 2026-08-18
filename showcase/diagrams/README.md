# Diagrams

Editable Excalidraw source + rendered PNGs, embedded in the showcase's Architecture section.

| File | What it shows |
|------|---------------|
| `architecture.excalidraw` / `.png` | Overall system architecture — edge (Arduino), backend, client, and external services, with data-up / control-down flows |
| `collaboration.excalidraw` / `.png` | Smart-mode component collaboration — how the AI planner, LLM provider, guard, run engine, and CompAI cooperate across a **plan** phase (1–5) and an **execute** phase (6–13) |

## Editing

Open the `.excalidraw` files at [excalidraw.com](https://excalidraw.com) (File → Open) or with the
**Excalidraw** VS Code extension. Colors follow a semantic scheme: purple = AI/LLM, orange =
trigger/actuation, amber = decision/guard, blue = services/data, green = telemetry/state.

## Regenerating the PNGs

The showcase embeds the PNGs, so re-render after editing. Two options:

**A — the skill's official renderer** (renders via Excalidraw itself; needs network to `esm.sh`):

```bash
cd /Users/manuel/Desktop/development/excalidraw-diagram-skill/references
uv run python render_excalidraw.py <path>/architecture.excalidraw --scale 2
```

**B — `render_png.py`** (bundled here; offline, no network — draws the shapes directly). It reuses
the skill's Playwright/Chromium install:

```bash
cd /Users/manuel/Desktop/development/excalidraw-diagram-skill/references
uv run python <path>/showcase/diagrams/render_png.py <path>/showcase/diagrams/architecture.excalidraw
```

`render_png.py` supports the subset of Excalidraw used here (rectangles, text, lines, arrows,
`roughness: 0`). For full-fidelity rendering (hand-drawn strokes, etc.), use option A.
