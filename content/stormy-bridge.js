/******/ (() => { // webpackBootstrap
/******/ 	"use strict";

/**
 * Stormy Bridge Content Script
 *
 * Runs on Stormy.ai /connected-accounts page to enable DOM-based communication.
 * Auto-configures the extension and stops after success.
 */
console.log('[Stormy Extension] 🚀 Bridge content script loaded at', new Date().toISOString());
console.log('[Stormy Extension] Document state:', document.readyState);
console.log('[Stormy Extension] Body exists:', !!document.body);
console.log('[Stormy Extension] Current path:', window.location.pathname);
let initializationAttempts = 0;
const MAX_INIT_ATTEMPTS = 10;
// Track configuration state and cleanup resources
let configuredSuccessfully = false;
let isFullyConnected = false;
let stateUpdateInterval = null;
let configCheckInterval = null;
let configObserver = null;
/**
 * Check if we're on the correct page
 */
function isConnectedAccountsPage() {
    const path = window.location.pathname;
    const isCorrectPage = path.includes('/connected-accounts') || path.includes('/email_agent');
    console.log('[Stormy Extension] 🔍 Path check:', { path, isCorrectPage });
    return isCorrectPage;
}
/**
 * Cleanup all resources (intervals, observers)
 */
function cleanup() {
    console.log('[Stormy Extension] 🧹 Cleaning up resources...');
    if (stateUpdateInterval) {
        clearInterval(stateUpdateInterval);
        stateUpdateInterval = null;
        console.log('[Stormy Extension] ✓ Cleared state update interval');
    }
    if (configCheckInterval) {
        clearInterval(configCheckInterval);
        configCheckInterval = null;
        console.log('[Stormy Extension] ✓ Cleared config check interval');
    }
    if (configObserver) {
        configObserver.disconnect();
        configObserver = null;
        console.log('[Stormy Extension] ✓ Disconnected mutation observer');
    }
    console.log('[Stormy Extension] ✅ Cleanup complete - bridge stopped');
}
/**
 * Wait for document.body to be available
 */
function waitForBody() {
    return new Promise((resolve) => {
        if (document.body) {
            console.log('[Stormy Extension] ✓ document.body already exists');
            resolve();
            return;
        }
        console.log('[Stormy Extension] ⏳ Waiting for document.body...');
        const observer = new MutationObserver(() => {
            if (document.body) {
                console.log('[Stormy Extension] ✓ document.body now available');
                observer.disconnect();
                resolve();
            }
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
        // Fallback timeout
        setTimeout(() => {
            observer.disconnect();
            console.log('[Stormy Extension] ⚠️ Timeout waiting for body, proceeding anyway');
            resolve();
        }, 5000);
    });
}
/**
 * Inject extension state into the DOM
 * This allows the page to read the extension's current status
 */
async function injectExtensionState() {
    try {
        console.log('[Stormy Extension] 📝 Injecting extension state...');
        // Ensure body exists
        if (!document.body) {
            console.error('[Stormy Extension] ❌ Cannot inject state: document.body is null');
            return;
        }
        // Get or create bridge element
        let bridge = document.getElementById('stormy-extension-bridge');
        if (!bridge) {
            bridge = document.createElement('div');
            bridge.id = 'stormy-extension-bridge';
            bridge.style.display = 'none';
            document.body.appendChild(bridge);
            console.log('[Stormy Extension] ✓ Created bridge element #stormy-extension-bridge');
        }
        else {
            console.log('[Stormy Extension] ✓ Bridge element already exists');
        }
        // Read current configuration from chrome.storage
        console.log('[Stormy Extension] 📖 Reading configuration from storage...');
        const config = await chrome.storage.sync.get(['apiBaseUrl', 'userId']);
        const localData = await chrome.storage.local.get(['lastSyncTime', 'lastSyncStatus']);
        console.log('[Stormy Extension] Config from storage:', {
            hasApiBaseUrl: !!config.apiBaseUrl,
            hasUserId: !!config.userId,
            apiBaseUrl: config.apiBaseUrl,
            userId: config.userId
        });
        // Check if we have a connection by asking background script
        console.log('[Stormy Extension] 📡 Checking connection status...');
        const response = await chrome.runtime.sendMessage({ action: 'checkStatus' });
        const connectionStatus = response?.data || { connected: false, username: '' };
        console.log('[Stormy Extension] Connection status:', connectionStatus);
        // Update bridge attributes with current state
        const configured = !!(config.apiBaseUrl && config.userId);
        bridge.setAttribute('data-extension-id', chrome.runtime.id);
        bridge.setAttribute('data-extension-version', chrome.runtime.getManifest().version);
        bridge.setAttribute('data-configured', configured ? 'true' : 'false');
        bridge.setAttribute('data-connected', connectionStatus.connected ? 'true' : 'false');
        bridge.setAttribute('data-username', connectionStatus.username || '');
        bridge.setAttribute('data-last-sync', localData.lastSyncTime || '');
        bridge.setAttribute('data-last-sync-status', localData.lastSyncStatus || '');
        console.log('[Stormy Extension] ✅ State injected successfully:', {
            extensionId: chrome.runtime.id,
            configured: configured,
            connected: connectionStatus.connected,
            username: connectionStatus.username,
            lastSync: localData.lastSyncTime
        });
        // If fully connected (configured + active connection), stop polling
        if (connectionStatus.connected && configured) {
            if (!isFullyConnected) {
                isFullyConnected = true;
                console.log('[Stormy Extension] ✅ Fully connected - stopping all polling');
                cleanup();
            }
        }
        // Dispatch custom event for immediate notification
        window.dispatchEvent(new CustomEvent('stormy-extension-state-updated', {
            detail: {
                configured,
                connected: connectionStatus.connected,
                username: connectionStatus.username
            }
        }));
    }
    catch (error) {
        console.error('[Stormy Extension] ❌ Error injecting state:', error);
    }
}
/**
 * Watch for configuration from the page
 * When the page writes config to DOM, auto-configure the extension
 */
function watchForPageConfig() {
    console.log('[Stormy Extension] 👀 Starting to watch for page config...');
    // Check for config element periodically
    const checkConfig = async () => {
        if (configuredSuccessfully) {
            console.log('[Stormy Extension] ⏭️ Already configured, skipping check');
            return;
        }
        const configEl = document.getElementById('stormy-extension-config');
        if (!configEl) {
            console.log('[Stormy Extension] ⏳ Config element not found yet (polling...)');
            return;
        }
        const apiBaseUrl = configEl.getAttribute('data-api-base-url');
        const userId = configEl.getAttribute('data-user-id');
        const countryCode = configEl.getAttribute('data-country-code');
        console.log('[Stormy Extension] 🔍 Found config element:', {
            hasApiBaseUrl: !!apiBaseUrl,
            hasUserId: !!userId,
            hasCountryCode: !!countryCode,
            apiBaseUrl,
            userId,
            countryCode
        });
        if (apiBaseUrl && userId) {
            // Get current config to check if it changed
            const currentConfig = await chrome.storage.sync.get(['apiBaseUrl', 'userId', 'countryCode']);
            // Only update if config changed
            if (currentConfig.apiBaseUrl !== apiBaseUrl ||
                currentConfig.userId !== userId ||
                currentConfig.countryCode !== countryCode) {
                console.log('[Stormy Extension] 🔧 Config changed! Auto-configuring...');
                console.log('[Stormy Extension] Old config:', currentConfig);
                console.log('[Stormy Extension] New config:', { apiBaseUrl, userId, countryCode });
                await chrome.storage.sync.set({
                    apiBaseUrl: apiBaseUrl,
                    userId: userId,
                    countryCode: countryCode || 'us' // Default to US if not provided
                });
                console.log('[Stormy Extension] ✅ Auto-configuration complete!');
                // Mark as configured
                configuredSuccessfully = true;
                // Final state update
                await injectExtensionState();
                // STOP EVERYTHING - cleanup all intervals and observers
                cleanup();
                console.log('[Stormy Extension] 🎉 Configuration done - bridge shutting down');
            }
            else {
                console.log('[Stormy Extension] ✓ Config unchanged, no update needed');
            }
        }
        else {
            console.log('[Stormy Extension] ⚠️ Config element missing required attributes');
        }
    };
    // Use MutationObserver for immediate detection
    configObserver = new MutationObserver(() => {
        if (configuredSuccessfully) {
            return; // Skip if already configured
        }
        const configEl = document.getElementById('stormy-extension-config');
        if (configEl) {
            console.log('[Stormy Extension] 🎯 Config element detected via MutationObserver!');
            checkConfig();
        }
    });
    configObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
    // Also check every 2 seconds as fallback
    configCheckInterval = window.setInterval(() => {
        if (configuredSuccessfully || isFullyConnected) {
            cleanup();
            return;
        }
        checkConfig();
    }, 2000);
    // Check immediately
    checkConfig();
}
/**
 * Listen for storage changes to update state immediately
 */
chrome.storage.onChanged.addListener((changes, namespace) => {
    console.log('[Stormy Extension] 📦 Storage changed:', namespace, changes);
    // Only update if not already configured successfully
    if (!configuredSuccessfully) {
        injectExtensionState();
    }
});
/**
 * Initialize bridge with retry logic
 */
async function initialize() {
    initializationAttempts++;
    console.log(`[Stormy Extension] 🔄 Initialization attempt ${initializationAttempts}/${MAX_INIT_ATTEMPTS}`);
    // Check if we're on the correct page FIRST
    if (!isConnectedAccountsPage()) {
        console.log('[Stormy Extension] ⏭️ Skipping - not on /connected-accounts or /email_agent page');
        console.log('[Stormy Extension] Current path:', window.location.pathname);
        return; // Exit early
    }
    console.log('[Stormy Extension] ✓ On correct page, proceeding with initialization...');
    try {
        // Wait for document.body to be ready
        await waitForBody();
        if (!document.body) {
            throw new Error('document.body still null after waiting');
        }
        console.log('[Stormy Extension] 🚀 Starting initialization...');
        // Inject initial state
        await injectExtensionState();
        // Start watching for config
        watchForPageConfig();
        // Update state every 5 seconds to keep it fresh (will stop after config succeeds or fully connected)
        stateUpdateInterval = window.setInterval(() => {
            if (configuredSuccessfully || isFullyConnected) {
                cleanup();
                return;
            }
            console.log('[Stormy Extension] 🔄 Periodic state update...');
            injectExtensionState();
        }, 5000);
        console.log('[Stormy Extension] ✅ Bridge initialized successfully!');
    }
    catch (error) {
        console.error('[Stormy Extension] ❌ Initialization failed:', error);
        // Retry with exponential backoff
        if (initializationAttempts < MAX_INIT_ATTEMPTS) {
            const delay = Math.min(1000 * Math.pow(2, initializationAttempts), 10000);
            console.log(`[Stormy Extension] ⏰ Retrying in ${delay}ms...`);
            setTimeout(initialize, delay);
        }
        else {
            console.error('[Stormy Extension] ❌ Max initialization attempts reached. Giving up.');
        }
    }
}
// Start initialization immediately
console.log('[Stormy Extension] 🎬 Starting bridge initialization...');
initialize();

/******/ })()
;