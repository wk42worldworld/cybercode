#!/usr/bin/env python3
"""CyberCode anonymous usage counter and private statistics dashboard."""

import base64
import binascii
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, urlsplit


SCHEMA_VERSION = 1
MAX_BODY_BYTES = 4096
MAX_LOGIN_BODY_BYTES = 2048
SESSION_COOKIE_NAME = "cybercode_stats_session"
SESSION_TTL_DAYS = 31
SESSION_TTL_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60
CHINA_TIMEZONE = timezone(timedelta(hours=8))
INSTALLATION_ID_PATTERN = re.compile(r"^[a-f0-9]{64}$")
METADATA_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+() -]{0,63}$")
ALLOWED_FIELDS = {
    "schemaVersion",
    "installationId",
    "version",
    "platform",
    "arch",
    "surface",
}
ASSET_CONTENT_TYPES = {
    "echarts.min.js": "text/javascript; charset=utf-8",
    "gsap.min.js": "text/javascript; charset=utf-8",
    "ScrollTrigger.min.js": "text/javascript; charset=utf-8",
    "satoshi-regular.woff2": "font/woff2",
    "satoshi-medium.woff2": "font/woff2",
    "satoshi-bold.woff2": "font/woff2",
    "world.geojson": "application/geo+json; charset=utf-8",
}
CHINA_REGION_NAMES = {
    "Anhui": "安徽省",
    "Beijing": "北京市",
    "Chongqing": "重庆市",
    "Fujian": "福建省",
    "Gansu": "甘肃省",
    "Guangdong": "广东省",
    "Guangxi": "广西壮族自治区",
    "Guizhou": "贵州省",
    "Hainan": "海南省",
    "Hebei": "河北省",
    "Heilongjiang": "黑龙江省",
    "Henan": "河南省",
    "Hubei": "湖北省",
    "Hunan": "湖南省",
    "Inner Mongolia": "内蒙古自治区",
    "Jiangsu": "江苏省",
    "Jiangxi": "江西省",
    "Jilin": "吉林省",
    "Liaoning": "辽宁省",
    "Ningxia": "宁夏回族自治区",
    "Qinghai": "青海省",
    "Shaanxi": "陕西省",
    "Shandong": "山东省",
    "Shanghai": "上海市",
    "Shanxi": "山西省",
    "Sichuan": "四川省",
    "Tianjin": "天津市",
    "Tibet": "西藏自治区",
    "Xinjiang": "新疆维吾尔自治区",
    "Yunnan": "云南省",
    "Zhejiang": "浙江省",
}
CHINA_REGION_CODES = {
    "11": "北京市",
    "12": "天津市",
    "13": "河北省",
    "14": "山西省",
    "15": "内蒙古自治区",
    "21": "辽宁省",
    "22": "吉林省",
    "23": "黑龙江省",
    "31": "上海市",
    "32": "江苏省",
    "33": "浙江省",
    "34": "安徽省",
    "35": "福建省",
    "36": "江西省",
    "37": "山东省",
    "41": "河南省",
    "42": "湖北省",
    "43": "湖南省",
    "44": "广东省",
    "45": "广西壮族自治区",
    "46": "海南省",
    "50": "重庆市",
    "51": "四川省",
    "52": "贵州省",
    "53": "云南省",
    "54": "西藏自治区",
    "61": "陕西省",
    "62": "甘肃省",
    "63": "青海省",
    "64": "宁夏回族自治区",
    "65": "新疆维吾尔自治区",
}


class PayloadError(ValueError):
    pass


@dataclass(frozen=True)
class GeoLocation:
    country_code: str = "ZZ"
    country_name: str = "未知地区"
    region_name: str = ""


UNKNOWN_LOCATION = GeoLocation()


