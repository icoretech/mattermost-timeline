#!/usr/bin/env python3
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

SITE_URL = os.environ.get("MM_SERVICESETTINGS_SITEURL", "http://localhost:18065").rstrip("/")
ADMIN_USERNAME = os.environ.get("MM_ADMIN_USERNAME", "admin@example.com")
ADMIN_PASSWORD = os.environ.get("MM_ADMIN_PASSWORD", "Password1!")
TEAM_NAME = os.environ.get("MATTERMOST_DEV_TEAM", "example-org")
CHANNEL_NAME = os.environ.get("MATTERMOST_DEV_CHANNEL", "town-square")
WEBHOOK_SECRET = os.environ.get("TIMELINE_WEBHOOK_SECRET", "timeline-smoke-secret")
EXTERNAL_ID = os.environ.get("TIMELINE_EXTERNAL_ID", f"timeline-smoke-{uuid.uuid4().hex}")
CHANNEL_SCOPE = os.environ.get("TIMELINE_CHANNEL_SCOPE", "false").lower() in {
    "1",
    "true",
    "yes",
    "on",
}
TEAM_IDENTIFIER = os.environ.get("TIMELINE_TEAM_IDENTIFIER")
CHANNEL_IDENTIFIER = os.environ.get("TIMELINE_CHANNEL_IDENTIFIER")
PLUGIN_ID = "ch.icorete.mattermost-timeline"


def request_json(method, path, payload=None, token=None, headers=None):
    body = None
    request_headers = {"Accept": "application/json"}
    if headers:
        request_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    if token:
        request_headers["Authorization"] = f"Bearer {token}"

    request = urllib.request.Request(
        f"{SITE_URL}{path}", data=body, method=method, headers=request_headers
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response_body = response.read()
            decoded = json.loads(response_body.decode("utf-8")) if response_body else {}
            return decoded, response.headers
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} failed with {error.code}: {detail}") from error


def login():
    _, headers = request_json(
        "POST",
        "/api/v4/users/login",
        {"login_id": ADMIN_USERNAME, "password": ADMIN_PASSWORD},
    )
    token = headers.get("Token")
    if not token:
        raise RuntimeError("login response did not include a Token header")
    return token


def get_team(token):
    team, _ = request_json(
        "GET",
        f"/api/v4/teams/name/{urllib.parse.quote(TEAM_NAME)}",
        token=token,
    )
    return team


def get_channel(token):
    channel, _ = request_json(
        "GET",
        f"/api/v4/teams/name/{urllib.parse.quote(TEAM_NAME)}/channels/name/{urllib.parse.quote(CHANNEL_NAME)}",
        token=token,
    )
    return channel


def post_webhook(team, channel):
    team_identifier = TEAM_IDENTIFIER or team["name"]
    channel_identifier = ""
    channels = []
    if CHANNEL_SCOPE:
        channel_identifier = CHANNEL_IDENTIFIER or channel["name"]
        channels = [channel_identifier]

    payload = {
        "title": "Timeline smoke test",
        "message": f"Deployment smoke test at {int(time.time())}.",
        "event_type": "info",
        "source": "smoke-test",
        "external_id": EXTERNAL_ID,
        "channels": channels,
    }
    event, _ = request_json(
        "POST",
        f"/plugins/{PLUGIN_ID}/webhook?team_id={urllib.parse.quote(team_identifier)}",
        payload,
        headers={"X-Webhook-Secret": WEBHOOK_SECRET},
    )
    return event, team_identifier, channel_identifier


def fetch_events(token, team_id, channel_id):
    query = urllib.parse.urlencode(
        {
            "team_id": team_id,
            "channel_id": channel_id,
            "limit": "10",
        }
    )
    response, _ = request_json(
        "GET",
        f"/plugins/{PLUGIN_ID}/api/v1/events?{query}",
        token=token,
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    return response


def main():
    token = login()
    team = get_team(token)
    channel = get_channel(token)
    event, posted_team_identifier, posted_channel_identifier = post_webhook(team, channel)
    events_response = fetch_events(token, team["id"], channel["id"])
    matching = [
        item for item in events_response.get("events", []) if item.get("external_id") == EXTERNAL_ID
    ]
    if not matching:
        raise RuntimeError(f"created event {event.get('id')} was not returned by events API")

    print(f"event_id={event['id']}")
    print(f"external_id={EXTERNAL_ID}")
    print(f"team_id={team['id']}")
    print(f"team_name={team['name']}")
    print(f"channel_id={channel['id']}")
    print(f"channel_name={channel['name']}")
    print(f"channel_scoped={str(CHANNEL_SCOPE).lower()}")
    print(f"posted_team_identifier={posted_team_identifier}")
    if posted_channel_identifier:
        print(f"posted_channel_identifier={posted_channel_identifier}")
    print(f"channel_url={SITE_URL}/{team['name']}/channels/{channel['name']}")
    print("events_api_contains_created_event=true")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        sys.exit(1)
