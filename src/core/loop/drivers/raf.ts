import { LoopDriver } from "../loop";

export class RafDriver implements LoopDriver {
    constructor(public update: (dt: number) => void) { }

    private last = performance.now();
    private running = false;
    private rafId: number | null = null;

    start() {
        this.running = true;
        this.last = performance.now();
        this.rafId = requestAnimationFrame(this.loop);
    }

    stop() {
        this.running = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    loop = () => {
        if (!this.running) return;

        const now = performance.now();
        const dt = (now - this.last) / 1000;
        this.last = now;

        this.update(dt);
        requestAnimationFrame(this.loop);
    };
}
