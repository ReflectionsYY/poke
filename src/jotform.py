import logging
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from .config import Config

log = logging.getLogger(__name__)


class JotformError(Exception):
    pass


class JotformClient:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self._client = httpx.Client(base_url=cfg.jotform_base_url, timeout=30.0)

    def close(self) -> None:
        self._client.close()

    @retry(
        reraise=True,
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=2, min=2, max=16),
        retry=retry_if_exception_type(httpx.TransportError),
    )
    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        merged = {"apiKey": self.cfg.jotform_api_key}
        if params:
            merged.update(params)
        resp = self._client.get(path, params=merged)
        if resp.status_code != 200:
            raise JotformError(f"Jotform {path} -> {resp.status_code} {resp.text}")
        body = resp.json()
        if body.get("responseCode") not in (200, None):
            raise JotformError(f"Jotform error body: {body}")
        return body

    def list_new_submissions(self, last_seen_id: str | None) -> list[dict[str, Any]]:
        """Return submissions newer than last_seen_id, oldest first."""
        # Jotform submission IDs are monotonically increasing (time-encoded).
        # We fetch the most recent page sorted desc then filter + reverse so
        # callers always process in chronological order.
        body = self._get(
            f"/form/{self.cfg.jotform_form_id}/submissions",
            params={"limit": 100, "orderby": "created_at"},
        )
        submissions = body.get("content", []) or []
        if last_seen_id:
            submissions = [s for s in submissions if s.get("id", "") > last_seen_id]
        submissions.sort(key=lambda s: s.get("id", ""))
        return submissions