def extract_public_ip(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    candidate = value.strip()
    if not candidate or "," in candidate:
        return None
    try:
        address = ipaddress.ip_address(candidate)
    except ValueError:
        return None
    if not address.is_global:
        return None
    return address.compressed


def trusted_client_ip(header_value: Optional[str], peer_address: str) -> Optional[str]:
    try:
        peer = ipaddress.ip_address(peer_address)
    except ValueError:
        return None
    if not peer.is_loopback:
        return None
    return extract_public_ip(header_value)


def localized_name(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    names = value.get("names")
    if not isinstance(names, dict):
        return ""
    for language in ("zh-CN", "zh", "en"):
        name = names.get(language)
        if isinstance(name, str) and name.strip():
            return name.strip()[:128]
    return ""


class GeoResolver:
    """Resolve an IP locally and return only coarse country/subdivision data."""

    def __init__(
        self,
        database_path: str,
        reader: Any = None,
        reload_interval_seconds: float = 300,
    ):
        self.database_path = database_path
        self.reload_interval_seconds = reload_interval_seconds
        self._lock = threading.Lock()
        self._reader = reader
        self._injected_reader = reader is not None
        self._database_mtime: Optional[float] = None
        self._last_reload_check = 0.0
        if not self._injected_reader:
            with self._lock:
                self._reload_locked(force=True)

    def lookup(self, address: Optional[str]) -> GeoLocation:
        if not address:
            return UNKNOWN_LOCATION
        with self._lock:
            if not self._injected_reader:
                self._reload_locked()
            if self._reader is None:
                return UNKNOWN_LOCATION
            try:
                record = self._reader.get(address)
            except (KeyError, TypeError, ValueError):
                return UNKNOWN_LOCATION

        if not isinstance(record, dict):
            return UNKNOWN_LOCATION
        country = record.get("country")
        if not isinstance(country, dict):
            return UNKNOWN_LOCATION
        country_code = str(country.get("iso_code", "")).upper()
        if not re.fullmatch(r"[A-Z]{2}", country_code):
            return UNKNOWN_LOCATION
        country_name = localized_name(country) or country_code

        region_name = ""
        subdivisions = record.get("subdivisions")
        if isinstance(subdivisions, list) and subdivisions:
            subdivision = subdivisions[0]
            region_name = localized_name(subdivision)
            region_code = (
                str(subdivision.get("iso_code", "")).upper()
                if isinstance(subdivision, dict)
                else ""
            )
            region_code = region_code.rsplit("-", 1)[-1]
        else:
            region_code = ""
        if country_code == "CN":
            region_name = CHINA_REGION_CODES.get(
                region_code,
                CHINA_REGION_NAMES.get(region_name, region_name),
            )
        return GeoLocation(country_code, country_name, region_name)

    def close(self) -> None:
        with self._lock:
            reader = self._reader
            self._reader = None
        if reader is not None and hasattr(reader, "close"):
            reader.close()

    def _reload_locked(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last_reload_check < self.reload_interval_seconds:
            return
        self._last_reload_check = now
        try:
            database_mtime = os.path.getmtime(self.database_path)
        except OSError:
            database_mtime = None
        if database_mtime is None or (
            self._reader is not None and database_mtime == self._database_mtime
        ):
            return

        try:
            import maxminddb

            reader = maxminddb.open_database(self.database_path)
        except (ImportError, OSError, ValueError):
            return

        previous = self._reader
        self._reader = reader
        self._database_mtime = database_mtime
        if previous is not None and hasattr(previous, "close"):
            previous.close()


def china_day(moment: datetime) -> str:
    return moment.astimezone(CHINA_TIMEZONE).date().isoformat()


def session_secret_from_password(password: str) -> bytes:
    return hashlib.sha256(
        b"CyberCode Stats Session\0" + password.encode("utf-8")
    ).digest()


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def create_session_token(
    username: str,
    secret: bytes,
    now: Optional[float] = None,
) -> str:
    issued_at = int(time.time() if now is None else now)
    expires_at = issued_at + SESSION_TTL_SECONDS
    nonce = secrets.token_urlsafe(12)
    payload = "{0}\n{1}\n{2}".format(username, expires_at, nonce).encode("utf-8")
    signature = hmac.new(secret, payload, hashlib.sha256).digest()
    return "{0}.{1}".format(
        _base64url_encode(payload),
        _base64url_encode(signature),
    )


def verify_session_token(
    token: str,
    username: str,
    secret: bytes,
    now: Optional[float] = None,
) -> bool:
    if not isinstance(token, str) or not token or len(token) > 512:
        return False
    try:
        payload_value, signature_value = token.split(".", 1)
        payload = _base64url_decode(payload_value)
        signature = _base64url_decode(signature_value)
        token_username, expires_value, nonce = payload.decode("utf-8").split("\n", 2)
        expires_at = int(expires_value)
    except (ValueError, UnicodeDecodeError, UnicodeEncodeError, binascii.Error):
        return False
    expected = hmac.new(secret, payload, hashlib.sha256).digest()
    if not hmac.compare_digest(signature, expected):
        return False
    current_time = int(time.time() if now is None else now)
    return bool(nonce) and secure_text_equal(token_username, username) and expires_at >= current_time


def cookie_value(header: Optional[str], name: str) -> str:
    if not header:
        return ""
    cookies = SimpleCookie()
    try:
        cookies.load(header)
    except CookieError:
        return ""
    morsel = cookies.get(name)
    return morsel.value if morsel else ""


def secure_text_equal(left: str, right: str) -> bool:
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


def validate_payload(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise PayloadError("JSON body must be an object")
    if set(value.keys()) != ALLOWED_FIELDS:
        raise PayloadError("Unexpected or missing fields")
    if value.get("schemaVersion") != SCHEMA_VERSION:
        raise PayloadError("Unsupported schema version")

    installation_id = value.get("installationId")
    if not isinstance(installation_id, str) or not INSTALLATION_ID_PATTERN.fullmatch(
        installation_id
    ):
        raise PayloadError("Invalid installation ID")

    metadata: Dict[str, str] = {}
    for field in ("version", "platform", "arch"):
        item = value.get(field)
        if not isinstance(item, str) or not METADATA_PATTERN.fullmatch(item):
            raise PayloadError("Invalid metadata")
        metadata[field] = item

    surface = value.get("surface")
    if surface not in {"cli", "desktop"}:
        raise PayloadError("Invalid surface")

    return {
        "installationId": installation_id,
        "version": metadata["version"],
        "platform": metadata["platform"],
        "arch": metadata["arch"],
        "surface": surface,
    }


class AnalyticsStore:
    def __init__(self, database_path: str):
        self.database_path = database_path
        Path(database_path).parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA synchronous = NORMAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS installations (
                    installation_id TEXT PRIMARY KEY,
                    first_seen_at TEXT NOT NULL,
                    first_seen_day TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    last_seen_day TEXT NOT NULL,
                    version TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    arch TEXT NOT NULL,
                    surface TEXT NOT NULL,
                    country_code TEXT NOT NULL DEFAULT 'ZZ',
                    country_name TEXT NOT NULL DEFAULT '未知地区',
                    region_name TEXT NOT NULL DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS daily_activity (
                    day TEXT NOT NULL,
                    installation_id TEXT NOT NULL,
                    first_seen_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    version TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    arch TEXT NOT NULL,
                    surface TEXT NOT NULL,
                    country_code TEXT NOT NULL DEFAULT 'ZZ',
                    country_name TEXT NOT NULL DEFAULT '未知地区',
                    region_name TEXT NOT NULL DEFAULT '',
                    PRIMARY KEY (day, installation_id)
                );

                CREATE INDEX IF NOT EXISTS idx_installations_first_seen_day
                    ON installations(first_seen_day);
                CREATE INDEX IF NOT EXISTS idx_installations_last_seen_day
                    ON installations(last_seen_day);
                CREATE INDEX IF NOT EXISTS idx_daily_activity_day
                    ON daily_activity(day);
                """
            )
            self._migrate_location_columns(connection)
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_installations_country_code "
                "ON installations(country_code)"
            )

    def _migrate_location_columns(self, connection: sqlite3.Connection) -> None:
        definitions = {
            "country_code": "TEXT NOT NULL DEFAULT 'ZZ'",
            "country_name": "TEXT NOT NULL DEFAULT '未知地区'",
            "region_name": "TEXT NOT NULL DEFAULT ''",
        }
        for table in ("installations", "daily_activity"):
            existing = {
                row["name"]
                for row in connection.execute(
                    "PRAGMA table_info({0})".format(table)
                ).fetchall()
            }
            for column, definition in definitions.items():
                if column not in existing:
                    connection.execute(
                        "ALTER TABLE {0} ADD COLUMN {1} {2}".format(
                            table, column, definition
                        )
                    )

    def record(
        self,
        payload: Dict[str, Any],
        now: Optional[datetime] = None,
        location: GeoLocation = UNKNOWN_LOCATION,
    ) -> None:
        moment = now or datetime.now(timezone.utc)
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        timestamp = moment.astimezone(timezone.utc).isoformat(timespec="seconds")
        day = china_day(moment)
        values = (
            payload["installationId"],
            timestamp,
            day,
            timestamp,
            day,
            payload["version"],
            payload["platform"],
            payload["arch"],
            payload["surface"],
            location.country_code,
            location.country_name,
            location.region_name,
        )

        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO installations (
                    installation_id, first_seen_at, first_seen_day,
                    last_seen_at, last_seen_day, version, platform, arch, surface,
                    country_code, country_name, region_name
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(installation_id) DO UPDATE SET
                    last_seen_at = excluded.last_seen_at,
                    last_seen_day = excluded.last_seen_day,
                    version = excluded.version,
                    platform = excluded.platform,
                    arch = excluded.arch,
                    surface = excluded.surface,
                    country_code = CASE
                        WHEN excluded.country_code != 'ZZ' THEN excluded.country_code
                        ELSE installations.country_code
                    END,
                    country_name = CASE
                        WHEN excluded.country_code != 'ZZ' THEN excluded.country_name
                        ELSE installations.country_name
                    END,
                    region_name = CASE
                        WHEN excluded.country_code != 'ZZ' THEN excluded.region_name
                        ELSE installations.region_name
                    END
                """,
                values,
            )
            connection.execute(
                """
                INSERT INTO daily_activity (
                    day, installation_id, first_seen_at, last_seen_at,
                    version, platform, arch, surface,
                    country_code, country_name, region_name
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(day, installation_id) DO UPDATE SET
                    last_seen_at = excluded.last_seen_at,
                    version = excluded.version,
                    platform = excluded.platform,
                    arch = excluded.arch,
                    surface = excluded.surface,
                    country_code = CASE
                        WHEN excluded.country_code != 'ZZ' THEN excluded.country_code
                        ELSE daily_activity.country_code
                    END,
                    country_name = CASE
                        WHEN excluded.country_code != 'ZZ' THEN excluded.country_name
                        ELSE daily_activity.country_name
                    END,
                    region_name = CASE
                        WHEN excluded.country_code != 'ZZ' THEN excluded.region_name
                        ELSE daily_activity.region_name
                    END
                """,
                (
                    day,
                    payload["installationId"],
                    timestamp,
                    timestamp,
                    payload["version"],
                    payload["platform"],
                    payload["arch"],
                    payload["surface"],
                    location.country_code,
                    location.country_name,
                    location.region_name,
                ),
            )

    def summary(self, now: Optional[datetime] = None) -> Dict[str, Any]:
        moment = now or datetime.now(timezone.utc)
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        local_date = moment.astimezone(CHINA_TIMEZONE).date()
        today = local_date.isoformat()
        yesterday = (local_date - timedelta(days=1)).isoformat()
        seven_day_start = (local_date - timedelta(days=6)).isoformat()
        previous_seven_day_start = (local_date - timedelta(days=13)).isoformat()
        previous_seven_day_end = (local_date - timedelta(days=7)).isoformat()
        thirty_day_start = (local_date - timedelta(days=29)).isoformat()

        with self._connect() as connection:
            total_users = scalar(connection, "SELECT COUNT(*) FROM installations")
            today_active = scalar(
                connection,
                "SELECT COUNT(*) FROM daily_activity WHERE day = ?",
                (today,),
            )
            yesterday_active = scalar(
                connection,
                "SELECT COUNT(*) FROM daily_activity WHERE day = ?",
                (yesterday,),
            )
            new_today = scalar(
                connection,
                "SELECT COUNT(*) FROM installations WHERE first_seen_day = ?",
                (today,),
            )
            growth_row = connection.execute(
                """
                SELECT
                    COUNT(CASE WHEN first_seen_day = ? THEN 1 END) AS new_yesterday,
                    COUNT(CASE WHEN first_seen_day BETWEEN ? AND ? THEN 1 END) AS new_7d,
                    COUNT(CASE WHEN first_seen_day BETWEEN ? AND ? THEN 1 END)
                        AS new_previous_7d,
                    COUNT(CASE WHEN first_seen_day BETWEEN ? AND ? THEN 1 END) AS new_30d
                FROM installations
                WHERE first_seen_day BETWEEN ? AND ?
                """,
                (
                    yesterday,
                    seven_day_start,
                    today,
                    previous_seven_day_start,
                    previous_seven_day_end,
                    thirty_day_start,
                    today,
                    thirty_day_start,
                    today,
                ),
            ).fetchone()
            active_7d = scalar(
                connection,
                """
                SELECT COUNT(DISTINCT installation_id)
                FROM daily_activity WHERE day BETWEEN ? AND ?
                """,
                (seven_day_start, today),
            )
            active_30d = scalar(
                connection,
                """
                SELECT COUNT(DISTINCT installation_id)
                FROM daily_activity WHERE day BETWEEN ? AND ?
                """,
                (thirty_day_start, today),
            )
            retention_rows = connection.execute(
                """
                SELECT
                    i.first_seen_day AS cohort_day,
                    COUNT(*) AS cohort_size,
                    COUNT(a.installation_id) AS retained_users
                FROM installations AS i
                LEFT JOIN daily_activity AS a
                    ON a.day = ? AND a.installation_id = i.installation_id
                WHERE i.first_seen_day IN (?, ?)
                GROUP BY i.first_seen_day
                """,
                (today, yesterday, previous_seven_day_end),
            ).fetchall()
            activity_rows = connection.execute(
                """
                SELECT day, COUNT(*) AS count
                FROM daily_activity
                WHERE day BETWEEN ? AND ?
                GROUP BY day
                """,
                (thirty_day_start, today),
            ).fetchall()
            new_rows = connection.execute(
                """
                SELECT first_seen_day AS day, COUNT(*) AS count
                FROM installations
                WHERE first_seen_day BETWEEN ? AND ?
                GROUP BY first_seen_day
                """,
                (thirty_day_start, today),
            ).fetchall()
            platforms = grouped_counts(connection, "platform")
            versions = grouped_counts(connection, "version", limit=8)
            surfaces = grouped_counts(connection, "surface")
            located_users = scalar(
                connection,
                "SELECT COUNT(*) FROM installations WHERE country_code != 'ZZ'",
            )
            country_rows = connection.execute(
                """
                SELECT country_code, MAX(country_name) AS country_name,
                       COUNT(*) AS count
                FROM installations
                WHERE country_code != 'ZZ'
                GROUP BY country_code
                ORDER BY count DESC, country_code ASC
                """
            ).fetchall()
            region_rows = connection.execute(
                """
                SELECT country_code, MAX(country_name) AS country_name,
                       region_name, COUNT(*) AS count
                FROM installations
                WHERE country_code != 'ZZ'
                GROUP BY country_code, region_name
                ORDER BY count DESC, country_code ASC, region_name ASC
                LIMIT 20
                """
            ).fetchall()
            china_users = scalar(
                connection,
                """
                SELECT COUNT(*) FROM installations
                WHERE country_code IN ('CN', 'HK', 'MO', 'TW')
                """,
            )
            china_located_users = scalar(
                connection,
                """
                SELECT COUNT(*) FROM installations
                WHERE country_code IN ('HK', 'MO', 'TW')
                   OR (country_code = 'CN' AND TRIM(region_name) != '')
                """,
            )
            china_province_rows = connection.execute(
                """
                SELECT province_name, COUNT(*) AS count
                FROM (
                    SELECT CASE country_code
                        WHEN 'HK' THEN '香港特别行政区'
                        WHEN 'MO' THEN '澳门特别行政区'
                        WHEN 'TW' THEN '台湾省'
                        ELSE TRIM(region_name)
                    END AS province_name
                    FROM installations
                    WHERE country_code IN ('CN', 'HK', 'MO', 'TW')
                )
                WHERE province_name != ''
                GROUP BY province_name
                ORDER BY count DESC, province_name ASC
                """
            ).fetchall()

        activity_by_day = {row["day"]: row["count"] for row in activity_rows}
        new_by_day = {row["day"]: row["count"] for row in new_rows}
        returning_today = max(0, today_active - new_today)
        new_yesterday = int(growth_row["new_yesterday"])
        new_7d = int(growth_row["new_7d"])
        new_previous_7d = int(growth_row["new_previous_7d"])
        new_30d = int(growth_row["new_30d"])
        retention_by_day = {row["cohort_day"]: row for row in retention_rows}
        d1_row = retention_by_day.get(yesterday)
        d7_row = retention_by_day.get(previous_seven_day_end)
        d1_cohort = int(d1_row["cohort_size"]) if d1_row else 0
        d1_retained = int(d1_row["retained_users"]) if d1_row else 0
        d7_cohort = int(d7_row["cohort_size"]) if d7_row else 0
        d7_retained = int(d7_row["retained_users"]) if d7_row else 0
        trend = []
        for offset in range(29, -1, -1):
            day = (local_date - timedelta(days=offset)).isoformat()
            trend.append(
                {
                    "day": day,
                    "active": activity_by_day.get(day, 0),
                    "new": new_by_day.get(day, 0),
                }
            )

        return {
            "generatedAt": moment.astimezone(timezone.utc).isoformat(timespec="seconds"),
            "timezone": "Asia/Shanghai",
            "today": today,
            "totalUsers": total_users,
            "todayActive": today_active,
            "newToday": new_today,
            "returningToday": returning_today,
            "yesterdayActive": yesterday_active,
            "active7d": active_7d,
            "active30d": active_30d,
            "newYesterday": new_yesterday,
            "new7d": new_7d,
            "newPrevious7d": new_previous_7d,
            "new30d": new_30d,
            "new7dGrowthRate": ratio_percent(
                new_7d - new_previous_7d,
                new_previous_7d,
            ),
            "dauMauRate": ratio_percent(today_active, active_30d),
            "wauMauRate": ratio_percent(active_7d, active_30d),
            "returningRate": ratio_percent(returning_today, today_active),
            "d1CohortSize": d1_cohort,
            "d1RetainedUsers": d1_retained,
            "d1RetentionRate": ratio_percent(d1_retained, d1_cohort),
            "d7CohortSize": d7_cohort,
            "d7RetainedUsers": d7_retained,
            "d7RetentionRate": ratio_percent(d7_retained, d7_cohort),
            "trend": trend,
            "platforms": platforms,
            "versions": versions,
            "surfaces": surfaces,
            "locatedUsers": located_users,
            "unlocatedUsers": max(0, total_users - located_users),
            "chinaUsers": china_users,
            "chinaLocatedUsers": china_located_users,
            "chinaUnlocatedUsers": max(0, china_users - china_located_users),
            "chinaProvinces": [
                {
                    "provinceName": row["province_name"],
                    "count": row["count"],
                }
                for row in china_province_rows
            ],
            "countries": [
                {
                    "countryCode": row["country_code"],
                    "countryName": row["country_name"],
                    "count": row["count"],
                }
                for row in country_rows
            ],
            "regions": [
                {
                    "countryCode": row["country_code"],
                    "countryName": row["country_name"],
                    "regionName": row["region_name"],
                    "count": row["count"],
                }
                for row in region_rows
            ],
        }


def scalar(
    connection: sqlite3.Connection,
    sql: str,
    parameters: tuple = (),
) -> int:
    row = connection.execute(sql, parameters).fetchone()
    return int(row[0]) if row else 0


def ratio_percent(numerator: int, denominator: int) -> Optional[float]:
    if denominator <= 0:
        return None
    return round(numerator / denominator * 100, 1)


def grouped_counts(
    connection: sqlite3.Connection,
    column: str,
    limit: int = 20,
) -> list:
    if column not in {"platform", "version", "surface"}:
        raise ValueError("Unsupported grouping")
    rows = connection.execute(
        "SELECT {0} AS label, COUNT(*) AS count "
        "FROM installations GROUP BY {0} ORDER BY count DESC, label ASC LIMIT ?".format(
            column
        ),
        (limit,),
    ).fetchall()
    return [{"label": row["label"], "count": row["count"]} for row in rows]


class UsageRequestHandler(BaseHTTPRequestHandler):
    server_version = "CyberCodeUsage/1"
    store: AnalyticsStore
    geo_resolver: GeoResolver
    admin_username: str
    admin_password: str
    session_secret: bytes
    dashboard_html: bytes
    login_html: bytes
    static_assets: Dict[str, tuple]

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if path == "/api/cybercode-usage/login":
            self._handle_login()
            return
        if path == "/api/cybercode-usage/logout":
            self._handle_logout()
            return
        if path != "/api/cybercode-usage/heartbeat":
            self._json(404, {"error": "Not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0
        if content_length <= 0 or content_length > MAX_BODY_BYTES:
            self._json(413, {"error": "Invalid body size"})
            return

        try:
            body = self.rfile.read(content_length)
            payload = validate_payload(json.loads(body.decode("utf-8")))
            client_ip = trusted_client_ip(
                self.headers.get("X-CyberCode-Client-IP"),
                self.client_address[0],
            )
            self.store.record(payload, location=self.geo_resolver.lookup(client_ip))
        except (UnicodeDecodeError, json.JSONDecodeError, PayloadError) as error:
            self._json(400, {"error": str(error)})
            return
        except sqlite3.Error:
            self._json(503, {"error": "Storage unavailable"})
            return

        self.send_response(204)
        self._security_headers()
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/health":
            self._json(200, {"status": "ok"})
            return

        static_asset = self._static_asset()
        if static_asset is not None:
            body, content_type = static_asset
            self.send_response(200)
            self._security_headers()
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/cybercode-stats/login":
            if self._authorized():
                self._redirect("/cybercode-stats")
            else:
                query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
                self._send_login_page(error=query.get("error") == ["1"])
            return

        if path not in {
            "/cybercode-stats",
            "/cybercode-stats/",
            "/api/cybercode-usage/summary",
        }:
            self._json(404, {"error": "Not found"})
            return
        if not self._authorized():
            if path == "/api/cybercode-usage/summary":
                self._json(401, {"error": "Authentication required"})
            else:
                self._redirect("/cybercode-stats/login")
            return

        if path == "/api/cybercode-usage/summary":
            self._json(200, self.store.summary())
            return

        self.send_response(200)
        self._security_headers()
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(self.dashboard_html)))
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; "
            "script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; "
            "form-action 'self'; base-uri 'none'",
        )
        self.end_headers()
        self.wfile.write(self.dashboard_html)

    def _authorized(self) -> bool:
        if self._basic_authorized():
            return True
        token = cookie_value(
            self.headers.get("Cookie"),
            SESSION_COOKIE_NAME,
        )
        return verify_session_token(
            token,
            self.admin_username,
            self.session_secret,
        )

    def _basic_authorized(self) -> bool:
        header = self.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            return False
        try:
            decoded = base64.b64decode(header[6:], validate=True).decode("utf-8")
            username, password = decoded.split(":", 1)
        except (ValueError, UnicodeDecodeError):
            return False
        return secure_text_equal(username, self.admin_username) and secure_text_equal(
            password, self.admin_password
        )

    def _handle_login(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0
        if content_length <= 0 or content_length > MAX_LOGIN_BODY_BYTES:
            self._redirect("/cybercode-stats/login?error=1", status=303)
            return
        if not self.headers.get("Content-Type", "").lower().startswith(
            "application/x-www-form-urlencoded"
        ):
            self._redirect("/cybercode-stats/login?error=1", status=303)
            return
        try:
            values = parse_qs(
                self.rfile.read(content_length).decode("utf-8"),
                keep_blank_values=True,
                max_num_fields=4,
            )
            username = values.get("username", [""])[0]
            password = values.get("password", [""])[0]
        except (UnicodeDecodeError, ValueError):
            self._redirect("/cybercode-stats/login?error=1", status=303)
            return

        valid = secure_text_equal(username, self.admin_username) and secure_text_equal(
            password, self.admin_password
        )
        if not valid:
            time.sleep(0.25)
            self._redirect("/cybercode-stats/login?error=1", status=303)
            return

        token = create_session_token(
            self.admin_username,
            self.session_secret,
        )
        self._redirect(
            "/cybercode-stats",
            status=303,
            cookie=self._session_cookie(token, SESSION_TTL_SECONDS),
        )

    def _handle_logout(self) -> None:
        if not self._authorized():
            self._redirect("/cybercode-stats/login", status=303)
            return
        self._redirect(
            "/cybercode-stats/login",
            status=303,
            cookie=self._session_cookie("", 0),
        )

    def _send_login_page(self, error: bool = False, status: int = 200) -> None:
        body = self.login_html.replace(
            b"__LOGIN_ERROR_CLASS__",
            b"visible" if error else b"",
        ).replace(
            b"__LOGIN_ERROR_MESSAGE__",
            "用户名或密码不正确，请重试。".encode("utf-8") if error else b"",
        )
        self.send_response(status)
        self._security_headers()
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; "
            "form-action 'self'; base-uri 'none'",
        )
        self.end_headers()
        self.wfile.write(body)

    def _redirect(
        self,
        location: str,
        status: int = 302,
        cookie: Optional[str] = None,
    ) -> None:
        self.send_response(status)
        self._security_headers()
        self.send_header("Location", location)
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _session_cookie(self, value: str, max_age: int) -> str:
        parts = [
            "{0}={1}".format(SESSION_COOKIE_NAME, value),
            "Path=/",
            "HttpOnly",
            "SameSite=Strict",
            "Max-Age={0}".format(max_age),
        ]
        if self.headers.get("X-Forwarded-Proto", "").split(",", 1)[0].strip() == "https":
            parts.append("Secure")
        return "; ".join(parts)

    def _static_asset(self) -> Optional[tuple]:
        prefix = "/cybercode-stats/assets/"
        path = urlsplit(self.path).path
        if not path.startswith(prefix):
            return None
        name = path[len(prefix) :]
        return self.static_assets.get(name)

    def _json(self, status: int, value: Dict[str, Any]) -> None:
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self._security_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _security_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")

    def log_message(self, _format: str, *_args: Any) -> None:
        # Deliberately avoid logging client IPs for anonymous heartbeats.
        return


def main() -> None:
    host = os.environ.get("CYBERCODE_ANALYTICS_HOST", "127.0.0.1")
    port = int(os.environ.get("CYBERCODE_ANALYTICS_PORT", "8787"))
    database_path = os.environ.get(
        "CYBERCODE_ANALYTICS_DB",
        "/var/lib/cybercode-usage/usage.sqlite3",
    )
    geoip_database_path = os.environ.get(
        "CYBERCODE_GEOIP_DB",
        "/var/lib/cybercode-usage/dbip-city-lite.mmdb",
    )
    admin_username = os.environ.get("CYBERCODE_ANALYTICS_ADMIN_USER", "admin")
    admin_password = os.environ.get("CYBERCODE_ANALYTICS_ADMIN_PASSWORD", "")
    if len(admin_password) < 11:
        raise RuntimeError("CYBERCODE_ANALYTICS_ADMIN_PASSWORD must be at least 11 characters")
    configured_session_secret = os.environ.get(
        "CYBERCODE_ANALYTICS_SESSION_SECRET",
        "",
    )
    if configured_session_secret and len(configured_session_secret) < 32:
        raise RuntimeError(
            "CYBERCODE_ANALYTICS_SESSION_SECRET must be at least 32 characters"
        )
    session_secret = (
        configured_session_secret.encode("utf-8")
        if configured_session_secret
        else session_secret_from_password(admin_password)
    )

    dashboard_path = Path(__file__).with_name("dashboard.html")
    login_path = Path(__file__).with_name("login.html")
    assets_path = Path(__file__).with_name("assets")
    UsageRequestHandler.store = AnalyticsStore(database_path)
    UsageRequestHandler.geo_resolver = GeoResolver(geoip_database_path)
    UsageRequestHandler.admin_username = admin_username
    UsageRequestHandler.admin_password = admin_password
    UsageRequestHandler.session_secret = session_secret
    UsageRequestHandler.dashboard_html = dashboard_path.read_bytes()
    UsageRequestHandler.login_html = login_path.read_bytes()
    UsageRequestHandler.static_assets = {
        name: ((assets_path / name).read_bytes(), content_type)
        for name, content_type in ASSET_CONTENT_TYPES.items()
    }

    server = ThreadingHTTPServer((host, port), UsageRequestHandler)
    print("CyberCode usage service listening on {0}:{1}".format(host, port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        UsageRequestHandler.geo_resolver.close()


if __name__ == "__main__":
    main()
