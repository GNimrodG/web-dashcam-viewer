# Web Dashcam Viewer (Viofo Multi-Channel)

A full-featured web application for viewing and managing Viofo dashcam recordings with front and rear camera support.

## Features

### Video Management

- **Automatic pairing** of front/rear clips by timestamp and naming convention
- **Smart indexing** with persistent caching for fast startup
- **Real-time file watching** with network share support
- **HTTP range streaming** for efficient video delivery
- **Cross-platform path handling** (Windows/Linux compatible)
- **Camera and license plate OCR** from the recording's on-video overlay
- **HDR detection** from the camera overlay with an HDR badge on generated clips
- **Per-recording OCR status** that distinguishes pending, completed, no-match, failed, and never-processed recordings
- **Automatic recording-save detection** from the camera's audio beep pattern

### GPS & Location

- **GPS track extraction** with concurrent processing queue
- **Real-time queue monitoring** via Server-Sent Events
- **Automatic reverse geocoding** for start/end locations
- **Manual location editing** with autocomplete
- **GPX export** for GPS tracks
- **Interactive map view** (Leaflet) with route playback
- **Manual and detected POI markers** on individual and all-recordings maps

### Video Playback

- **Synchronized dual-camera playback** (front + rear)
- **Fullscreen mode** with in-video controls for each camera
- **Frame capture** (download or copy to clipboard)
- **Timeline scrubbing** with time markers
- **Volume control** and audio sync

### Clip Creation & Sharing

- **Custom clip generation** from any time range
- **Channel selection** (front only, rear only, side-by-side, stacked, or either camera fullscreen with the other in a configurable corner)
- **Audio volume control** for clips
- **Accurate preview frames** for start/end points, including overlay size and position
- **Share links** with configurable expiration (1-365 days)
- **Public sharing** without authentication required

### Authentication & Security

- **Optional OIDC/OAuth2** authentication via Authentik
- **Session persistence** through OAuth redirects
- **URL-based state preservation** (selected videos persist through login)
- **Reverse proxy support** (nginx, Traefik compatible)
- **PKCE flow** for enhanced security

### UI/UX Features

- **Dark/Light mode** with system preference detection
- **Deep linking** to specific videos via URL hash
- **Auto-scroll** to selected items in sidebar
- **Grouped timeline view** by date
- **Search and filter** by location or date
- **Important recording markers**
- **Per-recording post-processing job manager** for OCR, GPS extraction, and beep detection, with live states, filtering, and retry controls

## Prerequisites

- **Node.js 18+** and yarn
- **FFmpeg/ffprobe** installed and available in PATH
- **ExifTool** (optional, for enhanced GPS extraction)
- **Tesseract OCR** with English language data (included in the Docker image)
- **Authentik server** (optional, for authentication)

## Quick Start

### Local Development

1. **Install dependencies:**

   ```sh
   yarn install
   ```

2. **Configure environment** - Create `server/.env`:

   ```env
   MEDIA_DIR=/path/to/your/dashcam/videos
   PORT=5174
   SERVE_WEB=false
   AUTH_ENABLED=false
   ```

3. **Start development servers:**

   ```sh
   yarn dev
   ```

   - Server API: http://localhost:5174
   - Web UI: http://localhost:5173

### Production Deployment

1. **Build the application:**

   ```sh
   yarn build
   ```

2. **Configure environment** - Create `server/.env`:

   ```env
   MEDIA_DIR=/media
   PORT=3000
   NODE_ENV=production
   SERVE_WEB=true
   AUTH_ENABLED=true
   AUTHENTIK_ISSUER=https://auth.example.com/application/o/dashcam/
   AUTHENTIK_CLIENT_ID=your-client-id
   AUTHENTIK_CLIENT_SECRET=your-client-secret
   AUTHENTIK_REDIRECT_URI=https://dashcam.example.com/api/auth/callback
   SESSION_SECRET=generate-a-secure-random-string
   FRONTEND_URL=https://dashcam.example.com
   ```

