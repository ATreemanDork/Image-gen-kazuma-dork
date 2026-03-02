/**
 * Utility functions for validation, sanitization, and error handling
 * Enhanced with security best practices
 */

import { CONSTANTS, VALIDATION_RANGES } from './constants.js';
import { warnLog, errorLog } from './logger.js';

/**
 * Sanitizes workflow filenames to prevent path traversal and injection attacks
 * @param {string} filename - The filename to sanitize
 * @returns {string} Sanitized filename with .json extension
 * @throws {Error} If filename is invalid
 */
export function sanitizeWorkflowFilename(filename) {
    if (!filename || typeof filename !== 'string') {
        throw new Error('Workflow filename must be a non-empty string');
    }

    // Remove leading/trailing whitespace
    let cleaned = filename.trim();

    // Unicode normalization to prevent bypass attempts
    cleaned = cleaned.normalize('NFC');

    // Check for null bytes
    if (cleaned.includes('\0')) {
        throw new Error('Filename contains null bytes');
    }

    // Ensure .json extension
    const withExt = cleaned.toLowerCase().endsWith('.json') ? cleaned : `${cleaned}.json`;

    // Check length
    if (withExt.length > CONSTANTS.FILENAME_MAX_LENGTH) {
        throw new Error(`Filename too long: maximum ${CONSTANTS.FILENAME_MAX_LENGTH} characters`);
    }

    // Whitelist validation: only alphanumeric, dash, underscore, and .json
    if (!CONSTANTS.FILENAME_ALLOWED_PATTERN.test(withExt)) {
        throw new Error(`Invalid filename: "${withExt}". Only alphanumeric, dash, underscore, and .json allowed`);
    }

    // Explicit path traversal checks (belt and suspenders)
    if (withExt.includes('..') || withExt.includes('/') || withExt.includes('\\')) {
        throw new Error('Filename contains invalid path characters');
    }

    return withExt;
}

/**
 * Validates and clamps numeric values to expected ranges
 * @param {any} value - Value to validate
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value
 * @param {number} defaultValue - Value to use if input is invalid
 * @returns {number} Validated and clamped value
 */
export function validateAndClampNumber(value, min, max, defaultValue = min) {
    const num = parseFloat(value);

    if (isNaN(num)) {
        warnLog(`Invalid number: "${value}", using default ${defaultValue}`);
        return defaultValue;
    }

    if (num < min) {
        warnLog(`Value ${num} below minimum ${min}, clamping to ${min}`);
        return min;
    }

    if (num > max) {
        warnLog(`Value ${num} exceeds maximum ${max}, clamping to ${max}`);
        return max;
    }

    return num;
}

/**
 * Validates ComfyUI URL to prevent protocol injection
 * @param {string} url - The URL to validate
 * @returns {string} Validated URL
 * @throws {Error} If URL is invalid or uses disallowed protocol
 */
export function validateComfyURL(url) {
    if (!url || typeof url !== 'string') {
        throw new Error('ComfyUI URL must be a non-empty string');
    }

    try {
        const parsed = new URL(url);

        // Whitelist only HTTP and HTTPS protocols
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error(`Only HTTP and HTTPS protocols are allowed. Got: ${parsed.protocol}`);
        }

        return parsed.toString();
    } catch (error) {
        if (error.message.includes('Invalid URL')) {
            throw new Error(`Invalid ComfyUI URL: ${url}. Must be a valid HTTP/HTTPS URL.`);
        }
        throw error;
    }
}

/**
 * Validates workflow JSON structure before sending to ComfyUI
 * @param {object} workflow - The workflow object to validate
 * @returns {object} The validated workflow
 * @throws {Error} If workflow is invalid
 */
export function validateWorkflowJSON(workflow) {
    if (!workflow || typeof workflow !== 'object') {
        throw new Error('Workflow must be a valid JSON object');
    }

    // Check if it has at least one node
    const nodeIds = Object.keys(workflow);
    if (nodeIds.length === 0) {
        throw new Error('Workflow is empty - must contain at least one node');
    }

    // Validate node structure
    let hasValidNode = false;
    for (const nodeId of nodeIds) {
        const node = workflow[nodeId];

        if (!node || typeof node !== 'object') {
            throw new Error(`Node "${nodeId}" is not a valid object`);
        }

        // Each node should have a class_type at minimum
        if (typeof node.class_type === 'string' && node.class_type.length > 0) {
            hasValidNode = true;
        }
    }

    if (!hasValidNode) {
        throw new Error('Workflow contains no valid nodes with class_type property');
    }

    return workflow;
}

/**
 * Validates entire settings object on import
 * Clamps all numeric values to valid ranges
 * @param {object} settings - Settings object to validate
 * @returns {object} Validated settings object
 */
