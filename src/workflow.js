/**
 * Workflow management module
 * Handles CRUD operations, placeholder injection, and per-workflow state
 */

import { debugLog, errorLog, warnLog } from './logger.js';
import { sanitizeWorkflowFilename, validateWorkflowJSON, deepClone, safeJSONParse } from './utils.js';

const WORKFLOW_API_BASE = '/api/extensions/third-party/Image-gen-kazuma-dork/workflows';
const STATIC_WORKFLOW_CANDIDATES = ['ExampleComfyWorkflow.json', 'default.json'];

function getWorkflowApiUrl(name) {
    const suffix = name ? `/${name}` : '';
    return `${WORKFLOW_API_BASE}${suffix}`;
}

function getStaticWorkflowUrl(name) {
    return new URL(`../reference/${name}`, import.meta.url).toString();
}

async function loadWorkflowFromStatic(name) {
    const staticUrl = getStaticWorkflowUrl(name);
    const response = await fetch(staticUrl, { method: 'GET' });

    if (!response.ok) {
        throw new Error(`Workflow not found in static reference: ${name}`);
    }

    const text = await response.text();
    const json = safeJSONParse(text, `workflow ${name}`);
    return validateWorkflowJSON(json);
}

async function listStaticWorkflows() {
    const discovered = [];

    for (const name of STATIC_WORKFLOW_CANDIDATES) {
        const response = await fetch(getStaticWorkflowUrl(name), { method: 'GET' });
        if (response.ok) {
            discovered.push(name);
        }
    }

    return discovered;
}

/**
 * Per-workflow state storage (remembers settings for each workflow)
 * Not persisted to extension_settings, only lives in session
 */
const workflowStates = new Map();

/**
 * Load workflow from SillyTavern server
 * @param {string} name - Workflow filename
 * @param {Function} getRequestHeaders - Function to get ST request headers
 * @returns {Promise<object>} Workflow JSON
 * @throws {Error} If load fails
 */
export async function loadWorkflow(name, getRequestHeaders) {
    const sanitizedName = sanitizeWorkflowFilename(name);
    debugLog(`Loading workflow: ${sanitizedName}`);

    // Prefer packaged static workflows first to avoid API 404s
    try {
        return await loadWorkflowFromStatic(sanitizedName);
    } catch {
        // Fall through to API-backed loading for user-saved workflows
    }

    try {
        const response = await fetch(getWorkflowApiUrl(sanitizedName), {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            if (response.status === 404) {
                debugLog(`Workflow API route unavailable or file missing for ${sanitizedName}, trying static fallback`);
                return await loadWorkflowFromStatic(sanitizedName);
            }
            throw new Error(`Failed to load workflow: ${response.status} ${response.statusText}`);
        }

        const text = await response.text();
        const json = safeJSONParse(text, `workflow ${sanitizedName}`);
        const validated = validateWorkflowJSON(json);

        debugLog(`Workflow loaded successfully: ${sanitizedName}`);
        return validated;
    } catch (error) {
        errorLog(`Failed to load workflow ${sanitizedName}:`, error.message);
        throw error;
    }
}

/**
 * Save workflow to SillyTavern server
 * @param {string} name - Workflow filename
 * @param {object} workflowData - Workflow JSON object
 * @param {Function} getRequestHeaders - Function to get ST request headers
 * @returns {Promise<string>} Sanitized filename
 * @throws {Error} If save fails
 */
export async function saveWorkflow(name, workflowData, getRequestHeaders) {
    const sanitizedName = sanitizeWorkflowFilename(name);
    debugLog(`Saving workflow: ${sanitizedName}`);

    try {
        // Validate before saving
        const validated = validateWorkflowJSON(workflowData);

        const response = await fetch(getWorkflowApiUrl(sanitizedName), {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(validated, null, 2)
        });

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Workflow save API is unavailable in this deployment (read-only workflow mode)');
            }
            throw new Error(`Failed to save workflow: ${response.status} ${response.statusText}`);
        }

        debugLog(`Workflow saved successfully: ${sanitizedName}`);
        return sanitizedName;
    } catch (error) {
        errorLog(`Failed to save workflow ${sanitizedName}:`, error.message);
        throw error;
    }
}

/**
 * Delete workflow from SillyTavern server
 * @param {string} name - Workflow filename
 * @param {Function} getRequestHeaders - Function to get ST request headers
 * @returns {Promise<void>}
 * @throws {Error} If delete fails
 */
