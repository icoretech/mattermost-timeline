---
name: mattermost-timeline-dev-smoke
description: Boot, provision, deploy, and smoke-test the local Mattermost preview stack for this timeline plugin. Use when reproducing webhook visibility reports, validating RHS event rendering, confirming channel/team IDs, or testing channel-scoped timeline behavior against a real Mattermost server.
---

# Mattermost Timeline Dev Smoke

## Dev stack

Use `docker-compose.dev.yml` from the repository root. It runs `mattermost/mattermost-preview:latest` on `linux/amd64`, publishes `${MATTERMOST_DEV_PORT:-18065}:8065`, and persists both Mattermost data and bundled Postgres data with named Docker volumes.

Default local URL:

```text
http://localhost:18065
```

Default provisioned account:

```text
admin@example.com / Password1!
```

Default team:

```text
Example Org (example-org)
```

## Bootstrap workflow

From the repository root, run the bundled helper:

```bash
.agents/skills/mattermost-timeline-dev-smoke/scripts/bootstrap-dev-mattermost.sh
```

The script:

1. runs `docker compose -f docker-compose.dev.yml up -d` when the target URL is not already reachable
2. waits for `/api/v4/system/ping`
3. creates the first admin through `POST /api/v4/users` when login fails
4. logs in through `POST /api/v4/users/login`
5. creates the `example-org` team if missing
6. prints the `make deploy` and smoke-test commands without printing passwords or webhook secrets; export existing credential variables before deployment

Override these env vars only when needed:

```bash
MATTERMOST_DEV_PORT=18066
MATTERMOST_DEV_SITE_URL=http://localhost:18066
MM_ADMIN_USERNAME=admin@example.com
MM_ADMIN_PASSWORD='Password1!'
MM_ADMIN_USER=admin
MATTERMOST_DEV_TEAM=example-org
MATTERMOST_DEV_TEAM_DISPLAY='Example Org'
COMPOSE_FILE=docker-compose.dev.yml
TIMELINE_WEBHOOK_SECRET='timeline-smoke-secret'
```

Do not stop or delete an already-running Mattermost dev instance unless the user explicitly asks. Prefer updating/reusing it so existing smoke-test data survives.

## Deploy workflow

Build and deploy through the repository Makefile after the stack is reachable:

```bash
MM_SERVICESETTINGS_SITEURL=http://localhost:18065 \
MM_ADMIN_USERNAME=admin@example.com \
MM_ADMIN_PASSWORD='Password1!' \
make deploy
```

Then configure the plugin's webhook secret in System Console, or set it with the helper:

```bash
MM_SERVICESETTINGS_SITEURL=http://localhost:18065 \
MM_ADMIN_USERNAME=admin@example.com \
MM_ADMIN_PASSWORD='Password1!' \
TIMELINE_WEBHOOK_SECRET='timeline-smoke-secret' \
.agents/skills/mattermost-timeline-dev-smoke/scripts/configure-plugin.py
```

## Timeline webhook helper

Use the deterministic helper to send a team-wide or channel-scoped event and read it back through the plugin API:

```bash
MM_SERVICESETTINGS_SITEURL=http://localhost:18065 \
MM_ADMIN_USERNAME=admin@example.com \
MM_ADMIN_PASSWORD='Password1!' \
TIMELINE_WEBHOOK_SECRET='timeline-smoke-secret' \
.agents/skills/mattermost-timeline-dev-smoke/scripts/post-sample-event.py
```

Env vars:

```bash
MM_SERVICESETTINGS_SITEURL=http://localhost:18065
MM_ADMIN_USERNAME=admin@example.com
MM_ADMIN_PASSWORD='Password1!'
MATTERMOST_DEV_TEAM=example-org
MATTERMOST_DEV_CHANNEL=town-square
TIMELINE_WEBHOOK_SECRET='timeline-smoke-secret'
TIMELINE_CHANNEL_SCOPE=false
TIMELINE_TEAM_IDENTIFIER=example-org
TIMELINE_CHANNEL_IDENTIFIER=town-square
TIMELINE_EXTERNAL_ID=timeline-smoke-<generated>
TIMELINE_WEBHOOK_SECRET='timeline-smoke-secret'
TIMELINE_WEBHOOK_TOKENS='[{"name":"smoke","secret":"timeline-token-secret","enabled":true,"require_signature":true}]'
TIMELINE_REQUIRE_SIGNED_WEBHOOKS=false
TIMELINE_SIGNED_WEBHOOK=false
TIMELINE_BATCH=false
TIMELINE_SEVERITY=critical
TIMELINE_STATUS=open
TIMELINE_ENVIRONMENT=staging
TIMELINE_PINNED=true
TIMELINE_EXPIRES_AT=0
TIMELINE_RESOLVED_AT=0
TIMELINE_CUSTOM_FIELDS='[{"name":"merge_status","label":"Merge status","type":"string","value":"merged"},{"name":"approvals","type":"number","value":0},{"name":"draft","type":"boolean","value":false}]'
```

