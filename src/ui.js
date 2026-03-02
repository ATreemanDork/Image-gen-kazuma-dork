/**
 * UI management module
 * Handles UI initialization, event handlers, and updates
 */

import { CONSTANTS } from './constants.js';
import { debugLog, errorLog, warnLog, setDebugMode } from './logger.js';
import * as core from './core.js';
import * as api from './api.js';
import * as workflow from './workflow.js';
import * as generation from './generation.js';
import * as batch from './batch.js';
import { sanitizeErrorMessage } from './utils.js';
import * as persistence from './persistence.js';
import { runtimeState, updateGenerationStats } from './state.js';

/**
 * Cached jQuery selectors (initialized once for performance)
 */
const UI = {
    // Main toggles
    $enable: null,
    $compress: null,
    $debug: null,
    $diagnosticMode: null,

    // Server
    $comfyUrl: null,
    $testBtn: null,

    // Workflow
    $workflowList: null,
    $newWorkflow: null,
    $editWorkflow: null,
    $deleteWorkflow: null,

    // Models & Samplers
    $modelList: null,
    $samplerList: null,

    // Parameters (sliders)
    $steps: null,
    $stepsVal: null,
    $cfg: null,
    $cfgVal: null,
    $denoise: null,
    $denoiseVal: null,
    $clip: null,
    $clipVal: null,

    // Dimensions
    $width: null,
    $height: null,

    // Auto-gen
    $autoEnable: null,
    $autoFreq: null,

    // Prompt builder
    $promptStyle: null,
    $promptPerspective: null,
    $promptArtStyle: null,
    $promptExtra: null,

    // Quality presets
    $qualityPreset: null,

    // Progress bar
    $progressBar: null,
    $progressFill: null,
    $progressText: null,

    /**
     * Initialize all jQuery selectors
     */
    init() {
        this.$enable = $("#kazuma_enable");
        this.$compress = $("#kazuma_compress");
        this.$debug = $("#kazuma_debug");
        this.$diagnosticMode = $("#kazuma_diagnostic");

        this.$comfyUrl = $("#kazuma_url");
        this.$testBtn = $("#kazuma_test_btn");

        this.$workflowList = $("#kazuma_workflow_list");
        this.$newWorkflow = $("#kazuma_new_workflow");
        this.$editWorkflow = $("#kazuma_edit_workflow");
        this.$deleteWorkflow = $("#kazuma_delete_workflow");

        this.$modelList = $("#kazuma_model_list");
        this.$samplerList = $("#kazuma_sampler_list");

        this.$steps = $("#kazuma_steps");
        this.$stepsVal = $("#kazuma_steps_val");
        this.$cfg = $("#kazuma_cfg");
        this.$cfgVal = $("#kazuma_cfg_val");
        this.$denoise = $("#kazuma_denoise");
        this.$denoiseVal = $("#kazuma_denoise_val");
        this.$clip = $("#kazuma_clip");
        this.$clipVal = $("#kazuma_clip_val");

        this.$width = $("#kazuma_width");
        this.$height = $("#kazuma_height");

        this.$autoEnable = $("#kazuma_auto_enable");
        this.$autoFreq = $("#kazuma_auto_freq");

        this.$promptStyle = $("#kazuma_prompt_style");
        this.$promptPerspective = $("#kazuma_prompt_persp");
        this.$promptArtStyle = $("#kazuma_prompt_art_style");
        this.$promptExtra = $("#kazuma_prompt_extra");

        this.$qualityPreset = $("#kazuma_quality_preset");

        this.$progressBar = $("#kazuma_progress_bar");
        this.$progressFill = $("#kazuma_progress_fill");
        this.$progressText = $("#kazuma_progress_text");

        debugLog('UI elements cached');
    }
};

/**
 * Sync slider and number input
 */
function syncSlider(sliderId, inputId, value) {
    $(`#${sliderId}`).val(value);
    $(`#${inputId}`).val(value);
}

/**
 * Show progress bar
 */
export function showProgress(stage, percent) {
    if (UI.$progressBar && UI.$progressBar.length) {
        UI.$progressBar.show();
        UI.$progressFill.css('width', `${percent}%`);
        UI.$progressText.text(stage);
    }
}

/**
 * Hide progress bar
 */
