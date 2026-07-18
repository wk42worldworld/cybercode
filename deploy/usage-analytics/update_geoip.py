#!/usr/bin/env python3
"""Download and atomically refresh the offline DB-IP Lite city database."""

import gzip
import os
import tempfile
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

import maxminddb


DOWNLOAD_TEMPLATE = "https://download.db-ip.com/free/dbip-city-lite-{0}.mmdb.gz"
MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024
MAX_DATABASE_BYTES = 256 * 1024 * 1024


def candidate_months(today: date) -> list[str]:
    current_month = today.replace(day=1)
    previous_month = (current_month - timedelta(days=1)).replace(day=1)
    return [current_month.strftime("%Y-%m"), previous_month.strftime("%Y-%m")]


def copy_limited(source, destination, maximum: int) -> int:
    total = 0
    while True:
        chunk = source.read(1024 * 1024)
        if not chunk:
            return total
        total += len(chunk)
        if total > maximum:
            raise RuntimeError("GeoIP database exceeds the configured size limit")
        destination.write(chunk)


def validate_database(path: str) -> None:
    reader = maxminddb.open_database(path)
    try:
        record = reader.get("8.8.8.8")
    finally:
        reader.close()
    country = record.get("country") if isinstance(record, dict) else None
    if not isinstance(country, dict) or not country.get("iso_code"):
        raise RuntimeError("Downloaded GeoIP database failed validation")


def download_month(month: str, target: Path) -> None:
    url = DOWNLOAD_TEMPLATE.format(month)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "CyberCode-Usage-GeoDB/1"},
    )
    target.parent.mkdir(parents=True, exist_ok=True)

    compressed_path = None
    database_path = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=target.parent,
            prefix="dbip-",
            suffix=".mmdb.gz.part",
            delete=False,
        ) as compressed:
            compressed_path = compressed.name
            with urllib.request.urlopen(request, timeout=60) as response:
                content_length = response.headers.get("Content-Length")
                if content_length and int(content_length) > MAX_DOWNLOAD_BYTES:
                    raise RuntimeError("GeoIP download exceeds the configured size limit")
                copy_limited(response, compressed, MAX_DOWNLOAD_BYTES)

        with tempfile.NamedTemporaryFile(
            dir=target.parent,
            prefix="dbip-",
            suffix=".mmdb.part",
            delete=False,
        ) as database:
            database_path = database.name
            with gzip.open(compressed_path, "rb") as source:
                copy_limited(source, database, MAX_DATABASE_BYTES)

        validate_database(database_path)
        os.chmod(database_path, 0o644)
        os.replace(database_path, target)
        database_path = None
        print("Installed DB-IP Lite database for {0}".format(month), flush=True)
    finally:
        for temporary_path in (compressed_path, database_path):
            if temporary_path:
                try:
                    os.unlink(temporary_path)
                except FileNotFoundError:
                    pass


def main() -> None:
    target = Path(
        os.environ.get(
            "CYBERCODE_GEOIP_DB",
            "/var/lib/cybercode-usage/dbip-city-lite.mmdb",
        )
    )
    failures = []
    for month in candidate_months(date.today()):
        try:
            download_month(month, target)
            return
        except (OSError, RuntimeError, ValueError, urllib.error.URLError) as error:
            failures.append("{0}: {1}".format(month, error))
    raise RuntimeError("Unable to refresh GeoIP database ({0})".format("; ".join(failures)))


if __name__ == "__main__":
    main()
