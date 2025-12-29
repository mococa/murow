# Multiplayer Game Example

A real-time multiplayer game demonstrating the gamedev-utils networking library with client-side prediction and server reconciliation.

## Features

- **Server-Authoritative Architecture**: All game logic runs on the server
- **Client-Side Prediction**: Immediate response to player input with reconciliation
- **Binary Protocol**: Efficient intent and snapshot encoding using PooledCodec
- **WebSocket Transport**: Real-time bidirectional communication using Bun WebSocket
- **Fixed Tick Rate**: Deterministic simulation at 20 ticks per second
- **Multiple Players**: Support for multiple concurrent players with unique colors

## Architecture

### Server ([server.ts](server.ts))

The server manages the authoritative game state:
- Spawns players when they connect
- Processes move intents from clients
- Runs the simulation at a fixed tick rate (20 TPS)
- Broadcasts game state snapshots to all clients

### Client ([client.html](client.html))

The client provides responsive gameplay:
- Sends move intents to the server
- Implements client-side prediction for immediate feedback
- Reconciles predicted state with authoritative snapshots
- Renders all players with smooth movement

### Shared Protocol ([shared.ts](shared.ts))

Defines the game protocol:
- **Intents**: Move intent with dx/dy velocity
- **Snapshots**: Game state with all player positions
- **Simulation**: Shared game logic for deterministic updates

## Running the Example

### 1. Start the Server

Using Bun:
```bash
cd examples/multiplayer-game
bun run server.ts
```

The server will start on `ws://localhost:3000`

### 2. Open the Client

Open `client.html` in one or more browser windows:
```bash
open client.html
# or
firefox client.html
# or simply drag client.html into your browser
```

### 3. Play

- Use **WASD** or **Arrow Keys** to move your player
- Open multiple browser windows to see multiplayer in action
- Your player has a white outline
- Other players appear as colored circles

## How It Works

### Client-Side Prediction

1. **Send Intent**: When you press a key, the client immediately:
   - Applies the movement locally (prediction)
   - Tracks the intent with its tick number
   - Sends the intent to the server

2. **Receive Snapshot**: When the server sends back the authoritative state:
   - The client loads the server's position
   - Drops all intents confirmed by the snapshot
   - Replays remaining unconfirmed intents

3. **Result**: Instant response with smooth reconciliation

### Network Protocol

**Intent Message** (Client → Server):
```
[MessageType.INTENT][kind: u8][tick: u32][dx: f32][dy: f32]
```

**Snapshot Message** (Server → Client):
```
[MessageType.SNAPSHOT][typeId: u8][tick: u32][players: Array<{id, x, y, color}>]
```

## Customization

### Change Tick Rate

Edit `TICK_RATE` in [shared.ts](shared.ts):
```ts
export const TICK_RATE = 20; // 20 updates per second
```

### Adjust Player Speed

Edit `PLAYER_SPEED` in [shared.ts](shared.ts):
```ts
export const PLAYER_SPEED = 200; // pixels per second
```

### Change Server Port

Edit `PORT` in [server.ts](server.ts):
```ts
const PORT = 3000;
```

## Technology Stack

- **Runtime**: Bun (for WebSocket server)
- **Networking**: gamedev-utils ServerNetwork/ClientNetwork
- **Protocol**: Binary encoding with PooledCodec
- **Prediction**: IntentTracker and Reconciliator
- **Rendering**: HTML5 Canvas

## Learn More

This example demonstrates:
- [ServerNetwork](../../src/net/server.ts) - Server-side networking
- [BunWebSocketServerTransport](../../src/net/adapters/bun-websocket.ts) - Bun WebSocket adapter
- [IntentRegistry](../../src/protocol/intent/intent-registry.ts) - Intent encoding/decoding
- [SnapshotRegistry](../../src/protocol/snapshot/snapshot-registry.ts) - Snapshot encoding/decoding
- [Reconciliator](../../src/core/prediction/prediction.ts) - Client-side prediction
- [FixedTicker](../../src/core/fixed-ticker.ts) - Fixed timestep simulation
