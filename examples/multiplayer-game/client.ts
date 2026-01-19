import {
    ClientNetwork,
    generateId,
    lerp,
    Reconciliator,
    createDriver,
} from "../../src";

import { BrowserWebSocketClientTransport } from "../../src/net/adapters/browser-websocket";
import {
    Simulation,
    Intents,
    GameStateUpdate,
    createIntentRegistry,
    createSnapshotRegistry,
    PLAYER_SIZE,
    WORLD_WIDTH,
    WORLD_HEIGHT,
    WS_PORT,
    createRpcRegistry,
    RPCs,
} from "./shared";

/* ================================
   Client
================================ */

export class GameClient {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;

    network!: ClientNetwork<GameStateUpdate>;
    simulation: Simulation;

    myId: string | null = null;
    connected = false;

    keys: Record<string, boolean> = {};
    lastSnapshotTick = 0;

    reconciler: Reconciliator<Intents.Move, GameStateUpdate>;
    previousPositions: Map<string, { x: number; y: number }> = new Map();
    snapshotTimestamps: Map<string, number> = new Map();

    // Error smoothing for own player
    positionError = { x: 0, y: 0 };
    readonly errorSmoothingFactor = 0.05; // Increased for faster smoothing
    positionBeforeReconciliation = { x: 0, y: 0 };

    // Interpolation for own player
    myPreviousPosition = { x: 0, y: 0 };
    lastTickTime = 0;
    shouldInterpolate = false;

    constructor() {
        this.canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
        this.ctx = this.canvas.getContext("2d")!;

        this.simulation = new Simulation();

        // Hook into pre-tick to store position before tick processing
        this.simulation.events.on('pre-tick', () => {
            // Store position and timestamp before tick for interpolation
            const myPlayer = this.simulation.players.get(this.myId!);
            if (myPlayer) {
                this.myPreviousPosition.x = myPlayer.x;
                this.myPreviousPosition.y = myPlayer.y;
                this.lastTickTime = performance.now();
                this.shouldInterpolate = true;
            }
        });

        // Hook into tick event to apply input and send intents
        this.simulation.events.on('tick', ({ tick }) => this.tick(tick));

        // Temporary variables for reconciliation
        let tempServerX = 0;
        let tempServerY = 0;

        this.reconciler = new Reconciliator({
            onLoadState: (state) => {
                const myPlayer = this.simulation.players.get(this.myId!);
                if (myPlayer && this.myId) {
                    this.positionBeforeReconciliation.x = myPlayer.x;
                    this.positionBeforeReconciliation.y = myPlayer.y;
                }

                // Extract server position without applying it
                const serverState = state.find((p: any) => p.id === this.myId);
                if (serverState) {
                    tempServerX = serverState.x;
                    tempServerY = serverState.y;
                }

                this.loadSnapshot(state);
            },
            onReplay: (intents) => {
                if (!this.myId) return;
                const myPlayer = this.simulation.players.get(this.myId);
                if (!myPlayer) return;

                // Save current visual position
                const visualX = myPlayer.x;
                const visualY = myPlayer.y;

                // Apply server state and replay
                myPlayer.x = tempServerX;
                myPlayer.y = tempServerY;
                myPlayer.vx = 0;
                myPlayer.vy = 0;

                for (const intent of intents) {
                    this.simulation.applyVelocity(this.myId, intent);
                    this.simulation.step();
                }

                // Calculate error
                const errorX = visualX - myPlayer.x;
                const errorY = visualY - myPlayer.y;
                const errorMagnitude = Math.hypot(errorX, errorY);

                if (errorMagnitude > 0.5) {
                    this.positionError.x = errorX;
                    this.positionError.y = errorY;

                    if (errorMagnitude > 5) {
                        console.warn(`Prediction error: ${errorMagnitude.toFixed(2)}px`);
                    }
                }

                // DON'T update myPreviousPosition or lastTickTime here
                // Let the normal tick event handle that, otherwise we disrupt interpolation
            },
        });

        this.setupInput();
        this.connect();
    }

    /* ================================
       Networking
    ================================ */

    connect() {
        const transport = new BrowserWebSocketClientTransport(`ws://mococa:${WS_PORT}`);

        this.network = new ClientNetwork({
            transport,
            intentRegistry: createIntentRegistry(),
            snapshotRegistry: createSnapshotRegistry(),
            rpcRegistry: createRpcRegistry(),
            config: {
                debug: false,
                heartbeatInterval: 0,
                maxSendQueueSize: 1024 * 1024, // 1 MB
                maxMessagesPerSecond: 0,
                lagSimulation: 0,
            },
        });

        this.network.onConnect(() => {
            this.connected = true;
            console.log('connected.');

            const id = generateId({ prefix: 'player_', size: 16 });
            this.myId = id;
            this.network.sendRPC(RPCs.SpawnPlayer, { id });
            this.start();
        });

        this.network.onRPC(RPCs.PlayerSpawned, (rpc) => {
            if (!this.simulation.players.has(rpc.id)) {
                console.log(`RPC SpawnPlayer received for id=${rpc.id}`);
                const player = this.simulation.spawn(rpc.id);
                player.x = rpc.x;
                player.y = rpc.y;
                player.color = rpc.color;
            }

            if (rpc.id === this.myId) {
                console.log(`Spawned own player with id=${rpc.id}`);
            }
        });

        this.network.onSnapshot("gameState", (snapshot) => {
            if (!snapshot.updates) return;

            this.reconciler.onSnapshot({
                tick: snapshot.tick,
                state: snapshot.updates as GameStateUpdate,
            });
        });
    }

