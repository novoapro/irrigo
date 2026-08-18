# Irrigo — Engineering Showcase

A self-contained, static single-page app that walks through the Irrigo system for a
technical interview: architecture, entry points, the multi-provider **LLM scheduling
integration** (the centerpiece), security posture, reliability, and a talking-points
cheat sheet.

It reuses Irrigo's own design language — the exact color tokens, spacing scale,
typography (Manrope), and component recipes lifted from `frontend/src/styles.css` —
so it looks like part of the product.

## Files

| File | Purpose |
|------|---------|
| `index.html` | All content and the CSS/HTML diagrams |
| `styles.css` | Irrigo design tokens (light + dark) + showcase components |
| `app.js` | Sidebar scrollspy, theme toggle, mobile menu (vanilla JS, no deps) |
| `diagrams/` | Editable **Excalidraw** architecture + collaboration diagrams (source + PNG) — see `diagrams/README.md` |

No build step. No framework. No network calls except the Google Fonts stylesheet
(Manrope / JetBrains Mono), which degrades gracefully to system fonts offline.

## Run it locally

Just open `index.html` in a browser, or serve the folder with any static server:

```bash
cd showcase
python3 -m http.server 8090
# → http://localhost:8090
```

## Host it

Drop the three files on any static host (Nginx, S3 + CloudFront, GitHub Pages,
Netlify, Vercel, an `nginx` container, …). There is no backend and no state.

## Presenting from it

The left nav is the running order. Sections 01–04 set up the system top-down;
**05 (LLM Integration)** and **06 (LLM Considerations)** are the core of the pitch;
**07 (Security)** is the honest gap analysis; **09 (Talking Points)** is the
question/answer cheat sheet. Toggle dark mode from the sidebar to match the room.
