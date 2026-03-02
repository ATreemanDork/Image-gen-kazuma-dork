/**
 * Image-gen-kazuma-dork - SillyTavern Extension
 * ComfyUI integration for AI image generation
 * 
 * Entry point - imports modular architecture and initializes extension
 */

import { extension_settings, getContext } from '../../../extensions.js';
import {
    saveSettingsDebounced,
    generateQuietPrompt,
    eventSource,
    event_types,
    getRequestHeaders,
    appendMediaToMessage,
} from '../../../../script.js';
import * as core from './src/core.js';
import { debugLog, errorLog } from './src/logger.js';
import { initializeUI } from './src/ui.js';

async function waitForSettingsReady(maxWaitMs = 10000, intervalMs = 100) {
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
        if (extension_settings && typeof extension_settings === 'object') {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error('Timed out waiting for SillyTavern extension_settings initialization');
}

/**
 * Bootstrap state - prevents double initialization
 */
let bootstrapComplete = false;
let bootstrapInProgress = false;

/**
 * Extension initialization
 * Called by SillyTavern on extension load
 * Ensures single execution even if invoked multiple times
 */
async function bootstrapExtension() {
    // Prevent double initialization
    if (bootstrapComplete) {
        debugLog('Extension already initialized, skipping bootstrap');
        return;
    }

    if (bootstrapInProgress) {
        debugLog('Bootstrap already in progress, skipping duplicate call');
        return;
    }

    bootstrapInProgress = true;

    try {
        debugLog('Image-gen-kazuma-dork loading...');

        await waitForSettingsReady();

        core.initializeAPIs({
            extension_settings,
            getExtensionSettings: () => extension_settings,
            getContext,
            saveSettingsDebounced,
            eventSource,
            event_types,
            generateQuietPrompt,
            getRequestHeaders,
            appendMediaToMessage,
        });

        // Initialize the extension
        await core.initialize();

        await initializeUI();

        bootstrapComplete = true;
        console.log(`[Image-gen-kazuma-dork] Extension loaded successfully`);

    } catch (error) {
        bootstrapInProgress = false;
        errorLog('Failed to initialize extension:', error);
        console.error('[Image-gen-kazuma-dork] Initialization failed:', error);

        // Use sanitized error message for user-facing notification
        const userMessage = `Image-gen-kazuma-dork failed to load: ${error.message || 'Unknown error'}`;
        if (typeof toastr !== 'undefined') {
            toastr.error(userMessage, { timeOut: 10000 });
        }

        throw error; // Re-throw so errors are visible in console
    }
}

// Use jQuery ready if available, otherwise use DOMContentLoaded
if (typeof jQuery === 'function') {
    jQuery(async () => {
        try {
            await bootstrapExtension();
        } catch (error) {
            // Error already logged in bootstrapExtension
        }
    });
} else if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', async () => {
        try {
            await bootstrapExtension();
        } catch (error) {
            // Error already logged in bootstrapExtension
        }
    });
} else {
    // Fallback for non-browser environments
    (async () => {
        try {
            await bootstrapExtension();
        } catch (error) {
            // Error already logged in bootstrapExtension
        }
    })();
}
