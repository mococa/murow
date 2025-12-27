# Network Layer (`@mococa/net`)

Transport-agnostic networking layer for multiplayer games. Provides generic client/server abstractions that work with any transport (WebSocket, WebRTC, UDP, Socket.io, etc.)

## Key Features

- **Per-Peer Snapshot Registries** - Each player gets their own snapshot codec, enabling:
  - Fog of war (only send visible entities)
  - Interest management (only send relevant data)
  - Player-specific compression/optimization

- **Transport Agnostic** - Pluggable transport adapters for:
  - Bun WebSocket (included)
  - Browser WebSocket
  - WebRTC
  - UDP
  - Socket.io
  - Custom transports

- **Type-Safe Protocol** - Integrates with `@mococa/protocol`:
  - Intent encoding/decoding
  - Snapshot encoding/decoding
  - Binary serialization

- **Connection Lifecycle** - Built-in handling for:
  - Connection/disconnection events
  - Per-peer state tracking
  - Message routing

## Architecture

```
┌─────────────┐                    ┌─────────────┐
│ Game Client │                    │ Game Server │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │  Intents (MoveIntent, etc)       │
       ├─────────────────────────────────>│
       │                                  │
       │  Snapshots (GameState)           │
       │<─────────────────────────────────┤
       │                                  │
       ▼                                  ▼
┌─────────────┐                    ┌─────────────┐
│ ClientNetwork  │                    │ ServerNetwork  │
│   Class     │                    │   Class     │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │  Binary Messages (Uint8Array)    │
       ├─────────────────────────────────>│
       │<─────────────────────────────────┤
       │                                  │
       ▼                                  ▼
┌─────────────┐                    ┌─────────────┐
│ Transport   │                    │ Transport   │
│ Adapter     │◄──────WebSocket───►│ Adapter     │
└─────────────┘                    └─────────────┘
```

## Quick Start

### 1. Define Your Game Protocol

```typescript
import { BinaryCodec, defineIntent, IntentRegistry, SnapshotRegistry } from '@mococa/gamedev-utils';

// Define intents (client -> server)
enum IntentKind {
  Move = 1,
  Attack = 2,
}

const MoveIntent = defineIntent({
  kind: IntentKind.Move,
  schema: {
    dx: BinaryCodec.f32,
    dy: BinaryCodec.f32,
  }
});

// Define game state (server -> client)
const GameStateCodec = BinaryCodec.object({
  players: BinaryCodec.record(BinaryCodec.string, BinaryCodec.object({
    x: BinaryCodec.f32,
    y: BinaryCodec.f32,
    health: BinaryCodec.u8,
  })),
  tick: BinaryCodec.u32,
});
```

### 2. Create Server

```typescript
import { ServerNetwork, BunWebSocketServerTransport } from '@mococa/gamedev-utils';

// Create transport
const transport = BunWebSocketServerTransport.create(3000);

// Create intent registry
const intentRegistry = new IntentRegistry();
intentRegistry.register(IntentKind.Move, MoveIntent.codec);

// Create server
const server = new ServerNetwork({
  transport,
  intentRegistry,
  config: { debug: true }
});

// Setup per-peer snapshot registries
server.onConnection((peerId) => {
  // Each peer gets their own snapshot registry!
  const registry = new SnapshotRegistry();
  registry.register('GameState', GameStateCodec);
  server.registerPeerSnapshotRegistry(peerId, registry);
});

// Handle intents
server.onIntent(IntentKind.Move, (peerId, intent) => {
  const { dx, dy } = intent as MoveIntent;
  // Update game state...
});

// Broadcast snapshots
setInterval(() => {
  server.broadcastSnapshot('GameState', {
    tick: currentTick++,
    updates: gameState
  });
}, 50); // 20 Hz
```

### 3. Create Client

```typescript
import { ClientNetwork, BunWebSocketClientTransport } from '@mococa/gamedev-utils';

// Connect to server
const transport = await BunWebSocketClientTransport.connect('ws://localhost:3000');

// Create registries
const intentRegistry = new IntentRegistry();
intentRegistry.register(IntentKind.Move, MoveIntent.codec);

const snapshotRegistry = new SnapshotRegistry();
snapshotRegistry.register('GameState', GameStateCodec);

// Create client
const client = new ClientNetwork({
  transport,
  intentRegistry,
  snapshotRegistry,
  config: { debug: true }
});

// Handle snapshots
client.onSnapshot('GameState', (snapshot) => {
  // Apply to local game state
  gameState = applySnapshot(gameState, snapshot);
});

// Send intents
client.sendIntent({
  kind: IntentKind.Move,
  tick: currentTick,
  dx: 1.0,
  dy: 0.5
});
```

## Per-Peer Snapshot Registries

The killer feature! Each peer can have a **different snapshot registry**, enabling powerful optimizations:

### Fog of War

```typescript
server.broadcastSnapshotWithCustomization('GameState', baseSnapshot, (peerId, snapshot) => {
  const player = gameState.players[peerId];

  // Only send visible entities to this player
  const visibleEntities = entities.filter(entity =>
    distance(player, entity) < VISIBILITY_RADIUS
  );

  return {
    tick: snapshot.tick,
    updates: {
      ...snapshot.updates,
      entities: visibleEntities
    }
  };
});
```

### Interest Management

