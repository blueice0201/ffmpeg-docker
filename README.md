# FFmpeg REST API

A REST API that wraps FFmpeg for media processing operations. Built with Node.js, Hono, and BullMQ for reliable async job processing.

<p align="center">
  <img src="https://github.com/blueice0201/ffmpeg-docker/blob/main/docs-preview.png?raw=true" alt="API Documentation Preview" width="800">
</p>

## Features

Convert and process media files through simple HTTP endpoints:

- **Video**: Convert any video to MP4, convert to animated GIF, extract audio tracks (mono/stereo), extract frames at custom FPS (compressed as ZIP/GZIP)
- **Audio**: Convert any audio to MP3 or WAV
- **Image**: Convert any image format to JPG, resize images while preserving format
- **Media Info**: Probe any media file for metadata and stream information
- **Video Compose**: Assemble multi-asset videos from a JSON manifest — sequential concatenation or timeline overlays with video, image, text, and audio tracks (including CJK subtitles)

## Video Compose (Convert API)

The `/convert*` endpoints compose a final MP4 from multiple uploaded assets using a JSON **manifest**. Unlike the synchronous conversion endpoints above, compose jobs are **async**: submit returns `202` with a `taskId`, then poll status or download the result when complete.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/convert` | Queue a compose task (`sequential` or `timeline` mode in manifest) |
| `POST` | `/convert/sequential` | Queue sequential compose (segments played in order) |
| `POST` | `/convert/timeline` | Queue timeline compose (clips positioned by start time) |
| `GET` | `/convert/{taskId}` | Poll task status (`queued` / `processing` / `completed` / `failed`) |
| `GET` | `/convert/{taskId}?download=1` | Download the composed MP4 when the task is completed |
| `GET` | `/doc/compose-manifest` | Manifest schema reference with examples |

Each submit endpoint accepts `multipart/form-data`:

- `manifest` — JSON string describing output settings, assets, and segments/clips
- One file field per `assets[].field` in the manifest (e.g. `clip=@video.mp4`)
- Optional `uploadToS3=true` when `STORAGE_MODE=s3` (defaults to retaining binary output for async download)

### Compose Modes

- **Sequential** — Concatenates full-screen segments in order: video clips, image slides, and text overlays. Background audio tracks can loop across the full output.
- **Timeline** — Overlays video, image, text, and audio clips on a shared timeline by `start` time. Elements can overlap (picture-in-picture, subtitles, logos, etc.).

Both modes support built-in CJK fonts (`noto-sans-sc`, `noto-sans-tc`, `noto-serif-sc`) via `style.fontId` on text segments/clips.

### Example Flow

```bash
# 1. Submit compose job
curl -X POST http://localhost:3000/convert/sequential \
  -F 'manifest={"mode":"sequential","output":{"width":1280,"height":720,"fps":30},"assets":[{"id":"clip","type":"video","field":"clip"}],"segments":[{"type":"video","assetId":"clip","keepAudio":true}]}' \
  -F 'clip=@input.mp4'

# Response: {"taskId":"<uuid>","status":"queued"}

# 2. Poll until completed
curl http://localhost:3000/convert/<taskId>

