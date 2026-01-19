import { LoopDriver } from "../loop";

export class ImmediateDriver implements LoopDriver {
    constructor(public update: (dt: number) => void) { }

    private last = performance.now();
    private running = false;

    start() {
        this.running = true;
        this.last = performance.now();
        this.loop();
    }

    stop() {
        this.running = false;
    }

    loop = () => {
        if (!this.running) return;

        const now = performance.now();
        const dt = (now - this.last) / 1000;
        this.last = now;

        this.update(dt);
        setImmediate(this.loop);
    };
}
