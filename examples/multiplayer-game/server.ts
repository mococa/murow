import { ServerNetwork } from "../../src/net/server";
import { BunWebSocketServerTransport } from "../../src/net/adapters/bun-websocket";
import {
    Simulation,
    createIntentRegistry,
    createSnapshotRegistry,
    Intents,
    type GameStateUpdate,
    PLAYER_SPEED,
} from "./shared";

const PORT = 3007;
const HTTP_PORT = 3008;

class GameServer {
    simulation: Simulation;
    network: ServerNetwork<any, GameStateUpdate>;
    currentTick = 0;
    pendingResponses = new Set<string>(); // Track peers that sent intents this tick
    lastSentSnapshots = new Map<string, GameStateUpdate>(); // Track last snapshot sent to each peer

    constructor() {
        this.simulation = new Simulation({
            onTick: (deltaTime, tick) => {
                this.currentTick = tick ?? 0;
                // Server doesn't need input before tick - velocities are set by intents
            },
            onTickAfter: () => {
                // Check each peer to see if their view of the game state changed
                // This happens AFTER the tick processes, so positions are up-to-date
                const gameState = this.simulation.getGameState();
                let peersToUpdate = 0;

                for (const peerId of this.network.getPeerIds()) {
                    const lastSnapshot = this.lastSentSnapshots.get(peerId);

                    // Check if this peer needs an update
                    let needsUpdate = !lastSnapshot; // First time

                    if (!needsUpdate && lastSnapshot) {
                        // Check if any player position changed (>0.01 units - very small threshold)
                        for (const currentPlayer of gameState) {
                            const lastPlayer = lastSnapshot.find(p => p.id === currentPlayer.id);

                            if (!lastPlayer) {
                                // New player joined
                                needsUpdate = true;
                                break;
                            }

                            // Check position difference (small threshold to catch early movement)
                            if (Math.abs(currentPlayer.x - lastPlayer.x) > 0.01 ||
                                Math.abs(currentPlayer.y - lastPlayer.y) > 0.01) {
                                needsUpdate = true;
                                break;
                            }
                        }

                        // Also check if any player left
                        if (!needsUpdate && lastSnapshot.length !== gameState.length) {
                            needsUpdate = true;
                        }
                    }

                    if (needsUpdate) {
                        peersToUpdate++;
                        // Send the last confirmed client tick from when they sent an intent
                        // The client will drop intents up to this tick during reconciliation
                        const confirmedClientTick = this.network.getConfirmedClientTick(peerId);
                        this.network.sendSnapshotToPeer(peerId, 'gameState', {
                            tick: confirmedClientTick, // Client tick, not server tick
                            updates: gameState,
                        });

                        // Clone the game state for this peer
                        this.lastSentSnapshots.set(peerId, JSON.parse(JSON.stringify(gameState)));
                    }
                }

                if (peersToUpdate > 0) {
                    console.log(`Server tick ${this.currentTick}: Sent snapshots to ${peersToUpdate}/${this.network.getPeerIds().length} peers`);
                }

                this.pendingResponses.clear();
            },
        });

        // Create transport
        const transport = BunWebSocketServerTransport.create(PORT);

        // Create network with intents and snapshots
        this.network = new ServerNetwork({
            transport,
            intentRegistry: createIntentRegistry(),
            createPeerSnapshotRegistry: createSnapshotRegistry,
            config: {
                debug: true,
                heartbeatInterval: 10000,  // Send heartbeat every 10 seconds
                heartbeatTimeout: 45000,   // Timeout after 45 seconds of no messages
            },
        });

        this.setupNetworkHandlers();
    }

    setupNetworkHandlers() {
        // Track which peers need responses this tick
        this.network.onAnyIntent((peerId) => {
            this.pendingResponses.add(peerId);
        });

        // Handle new player connections
        this.network.onConnection((peerId) => {
            console.log(`Player connected: ${peerId}`);
            this.simulation.spawn(peerId);

            // Send initial game state to the new player immediately
            const gameState = this.simulation.getGameState();
            this.network.sendSnapshotToPeer(peerId, 'gameState', {
                tick: 0, // No client ticks confirmed yet
                updates: gameState,
            });
        });

        // Handle player disconnections
        this.network.onDisconnection((peerId) => {
            console.log(`Player disconnected: ${peerId}`);
            this.simulation.removePlayer(peerId);
            this.lastSentSnapshots.delete(peerId);
            // No need to notify - they're gone
            // Note: ServerNetwork automatically cleans up lastProcessedClientTick
        });

        // Handle move intents
        this.network.onIntent(Intents.Move, (peerId, intent) => {
            console.log(`Intent received: peer=${peerId.substring(0, 8)}, clientTick=${intent.tick}, serverTick=${this.currentTick}, input=(${intent.dx},${intent.dy})`);

            // Note: ServerNetwork automatically tracks intent.tick for client-side prediction
            // Note: pendingResponses is handled by onAnyIntent above

            // Normalize and scale the input
            const length = Math.sqrt(intent.dx * intent.dx + intent.dy * intent.dy);
            if (length > 0) {
                const normalizedDx = (intent.dx / length) * PLAYER_SPEED;
                const normalizedDy = (intent.dy / length) * PLAYER_SPEED;
                this.simulation.setPlayerVelocity(peerId, normalizedDx, normalizedDy);
            } else {
                this.simulation.setPlayerVelocity(peerId, 0, 0);
            }
        });
    }

    start() {
        console.log(`Game server starting on port ${PORT}...`);
        console.log(`WebSocket endpoint: ws://mococa:${PORT}`);
        console.log(`HTTP server starting on port ${HTTP_PORT}...`);
        console.log(`Open http://mococa:${HTTP_PORT} in your browser to play!`);

        // Start HTTP server to serve the client
        this.startHttpServer();

        // Game loop - simulation.update() will trigger onTick callback
        let lastTime = performance.now();
        setInterval(() => {
            const currentTime = performance.now();
            const deltaTime = (currentTime - lastTime) / 1000;
            lastTime = currentTime;

            // Update simulation (this triggers onTick callback which handles responses)
            this.simulation.update(deltaTime);
        }, 1000 / this.simulation.ticker.rate);
    }

    startHttpServer() {
        Bun.serve({
            port: HTTP_PORT,
            async fetch(req) {
                const url = new URL(req.url);

                // Serve the client HTML file
                if (url.pathname === '/' || url.pathname === '/index.html') {
                    const file = Bun.file('./client.html');
                    return new Response(file, {
                        headers: {
                            'Content-Type': 'text/html',
                        },
                    });
                }

                // Serve the bundled client JS
                if (url.pathname === '/client.js') {
                    const file = Bun.file('./client.js');
                    return new Response(file, {
                        headers: {
                            'Content-Type': 'application/javascript',
                        },
                    });
                }

                return new Response('Not Found', { status: 404 });
            },
        });
    }
}

// Start the server
const server = new GameServer();
server.start();