export function validateSettings(settings) {
    if (!settings || typeof settings !== 'object') {
        throw new Error('Settings must be a valid object');
    }

    const validated = { ...settings };

    // Validate numeric fields using defined ranges
    for (const [field, range] of Object.entries(VALIDATION_RANGES)) {
        if (field in validated) {
            validated[field] = validateAndClampNumber(
                validated[field],
                range.min,
                range.max,
                range.default
            );
        }
    }

    // Validate LoRA weights separately (multiple fields)
    for (let i = 1; i <= 4; i++) {
        const weightKey = `lora${i}Weight`;
        if (weightKey in validated) {
            const range = VALIDATION_RANGES.loraWeight;
            validated[weightKey] = validateAndClampNumber(
                validated[weightKey],
                range.min,
                range.max,
                range.default
            );
        }
    }

    // Validate ComfyUI URL if present
    if (validated.comfyUrl) {
        try {
            validated.comfyUrl = validateComfyURL(validated.comfyUrl);
        } catch (error) {
            warnLog(`Invalid ComfyUI URL in settings: ${error.message}`);
            // Keep original value but warn
        }
    }

    return validated;
}

/**
 * Checks if chat context has messages
 * @param {object} context - SillyTavern context object
 * @throws {Error} If chat is empty or invalid
 */
export function checkChatBounds(context) {
    if (!context) {
        throw new Error('No context available');
    }

    if (!context.chat || !Array.isArray(context.chat)) {
        throw new Error('Chat data is not available');
    }

    if (context.chat.length === 0) {
        throw new Error('Chat is empty - send at least one message before generating an image');
    }
}

/**
 * Sanitizes error messages to prevent XSS in toastr notifications
 * @param {string} message - Error message to sanitize
 * @returns {string} Sanitized message
 */
export function sanitizeErrorMessage(message) {
    if (typeof message !== 'string') {
        return String(message);
    }

    // Remove HTML tags
    let sanitized = message.replace(/<[^>]*>/g, '');

    // Remove script content
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    // Escape common XSS patterns
    sanitized = sanitized
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');

    // Truncate very long messages
    if (sanitized.length > 500) {
        sanitized = sanitized.substring(0, 497) + '...';
    }

    return sanitized;
}

/**
 * Categorizes fetch/ComfyUI errors into actionable error messages
 * @param {Error} error - The error object
 * @param {object} context - Context object { response, url, method }
 * @returns {string} Detailed error message for user display
 */
export function getDetailedErrorMessage(error, context = {}) {
    const { response, url = '', method = 'POST' } = context;
    const errorMsg = error?.message || String(error);

    // Timeout errors
    if (errorMsg.includes('timeout') || errorMsg.includes('Timeout') || errorMsg.includes('abort')) {
        return `⏱️ Request timed out. ComfyUI server at ${url} did not respond. Check: 1) Server is running, 2) URL is correct, 3) Network connection.`;
    }

    // CORS/Network errors
    if (errorMsg.includes('CORS') || errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError') || errorMsg.includes('Network request failed')) {
        return `🔗 Network/CORS error. ComfyUI server at ${url} is unreachable or blocking requests. Check: 1) URL is correct (include http://), 2) Server started with --enable-cors-header flag, 3) Your internet connection.`;
    }

    // Permission/Auth errors (403, 401)
    if (response?.status === 403) {
        return `🔐 Permission denied (403). ComfyUI server rejected request. Check: 1) API key/credentials, 2) Server authentication settings, 3) User permissions.`;
    }
    if (response?.status === 401) {
        return `🔐 Unauthorized (401). ComfyUI server requires authentication. Check: 1) API key in settings, 2) Token expiration, 3) Server auth configuration.`;
    }

    // Server errors (5xx)
    if (response?.status >= 500) {
        return `⚠️ ComfyUI server error (${response.status}). Server encountered an internal error. Check: 1) Server logs, 2) ComfyUI version compatibility, 3) Available disk space.`;
    }

    // Bad request (400, 422)
    if (response?.status === 400 || response?.status === 422) {
        return `❌ Invalid request (${response.status}). Check: 1) Workflow JSON is valid, 2) All required fields present, 3) Model/LoRA names exist on server.`;
    }

    // Not found (404)
    if (response?.status === 404) {
        return `🔍 Not found (404). Check: 1) ComfyUI server is accessible at ${url}, 2) Workflow file exists, 3) API endpoint is correct.`;
    }

    // Generic fallback with sanitization
    return `❌ Generation failed: ${sanitizeErrorMessage(errorMsg)}. Check server health and try again.`;
}

/**
 * Safely parse JSON with error handling
 * @param {string} jsonString - JSON string to parse
 * @param {string} context - Context description for error messages
 * @returns {object} Parsed JSON object
 * @throws {Error} If JSON is invalid
 */
export function safeJSONParse(jsonString, context = 'JSON') {
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        throw new Error(`Failed to parse ${context}: ${error.message}`);
    }
}

/**
 * Deep clone an object using JSON serialization
 * @param {object} obj - Object to clone
 * @returns {object} Cloned object
 */
export function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Generate a random seed for image generation
 * @returns {number} Random integer between 0 and 999999999
 */
export function generateRandomSeed() {
    return Math.floor(Math.random() * 1000000000);
}

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string (e.g., "1.5 MB")
 */
export function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
