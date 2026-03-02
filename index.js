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

/**
 * Extension initialization
 * Called by SillyTavern on extension load
 */
(async function () {
    try {
        debugLog('Image-gen-kazuma-dork loading...');

        core.initializeAPIs({
            extension_settings,
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

        console.log(`[Image-gen-kazuma-dork] Extension loaded successfully`);

    } catch (error) {
        errorLog('Failed to initialize extension:', error);
        console.error('[Image-gen-kazuma-dork] Initialization failed:', error);
        toastr.error('Image-gen-kazuma-dork extension failed to load. Check console for details.');
    }
})();
