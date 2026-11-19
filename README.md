# CiteVerify

Academic manuscript verification workbench powered by open scholarly registries (**Crossref**, **OpenAlex**, and **arXiv**) and local **PyMuPDF + RapidOCR** visual evidence comparison.

**No Gemini API key or paid LLM dependency is required.**

## Architecture

- **Frontend (`/`)**: React + Vite + Tailwind CSS + TypeScript SPA deployed on **Vercel** (`dist/`).
- **Backend (`/backend`)**: FastAPI + Uvicorn + SQLAlchemy + `pypdf` + `PyMuPDF` + `RapidOCR` + `httpx` + `rapidfuzz` deployed separately on **Render** (or any persistent Python host).
- **Database & Persistence**: Hosted **PostgreSQL** (`DATABASE_URL`) stores verification runs, citation comparison records, interactive citation network metadata, extracted figure/graph PNGs (`BYTEA`), and visual evidence audits.

## Environment Variables

### Frontend (Vercel)

| Variable | Required | Description |
| :--- | :--- | :--- |
| `VITE_API_BASE_URL` | Yes (Production) | Public URL of your FastAPI backend (e.g. `https://citeverify-api.onrender.com`), with no trailing slash. Leave empty locally to use Vite's `/api` dev proxy. |
| `VITE_DEV_PROXY_TARGET` | No | Local Vite dev proxy target (defaults to `http://127.0.0.1:8000`). Ignored in production builds. |

### Backend (Render / Python Host)

| Variable | Required | Description |
| :--- | :--- | :--- |
| `DATABASE_URL` | Yes | Hosted PostgreSQL connection string (Neon, Supabase, Render Postgres, AWS RDS). Both `postgres://` and `postgresql://` are supported. |
| `CORS_ORIGINS` | Recommended | Comma-separated allowed frontend origins (e.g. `https://citeverify.vercel.app,http://localhost:3000`). |
| `CORS_ORIGIN_REGEX` | No | Regex for Vercel preview/production URLs (defaults to `https://.*\.vercel\.app`). |
| `MAX_UPLOAD_MB` | No | Maximum uploaded PDF size in MB (default `25`). |
| `CROSSREF_MAILTO` | No | Optional email included in Crossref `User-Agent` header for polite pool routing. |
| `STORAGE_MODE` | No | Persistence strategy (`postgres` stores PDFs and extracted figure PNGs in PostgreSQL `BYTEA`). |
| `STORAGE_DIR` | No | Optional persistent disk mount directory (e.g. `/var/data/citeverify`) for storing PDFs on disk alongside DB metadata. |
| `VISION_API_BASE_URL` / `VISION_MODEL` | No | Optional OpenAI-compatible vision endpoint (e.g. local Ollama) for automated curve/trend inference. When unset, items are analyzed via PyMuPDF + RapidOCR and marked for Human Review without fabricating trends. |

## Deployment Steps (GitHub + Render + Vercel + PostgreSQL)

### 1. Provision Hosted PostgreSQL
Create a PostgreSQL database on Neon, Supabase, or Render Postgres and copy the connection string (`DATABASE_URL`). Tables (`verification_documents`, `citation_entries`, `figure_evidences`) are created automatically.

### 2. Deploy FastAPI Backend on Render
You can use the included `render.yaml` Blueprint or configure a Web Service manually:
1. Connect your GitHub repository to Render and set **Root Directory** to `backend`.
2. Set **Build Command** to:
   ```bash
   pip install -r requirements.txt && pip uninstall -y opencv-python && pip install --no-cache-dir opencv-python-headless
   ```
3. Set **Start Command** to:
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port $PORT
   ```
4. Set **Health Check Path** to `/api/health`.
5. Add `DATABASE_URL` (and `CORS_ORIGINS` if using a custom domain) in Render Environment Variables.

### 3. Deploy Frontend on Vercel
1. Import your GitHub repository in Vercel with **Root Directory** set to `.` (repository root).
2. `vercel.json` configures Vite automatically:
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Add `VITE_API_BASE_URL` pointing to your Render FastAPI URL (e.g. `https://citeverify-api.onrender.com`).
4. Redeploy so Vite bakes `VITE_API_BASE_URL` into the static production bundle.

## Local Development

```bash
# Terminal 1: FastAPI backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/citeverify"
export CORS_ORIGINS="http://localhost:3000"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2: Frontend
npm install
npm run dev
```
