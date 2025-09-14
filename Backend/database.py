import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv() 

MONGO_URL = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(MONGO_URL)

db = client["tutedude"] 
collection = db["reports"]