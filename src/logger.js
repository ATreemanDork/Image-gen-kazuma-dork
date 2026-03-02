/**
 * Centralized logging utility for Image Gen Kazuma extension
 * Replaces scattered console.log statements with conditional debug logging
 */

const extensionName = "Image-gen-kazuma-dork";

let debugEnabled = false;

/**
 * Enable or disable debug logging
 * @param {boolean} enabled - Whether to enable debug logs
 */
export function setDebugMode(enabled) {
    debugEnabled = Boolean(enabled);
    if (debugEnabled) {
        console.log(`[${extensionName}] Debug mode enabled`);
    }
}

/**
 * Log debug messages (only shown when debug mode is enabled)
 * @param {...any} args - Arguments to log
 */
export function debugLog(...args) {
    if (debugEnabled) {
        console.log(`[${extensionName}]`, ...args);
    }
}

/**
 * Log error messages (always shown)
 * @param {...any} args - Arguments to log
 */
export function errorLog(...args) {
    console.error(`[${extensionName}]`, ...args);
}

/**
 * Log warning messages (always shown)
 * @param {...any} args - Arguments to log
 */
export function warnLog(...args) {
    console.warn(`[${extensionName}]`, ...args);
}

/**
 * Log info messages (always shown)
 * @param {...any} args - Arguments to log
 */
export function infoLog(...args) {
    console.info(`[${extensionName}]`, ...args);
}

/**
 * Get current debug mode state
 * @returns {boolean} Whether debug mode is enabled
 */
export function isDebugEnabled() {
    return debugEnabled;
}
