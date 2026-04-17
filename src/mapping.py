import re
from dataclasses import dataclass
from typing import Any

# Jotform submissions expose answers under "answers" keyed by question ID.
# Each answer is {"name": "firstName", "text": "First Name", "type": ..., "answer": ...}.
# The answer value is either a string or a typed dict (phone, date, fullname).
#
# Question IDs captured from the live form (form 222484018864157):
Q_FIRST_NAME = "37"
Q_LAST_NAME = "38"
Q_JOB_TITLE = "66"
Q_CELL_PHONE = "31"
Q_NMLS_ID = "59"
Q_REHIRE = "63"


@dataclass
class NewHire:
    first_name: str
    last_name: str
    job_title: str
    cell_phone: str
    nmls_id: str
    rehire: bool
    submission_id: str


def _phone_digits(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("full") or value.get("phone") or ""
    return re.sub(r"\D", "", str(value or ""))


def _plain(value: Any) -> str:
    if isinstance(value, dict):
        # fullname / shortname types
        for k in ("first", "full"):
            if value.get(k):
                return str(value[k]).strip()
        return ""
    return str(value or "").strip()


def parse_submission(submission: dict[str, Any]) -> NewHire:
    answers = submission.get("answers", {}) or {}

    def a(qid: str) -> Any:
        return (answers.get(qid) or {}).get("answer")

    first = _plain(a(Q_FIRST_NAME))
    last = _plain(a(Q_LAST_NAME))
    if not first or not last:
        raise ValueError(
            f"Submission {submission.get('id')} missing first/last name"
        )

    return NewHire(
        first_name=first,
        last_name=last,
        job_title=_plain(a(Q_JOB_TITLE)),
        cell_phone=_phone_digits(a(Q_CELL_PHONE)),
        nmls_id=_plain(a(Q_NMLS_ID)),
        rehire=_plain(a(Q_REHIRE)).lower() == "yes",
        submission_id=str(submission.get("id", "")),
    )


def base_user_id(hire: NewHire) -> str:
    clean = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
    return f"{clean(hire.first_name)}.{clean(hire.last_name)}"


def rehire_user_id(hire: NewHire, suffix: int = 2) -> str:
    return f"{base_user_id(hire)}{suffix}"


def build_encompass_payload(
    hire: NewHire,
    user_id: str,
    email_domain: str,
    persona_refs: list[dict[str, Any]],
    org_ref: dict[str, Any],
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": user_id,
        "firstName": hire.first_name,
        "lastName": hire.last_name,
        "email": f"{user_id}@{email_domain}",
        "personas": persona_refs,
        "organization": org_ref,
    }
    if hire.cell_phone:
        payload["cellphone"] = hire.cell_phone
    if hire.nmls_id:
        payload["nmlsOriginatorID"] = hire.nmls_id
    return payload
