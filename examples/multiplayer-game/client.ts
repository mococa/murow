import { ClientNetwork, Reconciliator, lerp } from "../../src";
import { BrowserWebSocketClientTransport } from "../../src/net/adapters/browser-websocket";
import {
    createIntentRegistry,
    createSnapshotRegistry,
    Intents,
    type GameStateUpdate,
    PLAYER_SPEED,
    PLAYER_SIZE,
    WORLD_WIDTH,
    WORLD_HEIGHT,
    Simulation,
} from "./shared";

const WS_PORT = 3007;

class GameClient {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    status: HTMLElement;

    network!: ClientNetwork<GameStateUpdate>;
    connected = false;
    myId: string | null = null;
    currentTick = 0;

    // Input state
    keys: Record<string, boolean> = {};
    currentInput: { dx: number; dy: number } = { dx: 0, dy: 0 }; // Captured every frame

    // Client-side simulation and prediction
    simulation: Simulation;
    reconciliator: Reconciliator<Intents.Move, GameStateUpdate>;

    // Previous positions for interpolation (rendering only)
    previousPositions: Map<string, { x: number; y: number }> = new Map();
    lerpAlpha = 1; // Smoothing factor

    constructor() {
        this.canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
        this.ctx = this.canvas.getContext('2d')!;
        this.status = document.getElementById('status')!;

        // Initialize simulation
        this.simulation = new Simulation({
            onTick: (deltaTime, tick) => {
                this.currentTick = tick;
                this.handleTickInput();
            },
        });

        this.lerpAlpha = 4 * (1 / this.simulation.ticker.rate);

        // Client-side prediction and reconciliation
        this.reconciliator = new Reconciliator({
            onLoadState: (state) => this.loadAuthoritativeState(state),
            onReplay: (intents) => this.replayIntents(intents),
        });

        this.setupInput();
        this.connect();
    }

    connect() {
        this.updateStatus('connecting', 'Connecting...');

        // Create network with proper transport and registries
        const transport = new BrowserWebSocketClientTransport(`ws://mococa:${WS_PORT}`);

        // Register handlers BEFORE creating ClientNetwork
        // so they're ready when setupTransportHandlers() is called
        this.network = new ClientNetwork({
            transport,
            intentRegistry: createIntentRegistry(),
            snapshotRegistry: createSnapshotRegistry(),
            config: {
                debug: false,
                heartbeatInterval: 15000,  // Send heartbeat every 15 seconds
                heartbeatTimeout: 45000,   // Timeout after 45 seconds of no messages

            },
        });

        this.network.onConnect(() => {
            this.connected = true;
            this.updateStatus('connected', 'Connected');
            this.startGameLoop();
        });

        this.network.onDisconnect(() => {
            this.connected = false;
            this.updateStatus('disconnected', 'Disconnected');
        });

        this.network.onSnapshot<GameStateUpdate>('gameState', (snapshot) => {
            this.handleSnapshot(snapshot);
        });
    }

    updateStatus(className: string, text: string) {
        this.status.className = className;
        this.status.textContent = text;
    }

