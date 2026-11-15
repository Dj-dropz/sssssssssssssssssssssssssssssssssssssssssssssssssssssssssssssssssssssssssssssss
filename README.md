# DexBlocks

## Run on Kali Linux
```bash
npm install
npm start
```
First launch asks for the owner account password in the terminal. The owner username is `Dexblocks`. Choose a unique test password; do not embed a password in a distributable application.

## Build Windows portable EXE
```bash
npm run build:win
```
Output is in `dist/`. Cross-building Windows apps from Linux can fail due to missing system dependencies or network restrictions. Build on Windows if packaging fails.

## Host for friends
The desktop app starts a server on `0.0.0.0:3210`. Friends need your reachable LAN IP on the same network, or a properly configured public server, firewall, and router. Do not expose the server to the public internet without TLS, stronger rate limits, moderation, and security review.

## Current limits
- API, accounts with bcrypt password hashes, game listings and server-side visit counts.
- Socket.IO room chat with a message length limit and per-user cooldown.
- Admin account and verified badges; owner can verify accounts.
- Studio upload stores `.rbxm` and `.rbxl` files (50 MB limit). It does not execute Roblox scripts or convert Roblox files to DexBlocks games.
- The sample Block Builder is a listing, not a complete 3D game engine. This project does not reproduce Roblox's proprietary engine, marketplace, or safety/moderation systems.
