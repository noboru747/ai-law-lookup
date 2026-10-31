"""Thin Ollama client. Thinking is disabled at the API level (think:false)."""
from __future__ import annotations

import json
import re

import httpx

_THINK = re.compile(r"<think>|</think>", re.I)


class LLMError(Exception):
    """Ollama unreachable, timed out, or returned something unusable."""


class OllamaClient:
    def __init__(self, base_url: str, model: str, keep_alive: str, num_predict: int,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.model, self.keep_alive, self.num_predict = model, keep_alive, num_predict
        self._http = httpx.AsyncClient(base_url=base_url, transport=transport)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def available(self) -> bool:
        try:
            r = await self._http.get("/api/tags", timeout=2.0)
            r.raise_for_status()
            names = {m.get("name") for m in r.json().get("models", [])}
            return self.model in names or f"{self.model}:latest" in names
        except Exception:
            return False

    async def warm(self) -> None:
        """Load the model into VRAM so the first real request is not a cold start."""
        try:
            await self._http.post("/api/generate", json={"model": self.model, "prompt": "", "think": False,
                                                          "keep_alive": self.keep_alive}, timeout=120)
        except Exception:
            pass

    async def chat_json(self, system: str, user: str, schema: dict, timeout: float,
                        num_predict: int | None = None) -> dict:
        body = {
            "model": self.model,
            "stream": False,
            "think": False,
            "format": schema,
            "keep_alive": self.keep_alive,
            "options": {"temperature": 0, "num_predict": num_predict or self.num_predict},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }
        try:
            r = await self._http.post("/api/chat", json=body, timeout=timeout)
            r.raise_for_status()
            content = r.json()["message"]["content"]
        except Exception as e:  # network, timeout, HTTP error, malformed envelope
            raise LLMError(f"ollama call failed: {type(e).__name__}") from e
        if _THINK.search(content):
            raise LLMError("model emitted think tags")
        try:
            data = json.loads(content)
        except ValueError as e:
            raise LLMError("model output is not JSON") from e
        if not isinstance(data, dict):
            raise LLMError("model output is not an object")
        return data
