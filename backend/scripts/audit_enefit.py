"""Audit locally downloaded Enefit competition files without copying source rows.

Run from backend/: python scripts/audit_enefit.py --data-dir local_data/enefit
This is a source gate, not a training or performance claim.
"""

from __future__ import annotations

import argparse
import csv
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


REQUIRED = {
    "train.csv": ("datetime", "target", "is_consumption", "county", "is_business", "product_type", "prediction_unit_id", "data_block_id"),
    "forecast_weather.csv": ("forecast_datetime", "origin_datetime", "hours_ahead", "temperature", "cloudcover_total", "surface_solar_radiation_downwards"),
    "client.csv": ("date", "county", "is_business", "product_type", "installed_capacity", "data_block_id"),
}
TIMESTAMP_COLUMN = {"train.csv": "datetime", "forecast_weather.csv": "forecast_datetime", "client.csv": "date"}
NONNEGATIVE_COLUMN = {"train.csv": "target", "forecast_weather.csv": "surface_solar_radiation_downwards", "client.csv": "installed_capacity"}


def _local_time(value: str) -> tuple[datetime, bool]:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is not None:
        raise ValueError("Expected Enefit source-local time without an offset")
    zone = ZoneInfo("Europe/Tallinn")
    dst_sensitive = parsed.replace(tzinfo=zone, fold=0).utcoffset() != parsed.replace(tzinfo=zone, fold=1).utcoffset()
    return parsed, dst_sensitive


def audit_file(path: Path, required: tuple[str, ...]) -> dict:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    result = {
        "file": path.name,
        "sha256": digest.hexdigest(),
        "rows": 0,
        "missing_required_fields": {},
        "invalid_timestamps": 0,
        "dst_sensitive_estonian_local_times": 0,
        "invalid_nonnegative_values": 0,
        "invalid_forecast_availability": 0,
        "first_source_local_timestamp": None,
        "last_source_local_timestamp": None,
    }
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if not reader.fieldnames:
            raise ValueError(f"{path.name}: empty CSV header")
        missing = sorted(set(required) - set(reader.fieldnames))
        if missing:
            raise ValueError(f"{path.name}: required columns missing: {', '.join(missing)}")
        missing_counts = {column: 0 for column in required}
        timestamp_column = TIMESTAMP_COLUMN[path.name]
        value_column = NONNEGATIVE_COLUMN[path.name]
        for row in reader:
            result["rows"] += 1
            for column in required:
                if not (row.get(column) or "").strip():
                    missing_counts[column] += 1
            timestamp = (row.get(timestamp_column) or "").strip()
            if timestamp:
                try:
                    parsed, dst_sensitive = _local_time(timestamp)
                    result["dst_sensitive_estonian_local_times"] += int(dst_sensitive)
                    iso = parsed.isoformat()
                    earliest = result["first_source_local_timestamp"]
                    latest = result["last_source_local_timestamp"]
                    result["first_source_local_timestamp"] = min(earliest, iso) if earliest else iso
                    result["last_source_local_timestamp"] = max(latest, iso) if latest else iso
                except ValueError:
                    result["invalid_timestamps"] += 1
            raw_value = (row.get(value_column) or "").strip()
            try:
                numeric = float(raw_value)
                if not math.isfinite(numeric) or numeric < 0:
                    raise ValueError
            except ValueError:
                result["invalid_nonnegative_values"] += 1
            if path.name == "forecast_weather.csv":
                try:
                    origin, _ = _local_time((row.get("origin_datetime") or "").strip())
                    forecast, _ = _local_time(timestamp)
                    horizon = int((row.get("hours_ahead") or "").strip())
                    if origin > forecast or not 0 <= horizon <= 48:
                        raise ValueError
                except ValueError:
                    result["invalid_forecast_availability"] += 1
        result["missing_required_fields"] = {key: value for key, value in missing_counts.items() if value}
    if result["rows"] == 0:
        raise ValueError(f"{path.name}: no data rows")
    return result


def audit_dataset(data_dir: Path) -> dict:
    missing = [name for name in REQUIRED if not (data_dir / name).is_file()]
    if missing:
        raise FileNotFoundError(f"Enefit source files missing: {', '.join(missing)}")
    files = [audit_file(data_dir / name, columns) for name, columns in REQUIRED.items()]
    issues = sum(
        bool(item["missing_required_fields"] or item["invalid_timestamps"] or item["invalid_nonnegative_values"]
             or item["invalid_forecast_availability"])
        for item in files
    )
    return {
        "source": "Enefit — Predict Energy Behavior of Prosumers, Kaggle competition",
        "source_url": "https://www.kaggle.com/competitions/predict-energy-behavior-of-prosumers/data",
        "licence": "CC BY-NC-SA 4.0 (competition rules also apply)",
        "source_timezone": "Europe/Tallinn (EET/EEST), source-local interval start",
        "production_target_unit": "not established by this audit; confirm before modelling or dispatch integration",
        "forecast_radiation_unit": "Wh/m² per hour (Kaggle data dictionary)",
        "installed_capacity_unit": "kW (Kaggle data dictionary)",
        "files": files,
        "quality_gate": "pass" if issues == 0 else "fail",
        "limitations": [
            "This audit does not establish forecast accuracy or site transferability.",
            "Ambiguous DST-local hours require a reviewed join/UTC conversion before training.",
            "Forecast weather must be joined using only values available at prediction time.",
            "Enefit sites/timelines must not be joined to BDG2 building readings.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("local_data/enefit"))
    args = parser.parse_args()
    try:
        report = audit_dataset(args.data_dir)
    except (FileNotFoundError, ValueError, OSError, ZoneInfoNotFoundError) as error:
        parser.exit(2, f"Enefit source audit unavailable: {error}\n")
    print(json.dumps(report, indent=2))
    return 0 if report["quality_gate"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