Set `TIMELINE_CHANNEL_SCOPE=true` to send `channels: [<channel name>]`. By default the helper posts with the team name/slug and channel name to exercise the same path users copy from URLs. Override `TIMELINE_TEAM_IDENTIFIER` or `TIMELINE_CHANNEL_IDENTIFIER` with 26-character Mattermost IDs when you need to verify ID-only behavior. The helper then fetches `/plugins/ch.icorete.mattermost-timeline/api/v1/events` with the resolved ID context and prints the event id plus channel URL.

Set `TIMELINE_SIGNED_WEBHOOK=true` to sign the exact JSON request body with `X-Timeline-Timestamp` and `X-Timeline-Signature`. The helper signs with `TIMELINE_WEBHOOK_SECRET`; when testing `TIMELINE_WEBHOOK_TOKENS`, either leave the legacy `TIMELINE_WEBHOOK_SECRET` empty while using the token secret for the posting helper, or use a distinct token secret because duplicate webhook credential secrets are rejected. Set `TIMELINE_BATCH=true` to post `{ "events": [payload] }` to `/webhook/batch` and validate the first successful result. Metadata env vars are only included when set.

Signed smoke example:

```bash
MM_SERVICESETTINGS_SITEURL=http://localhost:18065 \
MM_ADMIN_USERNAME=admin@example.com \
MM_ADMIN_PASSWORD='Password1!' \
TIMELINE_WEBHOOK_SECRET='timeline-smoke-secret' \
TIMELINE_SIGNED_WEBHOOK=true \
TIMELINE_SEVERITY=critical \
TIMELINE_STATUS=open \
TIMELINE_ENVIRONMENT=staging \
TIMELINE_PINNED=true \
.agents/skills/mattermost-timeline-dev-smoke/scripts/post-sample-event.py
```

Batch smoke example:

```bash
MM_SERVICESETTINGS_SITEURL=http://localhost:18065 \
MM_ADMIN_USERNAME=admin@example.com \
MM_ADMIN_PASSWORD='Password1!' \
TIMELINE_WEBHOOK_SECRET='timeline-smoke-secret' \
TIMELINE_SIGNED_WEBHOOK=true \
TIMELINE_BATCH=true \
.agents/skills/mattermost-timeline-dev-smoke/scripts/post-sample-event.py
```

Set `TIMELINE_CUSTOM_FIELDS` to a JSON array to exercise custom field creation or replacement using the same `TIMELINE_EXTERNAL_ID`. Unset it to omit the property, use `null` to retain existing fields, or use `[]` to clear them. Zero and false must stay JSON number and boolean values, not quoted strings. Test malformed custom fields in a mixed batch as well as a single webhook so an invalid sibling cannot hide the successful event.

## Browser smoke checklist

Use the local Mattermost UI after deployment:

1. login with the provisioned admin
2. open `http://localhost:18065/example-org/channels/town-square`
3. confirm the channel header shows the Event Feed icon button
4. click the Event Feed button and confirm the right-hand sidebar opens with the title `Event Feed`
5. run `post-sample-event.py` with `TIMELINE_CHANNEL_SCOPE=false`
6. confirm the RHS shows the new `Timeline smoke test` event in `town-square`
7. run `post-sample-event.py` with `TIMELINE_CHANNEL_SCOPE=true`
8. confirm the channel-scoped event appears in `town-square`
9. switch to another channel if available and confirm only the team-wide event remains visible there

## Local quality gates

Before claiming the smoke harness is ready, run the focused gates touched by this setup:

```bash
docker compose -f docker-compose.dev.yml config
cd server && go test -race ./...
```

Run `cd webapp && npm run lint && npm run test && npm run build`, `make manifest-check`, and `make dist` when plugin code or packaging changed.
