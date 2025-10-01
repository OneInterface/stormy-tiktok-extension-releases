/******/ (() => { // webpackBootstrap
/******/ 	"use strict";

/**
 * Content Script
 *
 * Runs in the context of TikTok pages to extract localStorage and user data
 */
console.log('[Stormy TikTok Extension] Content script loaded');
/**
 * Extract TikTok username from window.__UNIVERSAL_DATA_FOR_REHYDRATION__
 */
function extractTikTokUsername() {
    try {
        // @ts-ignore - __UNIVERSAL_DATA_FOR_REHYDRATION__ is injected by TikTok
        const universalData = window.__UNIVERSAL_DATA_FOR_REHYDRATION__;
        if (!universalData) {
            return undefined;
        }
        // Try standard path first
        if (universalData.__DEFAULT_SCOPE__) {
            const appContext = universalData.__DEFAULT_SCOPE__['webapp.app-context'];
            if (appContext?.user?.uniqueId) {
                return appContext.user.uniqueId;
            }
        }
        // Try alternative paths
        if (universalData.__I) {
            const possiblePaths = [
                universalData.__I?.['webapp.app-context']?.user?.uniqueId,
                universalData.__I?.__DEFAULT_SCOPE__?.['webapp.app-context']?.user?.uniqueId,
            ];
            for (const path of possiblePaths) {
                if (path) {
                    return path;
                }
            }
        }
        return undefined;
    }
    catch (e) {
        console.error('[Stormy TikTok Extension] Error extracting username from window data:', e);
        return undefined;
    }
}
/**
 * Extract TikTok username from DOM elements (fallback method)
 * Uses the nav-profile link which is specific to the logged-in user
 */
function extractUsernameFromDOM() {
    try {
        // Look for the logged-in user's profile link in navigation (not other users on page)
        const profileLink = document.querySelector('a[data-e2e="nav-profile"]');
        if (!profileLink) {
            return undefined;
        }
        const href = profileLink.getAttribute('href');
        if (href) {
            // Remove /@ prefix and query params
            const username = href.replace('/@', '').split('?')[0];
            return username;
        }
    }
    catch (e) {
        console.error('[Stormy TikTok Extension] Error extracting username from DOM:', e);
    }
    return undefined;
}
// Listen for messages from background script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractLocalStorage') {
        try {
            // Extract all localStorage items
            const localStorageData = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key) {
                    const value = localStorage.getItem(key);
                    if (value !== null) {
                        localStorageData[key] = value;
                    }
                }
            }
            // Extract username from window data first, fall back to DOM
            const usernameFromWindow = extractTikTokUsername();
            const usernameFromDOM = usernameFromWindow ? undefined : extractUsernameFromDOM();
            const username = usernameFromWindow || usernameFromDOM;
            sendResponse({
                success: true,
                data: {
                    localStorage: localStorageData,
                    username: username
                }
            });
        }
        catch (error) {
            console.error('[Stormy TikTok Extension] Error extracting data:', error);
            sendResponse({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    return true; // Keep message channel open for async response
});

/******/ })()
;