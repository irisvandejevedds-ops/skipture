import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from skipture import clock  # noqa: E402
from skipture.config import Config, set_config  # noqa: E402
from skipture.db import open_db  # noqa: E402


def env(tmp_path, **kw):
    e = {"SKIPTURE_DATA_DIR": str(tmp_path), "SKIPTURE_TZ": "America/Toronto", "SKIPTURE_REQUIRE_TS_HEADER": "0", "SKIPTURE_COOKIE_SECURE": "0"}
    e.update(kw)
    return e


@pytest.fixture
def cfg(tmp_path):
    c = Config(env(tmp_path))
    set_config(c)
    return c


@pytest.fixture
def db(cfg):
    d = open_db(cfg.db_path)
    yield d
    d.close()
    clock.set_now(None)
