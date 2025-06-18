from fastapi import FastAPI
from threading import Thread
import requests
import time

app = FastAPI()
CACHE_SIZE = 200
RPC_URL = "http://localhost:8766/"
RPC_USER = "superstrongusername"
RPC_PASS = "superstrongpassword"

block_cache = []

def get_best_block_hash():
    payload = {
        "jsonrpc": "1.0",
        "id": "getbestblockhash",
        "method": "getbestblockhash",
        "params": []
    }
    r = requests.post(RPC_URL, json=payload, auth=(RPC_USER, RPC_PASS))
    return r.json()["result"]

def get_block(hash):
    payload = {
        "jsonrpc": "1.0",
        "id": "getblock",
        "method": "getblock",
        "params": [hash, True]
    }
    r = requests.post(RPC_URL, json=payload, auth=(RPC_USER, RPC_PASS))
    return r.json()["result"]

def update_cache():
    global block_cache
    while True:
        try:
            best_hash = get_best_block_hash()
            if not block_cache or block_cache[0]["hash"] != best_hash:
                # Rebuild the cache starting from the best block
                blocks = []
                current_hash = best_hash
                for _ in range(CACHE_SIZE):
                    block = get_block(current_hash)
                    blocks.append(block)
                    if "previousblockhash" in block:
                        current_hash = block["previousblockhash"]
                    else:
                        break
                block_cache = blocks
        except Exception as e:
            print("Error updating cache:", e)
        time.sleep(5)  # Check every 5 seconds

@app.get("/blocks")
def get_blocks():
    return list(reversed(block_cache))  # Oldest to newest

# Start the cache update thread
Thread(target=update_cache, daemon=True).start() 