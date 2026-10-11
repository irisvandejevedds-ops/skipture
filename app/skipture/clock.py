from datetime import datetime, timezone

_override = None


def now() -> datetime:
    """Aware UTC now; tests may pin it with set_now()."""
    return _override or datetime.now(timezone.utc)


def set_now(dt):
    global _override
    _override = dt


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
