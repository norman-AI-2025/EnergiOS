"""EnergiOS live backend API for BDG2 benchmark telemetry, forecasting and diagnostics."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from src.bdg2_analytics import parse_utc
from src.bdg2_data import (
    AssetNotFound,
    Bdg2DataService,
    DataUnavailable,
    get_data_service,
)
from src.gemini_service import GeminiChatService
from src.dispatch_explanation import (
    DispatchExplanationRequest, ExplanationUnavailable, explain_dispatch, remember_dispatch,
)
from src.models import (
    AnomalyListResponse,
    AssetListResponse,
    ChatRequest,
    ChatResponse,
    ComparisonResponse,
    EnergyFlowResponse,
    ForecastResponse,
    HealthResponse,
    ReadingListResponse,
)
from src.solar_grid import (
    SolarGridRecommendation,
    SolarGridRequest,
    WeatherUnavailable,
    fetch_open_meteo,
    recommend_dispatch,
)
from src.video_dispatch import (
    VideoRequest, VideoReviewRequest, VideoRecommendation, build_video_dispatch, review_video_dispatch,
)


READING_RANGE_DAYS = 31
ANOMALY_RANGE_DAYS = 366
DEFAULT_FRONTEND_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
)


def configured_frontend_origins() -> list[str]:
    raw = os.getenv("FRONTEND_ORIGINS")
    if not raw:
        return list(DEFAULT_FRONTEND_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Warm up and verify BDG2 service on startup."""
    service = get_data_service()
    service.initialize()
    app.state.bdg2_service = service
    app.state.chat_service = GeminiChatService(service)
    yield


