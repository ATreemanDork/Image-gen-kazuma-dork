/**
 * Image generation module
 * Handles prompt building, avatar injection, and full generation orchestration
 */

import { CONSTANTS } from './constants.js';
import { debugLog, errorLog, warnLog } from './logger.js';
import { checkChatBounds, sanitizeErrorMessage, generateRandomSeed, formatBytes } from './utils.js';
import { getCachedResult, cacheResult } from './cache.js';
import { loadWorkflow, injectPlaceholders, buildPlaceholderValues } from './workflow.js';
import * as api from './api.js';

/**
 * Session-only avatar cache (not persisted to settings)
 * Key format: "char_{characterId}" or "persona"
 */
const sessionAvatarCache = new Map();

/**
 * Convert avatar image URL to base64 JPEG with size validation
 * @param {string} avatarUrl - Full URL to avatar image
 * @param {string} cacheKey - Identifier for cache
 * @returns {Promise<string>} Base64-encoded JPEG data URL
 * @throws {Error} If image fails to load or is too large
 */
async function getAvatarAsBase64(avatarUrl, cacheKey) {
    // Return cached version if available
    if (sessionAvatarCache.has(cacheKey)) {
        debugLog(`Using cached avatar: ${cacheKey}`);
        return sessionAvatarCache.get(cacheKey);
    }

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous"; // Handle CORS

        img.onload = () => {
            try {
                // Calculate resize dimensions if needed
                let width = img.width;
                let height = img.height;
                const maxSize = CONSTANTS.MAX_AVATAR_SIZE_PX;

                if (width > maxSize || height > maxSize) {
                    const scale = Math.min(maxSize / width, maxSize / height);
                    width = Math.floor(width * scale);
                    height = Math.floor(height * scale);
                    debugLog(`Resizing avatar from ${img.width}x${img.height} to ${width}x${height}`);
                }

                // Create canvas and draw resized image
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    throw new Error('Could not get canvas 2D context');
                }

                ctx.drawImage(img, 0, 0, width, height);

                // Convert to JPEG base64
                const base64Data = canvas.toDataURL('image/jpeg', CONSTANTS.AVATAR_JPEG_QUALITY);

                // Validate size
                const sizeBytes = Math.ceil((base64Data.length * 3) / 4);
                if (sizeBytes > CONSTANTS.MAX_AVATAR_SIZE_BYTES) {
                    throw new Error(
                        `Avatar too large after conversion: ${formatBytes(sizeBytes)} > ${formatBytes(CONSTANTS.MAX_AVATAR_SIZE_BYTES)}`
                    );
                }

                // Cache the result
                sessionAvatarCache.set(cacheKey, base64Data);
                debugLog(`Avatar cached: ${cacheKey} (${formatBytes(sizeBytes)}, ${width}x${height})`);

                resolve(base64Data);
            } catch (error) {
                reject(new Error(`Failed to convert avatar to JPEG: ${error.message}`));
            }
        };

        img.onerror = () => {
            reject(new Error(`Failed to load avatar image from ${avatarUrl}`));
        };

        img.src = avatarUrl;
    });
}

/**
 * Inject character and persona avatars into workflow
 * @param {object} workflow - Workflow to inject into
 * @param {object} context - SillyTavern context
 * @param {boolean} includeChar - Include character avatar
 * @param {boolean} includePersona - Include persona avatar
 * @returns {Promise<object>} Workflow with avatar placeholders injected
 */
