# tlsMusic

A 3D visualizer for Telestai. Notes play when blocks are added.

Available at [tls-music.telestai.io](https://tls-music.telestai.io).

## Prerequisites

- Node.js (v22+)
- npm (10+)

## Install

`npm i`

## Run

`npm start` or `ng serve --host 0.0.0.0 --proxy-config proxy.conf.json --port 9050` (for LAN support)


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
