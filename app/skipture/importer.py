"""Take library zips into Skipture from the command line. Uses exactly the same merge rules as the web Import page.

    python -m skipture.importer FILE.zip [FILE.zip ...] [--origin app|developer]

Reads SKIPTURE_DATA_DIR like the web app. Seeded art from your own apps is origin 'app'; a developer's return is 'developer'."""
import sys

from . import libs
from .config import get_config
from .db import open_db


def main(argv):
    origin = "developer"
    if "--origin" in argv:
        i = argv.index("--origin")
        origin = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    files = [a for a in argv if not a.startswith("--")]
    if not files or origin not in ("app", "developer"):
        print(__doc__)
        return 2
    db = open_db(get_config().db_path)
    bad = 0
    for f in files:
        try:
            with open(f, "rb") as fh:
                r = libs.import_zip(db, fh.read(), origin=origin)
        except (libs.LibError, OSError) as e:
            print(f"{f}: REFUSED ({e})")
            bad += 1
            continue
        print(f"{f}: {'created' if r['created'] else 'merged into'} {r['library']['name']}: {len(r['added'])} added, {len(r['updated'])} updated, "
              f"{len(r['kept'])} kept, {len(r['skipped'])} skipped, {len(r['problems'])} problems")
        for p in r["problems"]:
            print("   PROBLEM", p)
    db.close()
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