app = FastAPI(
    title="EnergiOS BDG2 Public Benchmark API",
    description=(
        "Official backend API providing verified four-building electricity telemetry, "
        "24-hour machine-learning forecasting, holdout accuracy metrics (MAE/RMSE), "
        "statistical unusual-pattern anomaly detection, and cross-building demand comparison "
        "derived from Building Data Genome Project 2 (BDG2) v1.0."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Permits frontend local servers and files
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_service(request: Request) -> Bdg2DataService:
    service = getattr(request.app.state, "bdg2_service", None)
    if service is None:
        return get_data_service()
    return service


def checked_range(
    start: datetime | None,
    end: datetime | None,
    maximum_days: int,
) -> tuple[datetime | None, datetime | None]:
    if (start is None) != (end is None):
        raise HTTPException(status_code=422, detail="'from' and 'to' must be supplied together")
    if start is None or end is None:
        return None, None
    try:
        start_utc = parse_utc(start.isoformat()) if hasattr(start, "isoformat") else parse_utc(str(start))
        end_utc = parse_utc(end.isoformat()) if hasattr(end, "isoformat") else parse_utc(str(end))
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"Invalid ISO timestamp format: {error}") from error

    if end_utc <= start_utc:
        raise HTTPException(status_code=422, detail="'to' timestamp must be later than 'from'")
    if end_utc - start_utc > timedelta(days=maximum_days):
        raise HTTPException(status_code=422, detail=f"Date range cannot exceed {maximum_days} days")
    return start_utc, end_utc


def map_error(error: Exception) -> HTTPException:
    if isinstance(error, AssetNotFound):
        return HTTPException(status_code=404, detail=str(error))
    if isinstance(error, DataUnavailable):
        return HTTPException(status_code=503, detail=str(error))
    return HTTPException(status_code=500, detail="Internal server error")


ServiceDependency = Annotated[Bdg2DataService, Depends(get_service)]


@app.get("/health", response_model=HealthResponse, tags=["System Operations"])
@app.head("/health", tags=["System Operations"])
async def health() -> HealthResponse:
    """Report application health and liveness status."""
    return HealthResponse(status="ok", version="1")


@app.get("/database/status", tags=["System Operations"])
async def database_status(service: ServiceDependency) -> dict:
    """Report Supabase database connectivity and configuration status."""
    status = service.get_supabase_status()
    is_live = await service._supabase.ping() if status["configured"] else False
    return {
        "engine": "Supabase PostgreSQL (PostgREST)",
        "configured": status["configured"],
        "url": status["url"],
        "connected": is_live,
        "tables": {
            "assets": 4 if is_live else 0,
            "meters": 4 if is_live else 0,
            "energy_readings": 672 if is_live else 0,
        },
        "live_source": "supabase_postgresql" if is_live else "local_verified_snapshot",
    }


@app.get("/assets", response_model=AssetListResponse, tags=["BDG2 Assets"])
async def assets(
    service: ServiceDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> AssetListResponse:
    """List monitored buildings in the approved BDG2 cohort with meter references."""
    try:
        return await service.list_assets_async(limit=limit)
    except Exception as error:
        raise map_error(error) from error


@app.get(
    "/assets/comparison",
    response_model=ComparisonResponse,
    tags=["BDG2 Analytics & Benchmarking"],
)
@app.get(
    "/comparison",
    response_model=ComparisonResponse,
    tags=["BDG2 Analytics & Benchmarking"],
)
async def asset_comparison(
    service: ServiceDependency,
    window_hours: Annotated[int, Query(ge=1, le=168, description="Time window in hours (up to 7 days)")] = 24,
) -> ComparisonResponse:
    """
    Cross-building demand comparison across the four BDG2 buildings.
    Calculates total kWh, peak demand kW, average demand, load factor, EUI (kWh/m²),
    and normalized delta against the Malaysian GBI Commercial baseline.
    """
    try:
        return service.get_comparison(window_hours=window_hours)
    except Exception as error:
        raise map_error(error) from error


@app.get(
    "/assets/{asset_id}/readings",
    response_model=ReadingListResponse,
    tags=["BDG2 Telemetry Readings"],
)
async def asset_readings(
    asset_id: str,
    service: ServiceDependency,
    from_: Annotated[datetime | None, Query(alias="from")] = None,
    to: Annotated[datetime | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 168,
) -> ReadingListResponse:
    """Return bounded hourly observed electricity meter interval readings in kWh."""
    start_utc, end_utc = checked_range(from_, to, READING_RANGE_DAYS)
    try:
        return await service.get_readings_async(asset_id, start=start_utc, end=end_utc, limit=limit)
    except Exception as error:
        raise map_error(error) from error


@app.get(
    "/assets/{asset_id}/forecast",
    response_model=ForecastResponse,
    tags=["BDG2 Analytics & Benchmarking"],
)
async def asset_forecast(
    asset_id: str,
    service: ServiceDependency,
) -> ForecastResponse:
    """Return the next-24-hour machine-learning forecast and held-out test accuracy metrics (MAE/RMSE)."""
    try:
        return service.get_forecast(asset_id)
    except Exception as error:
        raise map_error(error) from error


@app.get(
    "/assets/{asset_id}/anomalies",
    response_model=AnomalyListResponse,
    tags=["BDG2 Analytics & Benchmarking"],
)
async def asset_anomalies(
    asset_id: str,
    service: ServiceDependency,
    from_: Annotated[datetime | None, Query(alias="from")] = None,
    to: Annotated[datetime | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> AnomalyListResponse:
    """Return statistical unusual-consumption patterns (spikes and drops) detected via Validation MAD 6× threshold."""
    start_utc, end_utc = checked_range(from_, to, ANOMALY_RANGE_DAYS)
    try:
        return service.get_anomalies(asset_id, start=start_utc, end=end_utc, limit=limit)
    except Exception as error:
        raise map_error(error) from error


@app.get(
    "/assets/{asset_id}/energy-flow",
    response_model=EnergyFlowResponse,
    tags=["BDG2 Analytics & Benchmarking"],
)
async def asset_energy_flow(
    asset_id: str,
    service: ServiceDependency,
    timeframe: Annotated[str, Query(description="Aggregation window: hourly, daily, weekly, monthly")] = "hourly",
) -> EnergyFlowResponse:
    """Return physics-grounded microgrid energy flows (Solar, Battery, Building, Grid) aligned with live Supabase readings."""
    try:
        return await service.get_energy_flow_async(asset_id, timeframe=timeframe)
    except Exception as error:
        raise map_error(error) from error


@app.post(
    "/demo/solar-grid/recommendation",
    response_model=SolarGridRecommendation,
    tags=["Solar/Grid Scenario Analysis"],
)
async def solar_grid_recommendation(
    payload: SolarGridRequest,
    service: ServiceDependency,
) -> SolarGridRecommendation:
    """Return a read-only dispatch scenario from the BDG2 demand forecast and public weather forecast."""
    try:
        forecast = service.get_forecast(payload.asset_id)
        assets = await service.list_assets_async(limit=100)
        asset = next(
            item for item in assets.items
            if item.id == forecast.asset_id or item.source_asset_id == payload.asset_id
        )
    except Exception as error:
        raise map_error(error) from error

    try:
        weather = await fetch_open_meteo(payload.latitude, payload.longitude)
    except WeatherUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    try:
        result = recommend_dispatch(
            payload,
            [item.model_dump() for item in forecast.items],
            weather,
            asset_name=asset.name,
            provenance=forecast.provenance.model_dump(),
        )
        remember_dispatch(result)
        return result
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/demo/solar-grid/explanation", tags=["Solar/Grid Scenario Analysis"])
async def solar_grid_explanation(payload: DispatchExplanationRequest):
    """Explain a cached engine result only; no client-supplied recommendations or controls."""
    try:
        return await explain_dispatch(payload)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ExplanationUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.post("/demo/solar-grid/video/recommendation", response_model=VideoRecommendation,
          tags=["Solar/Grid Scenario Analysis"])
async def video_solar_grid_recommendation(payload: VideoRequest):
    """Run pinned demand history through the existing forecast and dispatch code, offline."""
    try:
        result = build_video_dispatch(payload)
        remember_dispatch(result)
        return result
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (ValueError, OSError, KeyError) as error:
        raise HTTPException(status_code=503, detail="Fixed demo inputs failed verification; inspect the versioned profile.") from error


@app.post("/demo/solar-grid/video/revalidate", tags=["Solar/Grid Scenario Analysis"])
async def video_solar_grid_revalidate(payload: VideoReviewRequest):
    """Recompute and check a fixed scenario before browser-local approval; no commands."""
    try:
        return review_video_dispatch(payload)
    except LookupError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except (OSError, KeyError) as error:
        raise HTTPException(status_code=503, detail="Fixed demo verification is unavailable; the plan was not applied.") from error


def get_chat_service(request: Request) -> GeminiChatService:
    chat_svc = getattr(request.app.state, "chat_service", None)
    if chat_svc is None:
        return GeminiChatService(get_data_service())
    return chat_svc


@app.post("/chat", response_model=ChatResponse, tags=["AI Copilot"])
@app.post("/ai/chat", response_model=ChatResponse, tags=["AI Copilot"])
async def chat(
    payload: ChatRequest,
    chat_service: Annotated[GeminiChatService, Depends(get_chat_service)],
) -> ChatResponse:
    """Interact with EnergiOS AI Copilot powered by Google Gemini 2.5 Flash with verified telemetry grounding."""
    try:
        return await chat_service.chat(
            message=payload.message,
            building_id=payload.building_id,
            history=payload.history,
        )
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"AI Copilot processing failed: {error}") from error

