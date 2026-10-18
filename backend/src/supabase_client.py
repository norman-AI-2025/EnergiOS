"""Supabase PostgREST database repository and client for EnergiOS."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any
import httpx


@dataclass(frozen=True)
class SupabaseConfig:
    url: str
    key: str

    @classmethod
    def from_env(cls) -> SupabaseConfig | None:
        url = os.getenv("SUPABASE_URL", "").strip()
        key = os.getenv("SUPABASE_KEY", os.getenv("SUPABASE_SECRET_KEY", "")).strip()

        # If not in os.environ, check backend/.env
        if not url or not key:
            from pathlib import Path
            env_file = Path(__file__).resolve().parents[1] / ".env"
            if env_file.is_file():
                for line in env_file.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, _, v = line.partition("=")
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k == "SUPABASE_URL" and not url:
                            url = v
                        elif k in ("SUPABASE_KEY", "SUPABASE_SECRET_KEY") and not key:
                            key = v

        url = url.rstrip("/")
        if url.endswith("/rest/v1"):
            url = url[:-len("/rest/v1")].rstrip("/")

        if not url or not key:
            return None
        return cls(url=url, key=key)


class SupabaseRepository:
    """Async PostgREST client for interacting with Supabase PostgreSQL tables."""

    def __init__(self, config: SupabaseConfig | None = None):
        self.config = config or SupabaseConfig.from_env()
        self._client: httpx.AsyncClient | None = None
        if self.config:
            self._client = httpx.AsyncClient(
                base_url=f"{self.config.url}/rest/v1/",
                headers={
                    "apikey": self.config.key,
                    "Authorization": f"Bearer {self.config.key}",
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation",
                },
                timeout=15.0,
            )

    @property
    def is_configured(self) -> bool:
        return self._client is not None

    async def ping(self) -> bool:
        """Check if Supabase database is reachable."""
        if not self._client:
            return False
        try:
            resp = await self._client.get("assets", params={"limit": "1"})
            return resp.status_code in (200, 206)
        except Exception:
            return False

    async def fetch_assets(self) -> list[dict[str, Any]]:
        """Fetch whole-building assets from Supabase."""
        if not self._client:
            return []
        try:
            resp = await self._client.get("assets", params={"select": "*", "order": "name.asc"})
            resp.raise_for_status()
            return resp.json()
        except Exception as error:
            print(f"[Supabase] fetch_assets error: {error}")
            return []

    async def fetch_meters(self) -> list[dict[str, Any]]:
        """Fetch electricity meters from Supabase."""
        if not self._client:
            return []
        try:
            resp = await self._client.get("meters", params={"select": "*", "is_active": "eq.true"})
            resp.raise_for_status()
            return resp.json()
        except Exception as error:
            print(f"[Supabase] fetch_meters error: {error}")
            return []

    async def fetch_readings(
        self,
        meter_id: str,
        start: datetime | None = None,
        end: datetime | None = None,
        limit: int = 168,
    ) -> list[dict[str, Any]]:
        """Fetch time-series energy readings for a given meter from Supabase."""
        if not self._client:
            return []
        params = {
            "select": "*",
            "meter_id": f"eq.{meter_id}",
            "order": "recorded_at.desc",
            "limit": str(limit),
        }
        if start:
            params["recorded_at"] = f"gte.{start.isoformat()}"
        if end:
            params["recorded_at"] = f"lt.{end.isoformat()}"

        try:
            resp = await self._client.get("energy_readings", params=params)
            resp.raise_for_status()
            rows = resp.json()
            rows.sort(key=lambda r: r["recorded_at"])
            return rows
        except Exception as error:
            print(f"[Supabase] fetch_readings error: {error}")
            return []

    async def insert_rows(self, table: str, rows: list[dict[str, Any]]) -> bool:
        """Insert records into a Supabase table."""
        if not self._client or not rows:
            return False
        try:
            resp = await self._client.post(table, json=rows)
            resp.raise_for_status()
            return True
        except Exception as error:
            print(f"[Supabase] insert_rows into {table} error: {error}")
            return False

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()
