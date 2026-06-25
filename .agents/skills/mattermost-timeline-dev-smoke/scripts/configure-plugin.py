#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.request

SITE_URL = os.environ.get("MM_SERVICESETTINGS_SITEURL", "http://localhost:18065").rstrip("/")
ADMIN_USERNAME = os.environ.get("MM_ADMIN_USERNAME", "admin@example.com")
ADMIN_PASSWORD = os.environ.get("MM_ADMIN_PASSWORD", "Password1!")
WEBHOOK_SECRET = os.environ.get("TIMELINE_WEBHOOK_SECRET", "timeline-smoke-secret")
PLUGIN_ID = "ch.icorete.mattermost-timeline"


def request_json(method, path, payload=None, token=None):
    body = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = urllib.request.Request(
        f"{SITE_URL}{path}", data=body, method=method, headers=headers
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


def main():
    token = login()
    config, _ = request_json("GET", "/api/v4/config", token=token)
    plugin_settings = config.setdefault("PluginSettings", {})
    plugins = plugin_settings.setdefault("Plugins", {})
    timeline_config = plugins.setdefault(PLUGIN_ID, {})
    timeline_config["WebhookSecret"] = WEBHOOK_SECRET
    timeline_config.setdefault("MaxEventsStored", "500")
    timeline_config.setdefault("MaxEventsDisplayed", "100")
    timeline_config.setdefault("TimelineOrder", "oldest_first")
    timeline_config.setdefault("EnableReactions", True)

    request_json("PUT", "/api/v4/config", config, token=token)
    print(f"configured_plugin={PLUGIN_ID}")
    print(f"site_url={SITE_URL}")
    print("webhook_secret_set=true")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        sys.exit(1)
