/**
 * ComfyUI API communication layer
 * All network requests to ComfyUI server with timeout and error handling
 */

import { CONSTANTS } from './constants.js';
import { debugLog, errorLog } from './logger.js';
import { validateComfyURL, getDetailedErrorMessage } from './utils.js';

/**
 * Fetch with timeout using AbortController
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Response>} Fetch response
 * @throws {Error} On timeout or network error
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = CONSTANTS.FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        // Validate URL before fetch
        const validatedUrl = validateComfyURL(url);

        const response = await fetch(validatedUrl, {
            ...options,
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);

        // Categorize error for user-friendly message
        const detailedError = getDetailedErrorMessage(error, { url, ...options });
        throw new Error(detailedError);
    }
}

/**
 * Test connection to ComfyUI server
 * @param {string} baseUrl - ComfyUI server base URL
 * @returns {Promise<object>} System stats from server
 * @throws {Error} If connection fails
 */
export async function testConnection(baseUrl) {
    debugLog(`Testing connection to: ${baseUrl}`);

    try {
        const response = await fetchWithTimeout(`${baseUrl}/system_stats`);

        if (!response.ok) {
            throw new Error(`Server returned status ${response.status}`);
        }

        const data = await response.json();
        debugLog('Connection test successful:', data);
        return data;
    } catch (error) {
        errorLog('Connection test failed:', error.message);
        throw error;
    }
}

/**
 * Get list of available checkpoint models from ComfyUI
 * @param {string} baseUrl - ComfyUI server base URL
 * @returns {Promise<string[]>} Array of model names
 */
export async function getModels(baseUrl) {
    debugLog('Fetching model list');

    try {
        const response = await fetchWithTimeout(`${baseUrl}/object_info`);

        if (!response.ok) {
            throw new Error(`Failed to fetch models: ${response.status}`);
        }

        const data = await response.json();

        // Extract checkpoint loader models
        const models = data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];

        debugLog(`Found ${models.length} models`);
        return models;
    } catch (error) {
        errorLog('Failed to fetch models:', error.message);
        return [];
    }
}

/**
 * Get list of available samplers from ComfyUI
 * @param {string} baseUrl - ComfyUI server base URL
 * @returns {Promise<string[]>} Array of sampler names
 */
export async function getSamplers(baseUrl) {
    debugLog('Fetching sampler list');

    try {
        const response = await fetchWithTimeout(`${baseUrl}/object_info`);

        if (!response.ok) {
            throw new Error(`Failed to fetch samplers: ${response.status}`);
        }

        const data = await response.json();

        // Extract KSampler samplers
        const samplers = data.KSampler?.input?.required?.sampler_name?.[0] || [];

        debugLog(`Found ${samplers.length} samplers`);
        return samplers;
    } catch (error) {
        errorLog('Failed to fetch samplers:', error.message);
        return [];
    }
}

/**
 * Get list of available schedulers from ComfyUI
 * @param {string} baseUrl - ComfyUI server base URL
 * @returns {Promise<string[]>} Array of scheduler names
 */
export async function getSchedulers(baseUrl) {
    debugLog('Fetching scheduler list');

    try {
        const response = await fetchWithTimeout(`${baseUrl}/object_info`);

        if (!response.ok) {
            throw new Error(`Failed to fetch schedulers: ${response.status}`);
        }

        const data = await response.json();

        // Extract KSampler schedulers
        const schedulers = data.KSampler?.input?.required?.scheduler?.[0] || [];

        debugLog(`Found ${schedulers.length} schedulers`);
        return schedulers;
    } catch (error) {
        errorLog('Failed to fetch schedulers:', error.message);
        return [];
    }
}

/**
 * Submit workflow to ComfyUI for generation
 * @param {string} baseUrl - ComfyUI server base URL
 * @param {object} workflow - ComfyUI workflow JSON
 * @returns {Promise<object>} Response with prompt_id
 * @throws {Error} If submission fails
 */
export async function submitWorkflow(baseUrl, workflow) {
    debugLog('Submitting workflow to ComfyUI');

    try {
        const response = await fetchWithTimeout(`${baseUrl}/prompt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prompt: workflow })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Submit failed (${response.status}): ${errorText}`);
        }

        const data = await response.json();

        if (!data.prompt_id) {
            throw new Error('Server response missing prompt_id');
        }

        debugLog(`Workflow submitted successfully. Prompt ID: ${data.prompt_id}`);
        return data;
    } catch (error) {
        errorLog('Workflow submission failed:', error.message);
        throw error;
    }
}

/**
 * Poll generation status from ComfyUI
 * @param {string} baseUrl - ComfyUI server base URL
 * @param {string} promptId - Prompt ID to check
 * @returns {Promise<object>} Generation status/history
 */
export async function pollGenerationStatus(baseUrl, promptId) {
    debugLog(`Polling status for prompt: ${promptId}`);

    try {
        const response = await fetchWithTimeout(`${baseUrl}/history/${promptId}`);

        if (!response.ok) {
            throw new Error(`Status check failed: ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        errorLog('Status poll failed:', error.message);
        throw error;
    }
}

/**
 * Download generated image from ComfyUI
 * @param {string} url - Full image URL
 * @returns {Promise<Blob>} Image as blob
 * @throws {Error} If download fails
 */
export async function downloadImage(url) {
    debugLog(`Downloading image: ${url}`);

    try {
        const response = await fetchWithTimeout(url);

        if (!response.ok) {
            throw new Error(`Download failed: ${response.status}`);
        }

        const blob = await response.blob();
        debugLog(`Image downloaded: ${blob.size} bytes`);
        return blob;
    } catch (error) {
        errorLog('Image download failed:', error.message);
        throw error;
    }
}

/**
 * Get queue status from ComfyUI
 * @param {string} baseUrl - ComfyUI server base URL
 * @returns {Promise<object>} Queue status
 */
export async function getQueueStatus(baseUrl) {
    debugLog('Fetching queue status');

    try {
        const response = await fetchWithTimeout(`${baseUrl}/queue`);

        if (!response.ok) {
            throw new Error(`Queue status failed: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        errorLog('Failed to fetch queue status:', error.message);
        throw error;
    }
}

/**
 * Cancel/interrupt current generation
 * @param {string} baseUrl - ComfyUI server base URL
 * @returns {Promise<void>}
 */
export async function interruptGeneration(baseUrl) {
    debugLog('Interrupting generation');

    try {
        const response = await fetchWithTimeout(`${baseUrl}/interrupt`, {
            method: 'POST'
        });

        if (!response.ok) {
            throw new Error(`Interrupt failed: ${response.status}`);
        }

        debugLog('Generation interrupted successfully');
    } catch (error) {
        errorLog('Failed to interrupt generation:', error.message);
        throw error;
    }
}
