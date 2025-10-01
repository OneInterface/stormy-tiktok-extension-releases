/******/ (() => { // webpackBootstrap
/******/ 	"use strict";

;// ./background/session-extractor.ts
/**
 * Session Extractor
 *
 * Extracts TikTok cookies and localStorage from the browser
 * and transforms them into the format expected by the backend.
 */
/**
 * Extract all TikTok cookies from Chrome
 */
async function extractTikTokCookies() {
    try {
        const cookies = await chrome.cookies.getAll({
            domain: '.tiktok.com'
        });
        console.log(`[SessionExtractor] Found ${cookies.length} TikTok cookies`);
        return cookies;
    }
    catch (error) {
        console.error('[SessionExtractor] Error extracting cookies:', error);
        throw new Error('Failed to extract cookies');
    }
}
/**
 * Extract localStorage and username from TikTok page via content script
 */
async function extractTikTokLocalStorage() {
    try {
        // Query for TikTok tabs
        const tabs = await chrome.tabs.query({
            url: 'https://*.tiktok.com/*'
        });
        if (tabs.length === 0) {
            throw new Error('No TikTok tab found. Please open tiktok.com first.');
        }
        const tab = tabs[0];
        if (!tab.id) {
            throw new Error('Invalid tab ID');
        }
        // Send message to content script to extract localStorage
        const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'extractLocalStorage'
        });
        if (!response || !response.success) {
            throw new Error(response?.error || 'Failed to extract localStorage');
        }
        console.log('[SessionExtractor] 📥 Raw response from content script:', {
            success: response.success,
            hasData: !!response.data,
            dataKeys: response.data ? Object.keys(response.data) : [],
            username: response.data?.username
        });
        // Handle both old format (just data) and new format (data.localStorage + data.username)
        const localStorage = response.data.localStorage || response.data;
        const username = response.data.username;
        console.log(`[SessionExtractor] 📊 Extracted ${Object.keys(localStorage).length} localStorage items`);
        console.log(`[SessionExtractor] 👤 Username from content script: ${username || 'NONE'}`);
        if (username) {
            console.log(`[SessionExtractor] ✅ Found username: ${username}`);
        }
        else {
            console.warn('[SessionExtractor] ⚠️ No username extracted from window data');
        }
        return {
            localStorage,
            username
        };
    }
    catch (error) {
        console.error('[SessionExtractor] Error extracting localStorage:', error);
        throw error;
    }
}
/**
 * Extract TikTok username from cookies or localStorage
 */
function extractUsername(cookies, localStorage) {
    // Try to extract from localStorage first
    try {
        // TikTok stores user info in various localStorage keys
        const userInfoKeys = ['user_info', 'userInfo', 'tiktok_user'];
        for (const key of userInfoKeys) {
            const value = localStorage[key];
            if (value) {
                try {
                    const parsed = JSON.parse(value);
                    if (parsed.username || parsed.uniqueId) {
                        return parsed.username || parsed.uniqueId;
                    }
                }
                catch {
                    // Not JSON, skip
                }
            }
        }
    }
    catch (error) {
        console.warn('[SessionExtractor] Could not extract username from localStorage');
    }
    // Try to extract from cookies
    const usernameCookie = cookies.find(c => c.name.toLowerCase().includes('username') ||
        c.name.toLowerCase().includes('uid'));
    if (usernameCookie) {
        return usernameCookie.value;
    }
    return undefined;
}
/**
 * Transform Chrome cookie format to Playwright cookie format
 */
function transformCookieFormat(chromeCookie) {
    return {
        name: chromeCookie.name,
        value: chromeCookie.value,
        domain: chromeCookie.domain,
        path: chromeCookie.path,
        expires: chromeCookie.expirationDate || -1,
        httpOnly: chromeCookie.httpOnly,
        secure: chromeCookie.secure,
        sameSite: transformSameSite(chromeCookie.sameSite)
    };
}
/**
 * Transform Chrome SameSite to Playwright SameSite
 */
function transformSameSite(sameSite) {
    switch (sameSite) {
        case 'strict':
            return 'Strict';
        case 'lax':
            return 'Lax';
        case 'no_restriction':
            return 'None';
        default:
            return 'Lax';
    }
}
/**
 * Extract complete session data (cookies + localStorage + username)
 */
async function extractSessionData() {
    console.log('[SessionExtractor] Starting session extraction...');
    // Extract cookies
    const chromeCookies = await extractTikTokCookies();
    // Extract localStorage and username
    const { localStorage, username: extractedUsername } = await extractTikTokLocalStorage();
    // Transform cookies to Playwright format
    const playwrightCookies = chromeCookies.map(transformCookieFormat);
    // Use extracted username from window data, fallback to old extraction method
    const username = extractedUsername || extractUsername(chromeCookies, localStorage);
    console.log('[SessionExtractor] 👤 Final username decision:', {
        extractedFromWindow: extractedUsername || 'NONE',
        fallbackUsername: extractedUsername ? 'not used' : (username || 'NONE'),
        finalUsername: username || 'NONE'
    });
    console.log('[SessionExtractor] Session extraction complete:', {
        cookieCount: playwrightCookies.length,
        localStorageCount: Object.keys(localStorage).length,
        username: username || 'unknown',
        usernameSource: extractedUsername ? 'window.__UNIVERSAL_DATA_FOR_REHYDRATION__' : 'fallback'
    });
    return {
        cookies: playwrightCookies,
        localStorage,
        username
    };
}

