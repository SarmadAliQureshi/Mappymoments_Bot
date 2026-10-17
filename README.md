# Mappy Moments Studio

Internal tool for the Mappy Moments team, built with Next.js.

- **Map Studio**: real maps (live map tiles, real coordinates) placed on AI-generated product photos, with map styles, colour editing and the three designs (Urban Canvas, Spanning the Distance, Coordinates of Commitment).
- **Ad Studio**: ad images and short videos of catalogue products from a text prompt, with a saved library.
- **AI Color Themes**: recolours the base Mapbox style from a text description, with a live preview and JSON download.

## Run locally

Requires Node 20.9 or newer.

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev
```

## Environment variables

| Variable | Needed for |
| --- | --- |
| `GEMINI_API_KEY` | All AI generation (images, video, prompts, colours). Kept on the server. |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox styles, colour editing and AI Color Themes. |
| `NEXT_PUBLIC_MAPTILER_KEY`, `NEXT_PUBLIC_THUNDERFOREST_KEY`, `NEXT_PUBLIC_JAWG_TOKEN` | The matching map styles; each is hidden when its key is missing. |
| `SITE_PASSWORD` | Set this on any public deployment. Everyone is asked for it (any user name). |
| `DATA_DIR` | Optional folder for the Ad Studio library (default `./data`). |

`NEXT_PUBLIC_` keys are visible in the browser by design, so restrict them to the deployed domain in each provider's dashboard.

## Deploy (Render, free plan)

The repo includes `render.yaml`. In Render choose **New → Blueprint**, pick this repository, then enter the environment variables when asked. Render runs `npm install --include=dev && npm run build` and `npm start`.

On the free plan the service sleeps after about 15 minutes without visits (the next visit takes up to a minute to wake it), and its disk is wiped on every restart, so the Ad Studio library does not last between restarts.
