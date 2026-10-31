"""Protections for an endpoint exposed from a home PC: body cap, per-IP rate limit."""
from __future__ import annotations

import json
import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, limit: int, window_s: float) -> None:
        self.limit, self.window = limit, window_s
        self.hits: dict[str, deque] = defaultdict(deque)

    def allow(self, key: str, now: float | None = None) -> bool:
        if self.limit <= 0:
            return True
        now = time.monotonic() if now is None else now
        q = self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        if len(self.hits) > 5000:  # bound memory
            for k in [k for k, v in self.hits.items() if not v or now - v[-1] > self.window]:
                del self.hits[k]
        return True


async def _send_json(send, status: int, obj: dict, extra: list | None = None) -> None:
    body = json.dumps(obj).encode()
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode()), *(extra or [])]})
    await send({"type": "http.response.body", "body": body})


class _TooLarge(Exception):
    pass


class LimitsMiddleware:
    """Pure ASGI: rejects oversized bodies (declared or streamed) and rate-limited IPs.

    Behind cloudflared the TCP peer is 127.0.0.1, so the real client IP is read from
    CF-Connecting-IP, but only when the peer is loopback (cannot be spoofed from the LAN).
    """

    def __init__(self, app, max_body: int, limiter: RateLimiter) -> None:
        self.app, self.max_body, self.limiter = app, max_body, limiter

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        peer = (scope.get("client") or ("?", 0))[0]
        ip = peer
        if peer in ("127.0.0.1", "::1") and b"cf-connecting-ip" in headers:
            ip = headers[b"cf-connecting-ip"].decode("latin-1")[:64]
        if scope["method"] != "OPTIONS" and not self.limiter.allow(ip):
            return await _send_json(send, 429, {"detail": "rate limit exceeded"}, [(b"retry-after", b"30")])
        cl = headers.get(b"content-length")
        if cl is not None and (not cl.isdigit() or int(cl) > self.max_body):
            return await _send_json(send, 413, {"detail": "body too large"})
        seen = 0

        async def limited_receive():
            nonlocal seen
            msg = await receive()
            if msg["type"] == "http.request":
                seen += len(msg.get("body", b""))
                if seen > self.max_body:
                    raise _TooLarge()
            return msg

        try:
            await self.app(scope, limited_receive, send)
        except _TooLarge:
            await _send_json(send, 413, {"detail": "body too large"})
