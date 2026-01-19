import { ImmediateDriver, RafDriver } from "./drivers";

export interface LoopDriver {
    start(): void;
    stop(): void;
    loop(): void;
    update(dt: number): void;
}

export type DriverType = 'server' | 'client';

export function createDriver(type: DriverType, update: (dt: number) => void): LoopDriver {
    if (type === 'server') {
        return new ImmediateDriver(update);
    } else {
        return new RafDriver(update);
    }
}
