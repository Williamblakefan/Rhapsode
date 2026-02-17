// Offline Sync Manager for Rhapsode
// ==================================
// Handles offline storage and syncing to Supabase when online

const SYNC_QUEUE_KEY = 'rhapsode_sync_queue';
const LAST_SYNC_KEY = 'rhapsode_last_sync';
const OFFLINE_POEMS_KEY = 'rhapsode_offline_poems';
const OFFLINE_PROGRESS_KEY = 'rhapsode_offline_progress';

// Track online status
let isOnline = navigator.onLine;

// Initialize online/offline listeners
function initOfflineSync() {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check initial status
    isOnline = navigator.onLine;
    updateOnlineStatus();

    // If online on startup, attempt sync
    if (isOnline) {
        setTimeout(() => syncPendingChanges(), 2000);
    }

    console.log('Offline sync initialized. Online:', isOnline);
}

function handleOnline() {
    isOnline = true;
    updateOnlineStatus();
    showToast && showToast('Online', 'Syncing your progress...');
    syncPendingChanges();
}

function handleOffline() {
    isOnline = false;
    updateOnlineStatus();
    showToast && showToast('Offline', 'Changes will sync when you reconnect');
}

function updateOnlineStatus() {
    const indicator = document.getElementById('online-status');
    if (indicator) {
        indicator.className = isOnline ? 'online-indicator online' : 'online-indicator offline';
        indicator.title = isOnline ? 'Online - syncing enabled' : 'Offline - changes saved locally';
    }
}

// =====================================
// SYNC QUEUE MANAGEMENT
// =====================================

function getSyncQueue() {
    try {
        return JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
    } catch (e) {
        return [];
    }
}

function saveSyncQueue(queue) {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
}

function addToSyncQueue(action, data) {
    const queue = getSyncQueue();
    queue.push({
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        action,
        data,
        timestamp: new Date().toISOString(),
        retries: 0
    });
    saveSyncQueue(queue);
    console.log('Added to sync queue:', action);
}

function removeFromSyncQueue(itemId) {
    const queue = getSyncQueue().filter(item => item.id !== itemId);
    saveSyncQueue(queue);
}

// =====================================
// OFFLINE DATA STORAGE
// =====================================

// Save poem progress locally (always, as backup)
function saveProgressLocally(poemId, progress) {
    const allProgress = JSON.parse(localStorage.getItem(OFFLINE_PROGRESS_KEY) || '{}');
    allProgress[poemId] = {
        ...progress,
        updatedAt: new Date().toISOString()
    };
    localStorage.setItem(OFFLINE_PROGRESS_KEY, JSON.stringify(allProgress));
}

// Get locally stored progress
function getLocalProgress(poemId) {
    const allProgress = JSON.parse(localStorage.getItem(OFFLINE_PROGRESS_KEY) || '{}');
    return allProgress[poemId] || null;
}

// Get all local progress
function getAllLocalProgress() {
    return JSON.parse(localStorage.getItem(OFFLINE_PROGRESS_KEY) || '{}');
}

// =====================================
// SYNC LOGIC
// =====================================

async function syncPendingChanges() {
    if (!isOnline) {
        console.log('Offline - skipping sync');
        return;
    }

    const user = typeof getCurrentUser === 'function' ? await getCurrentUser() : null;
    if (!user) {
        console.log('Not logged in - skipping cloud sync');
        return;
    }

    const queue = getSyncQueue();
    if (queue.length === 0) {
        console.log('No pending changes to sync');
        return;
    }

    console.log(`Syncing ${queue.length} pending changes...`);

    for (const item of queue) {
        try {
            await processSyncItem(item, user);
            removeFromSyncQueue(item.id);
        } catch (e) {
            console.error('Sync failed for item:', item.id, e);
            // Increment retry count
            item.retries = (item.retries || 0) + 1;
            if (item.retries >= 3) {
                console.error('Max retries reached, removing from queue:', item.id);
                removeFromSyncQueue(item.id);
            }
        }
    }

    // Also sync any local progress that might not be in queue
    await syncLocalProgressToCloud(user);

    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    console.log('Sync complete');
}

