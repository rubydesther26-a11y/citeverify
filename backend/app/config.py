from functools import lru_cache
from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "CiteVerify API"
    app_version: str = "1.1.0"

    # Environment-based PostgreSQL URL (Neon, Supabase, Render Postgres, etc.)
    database_url: str = ""

    # Comma-separated allowed CORS origins (e.g., https://citeverify.vercel.app)
    cors_origins: str = "http://localhost:3000,http://localhost:5173"
    cors_origin_regex: Optional[str] = r"https://.*\.vercel\.app"

    max_upload_mb: int = 25
    crossref_mailto: Optional[str] = None
    storage_mode: str = "postgres"
    storage_dir: Optional[str] = None
    lookup_timeout_seconds: float = 12.0

    # Optional vision-capable model settings (Ollama/vLLM OpenAI-compatible or optional Gemini)
    vision_api_base_url: Optional[str] = None
    vision_api_key: Optional[str] = None
    vision_model: Optional[str] = None
    vision_timeout_seconds: float = 30.0
    gemini_api_key: Optional[str] = None

    @property
    def normalized_database_url(self) -> str:
        url = (self.database_url or "").strip()
        if not url:
            return ""
        if url.startswith("postgres://"):
            return "postgresql+psycopg://" + url[len("postgres://"):]
        if url.startswith("postgresql://"):
            return "postgresql+psycopg://" + url[len("postgresql://"):]
        return url

    @property
    def allowed_origins_list(self) -> List[str]:
        items = [origin.strip().rstrip("/") for origin in self.cors_origins.split(",") if origin.strip()]
        return items or ["http://localhost:3000"]

    @property
    def vision_configured(self) -> bool:
        has_oai = bool(self.vision_api_base_url and self.vision_model)
        has_gemini = bool(self.gemini_api_key)
        return has_oai or has_gemini


@lru_cache
def get_settings() -> Settings:
    return Settings()