async function injectAvatarPlaceholders(workflow, context, includeChar, includePersona) {
    if (!includeChar && !includePersona) {
        return workflow;
    }

    debugLog('Injecting avatar placeholders');
    const avatarValues = {};

    // Character avatar
    if (includeChar && context.characterId) {
        try {
            const charData = context.characters[context.characterId];
            const charName = charData?.name || `Character ${context.characterId}`;
            const charAvatar = context.getThumbnailUrl?.(context.characterId, charData?.avatar);

            if (charAvatar) {
                const base64Avatar = await getAvatarAsBase64(charAvatar, `char_${context.characterId}`);
                avatarValues.char_avatar = base64Avatar;
                debugLog(`Character avatar injected: ${charName}`);
            } else {
                warnLog(`No avatar URL found for character: ${charName}`);
                avatarValues.char_avatar = "";
            }
        } catch (error) {
            warnLog(`Failed to inject character avatar: ${error.message}`);
            avatarValues.char_avatar = "";
        }
    }

    // Persona avatar
    if (includePersona) {
        try {
            const personaUrl = window.power_user?.user_avatar;

            if (personaUrl) {
                const base64Avatar = await getAvatarAsBase64(personaUrl, 'persona');
                avatarValues.persona_avatar = base64Avatar;
                debugLog('Persona avatar injected');
            } else {
                warnLog('No persona avatar configured');
                avatarValues.persona_avatar = "";
            }
        } catch (error) {
            warnLog(`Failed to inject persona avatar: ${error.message}`);
            avatarValues.persona_avatar = "";
        }
    }

    // Inject avatar values into workflow
    return injectPlaceholders(workflow, avatarValues);
}

/**
 * Clear avatar cache
 */
export function clearAvatarCache() {
    const size = sessionAvatarCache.size;
    sessionAvatarCache.clear();
    debugLog(`Avatar cache cleared: ${size} entries`);
}

/**
 * Build prompt from chat context using LLM
 * @param {object} context - SillyTavern context
 * @param {object} settings - Extension settings
 * @param {Function} generateQuietPrompt - ST prompt generation function
 * @returns {Promise<string>} Generated positive prompt
 * @throws {Error} If prompt generation fails
 */
async function buildPromptFromChat(context, settings, generateQuietPrompt) {
    debugLog('Building prompt from chat context');

    // Check chat bounds
    checkChatBounds(context);

    // Get character info
    const charData = context.characters[context.characterId];
    const charName = charData?.name || 'Character';

    // Get last few messages for context
    const recentMessages = context.chat.slice(-3);
    const chatContext = recentMessages
        .map(msg => `${msg.name || 'Unknown'}: ${msg.mes}`)
        .join('\n');

    // Build system prompt based on settings
    let systemPrompt = `You are a prompt generator for image generation AI. Generate a detailed visual description based on the conversation context below.

Chat context:
${chatContext}

Character name: ${charName}

Generate a prompt in the following style:`;

    // Add style instructions
    switch (settings.promptStyle) {
        case 'illustrious':
            systemPrompt += '\nStyle: Use Booru-style tags (comma-separated, lowercase). Example: "1girl, blue eyes, long hair, school uniform, indoor, classroom"';
            break;
        case 'sdxl':
            systemPrompt += '\nStyle: Natural language prose. Describe the scene like a photographer would. Example: "A young woman with flowing auburn hair stands in a sunlit room, wearing casual clothes"';
            break;
        default:
            systemPrompt += '\nStyle: Clear, descriptive sentences focusing on visual details.';
    }

    // Add perspective instructions
    switch (settings.promptPerspective) {
        case 'pov':
            systemPrompt += '\nPerspective: First-person POV, viewer perspective.';
            break;
        case 'character':
            systemPrompt += '\nPerspective: Character portrait focus, centered composition.';
            break;
        default:
            systemPrompt += '\nPerspective: Cinematic scene with environmental context.';
    }

    // Add art style
    if (settings.promptArtStyle && settings.promptArtStyle !== 'realistic') {
        systemPrompt += `\nArt style: ${settings.promptArtStyle}`;
    }

    // Add extra instructions
    if (settings.promptExtra && settings.promptExtra.trim()) {
        systemPrompt += `\nAdditional requirements: ${settings.promptExtra.trim()}`;
    }

    systemPrompt += '\n\nGenerate only the image prompt, no explanations or additional text.';

    // Generate prompt using ST's LLM
    try {
        debugLog('Calling generateQuietPrompt with system prompt');
        const generated = await generateQuietPrompt(systemPrompt, false, false);
        const cleaned = generated.trim();

        if (!cleaned) {
            throw new Error('Generated prompt is empty');
        }

        debugLog(`Prompt generated successfully: ${cleaned.substring(0, 100)}...`);
        return cleaned;
    } catch (error) {
        errorLog('Prompt generation failed:', error);
        throw new Error(`Failed to generate prompt: ${sanitizeErrorMessage(error.message)}`);
    }
}