```typescript
// Player A sees detailed info about nearby players
const nearbyRegistry = new SnapshotRegistry();
nearbyRegistry.register('Player', DetailedPlayerCodec); // More data

// Player B sees simplified info about distant players
const distantRegistry = new SnapshotRegistry();
distantRegistry.register('Player', SimplePlayerCodec); // Less data

server.registerPeerSnapshotRegistry('playerA', nearbyRegistry);
server.registerPeerSnapshotRegistry('playerB', distantRegistry);
```

### Platform-Specific Encoding

```typescript
// Mobile clients get more compressed snapshots
const mobileRegistry = new SnapshotRegistry();
mobileRegistry.register('GameState', CompressedGameStateCodec);

// Desktop clients get full precision
const desktopRegistry = new SnapshotRegistry();
desktopRegistry.register('GameState', FullGameStateCodec);
```

## Creating Custom Transports

Implement the `TransportAdapter` interface:

```typescript
import { TransportAdapter, ServerTransportAdapter } from '@mococa/net';

// Client-side transport
class MyTransport implements TransportAdapter {
  send(data: Uint8Array): void {
    // Send binary data through your transport
  }

  onMessage(handler: (data: Uint8Array) => void): void {
    // Register message handler
  }

  onClose(handler: () => void): void {
    // Register close handler
  }

  close(): void {
    // Close connection
  }
}

// Server-side transport
class MyServerTransport implements ServerTransportAdapter<MyTransport> {
  onConnection(handler: (peer: MyTransport, peerId: string) => void): void {
    // Register connection handler
  }

  onDisconnection(handler: (peerId: string) => void): void {
    // Register disconnection handler
  }

  getPeer(peerId: string): MyTransport | undefined {
    // Get peer by ID
  }

  getPeerIds(): string[] {
    // Get all peer IDs
  }

  close(): void {
    // Close server
  }
}
```

## Message Protocol

Messages are prefixed with a single byte indicating type:

```
┌────────────┬──────────────────────┐
│ Type (u8)  │ Payload (variable)   │
├────────────┼──────────────────────┤
│ 0x01       │ Intent data          │  (Client -> Server)
│ 0x02       │ Snapshot data        │  (Server -> Client)
│ 0xFF       │ Custom data          │  (Bidirectional)
└────────────┴──────────────────────┘
```

This allows the layer to automatically route messages without requiring separate channels.

## API Reference

### `ServerNetwork<TPeer>`

#### Constructor
```typescript
constructor(config: {
  transport: ServerTransportAdapter<TPeer>;
  intentRegistry: IntentRegistry;
  config?: NetworkConfig;
})
```

#### Methods
- `registerPeerSnapshotRegistry(peerId: string, registry: SnapshotRegistry)` - Register per-peer snapshot registry
- `onIntent(kind: number, handler: (peerId: string, intent: unknown) => void)` - Handle specific intent type
- `onConnection(handler: (peerId: string) => void)` - Handle new connections
- `onDisconnection(handler: (peerId: string) => void)` - Handle disconnections
- `sendSnapshotToPeer<T>(peerId: string, type: string, snapshot: Snapshot<T>)` - Send to specific peer
- `broadcastSnapshot<T>(type: string, snapshot: Snapshot<T>, filter?: (peerId: string) => boolean)` - Broadcast to all
- `broadcastSnapshotWithCustomization<T>(type: string, baseSnapshot: Snapshot<T>, customize: (peerId: string, snapshot: Snapshot<T>) => Snapshot<T>)` - Broadcast with per-peer customization
- `getPeerIds()` - Get all connected peer IDs
- `getPeerState(peerId: string)` - Get peer state
- `setPeerMetadata(peerId: string, key: string, value: unknown)` - Update peer metadata
- `close()` - Close server

### `ClientNetwork`

#### Constructor
```typescript
constructor(config: {
  transport: TransportAdapter;
  intentRegistry: IntentRegistry;
  snapshotRegistry: SnapshotRegistry;
  config?: NetworkConfig;
})
```

#### Methods
- `sendIntent(intent: unknown)` - Send intent to server
- `onSnapshot<T>(type: string, handler: (snapshot: Snapshot<T>) => void)` - Handle specific snapshot type
- `onAnySnapshot(handler: (type: string, snapshot: Snapshot<unknown>) => void)` - Handle all snapshots
- `onClose(handler: () => void)` - Handle connection close
- `getLastReceivedTick()` - Get last received tick number
- `isConnected()` - Check connection status
- `close()` - Close connection

## Examples

See [examples/multiplayer-game.ts](../../examples/multiplayer-game.ts) for a complete working example with:
- Server setup with per-peer registries
- Client prediction
- Multiple intent types
- Fog of war implementation
- Movement, combat, and chat

## Best Practices

1. **Always use per-peer snapshot registries** - Register them in `onConnection`
2. **Keep snapshots small** - Only send delta updates
3. **Use fog of war** - Don't send data players can't see
4. **Handle disconnections** - Clean up peer state and registries
5. **Rate limit snapshots** - Don't send faster than clients can process (typically 20-60 Hz)
6. **Validate intents** - Always sanitize/validate data from clients
7. **Use tick numbers** - Include tick in intents for prediction/rollback

## Performance Tips

- Use pooled codecs for zero-allocation encoding
- Batch snapshot updates when possible
- Implement delta compression for large states
- Use binary encoding (not JSON!)
- Consider different update rates for different data (e.g., position vs. health)
- Profile your snapshot sizes - aim for < 1KB per snapshot

## Future Enhancements

Potential additions:
- Reliable message channels (with acks/retries)
- Message priority/ordering
- Bandwidth monitoring
- Automatic compression
- Latency measurement
- Built-in lag compensation helpers