3. **Run with Docker:**

   ```sh
   docker build -t dashcam-viewer .
   docker run -p 3000:3000 \
     -v /path/to/videos:/media \
     -e AUTH_ENABLED=true \
     -e AUTHENTIK_ISSUER=https://auth.example.com/application/o/dashcam/ \
     dashcam-viewer
   ```

   Published images are also available from GitHub Container Registry:

   ```sh
   docker pull ghcr.io/gnimrodg/web-dashcam-viewer:latest
   ```

4. **Or run directly:**
   ```sh
   cd server
   node dist/index.js
   ```

## Configuration

### Environment Variables

#### Core Settings

- `MEDIA_DIR` - **Required.** Absolute path to dashcam video folder
- `DASHCAM_TIME_ZONE` - Default IANA timezone used by timestamps in dashcam filenames (default: `Etc/GMT-2`, fixed UTC+2). Individual GPX uploads can select a different timezone or persist an explicit browser-local recording start time.
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode (`development` or `production`)
- `SERVE_WEB` - Serve frontend build from server (default: `true`)

#### Authentication (Optional)

- `AUTH_ENABLED` - Enable authentication (default: `false`)
- `AUTHENTIK_ISSUER` - Authentik issuer URL
- `AUTHENTIK_CLIENT_ID` - OAuth2 client ID
- `AUTHENTIK_CLIENT_SECRET` - OAuth2 client secret
- `AUTHENTIK_REDIRECT_URI` - OAuth2 callback URL
- `SESSION_SECRET` - Session encryption key (generate random string)
- `FRONTEND_URL` - Optional frontend URL for post-login redirects when the UI is hosted separately. If omitted in production or bundled-server mode, the server uses the public origin from `AUTHENTIK_REDIRECT_URI` (or the proxy-aware request origin). Split development mode defaults to `http://localhost:5173`.

#### Performance & Storage

- `INDEX_CONCURRENCY` - Parallel indexing operations (default: `2`)
- `GPS_CONCURRENT_LIMIT` - Parallel GPS extractions (default: `5`)
- `OVERLAY_OCR_CONCURRENCY` - Parallel camera/plate OCR scans (default: `1`)
- `OVERLAY_OCR_ENABLED` - Set to `0` to disable camera/plate OCR (default: enabled)
- `OVERLAY_OCR_PROCESS_TIMEOUT_MS` - Maximum runtime for each FFmpeg or Tesseract OCR subprocess (default: `30000`)
- `AUDIO_EVENT_CONCURRENCY` - Parallel background camera-save beep scans (default: `1`)
- `AUDIO_EVENT_DETECTION_ENABLED` - Set to `0` to disable automatic camera-save beep detection (default: enabled)

## API Reference

### Videos

- `GET /api/videos` - List all video pairs
- `GET /api/videos/:id` - Get video pair details
- `GET /api/videos/:id/source/:channel` - Stream video (`front` or `rear`)
- `GET /api/videos/:id/gps` - Get GPS track data
- `GET /api/videos/:id/gps/gpx` - Download GPS track as GPX
- `DELETE /api/videos/:id/gps` - Delete and suppress incorrect GPS data
- `DELETE /api/videos/:id/gps/gpx` - Remove an external GPX and restore embedded GPS
- `POST /api/videos/gps/gpx/bulk` - Apply one GPX file to every overlapping recording
- `GET /api/videos/gps-queue-status` - Real-time GPS queue status (SSE)
- `GET /api/videos/background-tasks` - Current OCR, GPS, audio detection, and clip-generation task status
- `GET /api/videos/background-tasks/:id` - Post-processing status for one recording
- `POST /api/videos/background-tasks/:id/retry` - Re-run one or all post-processors for a recording
- `GET /api/videos/locations` - Get unique cities/countries for autocomplete
- `GET /api/videos/clips` - List generated clips
- `GET /api/videos/clips/:filename` - Stream a generated clip
- `GET /api/videos/clips/:filename/thumbnail` - Get clip thumbnail
- `POST /api/videos/:id/clip` - Start clip generation from a time range
- `GET /api/videos/clip-jobs/:jobId/status` - Stream clip progress and completion status
- `POST /api/videos/reindex` - Trigger manual re-indexing
- `POST /api/videos/backfill/locations` - Backfill missing location names
- `PATCH /api/videos/:id/location` - Update location manually
- `PATCH /api/videos/clips/:filename` - Rename a clip
- `DELETE /api/videos/clips/:filename` - Delete a clip

