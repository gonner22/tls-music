# tlsMusic

A 3D visualizer for Telestai blockchain. This is an adaptation that preloads the last 200 blocks and then visualizes them while emitting sound in real-time when new blocks arrive. Notes play when blocks are added to the blockchain, creating an immersive audiovisual experience of the Telestai network activity.

Available at [tls-music.telestai.io](https://tls-music.telestai.io).

## Prerequisites

### Node.js Application
- Node.js (v22+)
- npm (10+)

### Telestai Node Configuration
You must have a Telestai node running with the following parameters in your `telestai.conf`:

```
txindex=1
assetindex=1
addressindex=1
timestampindex=1
spentindex=1
server=1
rpcuser=superstronusarname
rpcpassword=superstrongpassword
rpcbind=127.0.0.1
rpcallowip=127.0.0.1
rpcport=8766
```

### Python Block Cache Service
- Python 3.7+
- FastAPI
- Uvicorn

## Install

### Frontend Application
`npm i`

### Block Cache Service
The `block_cache_service.py` is a FastAPI service that maintains a cache of the latest 200 blocks from your Telestai node. It continuously monitors for new blocks and provides them through a REST API endpoint.

To set up the Python service:

1. Create a virtual environment:
   ```bash
   python3 -m venv venv
   ```

2. Activate the virtual environment:
   ```bash
   source venv/bin/activate
   ```

3. Install dependencies:
   ```bash
   pip install fastapi uvicorn requests
   ```

## Run

### Frontend Application
`npm start` or `ng serve --host 0.0.0.0 --proxy-config proxy.conf.json --port 9050` (for LAN support)

### Block Cache Service
Start the block cache service:
```bash
uvicorn block_cache_service:app --host 0.0.0.0 --port 8000
```

The service will:
- Connect to your Telestai node via RPC
- Preload the last 200 blocks
- Continuously monitor for new blocks every 5 seconds
- Serve blocks through the `/blocks` endpoint

## Contributing

Send a PR or open an issue.

## Integrations

Embed tls-music in an iframe on your website or application:

```html
<iframe src="https://tls-music.telestai.io" width="100%" height="500px" frameborder="0"></iframe>
```

Configure the network settings using query parameters:

```
https://tls-music.telestai.io?nodeUrl=wss:%2F%2Fanna.telestai.stream%2Ftelestai%2Fmainnet%2Fwrpc%2Fborsh&selectedNetwork=mainnet
```
