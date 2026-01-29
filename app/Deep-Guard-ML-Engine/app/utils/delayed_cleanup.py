import asyncio
import shutil

async def delayed_cleanup(path: str, delay: int = 60):
    await asyncio.sleep(delay)
    try:
        shutil.rmtree(path, ignore_errors=True)
        print(f"Cleaned up temporary directory: {path}")
    except Exception as e:
        print(f"Error during delayed cleanup of {path}: {str(e)}")