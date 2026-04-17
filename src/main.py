import logging
import signal
import sys
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

from .config import Config, load_config
from .encompass import (
    BASELINE_PERSONAS,
    DuplicateUserError,
    EncompassClient,
    EncompassError,
)
from .jotform import JotformClient
from .mapping import (
    NewHire,
    base_user_id,
    build_encompass_payload,
    parse_submission,
    rehire_user_id,
)
from .state import State

log = logging.getLogger("encompass_autocreate")


def setup_logging(cfg: Config) -> None:
    Path(cfg.log_file).parent.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s - %(message)s"
    )
    root = logging.getLogger()
    root.setLevel(cfg.log_level)
    for h in list(root.handlers):
        root.removeHandler(h)
    file_h = RotatingFileHandler(cfg.log_file, maxBytes=5_000_000, backupCount=5)
    file_h.setFormatter(fmt)
    root.addHandler(file_h)
    stream_h = logging.StreamHandler(sys.stdout)
    stream_h.setFormatter(fmt)
    root.addHandler(stream_h)


def resolve_user_id(hire: NewHire, encompass: EncompassClient) -> str:
    base = base_user_id(hire)
    if not hire.rehire:
        return base
    # Rehire: start at "<base>2" and increment until we find an unused slot.
    suffix = 2
    while True:
        candidate = rehire_user_id(hire, suffix)
        if not encompass.user_exists(candidate):
            return candidate
        suffix += 1


def build_personas(hire: NewHire, encompass: EncompassClient) -> list[dict[str, Any]]:
    names = list(BASELINE_PERSONAS)
    if hire.job_title:
        names.append(hire.job_title)
    return [encompass.persona_ref(n) for n in names]


def process_submission(
    submission: dict[str, Any],
    encompass: EncompassClient,
    state: State,
    cfg: Config,
) -> None:
    sub_id = str(submission.get("id", ""))
    if state.is_processed(sub_id):
        log.info("Submission %s already processed, skipping", sub_id)
        return

    hire = parse_submission(submission)
    user_id = resolve_user_id(hire, encompass)
    personas = build_personas(hire, encompass)
    payload = build_encompass_payload(
        hire=hire,
        user_id=user_id,
        email_domain=cfg.email_domain,
        persona_refs=personas,
        org_ref=encompass.new_hires_org_ref(),
    )

    log.info(
        "Creating Encompass user id=%s (submission=%s, rehire=%s, title=%s)",
        user_id,
        sub_id,
        hire.rehire,
        hire.job_title,
    )
    try:
        encompass.create_user(payload)
        state.mark_processed(sub_id, user_id, "created")
        log.info("Created user %s", user_id)
    except DuplicateUserError:
        state.mark_processed(sub_id, user_id, "duplicate")
        log.warning("User %s already exists; marking submission %s as duplicate",
                    user_id, sub_id)


def poll_once(
    jotform: JotformClient,
    encompass: EncompassClient,
    state: State,
    cfg: Config,
) -> None:
    last_seen = state.get_last_seen()
    submissions = jotform.list_new_submissions(last_seen)
    if not submissions:
        log.debug("No new submissions")
        return
    log.info("Found %d new submission(s)", len(submissions))

    max_id = last_seen or ""
    for sub in submissions:
        sub_id = str(sub.get("id", ""))
        try:
            process_submission(sub, encompass, state, cfg)
        except (EncompassError, ValueError) as e:
            log.error("Submission %s failed: %s", sub_id, e)
            state.mark_processed(sub_id, "", f"error: {e}")
        if sub_id > max_id:
            max_id = sub_id
            state.set_last_seen(max_id)


_stop = False


def _handle_signal(signum, _frame):
    global _stop
    log.info("Received signal %s, stopping after current cycle", signum)
    _stop = True


def main() -> int:
    cfg = load_config()
    setup_logging(cfg)
    log.info("Starting encompass auto-user service")

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    state = State(cfg.state_db_path)
    jotform = JotformClient(cfg)
    encompass = EncompassClient(cfg)

    try:
        encompass.load_lookups()
        while not _stop:
            try:
                poll_once(jotform, encompass, state, cfg)
            except Exception:
                log.exception("Poll cycle failed")
            for _ in range(cfg.poll_interval_seconds):
                if _stop:
                    break
                time.sleep(1)
    finally:
        jotform.close()
        encompass.close()
        log.info("Service stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
