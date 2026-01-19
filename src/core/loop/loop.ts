import { ImmediateDriver, RafDriver } from "./drivers";

/**
 * Interface for game loop drivers that handle frame updates.
 * Drivers are responsible for scheduling and executing the game loop
 * at the appropriate rate for their environment (client or server).
 */
export interface LoopDriver {
    /** Starts the game loop */
    start(): void;
    /** Stops the game loop */
    stop(): void;
    /** Internal loop iteration method */
    loop(): void;
    /** Update callback invoked each frame with delta time in seconds */
    update(dt: number): void;
}

/**
 * Type of driver to use for the game loop.
 * - `'server'`: Uses setImmediate for Node.js environments (runs as fast as possible)
 * - `'client'`: Uses requestAnimationFrame for browser environments (syncs with display refresh rate)
 */
export type DriverType = 'server' | 'client';

/**
 * Factory function to create a loop driver for the specified environment.
 *
 * @param type - The environment type ('server' for Node.js, 'client' for browser)
 * @param update - Callback function invoked each frame with delta time in seconds
 * @returns A configured LoopDriver instance ready to start
 *
 * @example
 * ```typescript
 * const driver = createDriver('client', (dt) => {
 *   console.log(`Frame took ${dt}s`);
 * });
 * driver.start();
 * ```
 */
export function createDriver(type: DriverType, update: (dt: number) => void): LoopDriver {
    if (type === 'server') {
        return new ImmediateDriver(update);
    } else {
        return new RafDriver(update);
    }
}