/**
 * Wait for ComfyUI generation to complete
 * @param {string} baseUrl - ComfyUI server URL
 * @param {string} promptId - Prompt ID to poll
 * @param {Function} onProgress - Progress callback (stage, percent)
 * @returns {Promise<string>} Image URL
 * @throws {Error} On timeout or failure
 */
async function waitForGeneration(baseUrl, promptId, onProgress) {
    debugLog(`Waiting for generation: ${promptId}`);

    let attempts = 0;
    const maxAttempts = CONSTANTS.POLL_MAX_ATTEMPTS;
    const interval = CONSTANTS.POLL_INTERVAL_MS;

    while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, interval));
        attempts++;

        const progress = 50 + Math.floor((attempts / maxAttempts) * 45);
        onProgress('Rendering', progress);

        try {
            const status = await api.pollGenerationStatus(baseUrl, promptId);

            // Check if this prompt ID has outputs
            if (status[promptId]?.outputs) {
                const outputs = Object.values(status[promptId].outputs);

                // Find first output with images
                for (const output of outputs) {
                    if (output.images && output.images.length > 0) {
                        const imgData = output.images[0];
                        const subfolder = imgData.subfolder ? `&subfolder=${imgData.subfolder}` : '';
                        const type = imgData.type || 'output';
                        const imageUrl = `${baseUrl}/view?filename=${imgData.filename}${subfolder}&type=${type}`;

                        debugLog(`Generation complete: ${imageUrl}`);
                        return imageUrl;
                    }
                }
            }
        } catch (error) {
            warnLog(`Status poll attempt ${attempts} failed: ${error.message}`);
            // Continue polling on error
        }
    }

    throw new Error(`Generation timeout after ${maxAttempts} attempts (~${Math.floor(maxAttempts * interval / 1000)} seconds). ComfyUI may be busy or stuck.`);
}

/**
 * Compress image for chat display
 * @param {Blob} imageBlob - Original image blob
 * @returns {Promise<string>} Compressed base64 data URL
 */
async function compressImage(imageBlob) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(imageBlob);

        img.onload = () => {
            try {
                let width = img.width;
                let height = img.height;
                const maxWidth = CONSTANTS.COMPRESSED_IMAGE_MAX_WIDTH;
                const maxHeight = CONSTANTS.COMPRESSED_IMAGE_MAX_HEIGHT;

                // Resize if needed
                if (width > maxWidth || height > maxHeight) {
                    const scale = Math.min(maxWidth / width, maxHeight / height);
                    width = Math.floor(width * scale);
                    height = Math.floor(height * scale);
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const compressed = canvas.toDataURL('image/jpeg', CONSTANTS.COMPRESSED_IMAGE_QUALITY);

                URL.revokeObjectURL(url);
                debugLog(`Image compressed: ${formatBytes(imageBlob.size)} → ${formatBytes(Math.ceil(compressed.length * 3 / 4))}`);
                resolve(compressed);
            } catch (error) {
                URL.revokeObjectURL(url);
                reject(error);
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image for compression'));
        };

        img.src = url;
    });
}

/**
 * Generate image - main orchestration function
 * @param {object} options - Generation options
 * @param {string} options.workflowName - Workflow filename
 * @param {object} options.settings - Extension settings
 * @param {object} options.context - SillyTavern context
 * @param {Function} options.getRequestHeaders - ST request headers function
 * @param {Function} options.generateQuietPrompt - ST prompt generation function
 * @param {Function} options.onProgress - Progress callback (stage, percent)
 * @param {boolean} options.useCache - Whether to use/update cache
 * @param {string} options.customPrompt - Optional custom prompt (skips LLM generation)
 * @returns {Promise<string>} Base64 image data URL
 * @throws {Error} On generation failure
 */
