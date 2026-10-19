"""Bounded explanation of server-calculated dispatch facts; no decision or tool calls."""
from collections import OrderedDict
from time import monotonic
import json
import os

import httpx
from pydantic import BaseModel, Field

from src.gemini_service import get_gemini_api_key, GEMINI_API_BASE


class DispatchExplanationRequest(BaseModel):
    recommendation_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    transition_id: str = Field(pattern=r"^[a-f0-9]{24}$")


class ExplanationUnavailable(RuntimeError):
    pass


# Public benchmark/scenario context only, bounded to 128 recent calculations for one hour.
_results = OrderedDict()
_calls = []


def remember_dispatch(result):
    _results[result.recommendation_id] = (monotonic(), result)
    _results.move_to_end(result.recommendation_id)
    while len(_results) > 128:
        _results.popitem(last=False)


def resolve_dispatch(request):
    stored = _results.get(request.recommendation_id)
    if not stored or monotonic() - stored[0] > 3600:
        raise LookupError("Saved engine result expired or unavailable. Calculate and review a new scenario for a fresh explanation.")
    result = stored[1]
    transition = next((row for row in result.transitions if row["id"] == request.transition_id), None)
    if transition is None:
        raise LookupError("Transition is not present in this engine result.")
    return result, transition


async def explain_dispatch(request):
    result, transition = resolve_dispatch(request)
    key = get_gemini_api_key()
    if not key:
        raise ExplanationUnavailable("Gemini is not configured. Engine reasons remain available.")
    now = monotonic()
    _calls[:] = [time for time in _calls if now - time < 60]
    if len(_calls) >= 10:
        raise ExplanationUnavailable("Explanation rate limit reached; retry in one minute.")
    _calls.append(now)
    # Gemini selects and orders supplied factual explanation sentences. Arbitrary generated
    # recommendations, numbers and control actions cannot enter the rendered answer.
    allowed = transition["reasons"] + [transition["note"], result.demand_basis]
    context = {"building": result.asset_name, "transition": transition,
               "assumptions": result.assumptions, "location": result.location,
               "weather": result.weather, "classification": result.label,
               "demand_provenance": result.demand_provenance}
    if getattr(result, "video_demo", None):
        context["fixed_demo_inputs"] = result.video_demo
    payload = {
        "system_instruction": {"parts": [{"text":
            "Explain the supplied dispatch engine result by selecting and ordering its explanation sentences. "
            "You do not decide a source, calculate numbers, operate tools or control equipment. "
            "This is a scenario calculation using a public BDG2 forecast and labelled weather inputs from independent timelines. "
            "Return only supplied sentences; unavailable information must remain unavailable."}]},
        "contents": [{"role": "user", "parts": [{"text": json.dumps(context)}]}],
        "generationConfig": {"temperature": 0, "maxOutputTokens": 500,
            "responseMimeType": "application/json", "responseSchema": {
                "type": "OBJECT", "properties": {"sentences": {"type": "ARRAY",
                    "items": {"type": "STRING", "enum": allowed}}}, "required": ["sentences"]}},
    }
    # A provider-listed text model for this new endpoint; explicit existing overrides are honored.
    model = os.getenv("GEMINI_MODEL", "gemini-flash-lite-latest").strip().removeprefix("models/")
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            response = await client.post(f"{GEMINI_API_BASE}/models/{model}:generateContent",
                headers={"x-goog-api-key": key}, json=payload)
            response.raise_for_status()
            parts = response.json()["candidates"][0]["content"]["parts"]
            answer = json.loads("".join(part.get("text", "") for part in parts))
        sentences = answer["sentences"]
        if not isinstance(sentences, list) or not 1 <= len(sentences) <= len(allowed):
            raise ValueError("Invalid response")
        if any(not isinstance(sentence, str) or sentence not in allowed for sentence in sentences):
            raise ValueError("Ungrounded explanation")
    except httpx.HTTPStatusError as error:
        raise ExplanationUnavailable(f"Gemini explanation unavailable (provider HTTP {error.response.status_code}); retry. Engine reasons are unchanged.") from error
    except httpx.TimeoutException as error:
        raise ExplanationUnavailable("Gemini explanation timed out; retry. Engine reasons are unchanged.") from error
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as error:
        raise ExplanationUnavailable("Gemini explanation unavailable; retry. Engine reasons are unchanged.") from error
    return {"label": result.label, "explanation": " ".join(dict.fromkeys(sentences)),
            "model": model,
            "recommendation_id": result.recommendation_id, "transition_id": transition["id"],
            "sources": ["https://doi.org/10.5281/zenodo.3887306"] + (
                [] if getattr(result, "video_demo", None) else ["https://open-meteo.com/en/docs"]),
            "method": "Gemini selected and ordered engine-verified explanation sentences; it did not make the decision."}