    /* ================================
       Input
    ================================ */

    setupInput() {
        window.addEventListener("keydown", e => {
            this.keys[e.key.toLowerCase()] = true;
        });

        window.addEventListener("keyup", e => {
            this.keys[e.key.toLowerCase()] = false;
        });
    }

    readInput() {
        let vx = 0;
        let vy = 0;

        if (this.keys["w"] || this.keys["arrowup"]) vy -= 1;
        if (this.keys["s"] || this.keys["arrowdown"]) vy += 1;
        if (this.keys["a"] || this.keys["arrowleft"]) vx -= 1;
        if (this.keys["d"] || this.keys["arrowright"]) vx += 1;

        return { vx, vy };
    }

    /* ================================
       Game Loop
    ================================ */

    start() {
        const driver = createDriver('client', (dt: number) => {
            this.simulation.update(dt);
            this.render();
        });

        driver.start();
    }

    tick(tick: number) {
        if (!this.connected || !this.myId) return;

        const input = this.readInput();

        // Create intent
        const intent: Intents.Move = {
            kind: Intents.Move.kind,
            tick,
            vx: input.vx,
            vy: input.vy,
        };

        // Send intent to server and track locally
        this.network.sendIntent(intent);
        this.reconciler.trackIntent(tick, intent);

        // Apply client-side prediction (must match replay logic)
        this.simulation.applyVelocity(this.myId, intent);
        this.simulation.step();
    }

    /* ================================
       Snapshot Handling
    ================================ */

    loadSnapshot(state: GameStateUpdate) {
        const now = performance.now();

        for (const p of state) {
            let player = this.simulation.players.get(p.id);

            if (!player) {
                // Spawn new player from server snapshot
                player = this.simulation.spawn(p.id);
            }

            if (p.id === this.myId) {
                // For own player: only update on first spawn
                if (player.x === 0 && player.y === 0) {
                    player.x = p.x;
                    player.y = p.y;
                }
            } else {
                // Store previous position before updating (for interpolation)
                this.previousPositions.set(p.id, { x: player.x, y: player.y });
                this.snapshotTimestamps.set(p.id, now);

                // Update position from authoritative server state
                player.x = p.x;
                player.y = p.y;
            }

            player.color = p.color;
        }
    }

    /* ================================
       Rendering
    ================================ */

    renderGrid() {
        this.ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
        this.ctx.fillStyle = '#0f3460';
        this.ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

        this.ctx.strokeStyle = 'rgba(78, 205, 196, 0.1)';
        this.ctx.lineWidth = 1;
        for (let x = 0; x < WORLD_WIDTH; x += 50) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, WORLD_HEIGHT);
            this.ctx.stroke();
        }
        for (let y = 0; y < WORLD_HEIGHT; y += 50) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(WORLD_WIDTH, y);
            this.ctx.stroke();
        }
    }

    renderPlayers() {
        const now = performance.now();

        for (const [playerId, player] of this.simulation.players) {
            let x = player.x;
            let y = player.y;

            if (playerId === this.myId) {
                // Only interpolate if we have a valid previous position from a tick
                if (this.shouldInterpolate) {
                    // Interpolate base position between ticks
                    x = lerp(this.myPreviousPosition.x, player.x, this.simulation.ticker.alpha);
                    y = lerp(this.myPreviousPosition.y, player.y, this.simulation.ticker.alpha);
                } else {
                    // No interpolation - use current position directly
                    x = player.x;
                    y = player.y;
                }

                // Apply error correction on top
                x += this.positionError.x;
                y += this.positionError.y;

                // Gradually reduce the error over time (exponential decay)
                this.positionError.x *= (1 - this.errorSmoothingFactor);
                this.positionError.y *= (1 - this.errorSmoothingFactor);

                // Clear tiny errors to prevent floating point drift
                if (Math.abs(this.positionError.x) < 0.01) this.positionError.x = 0;
                if (Math.abs(this.positionError.y) < 0.01) this.positionError.y = 0;
            } else {
                // Interpolate other players based on snapshot arrival time
                const prev = this.previousPositions.get(playerId);
                const timestamp = this.snapshotTimestamps.get(playerId);

                if (prev && timestamp) {
                    const elapsed = now - timestamp;
                    const interval = this.simulation.ticker.intervalMs;
                    const alpha = Math.min(elapsed / interval, 1.0);

                    x = lerp(prev.x, player.x, alpha);
                    y = lerp(prev.y, player.y, alpha);
                }
            }

            this.ctx.fillStyle = player.color;
            this.ctx.beginPath();
            this.ctx.arc(x, y, PLAYER_SIZE / 2, 0, Math.PI * 2);
            this.ctx.fill();

            if (playerId === this.myId) {
                this.ctx.strokeStyle = '#fff';
                this.ctx.lineWidth = 3;
                this.ctx.stroke();
            }

            this.ctx.fillStyle = '#fff';
            this.ctx.font = '10px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(playerId.substring(0, 8), x, y - PLAYER_SIZE);
        }
    }

    renderDebugInfo() {
        this.ctx.fillStyle = '#4ECDC4';
        this.ctx.font = '16px Arial';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`Players: ${this.simulation.players.size}`, 10, 20);
        this.ctx.fillText(`My ID: ${this.myId ? this.myId.substring(0, 12) : 'none'}`, 10, 40);
        this.ctx.fillText(`Tick: ${this.simulation.ticker.tickCount}`, 10, 60);
    }

    render() {
        this.renderGrid();
        this.renderPlayers();
        this.renderDebugInfo();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new GameClient();
});
