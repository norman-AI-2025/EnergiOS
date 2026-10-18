"""Tests for AI Chatbot endpoint powered by Gemini."""

import pytest
from fastapi.testclient import TestClient
from app import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_chat_endpoint_generates_grounded_response(client: TestClient):
    payload = {
        "message": "What is the 24h consumption and forecast accuracy for Hog_office_Bill?",
        "building_id": "Hog_office_Bill",
    }
    response = client.post("/chat", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert "response" in data
    assert len(data["response"]) > 0
    assert "agent_logs" in data
    assert len(data["agent_logs"]) >= 2
    assert data["model"] == "gemini-2.5-flash"
    assert data["provenance"]["kind"] == "public_benchmark"
    assert data["building_context"] == "Hog_office_Bill"


def test_chat_quick_prompt(client: TestClient):
    payload = {
        "message": "Audit 118 anomalies",
        "building_id": "Hog_office_Bill",
    }
    response = client.post("/ai/chat", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "response" in data
    assert len(data["response"]) > 0
