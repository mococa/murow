import type { Intent } from "../protocol/intent/intent";

/**
 * Common intent validation helpers
 */

/**
 * Validate that intent tick is not in the past (with tolerance for network lag)
 * @param currentTick Current server tick
 * @param tolerance Number of ticks to allow in the past (default: 10)
 */
export function validateTickNotTooOld(currentTick: number, tolerance: number = 10) {
	return <T extends Intent>(_peerId: string, intent: T): boolean => {
		return intent.tick >= currentTick - tolerance;
	};
}

/**
 * Validate that intent tick is not too far in the future
 * @param currentTick Current server tick
 * @param tolerance Number of ticks to allow in the future (default: 5)
 */
export function validateTickNotTooFuture(currentTick: number, tolerance: number = 5) {
	return <T extends Intent>(_peerId: string, intent: T): boolean => {
		return intent.tick <= currentTick + tolerance;
	};
}

/**
 * Validate intent tick is within acceptable range
 * @param currentTick Current server tick
 * @param pastTolerance Ticks allowed in past (default: 10)
 * @param futureTolerance Ticks allowed in future (default: 5)
 */
export function validateTickRange(
	currentTick: number,
	pastTolerance: number = 10,
	futureTolerance: number = 5
) {
	return <T extends Intent>(_peerId: string, intent: T): boolean => {
		return (
			intent.tick >= currentTick - pastTolerance &&
			intent.tick <= currentTick + futureTolerance
		);
	};
}

/**
 * Combine multiple validators with AND logic
 */
export function combineValidators<T extends Intent>(
	...validators: Array<(peerId: string, intent: T) => boolean>
) {
	return (peerId: string, intent: T): boolean => {
		for (const validator of validators) {
			if (!validator(peerId, intent)) {
				return false;
			}
		}
		return true;
	};
}

/**
 * Validate that a numeric field is within a range
 */
export function validateRange(field: string, min: number, max: number) {
	return <T extends Intent>(_peerId: string, intent: T): boolean => {
		const value = (intent as any)[field];
		if (typeof value !== "number") {
			return false;
		}
		return value >= min && value <= max;
	};
}

/**
 * Validate that a field exists and is of expected type
 */
export function validateFieldType(field: string, expectedType: string) {
	return <T extends Intent>(_peerId: string, intent: T): boolean => {
		const value = (intent as any)[field];
		return typeof value === expectedType;
	};
}
