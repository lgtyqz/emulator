# Third-party notices

ROM Room can optionally start the following software and services for NetPlay.

## cloudflared

The packaged `cloudflared` executable is Copyright Cloudflare, Inc. and is distributed under the Apache License 2.0. Its source and license are available at <https://github.com/cloudflare/cloudflared>.

Using Cloudflare Quick Tunnels is also subject to Cloudflare's [Website Terms](https://www.cloudflare.com/website-terms/) and [Privacy Policy](https://www.cloudflare.com/privacypolicy/). [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) are a temporary, best-effort service without an uptime guarantee.

## EmulatorJS Netplay Server

The local signaling implementation is compatible with and derived from the protocol used by EmulatorJS-Netplay, Copyright the EmulatorJS contributors, under the Apache License 2.0. Source and license: <https://github.com/EmulatorJS/EmulatorJS-Netplay>.

## Socket.IO and selfsigned

Socket.IO and selfsigned are distributed under their respective MIT licenses. Their license files are included with the packaged production dependencies.

## Public ICE services

Internet NetPlay uses the example STUN and TURN configuration published in the EmulatorJS documentation. WebRTC media and input are encrypted, but they may traverse those third-party relay services when the peers cannot establish a direct connection. These services receive network connection metadata and are governed by their operators' terms and privacy practices.
