import logging
import time
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from .config import Config

log = logging.getLogger(__name__)

# Personas every new hire receives in addition to their job-title persona.
BASELINE_PERSONAS = ["SimpleNexus"]


class EncompassError(Exception):
    pass


class DuplicateUserError(EncompassError):
    pass


class EncompassClient:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self._client = httpx.Client(base_url=cfg.encompass_base_url, timeout=30.0)
        self._token: str | None = None
        self._token_expires_at: float = 0.0
        self._persona_index: dict[str, dict[str, Any]] = {}
        self._new_hires_org: dict[str, Any] | None = None

    def close(self) -> None:
        self._client.close()

    # ------------------------------------------------------------------ auth

    def _token_valid(self) -> bool:
        return self._token is not None and time.time() < self._token_expires_at - 30

    def _authenticate(self) -> None:
        # Encompass Resource Owner Password Credentials grant. The admin user's
        # name is combined with the instance ID: "<user>@encompass:<instance>".
        data = {
            "grant_type": "password",
            "username": f"{self.cfg.encompass_admin_user}@encompass:{self.cfg.encompass_instance_id}",
            "password": self.cfg.encompass_admin_password,
            "client_id": self.cfg.encompass_client_id,
            "client_secret": self.cfg.encompass_client_secret,
        }
        resp = self._client.post(
            "/oauth2/v1/token",
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if resp.status_code != 200:
            raise EncompassError(
                f"OAuth token request failed: {resp.status_code} {resp.text}"
            )
        body = resp.json()
        self._token = body["access_token"]
        self._token_expires_at = time.time() + int(body.get("expires_in", 3600))
        log.info("Acquired Encompass access token")

    def _auth_header(self) -> dict[str, str]:
        if not self._token_valid():
            self._authenticate()
        return {"Authorization": f"Bearer {self._token}"}

    # ---------------------------------------------------------------- helpers

    @retry(
        reraise=True,
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=2, min=2, max=16),
        retry=retry_if_exception_type(httpx.TransportError),
    )
    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        headers = kwargs.pop("headers", {}) | self._auth_header()
        resp = self._client.request(method, path, headers=headers, **kwargs)
        if resp.status_code == 401:
            # Token expired mid-flight; force refresh and retry once.
            self._token = None
            headers = kwargs.pop("headers", {}) | self._auth_header()
            resp = self._client.request(method, path, headers=headers, **kwargs)
        return resp

    # ----------------------------------------------------------------- lookups

    def load_lookups(self) -> None:
        """Resolve the New Hires org and persona IDs once at startup."""
        self._load_new_hires_org()
        self._load_personas()

    def _load_new_hires_org(self) -> None:
        # Encompass moved org admin to v3; fall back to v1 "groups" for older instances.
        resp = self._request("GET", "/encompass/v3/company/orgs")
        if resp.status_code == 404:
            resp = self._request(
                "GET",
                "/encompass/v1/company/groups",
                params={"type": "Organization"},
            )
        if resp.status_code != 200:
            raise EncompassError(
                f"Failed to list organizations: {resp.status_code} {resp.text}"
            )
        target = self.cfg.new_hires_org_name.strip().lower()
        for org in resp.json():
            if org.get("name", "").strip().lower() == target:
                self._new_hires_org = org
                log.info(
                    "Resolved '%s' org id=%s",
                    org["name"],
                    org.get("id") or org.get("entityId"),
                )
                return
        raise EncompassError(
            f"Org '{self.cfg.new_hires_org_name}' not found in instance"
        )

    def _load_personas(self) -> None:
        resp = self._request("GET", "/encompass/v3/company/personas")
        if resp.status_code == 404:
            resp = self._request("GET", "/encompass/v1/company/personas")
        if resp.status_code != 200:
            raise EncompassError(
                f"Failed to list personas: {resp.status_code} {resp.text}"
            )
        for persona in resp.json():
            name = persona.get("name", "")
            if name:
                self._persona_index[name.strip().lower()] = persona
        log.info("Loaded %d personas", len(self._persona_index))

    def persona_ref(self, name: str) -> dict[str, Any]:
        persona = self._persona_index.get(name.strip().lower())
        if not persona:
            raise EncompassError(f"Persona '{name}' not found in Encompass")
        return {
            "entityId": persona.get("id") or persona.get("entityId"),
            "entityType": "Persona",
            "entityName": persona.get("name"),
        }

    def new_hires_org_ref(self) -> dict[str, Any]:
        assert self._new_hires_org is not None, "load_lookups() must be called first"
        return {
            "entityId": self._new_hires_org.get("id"),
            "entityType": "Group",
            "entityName": self._new_hires_org.get("name"),
        }

    # ------------------------------------------------------------------ users

    def user_exists(self, user_id: str) -> bool:
        resp = self._request("GET", f"/encompass/v1/company/users/{user_id}")
        if resp.status_code == 200:
            return True
        if resp.status_code == 404:
            return False
        raise EncompassError(
            f"Failed to check user '{user_id}': {resp.status_code} {resp.text}"
        )

    def create_user(self, payload: dict[str, Any]) -> dict[str, Any]:
        resp = self._request(
            "POST",
            "/encompass/v1/company/users",
            json=payload,
        )
        if resp.status_code in (200, 201):
            return resp.json() if resp.content else {"id": payload.get("id")}
        if resp.status_code == 409:
            raise DuplicateUserError(payload.get("id", ""))
        raise EncompassError(
            f"Create user failed ({resp.status_code}): {resp.text}"
        )
