"""SecretForge Python SDK (Phase 6).

Fetches decrypted secrets over HTTPS at process boot and (optionally) merges
them into ``os.environ``. Nothing is written to disk.

Auth: service tokens only (read-only, single-env, expiring, revocable).
User JWTs are intentionally NOT supported: apps in CI and servers should
never carry a user's session.

Usage::

    import secretforge
    secretforge.config()  # os.environ now has your secrets
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, Optional

__all__ = ["load", "config", "ForgeError"]
__version__ = "0.1.0"

PROJECT_FILE_NAME = ".secretforge.json"
DEFAULT_URL = "http://localhost:4000"


class ForgeError(Exception):
    """Raised for configuration problems and API errors."""

    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


def _find_project_file(start: Path) -> Optional[Path]:
    """Walk up from `start` looking for .secretforge.json (like the CLI)."""
    directory = start.resolve()
    while True:
        candidate = directory / PROJECT_FILE_NAME
        if candidate.exists():
            return candidate
        if directory.parent == directory:
            return None
        directory = directory.parent


def _load_project_link(start: Path) -> Optional[dict]:
    file = _find_project_file(start)
    if file is None:
        return None
    try:
        parsed = json.loads(file.read_text("utf-8"))
        if parsed.get("projectId") and parsed.get("defaultEnv"):
            return {
                "projectId": parsed["projectId"],
                "defaultEnv": parsed["defaultEnv"],
                "group": parsed.get("group") or "",
            }
    except (ValueError, OSError):
        pass  # malformed link file — treated as absent
    return None


def _resolve(
    project_id: Optional[str],
    env: Optional[str],
    token: Optional[str],
    url: Optional[str],
    group: Optional[str] = None,
) -> tuple:
    link = _load_project_link(Path.cwd())

    project_id = project_id or (link and link["projectId"])
    if not project_id:
        raise ForgeError(
            f"No project_id provided and no {PROJECT_FILE_NAME} found. "
            "Pass project_id= or run `forge init` in your repo."
        )

    token = token or os.environ.get("SECRETFORGE_TOKEN")
    if not token:
        raise ForgeError(
            "No service token. Set SECRETFORGE_TOKEN or pass token=. "
            "Create one in the web UI under Project → Tokens."
        )

    env = env or os.environ.get("SECRETFORGE_ENV") or (link and link["defaultEnv"]) or "dev"
    url = (url or os.environ.get("SECRETFORGE_URL") or DEFAULT_URL).rstrip("/")

    if group is None:
        group = os.environ.get("SECRETFORGE_GROUP") or (link and link.get("group")) or ""

    return project_id, env, token, url, group


def load(
    project_id: Optional[str] = None,
    env: Optional[str] = None,
    token: Optional[str] = None,
    url: Optional[str] = None,
    group: Optional[str] = None,
) -> Dict[str, str]:
    """Fetch all secrets for the environment (and optional group) as a dict.

    Does NOT touch ``os.environ`` — use :func:`config` for that.
    """
    project_id, env, token, url, group = _resolve(project_id, env, token, url, group)

    endpoint = (
        f"{url}/projects/{urllib.parse.quote(project_id, safe='')}"
        f"/envs/{urllib.parse.quote(env, safe='')}/secrets/export"
    )
    if group:
        endpoint += f"?group={urllib.parse.quote(group, safe='')}"
    req = urllib.request.Request(endpoint, headers={"authorization": f"Bearer {token}"})

    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            body = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        message = f"SecretForge request failed ({e.code})"
        try:
            body = json.loads(e.read().decode("utf-8"))
            if body.get("message"):
                message = str(body["message"])
        except (ValueError, OSError):
            pass
        raise ForgeError(message, e.code) from None
    except urllib.error.URLError as e:
        raise ForgeError(f"SecretForge unreachable: {e.reason}") from None

    return dict(body.get("values", {}))


def config(
    project_id: Optional[str] = None,
    env: Optional[str] = None,
    token: Optional[str] = None,
    url: Optional[str] = None,
    group: Optional[str] = None,
) -> Dict[str, str]:
    """Fetch secrets and merge them into ``os.environ``.

    Existing environment variables win — the real environment always
    overrides the vault. Returns the loaded values.
    """
    values = load(project_id=project_id, env=env, token=token, url=url, group=group)
    for key, value in values.items():
        os.environ.setdefault(key, value)
    return values
