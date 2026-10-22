# FootNote — AI Research Notebooks (RAG, from scratch)

An AI-powered research assistant inspired by Gemini/NotebookLM: create isolated notebooks, add sources
(PDF, plain text, website URL, YouTube video, VTT transcript), and ask questions that are answered **only**
from what you gave it — every claim cited back to the exact page, timestamp, or passage.

Beyond Q&A, a notebook can generate a **two-host audio overview** of its sources and, for notebooks built
from linked YouTube videos, a **learning roadmap** that clusters and orders the concepts those videos
actually teach.

Built with Next.js 16, Clerk, Neon (Postgres) + Prisma, Qdrant, Redis, OpenAI, shadcn/ui-style
components, and Framer Motion.

Live demo: https://notellm-two.vercel.app/
 
---

## 1. Stack & why

| Concern            | Choice                                                       | Why                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework          | Next.js 16 (App Router)                                      | Server components for data loading, route handlers for the API, Inngest for durable background jobs — no separate backend service needed. |
| Auth               | Clerk                                                        | Notebook isolation is enforced by `ownerId`, sourced from Clerk's `userId`, at the data layer (every query filters by it), not just hidden in the UI.  |
| Relational DB      | Neon Postgres + Prisma                                       | Source of truth for notebooks, sources, chunks (with citation metadata), chat history, notes, and generated audio/roadmap artifacts.                   |
| Vector DB          | Qdrant                                                       | Stores chunk embeddings with `notebookId`/`sourceId` payload indexes so retrieval — and roadmap clustering — is always scoped to one notebook.          |
| Cache / job status | Redis (ioredis)                                              | Fast, ephemeral progress layer (ingest, audio generation, roadmap generation) so the UI can poll without hammering Postgres; Postgres stays durable. Background jobs themselves run on Inngest, not Redis.     |
| LLM / embeddings   | OpenAI (`gpt-4o-mini`, `text-embedding-3-small`)             | Configurable via env vars.                                                                                                                              |
| Text-to-speech     | OpenAI TTS (`tts-1`)                                       | Two distinct voices synthesize the generated podcast-style script for the audio overview. `tts-1` renders a line in ~3.5s, so a full episode fits inside the 300s serverless function limit; `gpt-4o-mini-tts` sounds better but is 20x slower. |
| Background jobs    | Inngest                                                      | Ingest/audio/roadmap pipelines are enqueued as durable Inngest events (`lib/inngest/functions.ts`) and run via `/api/inngest`; Inngest provides retries, step-level checkpointing, and survives restarts. |
| UI                 | Tailwind + Radix primitives (shadcn pattern) + Framer Motion | Dark "ink" theme with an amber→teal status motif for indexing/generation progress.                                                                      |

---

## 2. Architecture

