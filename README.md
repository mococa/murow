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

### Core Utilities
- `FixedTicker`: Deterministic fixed-rate update loop
- `EventSystem`: High-performance event handling
- `BinaryCodec`: Schema-driven binary serialization
- `generateId`: Cryptographically secure ID generation
- `lerp`: Linear interpolation utility
- `NavMesh`: Pathfinding with dynamic obstacles
- `PooledCodec`: Object-pooled binary codec
- `IntentTracker` & `Reconciliator`: Client-side prediction

## Building

```bash
npm install
npm run build
```

## License

MIT
