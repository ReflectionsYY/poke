import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


def _require(name: str) -> str:
    val = os.getenv(name)
    if not val:
        raise RuntimeError(f"Missing required env var: {name}")
    return val


@dataclass(frozen=True)
class Config:
    jotform_api_key: str
    jotform_form_id: str
    jotform_base_url: str

    encompass_base_url: str
    encompass_instance_id: str
    encompass_client_id: str
    encompass_client_secret: str
    encompass_admin_user: str
    encompass_admin_password: str
    new_hires_org_name: str

    email_domain: str

    poll_interval_seconds: int
    state_db_path: str

    log_level: str
    log_file: str


def load_config() -> Config:
    return Config(
        jotform_api_key=_require("JOTFORM_API_KEY"),
        jotform_form_id=_require("JOTFORM_FORM_ID"),
        jotform_base_url=os.getenv("JOTFORM_BASE_URL", "https://api.jotform.com"),
        encompass_base_url=os.getenv("ENCOMPASS_BASE_URL", "https://api.elliemae.com"),
        encompass_instance_id=_require("ENCOMPASS_INSTANCE_ID"),
        encompass_client_id=_require("ENCOMPASS_CLIENT_ID"),
        encompass_client_secret=_require("ENCOMPASS_CLIENT_SECRET"),
        encompass_admin_user=_require("ENCOMPASS_ADMIN_USER"),
        encompass_admin_password=_require("ENCOMPASS_ADMIN_PASSWORD"),
        new_hires_org_name=os.getenv("ENCOMPASS_NEW_HIRES_ORG_NAME", "New Hires"),
        email_domain=os.getenv("EMAIL_DOMAIN", "mortgageright.com"),
        poll_interval_seconds=int(os.getenv("POLL_INTERVAL_SECONDS", "300")),
        state_db_path=os.getenv("STATE_DB_PATH", "./state.sqlite3"),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        log_file=os.getenv("LOG_FILE", "./logs/service.log"),
    )