async function processSyncItem(item, user) {
    switch (item.action) {
        case 'save_poem':
            if (typeof saveUserPoem === 'function') {
                await saveUserPoem(user.id, item.data);
            }
            break;

        case 'remove_poem':
            if (typeof removeUserPoem === 'function') {
                await removeUserPoem(user.id, item.data.poemId);
            }
            break;

        case 'save_progress':
            if (typeof saveProgress === 'function') {
                await saveProgress(item.data.poemId, item.data.progress);
            }
            break;

        case 'save_quote':
            if (typeof saveUserQuote === 'function') {
                await saveUserQuote(user.id, item.data);
            }
            break;

        case 'delete_quote':
            if (typeof deleteUserQuote === 'function') {
                await deleteUserQuote(user.id, item.data.quoteId);
            }
            break;

        default:
            console.warn('Unknown sync action:', item.action);
    }
}

async function syncLocalProgressToCloud(user) {
    const localProgress = getAllLocalProgress();
    const poemIds = Object.keys(localProgress);

    if (poemIds.length === 0) return;

    console.log(`Syncing local progress for ${poemIds.length} poems...`);

    for (const poemId of poemIds) {
        try {
            if (typeof saveProgress === 'function') {
                await saveProgress(poemId, localProgress[poemId]);
            }
        } catch (e) {
            console.error('Failed to sync progress for poem:', poemId, e);
        }
    }
}

// =====================================
// WRAPPED FUNCTIONS (use these instead of direct Supabase calls)
// =====================================

// Wrapper for saving poem that handles offline
async function saveUserPoemOffline(poem) {
    // Always save locally first
    saveProgressLocally(poem.id, {
        stage: poem.stage,
        stageRepetition: poem.stageRepetition,
        lastPracticed: poem.lastPracticed,
        successfulReviews: poem.successfulReviews,
        hintsUsed: poem.hintsUsed
    });

    if (isOnline && typeof getCurrentUser === 'function') {
        const user = await getCurrentUser();
        if (user && typeof saveUserPoem === 'function') {
            try {
                await saveUserPoem(user.id, poem);
                return;
            } catch (e) {
                console.error('Online save failed, queuing:', e);
            }
        }
    }

    // Queue for later sync
    addToSyncQueue('save_poem', poem);
}

// Wrapper for saving progress that handles offline
async function saveProgressOffline(poemId, progress) {
    // Always save locally
    saveProgressLocally(poemId, progress);

    if (isOnline && typeof getCurrentUser === 'function') {
        const user = await getCurrentUser();
        if (user && typeof saveProgress === 'function') {
            try {
                await saveProgress(poemId, progress);
                return;
            } catch (e) {
                console.error('Online progress save failed, queuing:', e);
            }
        }
    }

    // Queue for later sync
    addToSyncQueue('save_progress', { poemId, progress });
}

// Check if we're online
function isAppOnline() {
    return isOnline;
}

// Get last sync time
function getLastSyncTime() {
    return localStorage.getItem(LAST_SYNC_KEY);
}

// Force a sync attempt
async function forceSyncNow() {
    if (!isOnline) {
        showToast && showToast('Offline', 'Cannot sync while offline');
        return false;
    }
    await syncPendingChanges();
    return true;
}

// Get pending sync count
function getPendingSyncCount() {
    return getSyncQueue().length;
}

// =====================================
// EXPORT FOR GLOBAL USE
// =====================================

if (typeof window !== 'undefined') {
    window.initOfflineSync = initOfflineSync;
    window.isAppOnline = isAppOnline;
    window.saveUserPoemOffline = saveUserPoemOffline;
    window.saveProgressOffline = saveProgressOffline;
    window.forceSyncNow = forceSyncNow;
    window.getPendingSyncCount = getPendingSyncCount;
    window.getLastSyncTime = getLastSyncTime;
    window.addToSyncQueue = addToSyncQueue;
    window.syncPendingChanges = syncPendingChanges;
}
