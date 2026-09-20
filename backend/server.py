import os
import logging
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware

import auth as A
import storage
from seed import seed_demo
from routers import auth_routes, projects, structure, assignments, versions, reviews, scripts, audit, misc

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Film Studio Manager API")
api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "Film Studio Manager API", "status": "ok"}


api_router.include_router(auth_routes.router)
api_router.include_router(misc.router)
api_router.include_router(projects.router)
api_router.include_router(structure.router)
api_router.include_router(assignments.router)
api_router.include_router(versions.router)
api_router.include_router(reviews.router)
api_router.include_router(scripts.router)
api_router.include_router(audit.router)

app.include_router(api_router)

_frontend = os.environ.get("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_frontend, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await A.ensure_indexes()
    await A.seed_admin()
    try:
        await seed_demo()
    except Exception as e:
        logger.error(f"Seed demo failed: {e}")
    try:
        storage.init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
    logger.info("Startup complete")


@app.on_event("shutdown")
async def shutdown():
    from db import client
    client.close()