```
src/
  app/
    page.tsx                          marketing landing (redirects signed-in users to /dashboard)
    (auth)/sign-in, sign-up            Clerk-hosted auth screens
    dashboard/page.tsx                 notebook grid — create / rename / delete
    notebook/[id]/page.tsx             workspace: sources rail | chat | studio (source/audio/roadmap viewer)
    notebook/shared/[slug]/page.tsx    read-only public view of a shared notebook
    api/
      notebooks/                       CRUD
      notebooks/[id]/sources/          add a source (upload flow)
      notebooks/[id]/query/            streaming RAG endpoint
      notebooks/[id]/notes/            pinned notes CRUD
      notebooks/[id]/audio/            generate/fetch audio overview(s)
      notebooks/[id]/audio/[audioId]/  fetch a specific audio overview + status
      notebooks/[id]/roadmap/          generate/fetch a learning roadmap
      notebooks/[id]/roadmap/[roadmapId]/  fetch a specific roadmap + status
      notebooks/[id]/share/            enable/revoke public share link
      sources/[id]/                    delete
      sources/[id]/reindex/            re-run the ingest pipeline
      sources/[id]/status/             fast polling endpoint (Redis-backed)
       sources/[id]/content/            full chunk list for the source viewer
       sources/[id]/file/                streamed original file (PDF) for the viewer
       web-preview?url=                   SSRF-protected check: does this page allow iframe embedding?
       web-preview/snapshot               lazy screenshot generation (Firecrawl → Cloudinary cache)
      notes/[id]/                      update/delete a single note
      public/notebooks/[slug]/         read-only fetch for shared notebooks
      credits/                         current user's credit balance/refresh time
  components/
    notebook/                          NotebookCard, SourcesRail, NotebookFormDialog
    source/                            AddSourceDialog, SourceListItem, StatusDot (signature motif)
    chat/                               ChatPanel (streaming), MessageBubble, CitationChip
    studio/                            StudioPanel (source viewer), AudioOverviewPanel, RoadmapPanel
    ui/                                 shadcn-style primitives (button, dialog, tabs, etc.)
  hooks/                                use-source-status, use-audio-status, use-roadmap-status, use-credits
  lib/
    extractors/                        pdf.ts, url.ts, youtube.ts, vtt.ts (+ inline text handling)
    chunking.ts                        sentence-aware sliding window / per-page / per-cue chunkers
    ingest.ts                          orchestrates extract -> chunk -> embed -> index -> persist
    rag.ts                             retrieval + prompt construction + streaming + citation extraction
    clustering.ts                      dependency-free k-means (cosine distance, k-means++ seeding)
    roadmap-pipeline.ts                cluster -> LLM-label -> vote-based topological ordering (Kahn's algorithm)
    audio-pipeline.ts                  two-host script generation -> per-line TTS -> concatenation
    credits.ts                         per-user metered-action credit budget (Postgres, row-locked)
    rate-limit.ts                      Redis-backed abuse guard
    db.ts / redis.ts / qdrant.ts / openai.ts   infra clients
    inngest/
      client.ts                        Inngest client + safeSend (dev-server registration-aware enqueue)
      functions.ts                     source/created, audio/generate, roadmap/generate, artifact/generate
  app/api/inngest/                     Inngest serve() endpoint (exempt from Clerk auth in proxy middleware)
     
### Data model (`prisma/schema.prisma`)

- **Notebook** — `ownerId` (Clerk user id) enforces isolation; every API route re-checks ownership
  server-side. `isPublic` / `shareSlug` back the read-only public share link.
- **Source** — one row per uploaded/linked source, with `status` (`UPLOADING → QUEUED → INDEXING → READY | FAILED`),
  `chunkCount`, and type-specific metadata (`pageCount`, `durationSec`, `originUrl`).
- **Chunk** — one row per indexed chunk, carrying whatever citation metadata its source type supports:
  `page` (PDF), `startSec`/`endSec` (YouTube/VTT), `startChar`/`endChar` (text/URL). `vectorId` maps 1:1
  to the point id in Qdrant, so a citation (or a roadmap cluster) can always be resolved back to both the
  Postgres row (for display) and the original vector (for clustering/re-embedding).
- **Message** — chat history per notebook, with a `citations` JSON blob so past answers keep their sourcing.
- **Note** — a pinned, user-authored note per notebook, independent of the chat.
- **AudioOverview** — one row per generated podcast-style overview: `status`
  (`SCRIPTING → SYNTHESIZING → READY | FAILED`), the generated `script`, and the resulting audio.
- **Roadmap** — one row per generated learning roadmap: `status`
  (`CLUSTERING → LABELING → ORDERING → READY | FAILED`) plus the persisted nodes and edges.
- **UserCredits** — one row per user tracking the metered-action balance and next refresh time.

---

## 3. Ingestion pipeline

1. **Upload** (`POST /api/notebooks/[id]/sources`) — accepts either `multipart/form-data` (PDF/VTT file)
   or JSON (`TEXT`/`URL`/`YOUTUBE`). Creates a `Source` row with `status: QUEUED` and returns immediately.
2. **Extract** (`lib/extractors/*`) — type-specific:
   - **PDF**: `pdf-parse` with a per-page callback, so every page keeps its own text and page number.
   - **URL**: fetch + Mozilla Readability (the engine behind Firefox Reader View) strips nav/ads down to
     article text.
   - **YouTube**: `youtube-transcript` / `youtubei.js` pulls the caption track with per-cue timestamps.
   - **VTT**: `node-webvtt` parses uploaded transcript files into the same cue shape.
   - **Text**: used as-is.
3. **Chunk** (`lib/chunking.ts`) — not a single one-size-fits-all splitter:
   - Plain text/URL: sentence-aware sliding window (~450 tokens, ~80 token overlap), tracking character
     offsets for citation highlighting.
   - PDF: chunked *within* each page, so a chunk never spans two pages and can always cite one page number.
   - YouTube/VTT: consecutive caption cues are grouped up to the token budget, keeping a precise
     `[startSec, endSec]` range per chunk for "jump to timestamp" citations.
4. **Embed** (`lib/openai.ts`) — `text-embedding-3-small`, batched.
5. **Index** (`lib/qdrant.ts`) — upserted into a single shared Qdrant collection with `notebookId` and
   `sourceId` as indexed payload fields, so every search (and every roadmap clustering run) is filtered to
   one notebook without needing a collection per notebook.
6. **Persist** — chunk rows written to Postgres in the same pass; `Source.status` flips to `READY`.

Progress is written to Redis at each stage (`lib/redis.ts::setProgress`) and polled by the UI every 1.5s
via `useSourceStatus`, which drives the amber "indexing" pulse → teal "indexed" pop in the sources rail.
Postgres is still the durable source of truth — Redis is a cache that self-heals on the next write.

Indexing itself runs as a durable Inngest job: `POST /api/notebooks/[id]/sources` and
`POST /api/sources/[id]/reindex` create the `Source` row (status `QUEUED`) then enqueue a
`source/created` event via `safeSend` (`lib/inngest/client.ts`). In local dev `npm run dev` starts both
Next.js and `npx inngest-cli@latest dev` in the same terminal; if you run `next dev` directly, start the
dev server in a second terminal so the event is actually executed instead of sitting in `QUEUED`. In
production, set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` (from the Inngest dashboard) as Vercel
project env vars; Inngest Cloud then POSTs back to `/api/inngest` (which the proxy middleware lets through
unauthenticated via the `isInngest` matcher) to run each step. `safeSend` fails loudly and leaves the row
`QUEUED`→`READY` instead of silently dropping the event if the dev server isn't synced or the keys are
missing, and the status endpoint auto-marks any source that stays `QUEUED` > 2 minutes as `FAILED` with a
retryable message (retry via the existing reindex route).

---

## 4. Retrieval / RAG flow (`lib/rag.ts`)

1. Embed the user's question.
2. `searchNotebook()` — Qdrant cosine search filtered to `notebookId`, top-8, with a similarity floor so
   low-relevance chunks are dropped instead of padding the context.
3. If nothing clears the floor, short-circuit with an honest "not enough information" answer instead of
   asking the model to improvise.
4. Otherwise, build a numbered context block (`[1] Source: "..."\n<content>`) and send it with a system
   prompt that requires every factual sentence to end in a bracket citation (`[1]`, `[1][3]`, …) and
   explicitly forbids fabricating a citation number.
5. Stream the completion back to the client as plain text; once the stream ends, `extractCitations()`
   parses the `[n]` markers out of the finished answer and maps them back to the actual retrieved chunks
   (deduped, in first-seen order) — so displayed citations are always ones the model actually used, not
   just everything that was retrieved.
6. The stream is terminated with a null-byte-delimited sentinel followed by the citations JSON, which the
   client splits off before rendering — one round trip, no second fetch for citations.
7. Clicking a citation chip opens the **Studio panel**, which fetches the full source content and scrolls/
   highlights the exact cited chunk (page for PDFs, timestamp range for video/transcript, offset for text).

---

## 5. Learning roadmap (`lib/roadmap-pipeline.ts`)

For any notebook with at least two indexed YouTube sources, the roadmap pipeline turns a pile of linked
videos into an ordered "concept syllabus":

1. **Gather** every `READY` YouTube source's chunks (and their already-computed embeddings, pulled back
   out of Qdrant rather than re-embedded).
2. **Cluster** (`lib/clustering.ts`) — a dependency-free k-means implementation over cosine distance, with
   k-means++ seeding and a seeded PRNG so the same chunk set clusters deterministically instead of
   reshuffling on every regenerate. Cluster count is picked automatically (`pickClusterCount`, roughly
   `√(n/2)` bounded between 3 and 9) so a roadmap stays skimmable regardless of corpus size. Clusters too
   thin to represent a real concept (fewer than 2 chunks) are dropped.
3. **Label** — each surviving cluster's most representative sample chunks are sent to the LLM
   (`labelClusters` in `lib/openai.ts`) to get a short concept name and summary.
4. **Order** — rather than ordering by upload date, the pipeline looks at *where in each video* a
   cluster's chunks fall (normalized 0–1 position), has every video that contains two clusters "vote" on
   which one comes first, and topologically sorts the resulting precedence graph with **Kahn's algorithm**
   (tie-broken by average position across videos when the vote graph is ambiguous or cyclic). The result:
   concepts are ordered by how their terminology actually progresses across the linked videos, not by
   which video happened to be added first.
5. **Persist** nodes (label, summary, keywords, source video + timestamps) and edges to the `Roadmap` row.

Progress (`CLUSTERING → LABELING → ORDERING → READY`) is polled the same way as ingestion, via
`useRoadmapStatus`. The `RoadmapPanel` renders the ordered concept list with jump-to-timestamp links back
into the source videos.

---

## 6. Audio overview (`lib/audio-pipeline.ts`)

Generates a two-host, podcast-style summary of a notebook (or a single source):

1. **Assemble context** from the `READY` source(s), splitting the character budget dynamically across
   however many sources are included — so a single-source notebook gets the full budget instead of a
   fixed per-source cap starving it of context.
2. **Script** — `generateAudioScript()` asks the LLM for a two-speaker dialogue script.
3. **Synthesize** — `synthesizeAudioScript()` renders each line with OpenAI TTS (`tts-1`) using
   a distinct voice per speaker, then concatenates the result into a single audio file.
4. **Persist** the script and audio to the `AudioOverview` row.

Like ingestion and the roadmap pipeline, this runs as a durable Inngest job (the
`audio/generate` event enqueued by `POST /api/notebooks/[id]/audio`) with live progress
(`SCRIPTING → SYNTHESIZING → READY`) polled through `useAudioStatus`, and is rendered in the
`AudioOverviewPanel`. The synthesis is bounded to a few-minute time budget so a full episode
fits inside the 300s Serverless Function limit on Vercel Hobby.

---

## 7. Other features

- **Notes** — freeform, user-authored notes pinned per notebook, independent of chat history
  (`/api/notebooks/[id]/notes`, `/api/notes/[id]`).
- **Public sharing** — a notebook owner can generate a share link (`POST /api/notebooks/[id]/share`);
  visiting `/notebook/shared/[slug]` gives read-only access without requiring the visitor to sign in.
  Revoking and re-sharing reuses the same slug so previously shared links keep working.
- **Credits** — every metered action (chat message, source upload, audio generation, roadmap generation)
  draws from a per-user credit budget that refreshes on a fixed window (`lib/credits.ts`), with the
  balance surfaced via `/api/credits` and polled by `useCredits()` for the dashboard badge. Balance checks
  use a row-locked Postgres transaction so two concurrent requests can't both slip through on the last
  credit.

---

## 8. Setup

### Prerequisites

- Node 20+
- A [Neon](https://neon.tech) Postgres database
- A [Qdrant](https://qdrant.tech) instance (Qdrant Cloud free tier works)
- A Redis instance (Upstash free tier works)
- An [OpenAI](https://platform.openai.com) API key (used for chat, embeddings, and TTS)
- A [Clerk](https://clerk.com) application

### Steps

```
git clone <your-fork-url> index
cd index
npm install
cp .env.example .env.local   # fill in every value — see table below
npm run db:push              # sync Prisma schema to Neon
npm run dev                  # http://localhost:3000
```

Qdrant's collection is created automatically on first use (`ensureCollection()` in `lib/qdrant.ts`) — no
manual setup needed beyond having a reachable Qdrant URL + key.

### Environment variables

| Variable                                                                                     | Purpose                                                                          |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                | Neon Postgres connection string                                                  |
| `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION`                                           | Vector DB connection + collection name                                           |
| `REDIS_URL`                                                                                   | Redis connection string (status cache + rate limiting; **not** the job queue). Use the TCP `rediss://` form for TLS — do not use the Upstash REST `https://` URL.  |
| `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `OPENAI_EMBEDDING_MODEL`                               | LLM + embedding config                                                         |
| `OPENAI_TTS_MODEL`                                                                             | *(optional)* TTS model for audio overviews — defaults to `tts-1`               |
| `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`                                              | *(voice mode)* OpenAI Realtime model + voice identifier                          |
| `VOICE_TOKEN_SECRET`                                                                           | *(voice mode)* HMAC secret for signing tool tokens — generate with `openssl rand -base64 32` |
| `VOICE_TOKEN_TTL_SECONDS`                                                                      | *(voice mode)* Ephemeral token TTL — defaults to `600` (10 min)                  |
| `VOICE_CREDIT_COST_PER_BLOCK`, `VOICE_CREDIT_BLOCK_MINUTES`                                   | *(voice mode)* Credit cost + duration per voice block                           |
| `CREDITS_MAX_PER_WINDOW`                                                                       | *(optional)* Credits per user per window — defaults to `200`                      |
| `CREDITS_WINDOW_HOURS`                                                                         | *(optional)* Hours before the credit balance refreshes — defaults to `6`         |
| `INNGEST_DEV`                                                                                     | *(local dev)* Set to `1`; runs events through the local `inngest-cli dev` server instead of Inngest Cloud |
| `INNGEST_EVENT_KEY`                                                                            | **Production only.** Inngest event key (from the Inngest dashboard)              |
| `INNGEST_SIGNING_KEY`                                                                          | **Production only.** Inngest signing key (from the Inngest dashboard)            |
| `INNGEST_DEVSERVER_URL`                                                                        | *(optional)* Override the dev-server URL (default `http://localhost:8288`)       |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`                                       | Clerk auth                                                                       |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `SIGN_UP_URL` / `AFTER_SIGN_IN_URL` / `AFTER_SIGN_UP_URL`   | Clerk redirect routing                                                           |
| `NEXT_PUBLIC_APP_URL`                                                                          | Used for absolute links where needed (e.g. share links)                          |
| `FIRECRAWL_API_KEY`                                                                           | *(optional)* Used by the Studio panel to screenshot non-embeddable web pages — falls back to reader view when unset |

### Deployment

Deploy the Next.js app to Vercel (or any Node host). Point `DATABASE_URL`/`QDRANT_URL`/`REDIS_URL` at
managed services (Neon, Qdrant Cloud, Upstash). Background jobs (source ingest, audio generation,
roadmaps, artifacts) run on Inngest: set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` as Vercel
project environment variables and make sure Inngest Cloud has synced your app (open `https://<your-domain>/api/inngest`
in a browser — the response is the registered function list). There is no separate worker process to run
for this scale; the Inngest serve endpoint dispatches each step back into your own API routes.

### Troubleshooting: sources (or audio/roadmaps) stuck in QUEUED

A source whose `status` never leaves `QUEUED` almost always means the Inngest event was enqueued but no
worker ever ran it. Check the following, in order:

1. **Local dev — is the Inngest dev server running?** `npm run dev` starts Next.js *and* the
   locally installed `inngest-cli dev` (no per-run download) in one terminal via `concurrently`; the
   dev server is pointed at `http://localhost:<PORT>/api/inngest` with `--no-discovery` so it never
   auto-registers the wrong URL. If you launched `next dev` directly, start it in a second terminal:
   `npm run dev:inngest`. `safeSend` (`lib/inngest/client.ts`) probes the dev server (trying both
   `localhost` and `127.0.0.1` to dodge Windows IPv6 mismatches) and fails loudly if it's unreachable
   or hasn't registered your app yet. For visual confirmation open `http://localhost:8288` (Apps tab
   → `footnote` registered; Runs tab → live step executions), or hit the diagnostics endpoint
   `GET /api/dev/inngest-status` which returns `inngest.devServerReachable`, `inngest.appRegistered`,
   the registered function slugs, a Redis ping, and booleans for the Inngest env vars (values are
   never returned).
2. **Is the app synced in Inngest Cloud (production)?** Open `https://<your-domain>/api/inngest` —
   the JSON response lists your registered functions (`source/created`, `audio/generate`, etc.). In
   the Inngest dashboard, go to **Apps → footnote** and confirm all four functions are registered. If
   they're missing, click **Sync** / re-save your Inngest integration.
3. **Missing signing/event keys (production).** Production enqueue of `source/created` requires
   `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` (both in the Inngest dashboard, both set as Vercel
   project env vars). `safeSend` prints a clear `[inngest]` error to the Vercel logs if either is
   unset instead of silently dropping the event.
4. **Keys set locally (a common trap).** For local dev, set `INNGEST_DEV=1` and leave
   `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` **empty**. If you paste your Inngest Cloud keys into
   a local `.env`, `inngest.send()` talks to Inngest Cloud — which can't callback to your localhost
   app — so events are accepted and sit in `QUEUED` forever.
5. **Vercel Deployment Protection blocking `/api/inngest`.** Inngest Cloud must be able to POST back
   to your deployed URL unauthenticated. The proxy middleware (`src/proxy.ts`, `isInngest` matcher)
   exempts `/api/inngest*` from Clerk auth, but a Vercel password/Protection rule that gates *all*
   traffic can still block Inngest's callback. Disable "Deployment Protection" for the production
   deployment, or whitelist Inngest's callback IPs.
6. **Redis URL is wrong.** `REDIS_URL` must be the TCP form (`redis://` or `rediss://` over TLS).
   Upstash's default "REST URL" (`https://...`) is **not** accepted by ioredis — ioredis treats it
   as a plain string and the connection silently fails, which makes progress polling fall back to Postgres
   (slower, and the cache never warms). Get the "UPSTASH_REDIS_URL"-style TCP URL from the Upstash
   console, or use `rediss://` for TLS. Redis failures are non-fatal (the app keeps working against
   Postgres) but they are now logged via `console.warn("[redis] …")` in `lib/redis.ts`.
7. **The job is genuinely stuck.** If a source sits `QUEUED` for more than 2 minutes, the status
   endpoint (`GET /api/sources/[id]/status`) auto-marks it `FAILED` with
   "Background worker did not pick up this job. Check Inngest setup, then retry via reindex".
   Retry it with `POST /api/sources/[id]/reindex`, or delete and re-add the source.

To test end-to-end locally: sign in, create a notebook, paste a plain-text source (type `TEXT`), and watch
the sources rail go `UPLOADING → QUEUED → INDEXING → READY` within seconds. If it stalls at `QUEUED`,
open `http://localhost:8288` (Runs tab) or `GET /api/dev/inngest-status` to confirm the dev server is
reachable and the `footnote` app is registered.

---

## 9. Notes on scope / production-oriented choices

- **Isolation is enforced server-side**, not just via UI filtering: every route re-fetches the notebook
  and checks `ownerId === auth().userId` before touching anything; the public share path is the one
  deliberate, explicit exception, gated by an unguessable slug.
- **Chunking is content-aware** rather than one generic splitter, because citation quality — and roadmap
  clustering quality — depends on it: a PDF chunk that spans two pages can't produce an honest page
  citation.
- **Redis is treated as disposable**: every write is wrapped so a Redis outage degrades (slower polling,
  falls back to Postgres) rather than breaking ingestion, audio generation, or roadmap generation.
- **The chat model is not allowed to answer past its context**: no chunks clearing the similarity floor
  means an explicit "not enough information," not a hallucinated guess.
- **Single shared Qdrant collection** with payload-indexed `notebookId`/`sourceId`, instead of one
  collection per notebook — keeps operations (backup, schema change) to one place while still giving hard
  query-time isolation via filters, and lets the roadmap pipeline pull embeddings straight back out
  without a second store.
- **Roadmap ordering is derived, not assumed**: concepts are ordered by a cross-video precedence vote plus
  Kahn's algorithm, not by upload order — so a roadmap built from videos added in any order still reflects
  how the material actually builds.
- **Credit checks are race-safe**: balance reads use a row-locked transaction so concurrent requests can't
  both read a stale non-zero balance and both be let through.

---

## 10. Voice mode (Realtime API)

A notebook-scoped realtime voice conversation is available via the Phone icon in the chat input bar.
It uses the OpenAI Realtime API over WebRTC through `samai-sdk/voice`.

### Security model

- `OPENAI_API_KEY` is **never** sent to the browser. The route mints a short-lived ephemeral client secret
  (`createRealtimeClientSecret`) and returns it only after Clerk auth + notebook ownership checks.
- Tool calls are authenticated with an HMAC-signed `x-voice-tool-token` containing `userId`, `notebookId`,
  `sessionId`, and `exp`. The server verifies signature + expiry on every request and re-checks
  `notebook.ownerId === userId`.
- The model never sees or supplies `notebookId`; it comes only from the signed token.

### Abuse limits

- One credit block (default: 1 credit per 5 minutes) is deducted when a new voice session starts.
- Reconnects within the same session (`refresh: true`) do **not** deduct additional credits.
- Only one active voice session per user is allowed (Redis key with TTL = token expiry).
- A Redis-backed rate limiter caps new session minting to 5 attempts per minute.

### Limitations

- Audio is sent as 24 kHz PCM over WebRTC; browser support requires modern Chrome, Edge, or Safari.
- The assistant answers only from `search_notebook` results — no outside knowledge.
- Citations from tool results are shown as chips in the transcript and saved to chat history as
  `Message` rows with `channel: VOICE`.
- On reconnect, the last 6 voice turns are summarized and injected into the new session's instructions
  (no turn-by-turn replay via `sendText`).
- Language is currently selectable from English, Hindi, and Tamil.


