import { createDriver, DriverType, EventSystem, FixedTicker, LoopDriver } from "../../core";
import { InputManager, BrowserInputSource } from "../../core/input";

/**
 * GameLoop class that manages the main game loop with tick events and optional rendering.
 * It supports both client and server types, emitting appropriate events for both.
 */
export class GameLoop<T extends DriverType = DriverType> {
    private _driver: LoopDriver;
    private _input: InputManager;

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
    /**
     * Current status of the game loop: 'running', 'paused', or 'stopped'.
     */
    status: 'running' | 'paused' | 'stopped' = 'stopped';

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

        this._input = new InputManager();

        this.events = new EventSystem({
            events: eventNames,
        }) as T extends 'client' ? EventSystem<ClientEvents> : EventSystem<ServerEvents>;

        this.ticker = new FixedTicker({
            rate: this.options.tickRate,
            onTick: (dt, tick = 0) => {
                const input = this._input.snapshot();

                this.events.emit('pre-tick', { deltaTime: dt, tick, input });
                this.options.onTick?.(dt, tick, input);
                this.events.emit('tick', { deltaTime: dt, tick, input });
                this.events.emit('post-tick', { deltaTime: dt, tick, input });
            },
            onTickSkipped: (skippedTicks) => {
                this.events.emit('skip', { ticks: skippedTicks });
            },
        });

        this._driver = createDriver(this.options.type as T, (dt: number) => {
            this.ticker.tick(dt);
            this.fps = 1 / dt;

            if (this.options.type === 'client') {
                this.options.onRender?.(dt, this.ticker.alpha, this._input.peek());
                this.events.emit('render', {
                    deltaTime: dt,
                    alpha: this.ticker.alpha,
                    input: this._input.peek(),
                });
            }
        });
    }

    /**
     * Pauses the game ticker and emits a 'toggle-pause' event.
     */
    pause() {
        this._driver.stop();
        this.status = 'paused';
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
        this._driver.start();
        this.status = 'running';
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
        this._driver.start();
        this.status = 'running';
        this.events.emit('start', { startedAt: Date.now() });

        if (this.options.type === 'client') {
            const source = new BrowserInputSource(document, document.body);
            this._input.listen(source);
        }
    }

    /**
     * Stops the game ticker and emits a 'stop' event.
     */
    stop() {
        this._driver.stop();
        this.ticker.resetTickCount();
        this.status = 'stopped';
        this.events.emit('stop', { stoppedAt: Date.now() });

        if (this.options.type === 'client') {
            this._input.unlisten();
        }
    }
}

interface GameLoopOptions {
    tickRate: number;
    type: DriverType;
    onTick?: (dt: number, tick: number, input: ReturnType<InputManager['snapshot']>) => void;
    onRender?: (dt: number, alpha: number, input: ReturnType<InputManager['snapshot']>) => void;
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
        /**
         * Input snapshot at the start of the tick.
         * 
         * **Only available in client loops.**
         */
        input: ReturnType<InputManager['snapshot']>;
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
        /**
         * Input snapshot at the start of the tick.
         * 
         * **Only available in client loops.**
         */
        input: ReturnType<InputManager['snapshot']>;
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
        /**
         * Input snapshot at the start of the tick.
         * 
         * **Only available in client loops.**
         */
        input: ReturnType<InputManager['snapshot']>;
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
    ['render', {
        deltaTime: number,
        alpha: number;
        input: ReturnType<InputManager['snapshot']>;
    }],
];

type ServerEvents = BaseEvents;

type Events = EventSystem<ClientEvents | ServerEvents>;
