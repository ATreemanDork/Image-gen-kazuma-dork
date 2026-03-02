/**
 * Batch generation module
 * Handles queue-based batch image generation with cancellation support
 */

import { debugLog, errorLog, warnLog } from './logger.js';
import { generateImage } from './generation.js';
import { generateRandomSeed } from './utils.js';

/**
 * Batch queue state
 */
let batchQueue = [];
let batchCancelled = false;
let batchInProgress = false;

/**
 * Initialize batch queue with specified count
 * @param {number} count - Number of images to generate
 * @param {object} baseOptions - Base generation options
 * @returns {Array} Initialized batch queue
 */
export function initBatchQueue(count, baseOptions) {
    debugLog(`Initializing batch queue: ${count} images`);

    batchQueue = [];
    batchCancelled = false;
    batchInProgress = false;

    for (let i = 0; i < count; i++) {
        batchQueue.push({
            id: i + 1,
            options: {
                ...baseOptions,
                settings: {
                    ...baseOptions.settings,
                    // Randomize seed for variety
                    seed: generateRandomSeed()
                }
            },
            status: 'pending',
            result: null,
            error: null,
            startTime: null,
            endTime: null
        });
    }

    debugLog(`Batch queue initialized with ${count} items`);
    return batchQueue;
}

/**
 * Process batch queue
 * @param {Function} onProgress - Progress callback (current, total, stage, percent)
 * @param {Function} onComplete - Completion callback (results)
 * @param {Function} onItemComplete - Individual item completion callback (item)
 * @returns {Promise<Array>} Array of results
 */
export async function processBatchQueue(onProgress, onComplete, onItemComplete = null) {
    debugLog('Starting batch processing');

    if (batchInProgress) {
        warnLog('Batch already in progress');
        throw new Error('Batch generation already in progress');
    }

    batchInProgress = true;
    batchCancelled = false;
    const results = [];
    const total = batchQueue.length;

    try {
        for (let i = 0; i < batchQueue.length; i++) {
            // Check for cancellation
            if (batchCancelled) {
                debugLog('Batch cancelled by user');
                break;
            }

            const item = batchQueue[i];
            item.status = 'processing';
            item.startTime = Date.now();

            debugLog(`Processing batch item ${item.id}/${total}`);

            try {
                // Generate image with progress tracking
                item.result = await generateImage({
                    ...item.options,
                    onProgress: (stage, percent) => {
                        onProgress(i + 1, total, stage, percent);
                    }
                });

                item.status = 'complete';
                item.endTime = Date.now();
                results.push(item.result);

                debugLog(`Batch item ${item.id} complete (${item.endTime - item.startTime}ms)`);

                // Call item completion callback
                if (onItemComplete) {
                    onItemComplete(item);
                }

            } catch (error) {
                errorLog(`Batch item ${item.id} failed:`, error.message);
                item.status = 'failed';
                item.error = error.message;
                item.endTime = Date.now();

                // Continue with next item even on failure
                // User can decide whether to stop entire batch in onItemComplete
            }
        }

        debugLog(`Batch processing complete: ${results.length}/${total} successful`);

        // Call completion callback
        if (onComplete) {
            onComplete(results);
        }

        return results;

    } finally {
        batchInProgress = false;
    }
}

/**
 * Cancel batch processing
 * Sets flag to stop after current item completes
 */
export function cancelBatch() {
    if (!batchInProgress) {
        warnLog('No batch in progress to cancel');
        return;
    }

    debugLog('Batch cancellation requested');
    batchCancelled = true;
}

/**
 * Check if batch is currently processing
 * @returns {boolean} Whether batch is in progress
 */
export function isBatchInProgress() {
    return batchInProgress;
}

/**
 * Check if batch has been cancelled
 * @returns {boolean} Whether batch is cancelled
 */
export function isBatchCancelled() {
    return batchCancelled;
}

/**
 * Get current batch status
 * @returns {object} Status summary
 */
export function getBatchStatus() {
    const total = batchQueue.length;
    const pending = batchQueue.filter(i => i.status === 'pending').length;
    const processing = batchQueue.filter(i => i.status === 'processing').length;
    const complete = batchQueue.filter(i => i.status === 'complete').length;
    const failed = batchQueue.filter(i => i.status === 'failed').length;

    return {
        total,
        pending,
        processing,
        complete,
        failed,
        inProgress: batchInProgress,
        cancelled: batchCancelled
    };
}

/**
 * Get batch queue
 * @returns {Array} Current batch queue
 */
export function getBatchQueue() {
    return batchQueue;
}

/**
 * Get successful results from batch
 * @returns {Array} Array of successful results
 */
export function getBatchResults() {
    return batchQueue
        .filter(item => item.status === 'complete' && item.result)
        .map(item => item.result);
}

/**
 * Get failed items from batch
 * @returns {Array} Array of failed items with errors
 */
export function getBatchFailures() {
    return batchQueue
        .filter(item => item.status === 'failed')
        .map(item => ({
            id: item.id,
            error: item.error,
            options: item.options
        }));
}

/**
 * Clear batch queue
 */
export function clearBatchQueue() {
    const count = batchQueue.length;
    batchQueue = [];
    batchCancelled = false;
    batchInProgress = false;
    debugLog(`Batch queue cleared: ${count} items removed`);
}

/**
 * Get batch statistics
 * @returns {object} Batch stats including timing
 */
export function getBatchStats() {
    const completedItems = batchQueue.filter(i => i.status === 'complete' && i.startTime && i.endTime);
    const failedItems = batchQueue.filter(i => i.status === 'failed');

    const durations = completedItems.map(i => i.endTime - i.startTime);
    const avgDuration = durations.length > 0
        ? durations.reduce((sum, d) => sum + d, 0) / durations.length
        : 0;
    const minDuration = durations.length > 0 ? Math.min(...durations) : 0;
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;

    return {
        total: batchQueue.length,
        completed: completedItems.length,
        failed: failedItems.length,
        pending: batchQueue.filter(i => i.status === 'pending').length,
        avgDurationMs: Math.round(avgDuration),
        minDurationMs: minDuration,
        maxDurationMs: maxDuration,
        errors: failedItems.map(i => ({ id: i.id, error: i.error }))
    };
}

/**
 * Retry failed items in batch
 * @param {Function} onProgress - Progress callback
 * @param {Function} onComplete - Completion callback
 * @returns {Promise<Array>} Array of retry results
 */
export async function retryFailed(onProgress, onComplete) {
    const failedItems = batchQueue.filter(i => i.status === 'failed');

    if (failedItems.length === 0) {
        debugLog('No failed items to retry');
        return [];
    }

    debugLog(`Retrying ${failedItems.length} failed items`);

    // Reset failed items to pending
    failedItems.forEach(item => {
        item.status = 'pending';
        item.error = null;
        item.result = null;
        item.startTime = null;
        item.endTime = null;
    });

    // Create temporary queue with only failed items
    const originalQueue = batchQueue;
    batchQueue = failedItems;

    try {
        const results = await processBatchQueue(onProgress, onComplete);

        // Restore original queue
        batchQueue = originalQueue;

        return results;
    } catch (error) {
        batchQueue = originalQueue;
        throw error;
    }
}