    setupInput() {
        window.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });
    }

    getInput() {
        let dx = 0, dy = 0;

        if (this.keys['w'] || this.keys['arrowup']) dy -= 1;
        if (this.keys['s'] || this.keys['arrowdown']) dy += 1;
        if (this.keys['a'] || this.keys['arrowleft']) dx -= 1;
        if (this.keys['d'] || this.keys['arrowright']) dx += 1;

        return { dx, dy };
    }

    handleSnapshot(snapshot: { tick: number; updates: Partial<GameStateUpdate> }) {
        // If we receive a snapshot, we're definitely connected
        if (!this.connected) {
            this.connected = true;
            this.updateStatus('connected', 'Connected');
            this.startGameLoop();
        }

        // Use reconciliator for client-side prediction
        // The reconciliator will only replay if there are remaining unconfirmed intents
        this.reconciliator.onSnapshot({
            tick: snapshot.tick,
            state: snapshot.updates as GameStateUpdate, // Server always sends complete array
        });
    }

    loadAuthoritativeState(players: GameStateUpdate) {
        // On first snapshot, assume the last player is us (server adds us last)
        if (this.myId === null && players.length > 0) {
            const lastPlayer = players[players.length - 1];
            this.myId = lastPlayer.id;
            this.simulation.localPlayerId = this.myId; // Set local player ID in simulation
        }

        // Load server state into simulation
        // Clear and rebuild players from authoritative state
        for (const playerData of players) {
            // If player exists in simulation, update it; otherwise create new
            let player = this.simulation.players.get(playerData.id);
            if (!player) {
                player = {
                    id: playerData.id,
                    x: playerData.x,
                    y: playerData.y,
                    vx: 0,
                    vy: 0,
                    color: playerData.color,
                };
                this.simulation.players.set(playerData.id, player);
            } else {
                // For remote players: always trust server authority and update position
                if (playerData.id !== this.myId) {
                    player.x = playerData.x;
                    player.y = playerData.y;
                } else {
                    // For local player: only correct position if there's significant error
                    // This prevents constant snapping due to frame-rate vs tick-rate mismatch
                    const dx = playerData.x - player.x;
                    const dy = playerData.y - player.y;
                    const errorDistSq = dx * dx + dy * dy;
                    const threshold = 4; // 5 pixels squared

                    if (errorDistSq > threshold) {
                        // Significant misprediction - reset to server position
                        // player.x = playerData.x;
                        // player.y = playerData.y;
                        this.previousPositions.set(playerData.id, { x: player.x, y: player.y });
                    }
                    // Otherwise trust client prediction
                }
            }
        }
    }

    replayIntents(intents: Intents.Move[]) {
        // Replay unconfirmed intents on the local player in simulation
        // Note: This is only called when there are actually intents to replay
        if (!this.myId) return;

        console.log(`Replaying ${intents.length} unconfirmed intents`);

        // For velocity-based movement, we only need to ensure the correct velocity is set
        // The most recent intent represents the current input state
        const lastIntent = intents[intents.length - 1];
        this.applyInput(lastIntent.dx, lastIntent.dy);

        // Position will be corrected naturally by the per-frame update
        // No need to manually advance position here
    }

    applyInput(dx: number, dy: number) {
        if (!this.myId) return;

        // Apply input to local player velocity in simulation
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length > 0) {
            const normalizedDx = (dx / length) * PLAYER_SPEED;
            const normalizedDy = (dy / length) * PLAYER_SPEED;
            this.simulation.setPlayerVelocity(this.myId, normalizedDx, normalizedDy);
        } else {
            this.simulation.setPlayerVelocity(this.myId, 0, 0);
        }
    }

    renderGrid() {
        // Clear canvas
        this.ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

        // Draw background
        this.ctx.fillStyle = '#0f3460';
        this.ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

        // Draw grid
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
        for (const [playerId, player] of this.simulation.players) {
            let x = player.x;
            let y = player.y;

            // Apply lerp interpolation for remote players only
            // Local player is updated at tick rate and doesn't need interpolation
            const prev = this.previousPositions.get(playerId);
            if (prev) {
                // Interpolate from previous position to current
                x = lerp(prev.x, player.x, this.lerpAlpha);
                y = lerp(prev.y, player.y, this.lerpAlpha);

                // Update previous position to the interpolated value
                prev.x = x;
                prev.y = y;
            } else if (playerId !== this.myId) {
                // First time seeing this player, initialize previous position
                this.previousPositions.set(playerId, { x, y });
            }

            // Draw player circle
            this.ctx.fillStyle = player.color;
            this.ctx.beginPath();
            this.ctx.arc(x, y, PLAYER_SIZE / 2, 0, Math.PI * 2);
            this.ctx.fill();

            // Draw outline for local player
            if (playerId === this.myId) {
                this.ctx.strokeStyle = '#fff';
                this.ctx.lineWidth = 3;
                this.ctx.stroke();
            }

            // Draw player ID
            this.ctx.fillStyle = '#fff';
            this.ctx.font = '10px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(playerId.substring(0, 8), x, y - PLAYER_SIZE);
        }
    }

    renderDebugInfo() {
        // Draw debug info
        this.ctx.fillStyle = '#4ECDC4';
        this.ctx.font = '16px Arial';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`Players: ${this.simulation.players.size}`, 10, 20);
        this.ctx.fillText(`My ID: ${this.myId ? this.myId.substring(0, 12) : 'none'}`, 10, 40);
        this.ctx.fillText(`Tick: ${this.currentTick}`, 10, 60);

    }

    render() {
        this.renderGrid();
        this.renderPlayers();
        this.renderDebugInfo();
    }

    startGameLoop() {
        let lastTime = performance.now();

        const loop = (currentTime: number) => {
            const deltaTime = (currentTime - lastTime) / 1000; // Convert to seconds
            lastTime = currentTime;

            // Capture input state each frame
            this.captureInput();

            // Update simulation each frame (it has internal fixed ticker)
            this.simulation.update(deltaTime);

            // Update local player position every frame for smooth movement
            this.updateLocalPlayerPosition(deltaTime);

            // Render
            this.render();

            requestAnimationFrame(loop);
        };

        requestAnimationFrame(loop);
    }

    /**
     * Update local player position every frame based on velocity for smooth 60fps movement
     */
    updateLocalPlayerPosition(deltaTime: number) {
        if (!this.myId) return;

        const player = this.simulation.players.get(this.myId);
        if (!player) return;

        // Update position based on current velocity
        player.x += player.vx * deltaTime;
        player.y += player.vy * deltaTime;

        // Keep player in bounds
        player.x = Math.max(PLAYER_SIZE / 2, Math.min(WORLD_WIDTH - PLAYER_SIZE / 2, player.x));
        player.y = Math.max(PLAYER_SIZE / 2, Math.min(WORLD_HEIGHT - PLAYER_SIZE / 2, player.y));
    }

    /**
     * Capture input state every frame (but don't apply it yet)
     */
    captureInput() {
        this.currentInput = this.getInput();
    }

    /**
     * Process input during simulation tick (called by onTick callback)
     * This ensures input is applied at fixed tick rate, not variable frame rate
     */
    handleTickInput() {
        if (!this.connected) return; // Don't process input if not connected

        const input = this.currentInput;

        // Apply input to local simulation for client-side prediction
        this.applyInput(input.dx, input.dy);

        // Create intent for this tick
        const intent: Intents.Move = {
            kind: Intents.Move.kind,
            tick: this.currentTick,
            dx: input.dx,
            dy: input.dy,
        };

        // Only track intents when there's actual movement (for reconciliation)
        // But we still need to SEND stop intents to the server
        if (input.dx !== 0 || input.dy !== 0) {
            this.reconciliator.trackIntent(this.currentTick, intent);
        }

        // Send intent to server when input changes (including stopping)
        // Use custom comparison for efficiency (compare dx/dy directly instead of JSON.stringify)
        if (this.network.hasIntentChanged(intent, (last, current) =>
            last.dx !== current.dx || last.dy !== current.dy
        )) {
            this.network.sendIntent(intent);
        }
    }
}

// Start the game when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    new GameClient();
});
