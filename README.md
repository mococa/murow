# Murow

A lightweight TypeScript game engine for server-authoritative multiplayer games.

## Installation

```bash
npm install murow
```

## Usage

```typescript
import {
  FixedTicker,
  EventSystem,
  BinaryCodec,
  generateId,
  lerp,
  NavMesh,
  PooledCodec,
  IntentTracker,
  Reconciliator
} from 'murow';
// or
import { FixedTicker } from 'murow/core';
```

## Modules

### Entity Component System (ECS)

High-performance ECS with **SoA (Structure of Arrays)** storage, bitmask queries, and zero-allocation hot paths:
- `World`: Manages entities and components
- `defineComponent`: Define typed components with binary schemas
- `EntityHandle`: Fluent chainable entity API

See [ECS Documentation](./src/ecs/README.md) for full usage.

### Core Utilities
- `FixedTicker`: Deterministic fixed-rate update loop
- `EventSystem`: High-performance event handling
- `BinaryCodec`: Schema-driven binary serialization
- `generateId`: Cryptographically secure ID generation
- `lerp`: Linear interpolation utility
- `NavMesh`: Pathfinding with dynamic obstacles
- `PooledCodec`: Object-pooled binary codec with array support (via `PooledCodec.array()`) for efficient snapshot encoding. Supports zero-copy encoding with `encodeInto()` for minimal allocations
- `IntentTracker` & `Reconciliator`: Client-side prediction

### Protocol Layer
Minimalist networking primitives:
- `IntentRegistry`: Type-safe intent codec registry
- `SnapshotCodec`: Binary encoding for state deltas
- `Snapshot<T>`: Delta-based state updates
- `applySnapshot()`: Deep merge snapshots into state

Works harmoniously with core utilities (`FixedTicker`, `IntentTracker`, `Reconciliator`).

See [Protocol Layer Documentation](./src/protocol/README.md) for usage.

### Network Layer
Transport-agnostic client/server abstractions:
- `ServerNetwork`: Multiplayer game server with per-peer snapshot registries
- `ClientNetwork`: Game client with intent/snapshot handling
- `TransportAdapter`: Pluggable transport interface
- `BunWebSocketTransport`: Bun WebSocket implementation (reference)

Key features:
- **Per-peer snapshot registries** for fog of war and interest management
- **Transport agnostic** - works with WebSocket, WebRTC, UDP, etc.
- **Type-safe** protocol integration with `IntentRegistry` and `SnapshotRegistry`

See [Network Layer Documentation](./src/net/README.md) for usage and [examples/multiplayer-game.ts](./examples/multiplayer-game.ts) for a complete example.

## Building

```bash
npm install
npm run build
```

## License

MIT
