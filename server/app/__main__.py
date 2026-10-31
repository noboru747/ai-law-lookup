import uvicorn

from .config import get_settings
from .main import create_app

s = get_settings()
uvicorn.run(create_app(s), host=s.host, port=s.port, log_level="info")
