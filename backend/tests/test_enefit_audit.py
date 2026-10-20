"""The Enefit source gate uses tiny isolated CSV fixtures, never model training."""

import csv
from pathlib import Path

import pytest

from scripts.audit_enefit import audit_dataset


def write_csv(root: Path, name: str, rows: list[dict]) -> None:
    with (root / name).open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def valid_files(root: Path) -> None:
    write_csv(root, "train.csv", [{"datetime": "2023-01-01 00:00:00", "target": "12.5", "is_consumption": "0", "county": "1", "is_business": "1", "product_type": "0", "prediction_unit_id": "7", "data_block_id": "1"}])
    write_csv(root, "forecast_weather.csv", [{"forecast_datetime": "2023-01-01 00:00:00", "origin_datetime": "2022-12-31 12:00:00", "hours_ahead": "12", "temperature": "-1", "cloudcover_total": "80", "surface_solar_radiation_downwards": "0"}])
    write_csv(root, "client.csv", [{"date": "2023-01-01", "county": "1", "is_business": "1", "product_type": "0", "installed_capacity": "25", "data_block_id": "1"}])


def test_audit_keeps_sources_separate_and_reports_hashes(tmp_path):
    valid_files(tmp_path)
    report = audit_dataset(tmp_path)
    assert report["quality_gate"] == "pass"
    assert [item["rows"] for item in report["files"]] == [1, 1, 1]
    assert all(len(item["sha256"]) == 64 for item in report["files"])
    assert "not established" in report["production_target_unit"]


def test_missing_file_and_invalid_values_fail_closed(tmp_path):
    valid_files(tmp_path)
    (tmp_path / "client.csv").unlink()
    with pytest.raises(FileNotFoundError):
        audit_dataset(tmp_path)
    valid_files(tmp_path)
    write_csv(tmp_path, "train.csv", [{"datetime": "bad", "target": "-3", "is_consumption": "0", "county": "1", "is_business": "1", "product_type": "0", "prediction_unit_id": "7", "data_block_id": "1"}])
    report = audit_dataset(tmp_path)
    assert report["quality_gate"] == "fail"
    assert report["files"][0]["invalid_timestamps"] == 1
    assert report["files"][0]["invalid_nonnegative_values"] == 1


def test_dst_sensitive_hour_is_reported_not_silently_converted(tmp_path):
    valid_files(tmp_path)
    write_csv(tmp_path, "train.csv", [{"datetime": "2023-10-29 03:00:00", "target": "12.5", "is_consumption": "0", "county": "1", "is_business": "1", "product_type": "0", "prediction_unit_id": "7", "data_block_id": "1"}])
    report = audit_dataset(tmp_path)
    assert report["files"][0]["dst_sensitive_estonian_local_times"] == 1


def test_weather_generated_after_target_interval_is_rejected(tmp_path):
    valid_files(tmp_path)
    write_csv(tmp_path, "forecast_weather.csv", [{"forecast_datetime": "2023-01-01 00:00:00", "origin_datetime": "2023-01-02 00:00:00", "hours_ahead": "12", "temperature": "-1", "cloudcover_total": "80", "surface_solar_radiation_downwards": "0"}])
    report = audit_dataset(tmp_path)
    assert report["quality_gate"] == "fail"
    assert report["files"][1]["invalid_forecast_availability"] == 1