export function hideProgress() {
    if (UI.$progressBar && UI.$progressBar.length) {
        UI.$progressBar.hide();
    }
}

/**
 * Enable all controls
 */
export function enableControls() {
    $(".kazuma-group input, .kazuma-group select, .kazuma-group button, .kazuma-details input, .kazuma-details select, .kazuma-details button").prop("disabled", false);
}

/**
 * Disable all controls
 */
export function disableControls() {
    $(".kazuma-group input, .kazuma-group select, .kazuma-group button, .kazuma-details input, .kazuma-details select, .kazuma-details button").prop("disabled", true);
}

/**
 * Update model list dropdown
 */
export async function updateModelList() {
    const settings = core.getSettings();

    try {
        const models = await api.getModels(settings.comfyUrl);

        UI.$modelList.empty();
        models.forEach(model => {
            const selected = model === settings.model ? 'selected' : '';
            UI.$modelList.append(`<option value="${model}" ${selected}>${model}</option>`);
        });

        debugLog(`Loaded ${models.length} models`);
    } catch (error) {
        errorLog('Failed to load models:', error.message);
    }
}

/**
 * Update sampler list dropdown
 */
export async function updateSamplerList() {
    const settings = core.getSettings();

    try {
        const samplers = await api.getSamplers(settings.comfyUrl);

        UI.$samplerList.empty();
        samplers.forEach(sampler => {
            const selected = sampler === settings.sampler ? 'selected' : '';
            UI.$samplerList.append(`<option value="${sampler}" ${selected}>${sampler}</option>`);
        });

        debugLog(`Loaded ${samplers.length} samplers`);
    } catch (error) {
        errorLog('Failed to load samplers:', error.message);
    }
}

/**
 * Update workflow list dropdown
 */
export async function updateWorkflowList() {
    const { getRequestHeaders } = core.kazumaExtension.stAPI;

    try {
        const workflows = await workflow.listWorkflows(getRequestHeaders);
        const settings = core.getSettings();

        UI.$workflowList.empty();
        workflows.forEach(wf => {
            const selected = wf === settings.activeWorkflow ? 'selected' : '';
            UI.$workflowList.append(`<option value="${wf}" ${selected}>${wf}</option>`);
        });

        debugLog(`Loaded ${workflows.length} workflows`);
    } catch (error) {
        errorLog('Failed to load workflows:', error.message);
    }
}

/**
 * Sync UI with current settings
 */
export function syncUIWithSettings() {
    const settings = core.getSettings();

    UI.$enable.prop('checked', settings.enabled);
    UI.$compress.prop('checked', settings.compress);
    UI.$debug.prop('checked', settings.debugLogging);

    UI.$comfyUrl.val(settings.comfyUrl);

    syncSlider('kazuma_steps', 'kazuma_steps_val', settings.steps);
    syncSlider('kazuma_cfg', 'kazuma_cfg_val', settings.cfg);
    syncSlider('kazuma_denoise', 'kazuma_denoise_val', settings.denoise);
    syncSlider('kazuma_clip', 'kazuma_clip_val', settings.clipSkip);

    if (UI.$width) UI.$width.val(settings.width);
    if (UI.$height) UI.$height.val(settings.height);

    if (UI.$autoEnable) UI.$autoEnable.prop('checked', settings.autoGenerate);
    if (UI.$autoFreq) UI.$autoFreq.val(settings.autoGenerateFrequency);

    if (UI.$promptStyle) UI.$promptStyle.val(settings.promptStyle);
    if (UI.$promptPerspective) UI.$promptPerspective.val(settings.promptPerspective);
    if (UI.$promptArtStyle) UI.$promptArtStyle.val(settings.promptArtStyle);
    if (UI.$promptExtra) UI.$promptExtra.val(settings.promptExtra);

    if (UI.$qualityPreset) UI.$qualityPreset.val(settings.qualityPreset || 'medium');

    debugLog('UI synced with settings');
}

/**
 * Setup event handlers
 */
