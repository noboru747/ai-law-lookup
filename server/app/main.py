"""Local generation service for ai-law-lookup (ADR 0009). Four routes only."""

import asyncio
import re
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from . import service
from .config import Settings, get_settings
from .corpus import Corpus
from .guards import LimitsMiddleware, RateLimiter
from .llm import OllamaClient


def origin_regex(patterns: list[str]) -> str:
    parts = [re.escape(p).replace(r"\*", "[A-Za-z0-9-]+") for p in patterns]
    return "^(" + "|".join(parts) + ")$"


def create_app(settings: Settings | None = None, llm: OllamaClient | None = None,
               corpus: Corpus | None = None) -> FastAPI:
    st = settings or get_settings()
    cp = corpus or Corpus(st.data_dir)
    client = llm or OllamaClient(st.ollama_url, st.model, st.keep_alive, st.num_predict)
    sem = asyncio.Semaphore(st.max_concurrency)

    @asynccontextmanager
    async def lifespan(_app):
        warm = asyncio.create_task(client.warm())
        yield
        warm.cancel()
        await client.aclose()

    # no docs/openapi routes: exactly the four public routes
    app = FastAPI(title="ai-law-lookup generation service", docs_url=None, redoc_url=None,
                  openapi_url=None, lifespan=lifespan)

    app.add_middleware(CORSMiddleware, allow_origin_regex=origin_regex(st.cors_origins),
                       allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Content-Type"], max_age=600)
    # added last = outermost: limits run before CORS/handlers
    app.add_middleware(LimitsMiddleware, max_body=st.max_body_bytes,
                       limiter=RateLimiter(st.rate_limit, st.rate_window_s))

    qmax, vmax = st.max_query_chars, st.max_slot_value_chars

    class RewriteIn(BaseModel):
        query: str
        leaf_id: str | None = None

        @field_validator("query")
        @classmethod
        def _q(cls, v):
            v = v.strip()
            if not v or len(v) > qmax:
                raise ValueError(f"query must be 1..{qmax} chars")
            return v

    class RouteIn(BaseModel):
        text: str

        @field_validator("text")
        @classmethod
        def _t(cls, v):
            v = v.strip()
            if not v or len(v) > qmax:
                raise ValueError(f"text must be 1..{qmax} chars")
            return v

    class GenerateIn(BaseModel):
        leaf_id: str
        slots: dict[str, str | int | float | bool | None] = {}
        query: str | None = None
        article_ids: list[str]

        @field_validator("slots")
        @classmethod
        def _s(cls, v):
            if len(v) > 20 or any(len(str(x)) > vmax for x in v.values()) or any(len(k) > 40 for k in v):
                raise ValueError("slots too large")
            return v

        @field_validator("query")
        @classmethod
        def _q(cls, v):
            if v is not None and len(v) > qmax:
                raise ValueError(f"query longer than {qmax} chars")
            return v

        @field_validator("article_ids")
        @classmethod
        def _a(cls, v):
            if len(v) > st.max_article_ids or any(len(i) > 40 for i in v):
                raise ValueError("too many article_ids")
            return v

    @app.exception_handler(RequestValidationError)
    async def _validation(_r: Request, exc: RequestValidationError):
        # schema errors are 422; an empty article_ids is handled in service.generate (also 422)
        return JSONResponse({"detail": "invalid request"}, status_code=422)

    @app.exception_handler(service.ServiceError)
    async def _svc(_r: Request, exc: service.ServiceError):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status)

    @app.get("/health")
    async def health():
        if await client.available():
            return {"status": "ok", "model": st.model}
        return JSONResponse({"status": "unavailable", "model": st.model}, status_code=503)

    async def run(coro_fn):
        # serialise GPU use; wait for a slot only as long as the budget allows
        try:
            await asyncio.wait_for(sem.acquire(), timeout=max(st.budget_s - 2, 1))
        except asyncio.TimeoutError:
            raise service.ServiceError(503, "busy")
        try:
            return await coro_fn(time.monotonic() + st.budget_s)
        finally:
            sem.release()

    @app.post("/rewrite")
    async def rewrite(body: RewriteIn):
        terms = await run(lambda dl: service.rewrite(client, cp, body.query, body.leaf_id, dl - time.monotonic()))
        return {"terms": terms}

    @app.post("/route")
    async def route(body: RouteIn):
        return await run(lambda dl: service.route(client, cp, body.text, dl - time.monotonic()))

    @app.post("/generate")
    async def generate(body: GenerateIn):
        return await run(lambda dl: service.generate(
            client, cp, body.leaf_id, body.slots, body.query, body.article_ids, dl))

    return app
