# SnapshotBuffer

A lightweight buffer for storing snapshots of game states (or any state) keyed by tick numbers. Useful for rewind, replay, or client-side prediction in games and simulations.

## Features

* Store and retrieve states by tick.
* Automatically manages buffer size.
* Discard old states efficiently.
* Replay states in order for simulations or debugging.

## Usage

```ts
import { SnapshotBuffer } from ".";

const buffer = new SnapshotBuffer<{ x: number; y: number }>(100);

buffer.store(1, { x: 10, y: 20 });
buffer.store(2, { x: 15, y: 25 });

console.log(buffer.at(1)); // { x: 10, y: 20 }
console.log(buffer.latest); // { tick: 2, state: { x: 15, y: 25 } }

buffer.replay((state, tick) => {
  console.log(tick, state);
});
```

## API

* `store(tick: number, state: T)` – Store a state at a specific tick.
* `at(tick: number)` – Get the state at a specific tick.
* `latest` – Get the latest tick and state.
* `earliest` – Get the earliest tick.
* `size` – Number of snapshots stored.
* `discardUntil(tick: number)` – Remove snapshots up to a tick.
* `replay(fn, fromTick?, toTick?)` – Replay snapshots in order.