function setupEventHandlers() {
    // Enable/disable toggle
    UI.$enable.on("change", async function () {
        if (this.checked) {
            core.enable();

            // Lazy-load dynamic data only after explicit enable
            await updateWorkflowList();
            await updateModelList();
            await updateSamplerList();

            if (typeof toastr !== 'undefined') {
                toastr.info('Extension enabled. Configure ComfyUI URL and test connection if needed.');
            }
        } else {
            core.disable();
        }
    });

    // Compress toggle
    UI.$compress.on("change", function () {
        core.updateSettings({ compress: this.checked });
    });

    // Debug toggle
    UI.$debug.on("change", function () {
        const enabled = this.checked;
        setDebugMode(enabled);
        core.updateSettings({ debugLogging: enabled });
        toastr.info(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
    });

    // ComfyUI URL
    UI.$comfyUrl.on("change", function () {
        core.updateSettings({ comfyUrl: $(this).val() });
    });

    // Test connection
    UI.$testBtn.on("click", async function () {
        const settings = core.getSettings();

        try {
            showProgress('Testing connection', 50);
            const result = await api.testConnection(settings.comfyUrl);
            hideProgress();
            toastr.success(`Connection successful! ComfyUI ${result.system?.os || 'running'}`);
        } catch (error) {
            hideProgress();
            toastr.error(`Connection failed: ${sanitizeErrorMessage(error.message)}`);
        }
    });

    // Workflow selection
    UI.$workflowList.on("change", function () {
        const selected = $(this).val();
        core.updateSettings({ activeWorkflow: selected });
        debugLog(`Active workflow changed: ${selected}`);
    });

    // Workflow buttons
    UI.$newWorkflow.on("click", () => openWorkflowEditor(null));
    UI.$editWorkflow.on("click", async () => {
        const selected = UI.$workflowList.val();
        if (!selected) {
            toastr.warning('No workflow selected');
            return;
        }

        try {
            const { getRequestHeaders } = core.kazumaExtension.stAPI;
            const workflowData = await workflow.loadWorkflow(selected, getRequestHeaders);
            openWorkflowEditor(selected, workflowData);
        } catch (error) {
            toastr.error(`Failed to load workflow: ${sanitizeErrorMessage(error.message)}`);
        }
    });

    UI.$deleteWorkflow.on("click", async () => {
        const selected = UI.$workflowList.val();
        if (!selected) return;

        if (confirm(`Delete workflow "${selected}"?`)) {
            try {
                const { getRequestHeaders } = core.kazumaExtension.stAPI;
                await workflow.deleteWorkflow(selected, getRequestHeaders);
                await updateWorkflowList();
                toastr.success('Workflow deleted');
            } catch (error) {
                toastr.error(`Failed to delete workflow: ${sanitizeErrorMessage(error.message)}`);
            }
        }
    });

    // Model & sampler selection
    UI.$modelList.on("change", function () {
        core.updateSettings({ model: $(this).val() });
    });

    UI.$samplerList.on("change", function () {
        core.updateSettings({ sampler: $(this).val() });
    });

    // Steps slider
    UI.$steps.on("input", function () {
        const val = parseFloat($(this).val());
        syncSlider('kazuma_steps', 'kazuma_steps_val', val);
        core.updateSettings({ steps: val });
    });

    UI.$stepsVal.on("change", function () {
        const val = parseFloat($(this).val());
        syncSlider('kazuma_steps', 'kazuma_steps_val', val);
        core.updateSettings({ steps: val });
    });

    // CFG slider
    UI.$cfg.on("input", function () {
        const val = parseFloat($(this).val());
        syncSlider('kazuma_cfg', 'kazuma_cfg_val', val);
        core.updateSettings({ cfg: val });
    });

    UI.$cfgVal.on("change", function () {
        const val = parseFloat($(this).val());
        syncSlider('kazuma_cfg', 'kazuma_cfg_val', val);
        core.updateSettings({ cfg: val });
    });

    // Denoise slider
    UI.$denoise.on("input", function () {
        const val = parseFloat($(this).val());
        syncSlider('kazuma_denoise', 'kazuma_denoise_val', val);
        core.updateSettings({ denoise: val });
    });

    UI.$denoiseVal.on("change", function () {
        const val = parseFloat($(this).val());
        syncSlider('kazuma_denoise', 'kazuma_denoise_val', val);
        core.updateSettings({ denoise: val });
    });

    // CLIP slider
    UI.$clip.on("input", function () {
        const val = parseInt($(this).val());
        syncSlider('kazuma_clip', 'kazuma_clip_val', val);
        core.updateSettings({ clipSkip: val });
    });

    UI.$clipVal.on("change", function () {
        const val = parseInt($(this).val());
        syncSlider('kazuma_clip', 'kazuma_clip_val', val);
        core.updateSettings({ clipSkip: val });
    });

    // Dimensions
    if (UI.$width) {
        UI.$width.on("change", function () {
            core.updateSettings({ width: parseInt($(this).val()) });
        });
    }

    if (UI.$height) {
        UI.$height.on("change", function () {
            core.updateSettings({ height: parseInt($(this).val()) });
        });
    }

    // Auto-gen
    if (UI.$autoEnable) {
        UI.$autoEnable.on("change", function () {
            core.updateSettings({ autoGenerate: this.checked });
        });
    }

    if (UI.$autoFreq) {
        UI.$autoFreq.on("change", function () {
            core.updateSettings({ autoGenerateFrequency: parseInt($(this).val()) });
        });
    }

    // Prompt builder
    if (UI.$promptStyle) {
        UI.$promptStyle.on("change", function () {
            core.updateSettings({ promptStyle: $(this).val() });
        });
    }

    if (UI.$promptPerspective) {
        UI.$promptPerspective.on("change", function () {
            core.updateSettings({ promptPerspective: $(this).val() });
        });
    }

    if (UI.$promptArtStyle) {
        UI.$promptArtStyle.on("change", function () {
            core.updateSettings({ promptArtStyle: $(this).val() });
        });
    }

    if (UI.$promptExtra) {
        UI.$promptExtra.on("change", function () {
            core.updateSettings({ promptExtra: $(this).val() });
        });
    }

    // Quality preset
    if (UI.$qualityPreset) {
        UI.$qualityPreset.on("change", function () {
            const preset = $(this).val();
            core.applyQualityPreset(preset);
            syncUIWithSettings();
        });
    }

    debugLog('Event handlers registered');
}

/**
 * Open workflow editor modal
 */
function openWorkflowEditor(name, data) {
    const isNew = !name;
    const title = isNew ? "New Workflow" : `Edit: ${name}`;

    const modal = $(`
        <div class="kazuma-modal" style="position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.7); z-index:9999; display:flex; align-items:center; justify-content:center;">
            <div class="kazuma-modal-content" style="background:var(--black70a); padding:20px; border-radius:10px; max-width:800px; width:90%; max-height:80vh; display:flex; flex-direction:column;">
                <h3>${title}</h3>
                <textarea id="kazuma_workflow_json" style="flex:1; width:100%; min-height:400px; font-family:monospace; background:var(--black30a); color:var(--smart-text-color); border:1px solid var(--smart-border-color); padding:10px; margin:10px 0;"></textarea>
                <div style="display:flex; gap:10px; justify-content:flex-end;">
                    <button id="kazuma_workflow_save" class="menu_button">Save</button>
                    <button id="kazuma_workflow_format" class="menu_button">Format JSON</button>
                    <button id="kazuma_workflow_import" class="menu_button">Import File</button>
                    <button id="kazuma_workflow_cancel" class="menu_button">Cancel</button>
                </div>
            </div>
        </div>
    `);

    $("body").append(modal);

    if (data) {
        $("#kazuma_workflow_json").val(workflow.formatWorkflowJSON(data));
    }

    // Save handler
    $("#kazuma_workflow_save").on("click", async () => {
        try {
            const jsonText = $("#kazuma_workflow_json").val();
            const json = JSON.parse(jsonText);
            const saveName = isNew ? prompt("Workflow name:") : name;

            if (!saveName) return;

            const { getRequestHeaders } = core.kazumaExtension.stAPI;
            await workflow.saveWorkflow(saveName, json, getRequestHeaders);
            await updateWorkflowList();
            modal.remove();
            toastr.success('Workflow saved!');
        } catch (error) {
            toastr.error(`Save failed: ${sanitizeErrorMessage(error.message)}`);
        }
    });

    // Format handler
    $("#kazuma_workflow_format").on("click", () => {
        try {
            const json = JSON.parse($("#kazuma_workflow_json").val());
            $("#kazuma_workflow_json").val(workflow.formatWorkflowJSON(json));
            toastr.success('JSON formatted');
        } catch (error) {
            toastr.error('Invalid JSON');
        }
    });

    // Import handler
    $("#kazuma_workflow_import").on("click", () => {
        const input = $('<input type="file" accept=".json">');
        input.on("change", function () {
            const file = this.files[0];
            const reader = new FileReader();
            reader.onload = (e) => {
                $("#kazuma_workflow_json").val(e.target.result);
            };
            reader.readAsText(file);
        });
        input.click();
    });

    // Cancel handler
    $("#kazuma_workflow_cancel").on("click", () => modal.remove());
}

/**
 * Render settings panel in Extensions tab
 * Loads settings.html template
 */
async function renderSettingsPanel() {
    try {
        // Check if settings panel already rendered
        if (runtimeState.settingsPanelRendered) {
            debugLog('Settings panel already rendered, skipping');
            return;
        }

        // Find or create extension settings container
        let settingsContainer = $('#extensions_settings2');
        if (settingsContainer.length === 0) {
            settingsContainer = $('#extensions_settings');
        }
        if (settingsContainer.length === 0) {
            warnLog('Extension settings container not found');
            return;
        }

        // Fetch settings.html and append
        const candidateUrls = [
            new URL('../settings.html', import.meta.url).toString(),
            '/scripts/extensions/third-party/Image-gen-kazuma-dork/settings.html',
            './settings.html'
        ];

        let settingsHTML;
        let lastStatus = 'unknown';

        for (const url of candidateUrls) {
            const response = await fetch(url);
            if (response.ok) {
                settingsHTML = await response.text();
                break;
            }
            lastStatus = String(response.status);
        }

        if (!settingsHTML) {
            throw new Error(`Failed to load settings.html: ${lastStatus}`);
        }

        settingsContainer.append(settingsHTML);

        runtimeState.settingsPanelRendered = true;
        debugLog('Settings panel rendered successfully');
    } catch (error) {
        warnLog('Failed to render settings panel:', error.message);
        // Continue without settings panel - isn't critical
    }
}

/**
 * Setup settings panel event handlers
 */
function setupSettingsPanelHandlers() {
    // Extension enable/disable toggle
    const $enableCheckbox = $('#kazuma-extension-enabled');
    if ($enableCheckbox.length) {
        const settings = core.getSettings();
        $enableCheckbox.prop('checked', settings.enabled);

        $enableCheckbox.on('change', function () {
            const enabled = $(this).prop('checked');
            core.updateSettings({ enabled });

            if (enabled) {
                core.enable();
            } else {
                core.disable();
            }
        });
    }

    // Debug logging toggle
    const $debugCheckbox = $('#kazuma-debug-logging');
    if ($debugCheckbox.length) {
        const settings = core.getSettings();
        $debugCheckbox.prop('checked', settings.debugLogging);

        $debugCheckbox.on('change', function () {
            const enabled = $(this).prop('checked');
            setDebugMode(enabled);
            core.updateSettings({ debugLogging: enabled });

            if (typeof toastr !== 'undefined') {
                toastr.info(`Debug logging ${enabled ? 'enabled' : 'disabled'}`);
            }
        });
    }

    // Export settings button
    const $exportBtn = $('#kazuma-export-settings');
    if ($exportBtn.length) {
        $exportBtn.on('click', function () {
            try {
                const settings = core.getSettings();
                const exportData = persistence.exportSettingsToJSON(settings);

                // Copy to clipboard
                navigator.clipboard.writeText(exportData).then(() => {
                    if (typeof toastr !== 'undefined') {
                        toastr.success('Settings exported to clipboard');
                    }
                    debugLog('Settings exported');
                }).catch(error => {
                    warnLog('Failed to copy to clipboard:', error.message);
                    if (typeof toastr !== 'undefined') {
                        toastr.info('Settings exported to browser console');
                    }
                    console.log('Settings JSON:', exportData);
                });
            } catch (error) {
                if (typeof toastr !== 'undefined') {
                    toastr.error(`Export failed: ${error.message}`);
                }
            }
        });
    }

    // Import settings button
    const $importBtn = $('#kazuma-import-settings');
    if ($importBtn.length) {
        $importBtn.on('click', async function () {
            try {
                const stAPI = core.kazumaExtension.stAPI;
                const imported = await persistence.importSettingsFromJSON(stAPI, 'clipboard');

                // Refresh UI with imported settings
                syncUIWithSettings();

                if (typeof toastr !== 'undefined') {
                    toastr.success('Settings imported successfully');
                }
                debugLog('Settings imported');
            } catch (error) {
                if (typeof toastr !== 'undefined') {
                    toastr.error(`Import failed: ${error.message}`);
                }
            }
        });
    }

    // Reset settings button
    const $resetBtn = $('#kazuma-reset-settings');
    if ($resetBtn.length) {
        $resetBtn.on('click', function () {
            if (!confirm('Reset all settings to defaults? This cannot be undone.')) {
                return;
            }

            try {
                persistence.resetSettings(core.kazumaExtension.stAPI);
                syncUIWithSettings();

                if (typeof toastr !== 'undefined') {
                    toastr.success('Settings reset to defaults');
                }
                debugLog('Settings reset');
            } catch (error) {
                if (typeof toastr !== 'undefined') {
                    toastr.error(`Reset failed: ${error.message}`);
                }
            }
        });
    }

    debugLog('Settings panel handlers registered');
}

/**
 * Inject chat button using MutationObserver
 */
function setupChatButtonObserver() {
    const targetNode = document.querySelector("#send_form");

    if (!targetNode) {
        // Fallback: try once after delay
        core.registerTimeout(() => injectChatButton(), CONSTANTS.CHAT_BUTTON_CHECK_DELAY_MS);
        return;
    }

    const observer = new MutationObserver((mutations) => {
        if ($("#kazuma_chat_btn").length === 0) {
            injectChatButton();
        }
    });

    observer.observe(targetNode, { childList: true, subtree: true });
    core.registerObserver(observer);

    // Try immediate injection
    injectChatButton();

    debugLog('Chat button observer setup');
}

/**
 * Inject generate button into chat
 */
function injectChatButton() {
    const chatArea = $("#send_but_sheld");
    if (chatArea.length === 0 || $("#kazuma_chat_btn").length > 0) {
        return;
    }

    const button = $(`
        <div id="kazuma_chat_btn" class="menu_button" title="Generate Image" style="margin-left:5px;">
            <i class="fa-solid fa-image"></i>
        </div>
    `);

    button.on("click", async () => {
        const settings = core.getSettings();
        const { getContext, getRequestHeaders, generateQuietPrompt, appendMediaToMessage } = core.kazumaExtension.stAPI;

        if (!settings.enabled) {
            toastr.warning('Extension is disabled');
            return;
        }

        try {
            const context = getContext();

            showProgress('Generating', 0);

            const result = await generation.generateImage({
                workflowName: settings.activeWorkflow,
                settings: settings,
                context: context,
                getRequestHeaders: getRequestHeaders,
                generateQuietPrompt: generateQuietPrompt,
                onProgress: showProgress,
                useCache: true
            });

            hideProgress();

            // Add to last message
            const lastIndex = context.chat.length - 1;
            await appendMediaToMessage(result, lastIndex);

            toastr.success('Image added to chat!');
        } catch (error) {
            hideProgress();
            toastr.error(`Generation failed: ${sanitizeErrorMessage(error.message)}`);
        }
    });

    chatArea.append(button);
    debugLog('Chat button injected');
}

/**
 * Initialize UI
 */
export async function initializeUI() {
    debugLog('Initializing UI...');

    try {
        // Render settings panel in Extensions tab
        await renderSettingsPanel();

        // Cache all selectors
        UI.init();

        // Setup event handlers
        setupEventHandlers();

        // Setup settings panel handlers (export/import/reset)
        setupSettingsPanelHandlers();

        // Sync UI with settings
        syncUIWithSettings();

        // Load dynamic lists only if extension is enabled
        const settings = core.getSettings();
        if (settings.enabled) {
            await updateWorkflowList();
            await updateModelList();
            await updateSamplerList();
        } else {
            debugLog('Extension starts disabled; skipping startup ComfyUI/workflow fetches');
        }

        // Setup chat button observer
        setupChatButtonObserver();

        // Setup auto-generation event listener
        const { event_types } = core.kazumaExtension.stAPI;
        if (event_types && event_types.MESSAGE_RECEIVED) {
            core.registerEventListener(event_types.MESSAGE_RECEIVED, core.handleAutoGeneration);
        }

        debugLog('UI initialized successfully');

    } catch (error) {
        errorLog('UI initialization failed:', error);
        throw error;
    }
}
