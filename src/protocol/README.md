# Protocol Layer

Minimalist primitives for networked multiplayer games. Just intents and snapshots - you handle the rest.

## What You Get

1. **IntentRegistry** - Register, encode, decode intents with zero allocations
2. **Snapshot<T>** - Type-safe delta updates
3. **applySnapshot()** - Deep merge snapshot updates into state

That's it. No loops, no queues, no storage - just the codec layer.

## Quick Start

### 1. Define Your Types

```ts
import { Intent, Snapshot } from "./protocol";

interface GameState {
  players: Record<number, { x: number; y: number; health: number }>;
}

interface MoveIntent extends Intent {
  kind: 1;
  tick: number;
  dx: number;
  dy: number;
}

interface ShootIntent extends Intent {
  kind: 2;
  tick: number;
  targetId: number;
}
```

### 2. Register Intent Codecs

```ts
import { IntentRegistry } from "./protocol/intent";
import { PooledCodec } from "./core/pooled-codec";
import { BinaryCodec } from "./core/binary-codec";

const registry = new IntentRegistry();

// Register move intent
registry.register(
  1,
  new PooledCodec({
    kind: BinaryCodec.u8,
    tick: BinaryCodec.u32,
    dx: BinaryCodec.f32,
    dy: BinaryCodec.f32,
  })
);

// Register shoot intent
registry.register(
  2,
  new PooledCodec({
    kind: BinaryCodec.u8,
    tick: BinaryCodec.u32,
    targetId: BinaryCodec.u32,
  })
);
```

### 3. Client: Encode & Send Intents

```ts
// Generate intent from input
const intent: MoveIntent = {
  kind: 1,
  tick: currentTick,
  dx: input.x,
  dy: input.y,
};

// Encode using pooled codec (zero allocation)
const buf = registry.encode(intent);

// Send to server
socket.send(buf);
```

### 4. Server: Receive & Decode Intents

```ts
socket.on("data", (buf: Uint8Array) => {
  // First byte is always the intent kind
  const kind = buf[0];

  // Decode using registered codec
  const intent = registry.decode(kind, buf);

  // Process intent in your game logic
  processIntent(intent);
});
```

### 5. Server: Create & Send Snapshots

```ts
import { SnapshotCodec } from "./protocol/snapshot";
import { PooledCodec } from "./core/pooled-codec";

// Create codec for state updates (same schema as your state)
const stateCodec = new PooledCodec({
  players: // your state schema here
});

const snapshotCodec = new SnapshotCodec(stateCodec);

// After processing intents, create a snapshot
const snapshot: Snapshot<GameState> = {
  tick: serverTick,
  updates: {
    // Only include what changed
    players: {
      1: { x: 10, y: 20, health: 90 },
      2: { x: 15, y: 25 }, // health unchanged
    },
  },
};

// Encode and send (zero allocation)
const buf = snapshotCodec.encode(snapshot);
socket.send(buf);
```

### 6. Client: Decode & Apply Snapshots

```ts
import { applySnapshot } from "./protocol/snapshot";

socket.on("snapshot", (buf: Uint8Array) => {
  // Decode snapshot
  const snapshot = snapshotCodec.decode(buf);

  // Deep merge updates into client state
  applySnapshot(clientState, snapshot);

  // Render updated state
  render(clientState);
});
```

## Memory Efficiency

The `PooledCodec` reuses buffers and objects:

```ts
// Encoding - reuses Uint8Array from pool
const buf1 = registry.encode(intent1); // Acquires from pool
socket.send(buf1);
// buf1 automatically released back to pool after use

// Decoding - reuses objects from pool
const intent = registry.decode(kind, buf); // Acquires from pool
processIntent(intent);
// intent automatically released back to pool
```

**Zero allocations** during gameplay = zero GC pauses.

## Snapshot Deep Merging

`applySnapshot` intelligently merges nested updates:

```ts
const state: GameState = {
  players: {
    1: { x: 0, y: 0, health: 100 },
    2: { x: 10, y: 10, health: 100 },
  },
};

const snapshot: Snapshot<GameState> = {
  tick: 100,
  updates: {
    players: {
      1: { x: 5 }, // Only update x, keep y and health
    },
  },
};

applySnapshot(state, snapshot);

// Result:
// state.players[1] = { x: 5, y: 0, health: 100 }
// state.players[2] unchanged
```

- **Objects**: Deep merged
- **Arrays**: Replaced entirely
- **Primitives**: Overwritten

## Efficient Partial Updates with SnapshotRegistry

For games with many state fields, use `SnapshotRegistry` to send only specific update types:

```ts
import { SnapshotRegistry } from "./protocol/snapshot";
import { PooledCodec } from "./core/pooled-codec";
import { BinaryCodec } from "./core/binary-codec";

// Define separate update types
interface PlayerUpdate {
  players: Record<number, { x: number; y: number }>;
}

interface ScoreUpdate {
  score: number;
}

interface ProjectileUpdate {
  projectiles: Array<{ id: number; x: number; y: number }>;
}

type GameUpdate = PlayerUpdate | ScoreUpdate | ProjectileUpdate;

// Create registry
const registry = new SnapshotRegistry<GameUpdate>();

// Register codecs for each update type
registry.register("players", new PooledCodec({
  players: // schema
}));

registry.register("score", new PooledCodec({
  score: BinaryCodec.u32
}));

registry.register("projectiles", new PooledCodec({
  projectiles: // array schema
}));

// Server: Send only what changed
if (playersChanged) {
  const buf = registry.encode("players", {
    tick: 100,
    updates: { players: { 1: { x: 5, y: 10 } } }
  });
  socket.send(buf);
}

if (scoreChanged) {
  const buf = registry.encode("score", {
    tick: 100,
    updates: { score: 50 }
  });
  socket.send(buf);
}

// Client: Decode and apply
socket.on("snapshot", (buf: Uint8Array) => {
  const { type, snapshot } = registry.decode(buf);
  applySnapshot(clientState, snapshot);
});
```

**Benefits:**
- ✅ Only encode fields that changed (true partial updates)
- ✅ No bandwidth wasted on nil/empty values
- ✅ Type ID embedded in message (1 byte overhead)
- ✅ Works with arrays, Records, primitives

## Multiple Intents

You can have as many intent types as needed:

```ts
enum IntentKind {
  Move = 1,
  Shoot = 2,
  Jump = 3,
  UseItem = 4,
  Chat = 5,
}

registry.register(IntentKind.Move, new PooledCodec(moveSchema));
registry.register(IntentKind.Shoot, new PooledCodec(shootSchema));
registry.register(IntentKind.Jump, new PooledCodec(jumpSchema));
// ... etc
```

## What You Build Yourself

This layer intentionally **does not** provide:

- ❌ Game loops (use `FixedTicker` from core)
- ❌ Intent queuing/buffering (application-specific)
- ❌ Snapshot storage/history (application-specific)
- ❌ Network transport (WebSocket, WebRTC, etc.)
- ❌ Prediction/rollback (use `IntentTracker` and `Reconciliator` from core)
- ❌ Interpolation (application-specific)
- ❌ Lag compensation (application-specific)

The protocol layer gives you type-safe codecs. Core utilities like `FixedTicker`, `IntentTracker`, and `Reconciliator` are available separately.

## Testing

```bash
npm test -- intent-registry
```

## License

MIT