### Authentication (when enabled)

- `GET /api/auth/me` - Get current user info
- `GET /api/auth/login` - Initiate OIDC login flow (with `returnUrl` support)
- `GET /api/auth/callback` - OAuth callback endpoint
- `POST /api/auth/logout` - Logout current user

### Share Links

- `POST /api/shares` - Create share token for a clip
- `POST /api/shares/clip` - Create a 1-365 day public share for a generated clip
- `GET /api/shares/:tokenId` - Get share token details
- `GET /api/shares/:tokenId/download` - Download shared clip
- `GET /api/shares/video/:videoId` - List share tokens for video
- `DELETE /api/shares/:tokenId` - Delete share token

### System

- `GET /api/health` - Health check endpointExifTool (NMEA data)
- **GPX export** for all extracted tracks

### GPS Processing Queue

- Concurrent extraction with configurable limit
- Real-time queue status via Server-Sent Events
- Automatic reverse geocoding for start/end locations
- Cached GPS data to avoid re-extraction

### Implementation Notes

- GPS extraction uses ExifTool to parse embedded NMEA data
- See `server/src/services/gps.ts` for extraction logic
- Customize for specific Viofo models/firmware as needed

## File Pairing & Indexing

### Pairing Heuristics

The indexer pairs front/rear clips using common Viofo filename patterns:

- `YYYYMMDD_HHMMSS_A.mp4` / `YYYYMMDD_HHMMSS_B.mp4` (or F/R)
- `YYYYMMDD_HHMMSS_front.mp4` / `YYYYMMDD_HHMMSS_rear.mp4`
- Fuzzy matching (±1 second) for timestamp variations

Customize patterns in `server/src/utils/pairing.ts`.

### Index Caching

- **Cache file:** `.video_index_cache.json` in `MEDIA_DIR` (or `INDEX_CACHE_DIR`)
- **Relative paths:** Cache uses relative paths for portability across mount points
- **Cross-platform:** Automatically converts between Windows/Linux path separators
- **Validation:** Cached entries validated against file size and modification time
- **Incremental:** Only new/changed files are re-indexed on startup
- **Auto-cleanup:** Missing files and stale entries automatically pruned

The cache file can be safely deleted and will be regenerated automatically.

## API

### Videos

- GET `/api/videos` → list of paired clips
- GET `/api/videos/:id` → details for one pair
- GET `/api/videos/:id/source/:channel` → video stream for `front` or `rear`
- GET `/api/videos/:id/gps` → GPS track (placeholder)
- POST `/api/videos/:id/clip` → create a clip from a video segment

### Authentication (when enabled)

- GET `/api/auth/me` → get current user info
- GET `/api/auth/login` → initiate OIDC login flow
- GET `/api/auth/callback` → OAuth callback endpoint
- POST `/api/auth/logout` → logout current user

### Share Links

- POST `/api/shares` → create a share token for a clip
- GET `/api/shares/:tokenId` → get share token details
- GET `/api/shares/:tokenId/download` → download the shared clip
- GET `/api Features

### Video Browser

- **Grouped timeline view** by year/month/day
- **Search and filter** by video ID or location
- **Location display** with start/end cities and countries
- **Important recording markers** (RO files)
- **Manual location editing** with autocomplete
- **Deep linking** - URLs with hash (`#20241215_120000`) for direct video access
- **Auto-scroll** to selected video in sidebar

### Video Player

- **Synchronized dual-camera playback** (front + rear side-by-side)
- **Fullscreen mode** for individual cameras with overlay controls
- **Timeline scrubbing** with adaptive time markers
- **Volume control** with visual slider
- **Keyboard shortcuts** (Space = play/pause)
- **Frame capture** - download or copy to clipboard
- **Clip creation** with visual timeline editor

### Map View