;// ./utils/api-client.ts
/**
 * API Client
 *
 * Handles communication with Stormy backend API
 */
class ApiClient {
    constructor() {
        this.config = null;
    }
    /**
     * Initialize API client with user configuration
     */
    async initialize() {
        // Get stored configuration
        const result = await chrome.storage.sync.get(['apiBaseUrl', 'userId']);
        if (!result.apiBaseUrl || !result.userId) {
            throw new Error('API not configured. Please set your API URL and User ID.');
        }
        this.config = {
            baseUrl: result.apiBaseUrl,
            userId: result.userId
        };
    }
    /**
     * Import browser session to Stormy backend
     */
    async importSession(sessionData) {
        if (!this.config) {
            await this.initialize();
        }
        if (!this.config) {
            throw new Error('API client not configured');
        }
        const url = `${this.config.baseUrl}/tiktok-dm/sessions/${this.config.userId}/import-browser`;
        console.log('[ApiClient] Importing session to:', url);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(sessionData)
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.detail || data.error || 'Failed to import session');
            }
            console.log('[ApiClient] Session imported successfully:', data);
            return data;
        }
        catch (error) {
            console.error('[ApiClient] Error importing session:', error);
            throw error;
        }
    }
    /**
     * Check connection status with backend
     */
    async checkConnectionStatus() {
        if (!this.config) {
            try {
                await this.initialize();
            }
            catch {
                return { connected: false, error: 'Not configured' };
            }
        }
        if (!this.config) {
            return { connected: false, error: 'Not configured' };
        }
        const url = `${this.config.baseUrl}/tiktok-dm/connections?user_id=${this.config.userId}`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                return { connected: false, error: 'API error' };
            }
            const data = await response.json();
            if (data.connections && data.connections.length > 0) {
                return {
                    connected: true,
                    username: data.connections[0].handle
                };
            }
            return { connected: false };
        }
        catch (error) {
            console.error('[ApiClient] Error checking connection:', error);
            return {
                connected: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    /**
     * Disconnect TikTok session
     */
    async disconnect() {
        if (!this.config) {
            await this.initialize();
        }
        if (!this.config) {
            throw new Error('API client not configured');
        }
        const url = `${this.config.baseUrl}/tiktok-dm/sessions/${this.config.userId}/disconnect`;
        try {
            const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || data.error || 'Failed to disconnect');
            }
            console.log('[ApiClient] Disconnected successfully');
        }
        catch (error) {
            console.error('[ApiClient] Error disconnecting:', error);
            throw error;
        }
    }
}
// Export singleton instance
const apiClient = new ApiClient();

;// ./background/background.ts
/**
 * Background Service Worker
 *
 * Handles extension lifecycle, message passing, and background tasks
 */


console.log('[Stormy TikTok Extension] Background service worker loaded');
// Note: Auto-configuration now happens via DOM bridge (stormy-bridge.ts content script)
// No need for external message listener
// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[Background] Received message:', request);
    if (request.action === 'extractAndSync') {
        handleExtractAndSync().then(sendResponse).catch(error => {
            sendResponse({
                success: false,
                error: error.message
            });
        });
        return true; // Keep channel open for async response
    }
    if (request.action === 'checkStatus') {
        handleCheckStatus().then(sendResponse).catch(error => {
            sendResponse({
                success: false,
                error: error.message
            });
        });
        return true;
    }
    if (request.action === 'disconnect') {
        handleDisconnect().then(sendResponse).catch(error => {
            sendResponse({
                success: false,
                error: error.message
            });
        });
        return true;
    }
    return false;
});
// Auto-config handler removed - now handled by stormy-bridge.ts content script via DOM
/**
 * Extract session and sync to backend
 */
async function handleExtractAndSync() {
    try {
        console.log('[Background] Starting session extraction and sync...');
        // Extract session data
        const sessionData = await extractSessionData();
        // Sync to backend
        const response = await apiClient.importSession(sessionData);
        console.log('[Background] Session synced successfully:', response);
        // Store last sync time
        await chrome.storage.local.set({
            lastSyncTime: new Date().toISOString(),
            lastSyncStatus: 'success'
        });
        return {
            success: true,
            data: response
        };
    }
    catch (error) {
        console.error('[Background] Error in extract and sync:', error);
        await chrome.storage.local.set({
            lastSyncTime: new Date().toISOString(),
            lastSyncStatus: 'error',
            lastSyncError: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
    }
}
/**
 * Check connection status with backend
 */
async function handleCheckStatus() {
    try {
        const status = await apiClient.checkConnectionStatus();
        return {
            success: true,
            data: status
        };
    }
    catch (error) {
        console.error('[Background] Error checking status:', error);
        throw error;
    }
}
/**
 * Disconnect from backend
 */
async function handleDisconnect() {
    try {
        await apiClient.disconnect();
        await chrome.storage.local.set({
            lastSyncTime: null,
            lastSyncStatus: null
        });
        return {
            success: true
        };
    }
    catch (error) {
        console.error('[Background] Error disconnecting:', error);
        throw error;
    }
}
// Extension installation/update handler
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('[Background] Extension installed');
        // User can configure by clicking the extension icon
    }
    else if (details.reason === 'update') {
        console.log('[Background] Extension updated to version', chrome.runtime.getManifest().version);
    }
});

/******/ })()
;