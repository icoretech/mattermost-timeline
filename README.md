# Mattermost Timeline

A Mattermost plugin that displays a real-time animated timeline of events from external webhooks in the right-hand sidebar.

External services push events via HTTP webhooks. New entries animate into the timeline with support for Markdown messages, event types, source badges, and clickable links.

## Features

- Real-time timeline in the Mattermost RHS (right-hand sidebar)
- Smooth slide-in animations for new events
- Markdown support in event messages (bold, italic, code, links)
- Event type icons (deploy, alert, error, host_online, host_offline, etc.)
- Team-scoped events with per-team KV store persistence
- Paginated event history with "Load older events" support
- Webhook authentication via shared secret

## Requirements

- Mattermost Server 7.0+
- Go 1.26+ (for building the server)
- Node.js 24+ (for building the webapp)

## Installation

Download the latest release from the [Releases](https://github.com/icoretech/mattermost-timeline/releases) page and upload the `.tar.gz` file through **System Console > Plugin Management**.

## Configuration

After enabling the plugin, configure it in **System Console > Plugins > Mattermost Timeline**:

| Setting | Description | Default |
|---------|-------------|---------|
| Webhook Secret | Shared secret for authenticating incoming webhooks | _(empty)_ |
| Max Events Stored | Maximum events to persist per team | 500 |
| Max Events Displayed | Maximum events shown in the timeline | 100 |

## Webhook API

Send events to the plugin via HTTP POST:

```bash
curl -X POST https://your-mattermost.example.com/plugins/ch.icorete.mattermost-timeline/webhook?team_id=TEAM_ID \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: YOUR_SECRET" \
  -d '{
    "title": "web-server-01 online",
    "message": "Recovered after **5 minutes** of downtime",
    "link": "https://monitor.example.com/hosts/01",
    "event_type": "host_online",
    "source": "monitoring"
  }'
```

### Webhook Payload

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Event title |
| `message` | string | no | Event description (supports Markdown) |
| `link` | string | no | Clickable URL |
| `event_type` | string | no | One of: `host_online`, `host_offline`, `deploy`, `alert`, `error`, `info`, `success`, `generic` |
| `source` | string | no | Source system label (e.g., "monitoring", "ci/cd") |

## Development

### Prerequisites

- Go 1.26+
- Node.js 24+
- Make

### Build

```bash
# Full build (server + webapp + bundle)
make dist

# Server only
make server

# Webapp only
cd webapp && npm run build
```

### Test

```bash
# All tests
make test

# Server tests
cd server && go test ./...

# Webapp tests
cd webapp && npm test
```

### Lint

```bash
# Webapp: runs Biome + TypeScript type checking
cd webapp && npm run lint
```

### Deploy to a local Mattermost instance

```bash
make deploy
```

### Tech Stack

**Server:** Go, Mattermost Plugin API, gorilla/mux

**Webapp:** React 19, Redux, TypeScript 5.9, Vite 8, Vitest, Biome, SCSS

## Releases

This project uses [release-please](https://github.com/googleapis/release-please) for automated releases. Merging to `main` creates a release PR that, when merged, publishes a GitHub release with the plugin bundle attached.

## License

[MIT](LICENSE) - iCoreTech, Inc.
