/**
 * Runtime state module
 * Holds ephemeral state that should NOT be persisted to settings
 * Pattern adapted from rpg-companion best practices
 */

import { debugLog } from './logger.js';

/**
 * Runtime state (volatile, not serialized)
 */
export const runtimeState = {
    // UI state
    panelRendered: false,
    settingsPanelRendered: false,

    // Generation tracking
    generationInProgress: false,
    lastGenerationTime: null,
    totalGenerations: 0,
    averageGenerationTime: 0,
    generationTimes: [], // Array of recent generation times (max 10)

    // Batch generation tracking
    batchInProgress: false,
    batchCurrentIndex: 0,
    batchTotal: 0,
    batchResults: [],

    // Cache statistics
    cacheHits: 0,
    cacheMisses: 0,

    // Connection status
    comfyConnectionTested: false,
    comfyConnectionStatus: null, // 'connected', 'failed', or null
    lastConnectionTest: null,

    // Loaded resources lists (runtime only)
    availableModels: [],
    availableSamplers: [],
    availableLoras: [],
    availableWorkflows: [],
};

/**
 * Update generation statistics
 * @param {number} generationTimeMs - Generation time in milliseconds
 */
export function updateGenerationStats(generationTimeMs) {
    runtimeState.lastGenerationTime = generationTimeMs;
    runtimeState.totalGenerations++;

    // Keep last 10 generation times for rolling average
    runtimeState.generationTimes.push(generationTimeMs);
    if (runtimeState.generationTimes.length > 10) {
        runtimeState.generationTimes.shift();
    }

    // Calculate average
    const sum = runtimeState.generationTimes.reduce((acc, time) => acc + time, 0);
    runtimeState.averageGenerationTime = Math.round(sum / runtimeState.generationTimes.length);

    debugLog(`Generation stats updated: ${generationTimeMs}ms (avg: ${runtimeState.averageGenerationTime}ms, total: ${runtimeState.totalGenerations})`);
}

/**
 * Update batch generation progress
 * @param {number} current - Current image index
 * @param {number} total - Total images to generate
 */
export function updateBatchProgress(current, total) {
    runtimeState.batchCurrentIndex = current;
    runtimeState.batchTotal = total;
    runtimeState.batchInProgress = current < total;

    debugLog(`Batch progress: ${current}/${total}`);
}

/**
 * Add batch result
 * @param {string} result - Generation result (base64 or URL)
 */
export function addBatchResult(result) {
    runtimeState.batchResults.push(result);
    debugLog(`Batch result added (${runtimeState.batchResults.length}/${runtimeState.batchTotal})`);
}

/**
 * Clear batch state
 */
export function clearBatchState() {
    runtimeState.batchInProgress = false;
    runtimeState.batchCurrentIndex = 0;
    runtimeState.batchTotal = 0;
    runtimeState.batchResults = [];
    debugLog('Batch state cleared');
}

/**
 * Update cache statistics
 * @param {boolean} hit - Whether it was a cache hit
 */
export function updateCacheStats(hit) {
    if (hit) {
        runtimeState.cacheHits++;
    } else {
        runtimeState.cacheMisses++;
    }

    const totalCacheRequests = runtimeState.cacheHits + runtimeState.cacheMisses;
    const hitRate = totalCacheRequests > 0
        ? Math.round((runtimeState.cacheHits / totalCacheRequests) * 100)
        : 0;

    debugLog(`Cache ${hit ? 'hit' : 'miss'} (hit rate: ${hitRate}%)`);
}

/**
 * Update connection status
 * @param {boolean} success - Whether connection test succeeded
 */
export function updateConnectionStatus(success) {
    runtimeState.comfyConnectionTested = true;
    runtimeState.comfyConnectionStatus = success ? 'connected' : 'failed';
    runtimeState.lastConnectionTest = Date.now();

    debugLog(`ComfyUI connection status: ${runtimeState.comfyConnectionStatus}`);
}

/**
 * Update available resources
 * @param {object} resources - Object with models, samplers, loras, workflows arrays
 */
export function updateAvailableResources(resources) {
    if (resources.models) {
        runtimeState.availableModels = resources.models;
        debugLog(`Available models updated: ${resources.models.length}`);
    }

    if (resources.samplers) {
        runtimeState.availableSamplers = resources.samplers;
        debugLog(`Available samplers updated: ${resources.samplers.length}`);
    }

    if (resources.loras) {
        runtimeState.availableLoras = resources.loras;
        debugLog(`Available LoRAs updated: ${resources.loras.length}`);
    }

    if (resources.workflows) {
        runtimeState.availableWorkflows = resources.workflows;
        debugLog(`Available workflows updated: ${resources.workflows.length}`);
    }
}

/**
 * Get runtime state snapshot (for debugging/diagnostics)
 * @returns {object} Snapshot of current runtime state
 */
export function getStateSnapshot() {
    return {
        panelRendered: runtimeState.panelRendered,
        generationInProgress: runtimeState.generationInProgress,
        batchInProgress: runtimeState.batchInProgress,
        totalGenerations: runtimeState.totalGenerations,
        averageGenerationTime: runtimeState.averageGenerationTime,
        cacheHitRate: runtimeState.cacheHits + runtimeState.cacheMisses > 0
            ? Math.round((runtimeState.cacheHits / (runtimeState.cacheHits + runtimeState.cacheMisses)) * 100)
            : 0,
        comfyConnectionStatus: runtimeState.comfyConnectionStatus,
        resourcesLoaded: {
            models: runtimeState.availableModels.length,
            samplers: runtimeState.availableSamplers.length,
            loras: runtimeState.availableLoras.length,
            workflows: runtimeState.availableWorkflows.length
        }
    };
}

/**
 * Reset all runtime state (useful for testing or cleanup)
 */
export function resetRuntimeState() {
    runtimeState.panelRendered = false;
    runtimeState.settingsPanelRendered = false;
    runtimeState.generationInProgress = false;
    runtimeState.lastGenerationTime = null;
    runtimeState.totalGenerations = 0;
    runtimeState.averageGenerationTime = 0;
    runtimeState.generationTimes = [];
    runtimeState.batchInProgress = false;
    runtimeState.batchCurrentIndex = 0;
    runtimeState.batchTotal = 0;
    runtimeState.batchResults = [];
    runtimeState.cacheHits = 0;
    runtimeState.cacheMisses = 0;
    runtimeState.comfyConnectionTested = false;
    runtimeState.comfyConnectionStatus = null;
    runtimeState.lastConnectionTest = null;
    runtimeState.availableModels = [];
    runtimeState.availableSamplers = [];
    runtimeState.availableLoras = [];
    runtimeState.availableWorkflows = [];

    debugLog('Runtime state reset');
}
