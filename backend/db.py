import os
from motor.motor_asyncio import AsyncIOMotorClient

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]


def clean(doc: dict) -> dict:
    """Strip Mongo _id from a domain document (domain entities use uuid `id`)."""
    if doc is None:
        return None
    doc.pop("_id", None)
    return doc