export async function generateImage(options) {
    const {
        workflowName,
        settings,
        context,
        getRequestHeaders,
        generateQuietPrompt,
        onProgress = () => { },
        useCache = true,
        customPrompt = null
    } = options;

    debugLog('Starting image generation');
    onProgress('Initializing', 5);

    try {
        // Step 1: Build or use custom prompt
        let positivePrompt;

        if (customPrompt) {
            positivePrompt = customPrompt;
            debugLog('Using custom prompt');
        } else {
            onProgress('Building prompt', 10);
            positivePrompt = await buildPromptFromChat(context, settings, generateQuietPrompt);
        }

        // Step 2: Check cache
        if (useCache) {
            const cacheKey = {
                workflowName,
                prompt: positivePrompt,
                negativePrompt: settings.negativePrompt,
                seed: settings.seed,
                steps: settings.steps,
                cfg: settings.cfg,
                model: settings.model,
                sampler: settings.sampler,
                width: settings.width,
                height: settings.height
            };

            const cached = getCachedResult(cacheKey);
            if (cached) {
                debugLog('Using cached image');
                onProgress('Complete (cached)', 100);
                return cached;
            }
        }

        onProgress('Loading workflow', 20);

        // Step 3: Load workflow
        let workflow = await loadWorkflow(workflowName, getRequestHeaders);

        onProgress('Injecting parameters', 30);

        // Step 4: Build placeholder values
        const placeholderValues = buildPlaceholderValues(settings, positivePrompt);

        // Step 5: Inject placeholders
        workflow = injectPlaceholders(workflow, placeholderValues);

        onProgress('Injecting avatars', 35);

        // Step 6: Inject avatars if enabled
        workflow = await injectAvatarPlaceholders(
            workflow,
            context,
            settings.includeCharAvatar,
            settings.includePersonaAvatar
        );

        onProgress('Submitting to ComfyUI', 40);

        // Step 7: Submit to ComfyUI
        const submitResult = await api.submitWorkflow(settings.comfyUrl, workflow);
        const promptId = submitResult.prompt_id;

        if (!promptId) {
            throw new Error('Server did not return a prompt ID');
        }

        debugLog(`Submitted to ComfyUI. Prompt ID: ${promptId}`);

        onProgress('Rendering', 50);

        // Step 8: Wait for generation
        const imageUrl = await waitForGeneration(settings.comfyUrl, promptId, onProgress);

        onProgress('Downloading', 95);

        // Step 9: Download image
        const imageBlob = await api.downloadImage(imageUrl);

        // Step 10: Compress image if enabled
        let finalImage;
        if (settings.compress) {
            onProgress('Compressing', 98);
            finalImage = await compressImage(imageBlob);
        } else {
            // Convert blob to base64 without compression
            finalImage = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(imageBlob);
            });
        }

        onProgress('Complete', 100);

        // Step 11: Cache result
        if (useCache) {
            const cacheKey = {
                workflowName,
                prompt: positivePrompt,
                negativePrompt: settings.negativePrompt,
                seed: settings.seed,
                steps: settings.steps,
                cfg: settings.cfg,
                model: settings.model,
                sampler: settings.sampler,
                width: settings.width,
                height: settings.height
            };
            cacheResult(cacheKey, finalImage);
        }

        debugLog('Image generation complete');
        return finalImage;

    } catch (error) {
        errorLog('Image generation failed:', error);
        throw new Error(sanitizeErrorMessage(error.message));
    }
}

/**
 * Get avatar cache statistics
 * @returns {object} Cache stats
 */
export function getAvatarCacheStats() {
    return {
        size: sessionAvatarCache.size,
        keys: Array.from(sessionAvatarCache.keys())
    };
}