- **Interactive Leaflet map** with GPS route overlay
- **Real-time playback synchronization** with video timeline
- **Start/end location markers**
- **Smooth route animation** following video progress

### Clip Management

- **Visual clip editor** with preview frames
- **Channel selection** (front, rear, side-by-side, stacked, and adjustable picture-in-picture)
- **Audio volume control** (0-100% or mute)
- **Thumbnail generation** for all clips
- **Download or share** generated clips
- **Clip renaming and deletion**

### GPS Queue Monitor

- **Real-time status** via Server-Sent Events
- **Processing and queued items** display
- **Concurrent extraction tracking**
- **Queue position indicators**

## Authentication & Security

### When `AUTH_ENABLED=true`:

- **OIDC/OAuth2** via Authentik
- **Session-based auth** with HttpOnly cookies (24-hour expiration)
- **PKCE flow** for enhanced security
- **Reverse proxy support** with `trust proxy` configuration
- **Session persistence** through OAuth redirects
- **URL state preservation** (selected videos persist through login)

### When `AUTH_ENABLED=false`:

- **Public access** without authentication
- All features available without login
- Share links work the same way

### Database

- **SQLite** stored at `${MEDIA_DIR}/.dashcam-viewer.db`
- **Share tokens** with cryptographically random 16-character IDs
- **Automatic cleanup** of expired tokens on startup

## Sharing & Collaboration

### Share Links

Share tokens include:

- Video ID and exact time range
- Channel selection and layout
- Configurable expiration (1-365 days)
- Creator information (when authenticated)

**Share URL format:** `/api/shares/:tokenId/download`

**Note:** Share links work without authentication for easy sharing.

## Deployment

### Docker

The application includes a multi-stage Dockerfile with health checks:

```dockerfile
# Includes FFmpeg and ExifTool
# Health check on /api/health endpoint
# Multi-stage build for optimal size
```

**Example docker-compose.yml:**

```yaml
version: "3.8"
services:
  dashcam-viewer:
    image: dashcam-viewer:latest
    ports:
      - "3000:3000"
    volumes:
      - /path/to/videos:/media
      - /path/to/cache:/cache
    environment:
      MEDIA_DIR: /media
      DASHCAM_TIME_ZONE: Etc/GMT-2
      INDEX_CACHE_DIR: /cache
      AUTH_ENABLED: "true"
      AUTHENTIK_ISSUER: https://auth.example.com/application/o/dashcam/
      AUTHENTIK_CLIENT_ID: your-client-id
      AUTHENTIK_CLIENT_SECRET: your-secret
      AUTHENTIK_REDIRECT_URI: https://dashcam.example.com/api/auth/callback
      SESSION_SECRET: your-random-secret
      FRONTEND_URL: https://dashcam.example.com
```

### Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name dashcam.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support for GPS queue status
        proxy_buffering off;
        proxy_cache off;
    }
}
```

## Development & Extension

### Custom GPS Extraction

Implement model-specific extraction in `server/src/services/gps.ts`:

```typescript
export async function extractTimedGpsTrack(
  filePath: string,
): Promise<GpsPoint[]> {
  // Your Viofo-specific extraction logic
}
```

### Custom Pairing Logic

Modify filename patterns in `server/src/utils/pairing.ts`:

```typescript
export function parseFilenameForPairing(filePath: string): ParsedFilename {
  // Your custom pairing logic
}
```

### Troubleshooting

**Slow indexing on network shares:**

- Enable `DISABLE_FILE_WATCH=1`
- Set `INDEX_CACHE_DIR` to local path
- Reduce `INDEX_CONCURRENCY` to `1` or `2`

**GPS extraction stuck:**

- Check ExifTool is installed and in PATH
- Monitor queue status at `/api/videos/gps-queue-status`
- Adjust `GPS_CONCURRENT_LIMIT` based on system resources

**Authentication redirect issues:**

- If set, ensure `FRONTEND_URL` matches your public domain; omit it when the server hosts the UI on the same origin
- Set `AUTHENTIK_REDIRECT_URI` correctly
- Check reverse proxy forwards `X-Forwarded-*` headers

Share URLs are in the format: `/api/shares/:tokenId/download`
