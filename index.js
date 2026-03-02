/**
 * Image-gen-kazuma-dork - SillyTavern Extension
 * ComfyUI integration for AI image generation
 * 
 * Entry point - imports modular architecture and initializes extension
 */

import * as core from './src/core.js';
import { debugLog, errorLog } from './src/logger.js';

/**
 * Extension initialization
 * Called by SillyTavern on extension load
 */
(async function () {
    try {
        debugLog('Image-gen-kazuma-dork loading...');

        // Initialize the extension
        await core.initialize();

        console.log(`[Image-gen-kazuma-dork] Extension loaded successfully`);

    } catch (error) {
        errorLog('Failed to initialize extension:', error);
        console.error('[Image-gen-kazuma-dork] Initialization failed:', error);
        toastr.error('Image-gen-kazuma-dork extension failed to load. Check console for details.');
    }
})();
