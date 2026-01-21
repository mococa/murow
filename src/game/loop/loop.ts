import { createDriver, DriverType, EventSystem, FixedTicker, LoopDriver } from "../../core";

/**
 * GameLoop class that manages the main game loop with tick events and optional rendering.
 * It supports both client and server types, emitting appropriate events for both.
 */
export class GameLoop<T extends DriverType = DriverType> {
    private driver: LoopDriver;
    /**
     * FixedTicker instance that handles tick timing and updates.
     */
    ticker: FixedTicker;
    /**
     * Event emitter system for the game loop, emitting various lifecycle events.
     */
    events: Events;
    /**
     * Current frames per second (FPS) measurement.
     */
    fps: number = 0;

    constructor(public options: GameLoopOptions & { type: T }) {
        const eventNames = [
            'pre-tick',
            'tick',
            'post-tick',
            'skip',
            'start',
            'stop',
            'toggle-pause',
        ];

        if (this.options.type === 'client') {
            eventNames.push('render');
        }

        this.events = new EventSystem({
            events: eventNames,
        }) as T extends 'client' ? EventSystem<ClientEvents> : EventSystem<ServerEvents>;

        this.ticker = new FixedTicker({
            rate: this.options.tickRate,
            onTick: (dt, tick = 0) => {
                this.events.emit('pre-tick', { deltaTime: dt, tick });
                this.options.onTick?.(dt, tick);
                this.events.emit('tick', { deltaTime: dt, tick });
                this.events.emit('post-tick', { deltaTime: dt, tick });
            },
            onTickSkipped: (skippedTicks) => {
                this.events.emit('skip', { ticks: skippedTicks });
            },
        });

        this.driver = createDriver(this.options.type as T, (dt: number) => {
            this.ticker.tick(dt);
            this.fps = 1 / dt;

            if (this.options.type === 'client') {
                this.options.onRender?.(dt, this.ticker.alpha);
                this.events.emit('render', {
                    deltaTime: dt,
                    alpha: this.ticker.alpha,
                });
            }
        });
    }

    /**
     * Pauses the game ticker and emits a 'toggle-pause' event.
     */
    pause() {
        this.driver.stop();
        this.events.emit('toggle-pause', {
            paused: true,
            lastToggledAt: Date.now(),
            lastToggleTick: this.ticker.tickCount,
        });
    }

    /**
     * Resumes the game ticker and emits a 'toggle-pause' event.
     */
    resume() {
        this.driver.start();
        this.events.emit('toggle-pause', {
            paused: false,
            lastToggledAt: Date.now(),
            lastToggleTick: this.ticker.tickCount,
        });
    }

    /**
     * Starts the game ticker and emits a 'start' event.
     */
    start() {
        this.driver.start();
        this.events.emit('start', { startedAt: Date.now() });
    }

    /**
     * Stops the game ticker and emits a 'stop' event.
     */
    stop() {
        this.driver.stop();
        this.events.emit('stop', { stoppedAt: Date.now() });
    }
}

interface GameLoopOptions {
    tickRate: number;
    type: DriverType;
    onTick?: (dt: number, tick: number) => void;
    onRender?: (dt: number, alpha: number) => void;
}

type BaseEvents = [
    ['start', {
        /**
         * Timestamp when the loop was started.
         */
        startedAt: number;
    }],
    ['pre-tick', {
        /**
         * Current tick number.
         */
        tick: number;
        /**
         * Delta time since the last tick.
         */
        deltaTime: number;
    }],
    ['tick', {
        /**
         * Current tick number.
         */
        tick: number;
        /**
         * Delta time since the last tick.
         */
        deltaTime: number;
    }],
    ['post-tick', {
        /**
        * Current tick number.
        */
        tick: number;
        /**
         * Delta time since the last tick.
         */
        deltaTime: number;
    }],
    ['skip', {
        /**
         * Number of ticks that were skipped.
         */
        ticks: number;
    }],
    ['stop', {
        /**
         * Timestamp when the loop was stopped.
         */
        stoppedAt: number;
    }],
    ['toggle-pause', {
        /**
         * Current paused state of the loop.
         */
        paused: boolean;
        /**
         * Timestamp when the pause state was last toggled.
         */
        lastToggledAt: number;
        /**
         * Tick number when the pause state was last toggled.
         */
        lastToggleTick: number;
    }],
];

type ClientEvents = [
    ...BaseEvents,
    ['render', { deltaTime: number, alpha: number; }],
];

type ServerEvents = BaseEvents;

type Events = EventSystem<ClientEvents | ServerEvents>;