# 3. Download result
curl -OJ "http://localhost:3000/convert/<taskId>?download=1"
```

See `GET /doc/compose-manifest` or the interactive docs at `/reference` for full manifest examples.

**Related environment variables**:

```bash
CONVERT_MAX_TOTAL_SIZE=524288000   # Max total multipart upload size (bytes)
COMPOSE_FONT_PATH=                 # Optional global font override
COMPOSE_FONT_AUTO_DOWNLOAD=true    # Auto-download CJK fonts on first use
```

The web UI at `/compose` (via `apps/web`) provides a visual editor for both sequential and timeline workflows.

## Storage Modes

The API supports two storage modes configured via the `STORAGE_MODE` environment variable:

- **`stateless`** (default) - Files returned directly in HTTP responses
- **`s3`** - Files uploaded to S3-compatible storage, URLs returned

### Stateless Mode (Default)

Files are processed and returned directly in the HTTP response. Simple and straightforward for immediate consumption. Processed files are not persisted — each response is generated on demand and streamed through your API server.

For high-volume or large-file workloads, consider **S3 mode** so clients download directly from object storage instead of through your API.

#### Stateless Binary Cache

Stateless mode can optionally cache binary conversion outputs using `cacache` to avoid rerunning FFmpeg on identical inputs + params.

- Cache scope: binary conversion endpoints only (not `/.../url` S3 responses, not `/media/info`)
- Cache key: SHA-256 of input bytes + job type + normalized processing params
- Retention: TTL + size cap (enforced on reads/writes and startup)
- Storage: local filesystem (ephemeral by default)

**Configuration**:

```bash
CACHE_ENABLED=false             # Enable/disable stateless binary cache
CACHE_DIR=/tmp/ffmpeg-rest/cache # Cache directory (defaults to <TEMP_DIR>/cache)
CACHE_TTL_HOURS=2160            # Entry TTL in hours (90 days)
CACHE_MAX_SIZE_MB=1024          # Max cache size on disk in MiB (1 GiB)
```

### S3 Mode

Processed files are uploaded to S3-compatible storage and a URL is returned. This mode significantly reduces egress bandwidth costs since users download the processed files directly from S3 rather than through your API server. Ideal for production deployments where bandwidth costs matter.

**Why Cloudflare R2?** R2 is S3-compatible and offers no egress fees, which dramatically lowers costs when serving processed media from your bucket via Cloudflare's global network. While any S3-compatible storage works, R2 is the only major provider with zero egress charges—making it the optimal choice for media delivery.

Configure S3 mode by setting `STORAGE_MODE=s3` and providing S3 credentials in your environment variables.

#### Content Deduplication

S3 Mode includes intelligent content-based deduplication to optimize storage costs and upload performance:

- **SHA-256 File Hashing**: Each processed file is hashed using SHA-256 before upload
- **Redis Cache**: File hashes are mapped to S3 URLs with a 90-day TTL (configurable)
- **Automatic Deduplication**: Identical files are only uploaded once - subsequent requests return the cached S3 URL
- **Zero-Cost Cache Hits**: When a duplicate file is processed, the upload to S3 is skipped entirely
- **Graceful Degradation**: Cache failures don't block uploads - the system falls back to normal upload behavior

**Configuration**:

```bash
S3_DEDUP_ENABLED=1           # Enable/disable deduplication (default: true)
S3_DEDUP_TTL_DAYS=90         # Cache TTL in days (default: 90)
```

This feature dramatically reduces S3 storage costs and upload bandwidth for workloads with duplicate media content, while improving response times through cache hits.

## Documentation

This API is built with documentation-first approach using **Hono Zod OpenAPI** and **Scalar**:

- **Type-Safe Schemas**: All endpoints use Zod schemas for validation, ensuring type safety and automatic OpenAPI spec generation
- **Interactive API Reference**: Beautiful, interactive documentation powered by Scalar at `/reference`
- **OpenAPI Spec (`/doc`)**: Complete machine-readable API specification (served as OpenAPI 3.0)
- **LLM-Friendly Docs (`/llms.txt`)**: Markdown documentation optimized for AI assistants (generated from OpenAPI 3.1, following [llmstxt.org](https://llmstxt.org/) standard)

Every endpoint is fully documented with request/response schemas, validation rules, and example payloads. No manual documentation maintenance required.

## Quick Start

### Prerequisites

- **Node.js** 22+ and npm
- **FFmpeg** and **FFprobe** installed and available in PATH
- **Redis** server running

### Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/blueice0201/ffmpeg-docker
   cd ffmpeg-docker
   ```

2. **Install dependencies**

   ```bash
   npm ci
   ```

3. **Start Redis** (using Docker)

   ```bash
   docker-compose up -d
   ```

4. **Configure environment**

   ```bash
   cp .env.example .env
   cp apps/web/.env.example apps/web/.env
   # Edit both files with your settings
   ```