export async function deleteWorkflow(name, getRequestHeaders) {
    const sanitizedName = sanitizeWorkflowFilename(name);
    debugLog(`Deleting workflow: ${sanitizedName}`);

    try {
        const response = await fetch(getWorkflowApiUrl(sanitizedName), {
            method: 'DELETE',
            headers: getRequestHeaders()
        });

        if (!response.ok && response.status !== 404) {
            throw new Error(`Failed to delete workflow: ${response.status} ${response.statusText}`);
        }

        if (response.status === 404) {
            throw new Error('Workflow delete API is unavailable in this deployment (read-only workflow mode)');
        }

        // Clean up workflow state
        workflowStates.delete(sanitizedName);

        debugLog(`Workflow deleted successfully: ${sanitizedName}`);
    } catch (error) {
        errorLog(`Failed to delete workflow ${sanitizedName}:`, error.message);
        throw error;
    }
}

/**
 * List all workflows from SillyTavern server
 * @param {Function} getRequestHeaders - Function to get ST request headers
 * @returns {Promise<string[]>} Array of workflow filenames
 */
export async function listWorkflows(getRequestHeaders) {
    debugLog('Fetching workflow list');

    // Prefer static reference workflows (works in read-only/non-admin hosted setups)
    const staticWorkflows = await listStaticWorkflows();
    if (staticWorkflows.length > 0) {
        debugLog(`Using ${staticWorkflows.length} static workflows`);
        return staticWorkflows;
    }

    try {
        const response = await fetch(getWorkflowApiUrl(), {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            if (response.status === 404) {
                debugLog('Workflow API unavailable, using static reference fallback');
                return await listStaticWorkflows();
            }
            warnLog(`Failed to fetch workflow list: ${response.status}`);
            return [];
        }

        const workflows = await response.json();
        debugLog(`Found ${workflows.length} workflows`);
        return Array.isArray(workflows) ? workflows : [];
    } catch (error) {
        errorLog('Failed to fetch workflow list:', error.message);
        return [];
    }
}

/**
 * Inject placeholder values into workflow (single-pass optimization)
 * Supports both *token* and %token% formats
 * @param {object} workflow - Workflow object to inject into
 * @param {object} values - Key-value pairs of placeholder values
 * @returns {object} Workflow with injected values
 */
export function injectPlaceholders(workflow, values) {
    debugLog('Injecting placeholders into workflow');

    // Deep clone to avoid mutating original
    const injected = deepClone(workflow);

    let injectionCount = 0;

    // Single-pass injection through all nodes
    for (const nodeId in injected) {
        const node = injected[nodeId];

        if (!node || !node.inputs) continue;

        for (const inputKey in node.inputs) {
            const inputValue = node.inputs[inputKey];

            // Only process string values that look like placeholders
            if (typeof inputValue !== 'string') continue;

            // Check for placeholder patterns
            for (const [placeholder, value] of Object.entries(values)) {
                // Support both *token* and %token% formats
                if (inputValue === `*${placeholder}*` || inputValue === `%${placeholder}%`) {
                    node.inputs[inputKey] = value;
                    injectionCount++;
                    debugLog(`Injected ${placeholder} = ${value} into node ${nodeId}.${inputKey}`);
                    break; // Move to next input
                }
            }
        }
    }

    debugLog(`Total placeholders injected: ${injectionCount}`);
    return injected;
}

/**
 * Build placeholder values object from settings
 * @param {object} settings - Extension settings object
 * @param {string} positivePrompt - Generated positive prompt
 * @returns {object} Values object for injection
 */
export function buildPlaceholderValues(settings, positivePrompt) {
    return {
        input: positivePrompt,
        ninput: settings.negativePrompt || '',
        seed: settings.seed === -1 ? Math.floor(Math.random() * 1000000000) : settings.seed,
        steps: settings.steps || 20,
        cfg: settings.cfg || 7.0,
        model: settings.model || '',
        sampler: settings.sampler || 'euler_ancestral',
        scheduler: settings.scheduler || 'normal',
        width: settings.width || 512,
        height: settings.height || 512,
        denoise: settings.denoise || 0.5,
        clipSkip: settings.clipSkip || 1,
        lora: settings.lora1 || '',
        lorawt: settings.lora1Weight || 1.0,
        lora2: settings.lora2 || '',
        lorawt2: settings.lora2Weight || 1.0,
        lora3: settings.lora3 || '',
        lorawt3: settings.lora3Weight || 1.0,
        lora4: settings.lora4 || '',
        lorawt4: settings.lora4Weight || 1.0
    };
}

/**
 * Validate that workflow contains required placeholders
 * @param {object} workflow - Workflow to validate
 * @param {string[]} requiredPlaceholders - Array of required placeholder names
 * @returns {object} { valid: boolean, missing: string[] }
 */
export function validateRequiredPlaceholders(workflow, requiredPlaceholders = ['input']) {
    const foundPlaceholders = new Set();

    // Scan workflow for placeholders
    for (const nodeId in workflow) {
        const node = workflow[nodeId];
        if (!node || !node.inputs) continue;

        for (const inputValue of Object.values(node.inputs)) {
            if (typeof inputValue !== 'string') continue;

            // Extract placeholder name from *name* or %name% format
            const starMatch = inputValue.match(/^\*(\w+)\*$/);
            const percentMatch = inputValue.match(/^%(\w+)%$/);

            if (starMatch) {
                foundPlaceholders.add(starMatch[1]);
            } else if (percentMatch) {
                foundPlaceholders.add(percentMatch[1]);
            }
        }
    }

    // Check for missing required placeholders
    const missing = requiredPlaceholders.filter(p => !foundPlaceholders.has(p));

    const valid = missing.length === 0;
    if (!valid) {
        warnLog(`Workflow missing required placeholders: ${missing.join(', ')}`);
    }

    return { valid, missing, found: Array.from(foundPlaceholders) };
}

/**
 * Save workflow state (settings per workflow)
 * @param {string} workflowName - Workflow filename
 * @param {object} state - State object to save
 */
export function saveWorkflowState(workflowName, state) {
    const sanitizedName = sanitizeWorkflowFilename(workflowName);
    workflowStates.set(sanitizedName, { ...state });
    debugLog(`Saved state for workflow: ${sanitizedName}`);
}

/**
 * Get workflow state (settings per workflow)
 * @param {string} workflowName - Workflow filename
 * @returns {object|null} State object or null if not found
 */
export function getWorkflowState(workflowName) {
    try {
        const sanitizedName = sanitizeWorkflowFilename(workflowName);
        const state = workflowStates.get(sanitizedName);

        if (state) {
            debugLog(`Retrieved state for workflow: ${sanitizedName}`);
        }

        return state || null;
    } catch (error) {
        warnLog(`Failed to get workflow state: ${error.message}`);
        return null;
    }
}

/**
 * Clear workflow state
 * @param {string} workflowName - Workflow filename
 */
export function clearWorkflowState(workflowName) {
    try {
        const sanitizedName = sanitizeWorkflowFilename(workflowName);
        const deleted = workflowStates.delete(sanitizedName);

        if (deleted) {
            debugLog(`Cleared state for workflow: ${sanitizedName}`);
        }
    } catch (error) {
        warnLog(`Failed to clear workflow state: ${error.message}`);
    }
}

/**
 * Clear all workflow states
 */
export function clearAllWorkflowStates() {
    const count = workflowStates.size;
    workflowStates.clear();
    debugLog(`Cleared all workflow states: ${count} entries`);
}

/**
 * Get all workflow names that have saved states
 * @returns {string[]} Array of workflow names with saved states
 */
export function getWorkflowsWithState() {
    return Array.from(workflowStates.keys());
}

/**
 * Format workflow JSON with pretty printing
 * @param {object} workflow - Workflow object
 * @returns {string} Formatted JSON string
 */
export function formatWorkflowJSON(workflow) {
    return JSON.stringify(workflow, null, 2);
}

/**
 * Minify workflow JSON (remove whitespace)
 * @param {object} workflow - Workflow object
 * @returns {string} Minified JSON string
 */
export function minifyWorkflowJSON(workflow) {
    return JSON.stringify(workflow);
}

/**
 * Count nodes in workflow
 * @param {object} workflow - Workflow object
 * @returns {number} Number of nodes
 */
export function countWorkflowNodes(workflow) {
    return Object.keys(workflow).length;
}

/**
 * Get workflow summary information
 * @param {object} workflow - Workflow object
 * @returns {object} Summary with node count, placeholders, etc.
 */
export function getWorkflowSummary(workflow) {
    const nodeCount = countWorkflowNodes(workflow);
    const placeholderCheck = validateRequiredPlaceholders(workflow, []);

    // Count node types
    const nodeTypes = new Map();
    for (const node of Object.values(workflow)) {
        if (node && node.class_type) {
            nodeTypes.set(node.class_type, (nodeTypes.get(node.class_type) || 0) + 1);
        }
    }

    return {
        nodeCount,
        placeholders: placeholderCheck.found,
        nodeTypes: Object.fromEntries(nodeTypes)
    };
}
