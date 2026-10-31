"""Runtime configuration, all overridable by environment variables."""
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _list(name: str, default: str) -> list[str]:
    return [s.strip() for s in os.environ.get(name, default).split(",") if s.strip()]


class Settings:
    def __init__(self) -> None:
        e = os.environ.get
        self.model = e("LAW_MODEL", "qwen3:14b")
        self.ollama_url = e("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
        self.data_dir = Path(e("LAW_DATA_DIR", str(REPO_ROOT / "data")))
        self.host = e("LAW_HOST", "127.0.0.1")
        self.port = int(e("LAW_PORT", "8790"))
        # CORS: exact origins, plus wildcard patterns such as https://*.pages.dev
        self.cors_origins = _list(
            "LAW_CORS_ORIGINS",
            "http://localhost:5173,http://localhost:4173,https://*.pages.dev",
        )
        self.max_body_bytes = int(e("LAW_MAX_BODY_BYTES", "16384"))
        self.max_query_chars = int(e("LAW_MAX_QUERY_CHARS", "300"))
        self.max_slot_value_chars = int(e("LAW_MAX_SLOT_VALUE_CHARS", "100"))
        self.max_article_ids = int(e("LAW_MAX_ARTICLE_IDS", "12"))
        self.rate_limit = int(e("LAW_RATE_LIMIT", "20"))  # requests per window per IP; 0 = off
        self.rate_window_s = float(e("LAW_RATE_WINDOW_S", "60"))
        # total wall-clock budget for one request (front end times out at 15 s)
        self.budget_s = float(e("LAW_BUDGET_S", "14"))
        self.max_concurrency = int(e("LAW_MAX_CONCURRENCY", "2"))
        self.keep_alive = e("LAW_KEEP_ALIVE", "30m")
        self.num_predict = int(e("LAW_NUM_PREDICT", "700"))


def get_settings() -> Settings:
    return Settings()