5. **Run the API**

   Development mode (with auto-reload):

   ```bash
   # Starts web + server + worker
   npm run dev
   ```

   Or run processes individually:

   ```bash
   npm run dev:server
   npm run dev:worker
   npm run dev:web
   ```

   Production mode (server + worker only):

   ```bash
   npm run build
   npm start
   ```

   For production deployment with the web UI included, see [Docker Deployment](#docker-deployment).

## Docker Deployment

The `Dockerfile` builds a single image that runs the API server, FFmpeg worker, and web UI together (`npm run start:all`). FFmpeg binaries come from `ghcr.io/jrottenberg/ffmpeg` (default: `7.1-scratch`).

`docker-compose.yml` in this repo only starts **Redis** for local development. For production, run the image below and point it at your Redis instance.

### Automatic release (GitHub Actions → GHCR)

The workflow at `.github/workflows/docker-publish.yml` builds and pushes to GitHub Container Registry automatically.

| Trigger | Image tags pushed |
| --- | --- |
| Push to `main` | `latest`, `main`, commit SHA |
| Push tag `v1.2.3` | `1.2.3`, `1.2`, `1`, `latest`, commit SHA |
| Manual run (`workflow_dispatch`) | Same rules as the branch or tag you run it on |

Image name: `ghcr.io/<owner>/<repo>` (for this repo: `ghcr.io/blueice0201/ffmpeg-docker`).

Before the first run, ensure **Settings → Actions → General → Workflow permissions** allows read/write for `GITHUB_TOKEN` (needed to publish packages). No separate GHCR repository setup is required—the package is created on the first successful push.

Release example:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Pull on the target host:

```bash
docker pull ghcr.io/blueice0201/ffmpeg-docker:1.0.0
```

### Manual release

Set your registry, image name, and version, then build and push.

**Bash / Git Bash:**

```bash
# 1. (Optional) Validate before building
npm run typecheck
npm run test:app

# 2. Set release variables
export REGISTRY=ghcr.io/your-org          # or docker.io/your-user
export IMAGE=ffmpeg-rest
export VERSION=1.0.0                      # your release tag

# 3. Build the image
docker build \
  --build-arg FFMPEG_TARGET_PLATFORM=linux/amd64 \
  --build-arg VERSION=7.1 \
  --build-arg VARIANT=scratch \
  -t ${REGISTRY}/${IMAGE}:${VERSION} \
  -t ${REGISTRY}/${IMAGE}:latest \
  .

# 4. Log in to your registry (GHCR example)
docker login ghcr.io
# Docker Hub: docker login

# 5. Push
docker push ${REGISTRY}/${IMAGE}:${VERSION}
docker push ${REGISTRY}/${IMAGE}:latest
```

**PowerShell:**

```powershell
# 1. (Optional) Validate before building
npm run typecheck
npm run test:app

# 2. Set release variables
$env:REGISTRY = "ghcr.io/your-org"   # or docker.io/your-user
$env:IMAGE = "ffmpeg-rest"
$env:VERSION = "1.0.0"               # your release tag

# 3. Build the image
docker build `
  --build-arg FFMPEG_TARGET_PLATFORM=linux/amd64 `
  --build-arg VERSION=7.1 `
  --build-arg VARIANT=scratch `
  -t "$env:REGISTRY/$env:IMAGE:$env:VERSION" `
  -t "$env:REGISTRY/$env:IMAGE:latest" `
  .

# 4. Log in to your registry (GHCR example)
docker login ghcr.io
# Docker Hub: docker login

# 5. Push
docker push "$env:REGISTRY/$env:IMAGE:$env:VERSION"
docker push "$env:REGISTRY/$env:IMAGE:latest"
```

Deploy on the target host:

```bash
docker pull ${REGISTRY}/${IMAGE}:${VERSION}

docker run -d --name ffmpeg-rest --restart unless-stopped \
  -p 3000:3000 -p 3001:3001 \
  -e NODE_ENV=production \
  -e REDIS_URL=redis://your-redis-host:6379 \
  -e AUTH_TOKEN=your-api-token \
  -e BACKEND_URL=http://localhost:3000 \
  -e COMPOSE_FONT_AUTO_DOWNLOAD=true \
  ${REGISTRY}/${IMAGE}:${VERSION}
```

- API: `http://<host>:3000`
- Web UI (including `/compose`): `http://<host>:3001`
- See `.env.example` for all supported environment variables (`STORAGE_MODE`, S3, cache, etc.)

### Local build and run

For a quick local smoke test without pushing to a registry:

```bash
docker build -t ffmpeg-rest .
docker run --rm -p 3000:3000 -p 3001:3001 \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -e BACKEND_URL=http://localhost:3000 \
  ffmpeg-rest
```

- API: `http://localhost:3000`
- Web UI (including `/compose`): `http://localhost:3001`

## Web App + Nitro Proxy

The `apps/web` workspace is a Vite + TanStack Router frontend with a Nitro catch-all proxy for `/api/**`.

- Dev server: `npm run dev:web`
- Compose UI: `http://localhost:3001/compose` (sequential + timeline video editor)
- Proxy route: `apps/web/routes/api/[...path].ts`
- Frontend API client uses Hono RPC (`hc`) with shared `AppType` from the server

Proxy behavior:

- Requests to `/api/**` are forwarded to `BACKEND_URL` (required)
- `Authorization: Bearer ${AUTH_TOKEN}` is injected server-side when `AUTH_TOKEN` is set
- Browser clients do not need to store or submit `AUTH_TOKEN`
- Web dev server runs on `http://localhost:3001` (fixed), API server defaults to `http://localhost:3000`

Environment variables:

```bash
BACKEND_URL=http://localhost:3000
AUTH_TOKEN=your-api-token
WEB_PASSWORD=
```

## Contribution Policy

FFmpeg REST is open source but only accepting contributions for bug fixes.

## Acknowledgments

This project is built on top of [ffmpeg-rest](https://github.com/crisog/ffmpeg-rest) by [crisog](https://github.com/crisog). Thank you for the original architecture, API design, and open-source foundation that made this extended version possible.
