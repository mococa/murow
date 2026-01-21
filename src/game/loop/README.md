# Game Loop

The Game Loop module provides a flexible and efficient way to manage the main loop of a game, handling both fixed-rate updates (ticks) and variable-rate rendering. It supports different driver types for client and server environments.

## Usage

Hook it to a game simulation, ECS, or any other game logic by listening to tick events or providing callback functions.

```typescript
import { GameLoop } from "gamedev-utils";
const loop = new GameLoop({
    type: 'client', // or 'server-immediate' / 'server-timeout'
    tickRate: 12, // ticks per second
});

// Events way: Listen to various loop events, such as tick.
// tick event runs at fixed intervals defined by tickRate
loop.events.on('tick', ({ deltaTime, tick }) => {
    console.log(`Tick ${tick} with deltaTime ${deltaTime}`);
});
// render event in the client, runs at every frame at your monitor refresh rate
loop.events.on('render', ({ deltaTime, alpha }) => {
    console.log(`Render frame with deltaTime ${deltaTime} and alpha ${alpha}`);
});

loop.start();

// Play with the loop (all emits events as well)
loop.stop();
loop.pause();
loop.resume();
```