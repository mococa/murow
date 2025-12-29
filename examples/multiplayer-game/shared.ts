import {
    FixedTicker,
    BinaryCodec,
    defineIntent,
    IntentRegistry,
    SnapshotRegistry,
    PooledCodec,
} from "../../src";

// Game constants
export const WORLD_WIDTH = 800;
export const WORLD_HEIGHT = 600;
export const PLAYER_SIZE = 20;
export const PLAYER_SPEED = 200;
export const TICK_RATE = 12;

export enum IntentKind {
    Move = 0x1,
}

export namespace Intents {
    export const Move = defineIntent({
        kind: IntentKind.Move,
        schema: {
            dx: BinaryCodec.f32,
            dy: BinaryCodec.f32,
        },
    });

    export type Move = typeof Move.type;
}

// Snapshot update types (use array directly, not wrapped in object)
export type GameStateUpdate = Array<{
    id: string;
    x: number;
    y: number;
    color: string;
}>;

export interface Player {
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    color: string;
}

export class Simulation {
    ticker: FixedTicker;
    players: Map<string, Player> = new Map();
    localPlayerId?: string; // Track which player is local (for client-side prediction)

    constructor({
        onTick,
        onTickAfter
    }: {
        onTick?: (deltaTime: number, tick: number) => void;
        onTickAfter?: (deltaTime: number, tick: number) => void;
    } = {}) {
        this.ticker = new FixedTicker({
            rate: TICK_RATE,
            onTick: (deltaTime, tick) => {
                // Let the callback run BEFORE the tick, so input can be applied first
                onTick?.(deltaTime, tick ?? 0);

                // Now process the tick with the updated input
                this.tick(deltaTime);

                // After tick callback (for sending snapshots, etc.)
                onTickAfter?.(deltaTime, tick ?? 0);
            },
        });
    }

    update(deltaTime: number): void {
        this.ticker.tick(deltaTime);
    }

    tick(deltaTime: number): void {
        // Update player positions based on their velocity
        for (const player of this.players.values()) {
            // Only update on server (no localPlayerId set), not on client
            // Client updates local player position per-frame for smooth movement
            if (!this.localPlayerId) {
                player.x += player.vx * deltaTime;
                player.y += player.vy * deltaTime;

                // Keep players in bounds
                player.x = Math.max(PLAYER_SIZE / 2, Math.min(WORLD_WIDTH - PLAYER_SIZE / 2, player.x));
                player.y = Math.max(PLAYER_SIZE / 2, Math.min(WORLD_HEIGHT - PLAYER_SIZE / 2, player.y));
            }
        }
    }

    spawn(id: string): Player {
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE'];
        const color = colors[Math.floor(Math.random() * colors.length)];

        const player: Player = {
            id,
            x: WORLD_WIDTH / 2,
            y: WORLD_HEIGHT / 2,
            vx: 0,
            vy: 0,
            color,
        };
        this.players.set(id, player);
        return player;
    }

    removePlayer(id: string): void {
        this.players.delete(id);
    }

    setPlayerVelocity(id: string, vx: number, vy: number): void {
        const player = this.players.get(id);
        if (player) {
            player.vx = vx;
            player.vy = vy;
        }
    }

    getGameState(): GameStateUpdate {
        return Array.from(this.players.values()).map(p => ({
            id: p.id,
            x: p.x,
            y: p.y,
            color: p.color,
        }));
    }
}

// Create intent registry (shared between client and server)
export function createIntentRegistry(): IntentRegistry {
    const registry = new IntentRegistry();
    registry.register(Intents.Move);

    return registry;
}

// Create snapshot registry for game state updates
export function createSnapshotRegistry(): SnapshotRegistry<GameStateUpdate> {
    const registry = new SnapshotRegistry<GameStateUpdate>();

    // Define the player snapshot schema
    const playerSchema = {
        id: BinaryCodec.string(64),
        x: BinaryCodec.f32,
        y: BinaryCodec.f32,
        color: BinaryCodec.string(16),
    };

    // Use PooledCodec.array() - it now works directly as a Codec!
    registry.register('gameState', PooledCodec.array(playerSchema));

    return registry;
}
