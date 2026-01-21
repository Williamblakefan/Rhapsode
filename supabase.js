// Supabase Configuration for Rhapsode
// =====================================
//
// SETUP INSTRUCTIONS:
// 1. Go to https://supabase.com and create a free account
// 2. Create a new project (pick any name and a strong database password)
// 3. Wait for the project to be provisioned (~2 minutes)
// 4. Go to Project Settings > API
// 5. Copy your "Project URL" and paste it below as SUPABASE_URL
// 6. Copy your "anon public" key and paste it below as SUPABASE_ANON_KEY
//
// IMPORTANT: The anon key is safe to use in client-side code.
// It only allows access based on your Row Level Security (RLS) policies.

const SUPABASE_URL = 'https://oqewlauwovuvrmbyetyd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_FdXttvPlJAIi3POySLKBDA_jq6-oalN';

// Initialize Supabase client
// The supabase-js library is loaded via CDN in the HTML file
let supabaseClient = null;

function initSupabase() {
    if (typeof window.supabase !== 'undefined' && SUPABASE_URL !== 'YOUR_SUPABASE_PROJECT_URL') {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        return true;
    }
    return false;
}

// =====================================
// AUTH FUNCTIONS
// =====================================

async function signUp(email, password) {
    if (!supabaseClient) throw new Error('Supabase not initialized');

    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password
    });

    if (error) throw error;
    return data;
}

async function signIn(email, password) {
    if (!supabaseClient) throw new Error('Supabase not initialized');

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
    });

    if (error) throw error;
    return data;
}

async function signOut() {
    if (!supabaseClient) throw new Error('Supabase not initialized');

    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
}

async function resetPassword(email) {
    if (!supabaseClient) throw new Error('Supabase not initialized');

    const { data, error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/mnemosyne.html'
    });

    if (error) throw error;
    return data;
}

async function updatePassword(newPassword) {
    if (!supabaseClient) throw new Error('Supabase not initialized');

    const { data, error } = await supabaseClient.auth.updateUser({
        password: newPassword
    });

    if (error) throw error;
    return data;
}

async function getCurrentUser() {
    if (!supabaseClient) return null;

    const { data: { user } } = await supabaseClient.auth.getUser();
    return user;
}

function onAuthStateChange(callback) {
    if (!supabaseClient) return null;

    return supabaseClient.auth.onAuthStateChange((event, session) => {
        callback(event, session);
    });
}

// =====================================
// DATABASE FUNCTIONS
// =====================================

// Get user's poems from Supabase
async function fetchUserPoems(userId) {
    if (!supabaseClient) return [];

    const { data, error } = await supabaseClient
        .from('user_poems')
        .select('*')
        .eq('user_id', userId)
        .order('added_at', { ascending: false });

    if (error) {
        console.error('Error fetching poems:', error);
        return [];
    }

    // Transform from DB format to app format
    return data.map(row => ({
        id: row.poem_id,
        title: row.title,
        author: row.author,
        stanzas: row.stanzas,
        text: row.text,
        stage: row.stage,
        stageRepetition: row.stage_repetition,
        lastPracticed: row.last_practiced ? new Date(row.last_practiced).getTime() : null,
        successfulReviews: row.successful_reviews,
        hintsUsed: row.hints_used,
        addedAt: new Date(row.added_at).getTime(),
        isCustom: row.is_custom
    }));
}

// Save a poem to user's collection in Supabase
async function saveUserPoem(userId, poem) {
    if (!supabaseClient) return null;

    const { data, error } = await supabaseClient
        .from('user_poems')
        .upsert({
            user_id: userId,
            poem_id: poem.id,
            title: poem.title,
            author: poem.author || 'Unknown',
            stanzas: poem.stanzas,
            text: poem.text || null,
            stage: poem.stage || 1,
            stage_repetition: poem.stageRepetition || 1,
            last_practiced: poem.lastPracticed ? new Date(poem.lastPracticed).toISOString() : null,
            successful_reviews: poem.successfulReviews || 0,
            hints_used: poem.hintsUsed || 0,
            added_at: poem.addedAt ? new Date(poem.addedAt).toISOString() : new Date().toISOString(),
            is_custom: poem.isCustom || false
        }, {
            onConflict: 'user_id,poem_id'
        });

    if (error) {
        console.error('Error saving poem:', error);
        throw error;
    }

    return data;
}

// Remove a poem from user's collection
async function removeUserPoem(userId, poemId) {
    if (!supabaseClient) return;

    const { error } = await supabaseClient
        .from('user_poems')
        .delete()
        .eq('user_id', userId)
        .eq('poem_id', poemId);

    if (error) {
        console.error('Error removing poem:', error);
        throw error;
    }
}

// Sync all poems (for migration from localStorage)
async function syncAllPoems(userId, poems) {
    if (!supabaseClient || !poems.length) return;

    // Save each poem
    for (const poem of poems) {
        await saveUserPoem(userId, poem);
    }
}

// =====================================
// POEM SAVES TRACKING (for Popular This Week)
// =====================================

// Record a poem save for popularity tracking
async function recordPoemSave(poemId) {
    if (!supabaseClient) return null;

    const user = await getCurrentUser();
    if (!user) return null; // Only logged-in users contribute to saves

    const { data, error } = await supabaseClient
        .from('poem_saves')
        .insert({
            poem_id: poemId,
            user_id: user.id
        });

    if (error) {
        console.error('Error recording poem save:', error);
        return null;
    }
    return data;
}

// Remove a poem save record when user removes poem
async function removePoemSave(poemId) {
    if (!supabaseClient) return;

    const user = await getCurrentUser();
    if (!user) return;

    const { error } = await supabaseClient
        .from('poem_saves')
        .delete()
        .eq('poem_id', poemId)
        .eq('user_id', user.id);

    if (error) {
        console.error('Error removing poem save:', error);
    }
}

// Cache for popular this week
let popularThisWeekCache = null;
let popularThisWeekCacheTime = null;
const POPULAR_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Get most saved poems in the last 7 days
async function getPopularThisWeek(limit = 10) {
    if (!supabaseClient) return [];

    // Check cache first
    if (popularThisWeekCache && popularThisWeekCacheTime &&
        (Date.now() - popularThisWeekCacheTime) < POPULAR_CACHE_DURATION) {
        return popularThisWeekCache;
    }

    // Calculate date 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data, error } = await supabaseClient
        .rpc('get_popular_poems_this_week', {
            days_ago: 7,
            result_limit: limit
        });

    if (error) {
        console.error('Error fetching popular poems:', error);
        // Fallback: try raw query if RPC doesn't exist
        return await getPopularThisWeekFallback(limit, sevenDaysAgo);
    }

    // Cache the results
    popularThisWeekCache = data || [];
    popularThisWeekCacheTime = Date.now();

    return popularThisWeekCache;
}

// Fallback query if RPC function doesn't exist
async function getPopularThisWeekFallback(limit, sinceDate) {
    if (!supabaseClient) return [];

    const { data, error } = await supabaseClient
        .from('poem_saves')
        .select('poem_id')
        .gte('saved_at', sinceDate.toISOString());

    if (error) {
        console.error('Error in fallback popular query:', error);
        return [];
    }

    // Count saves per poem manually
    const counts = {};
    data.forEach(row => {
        counts[row.poem_id] = (counts[row.poem_id] || 0) + 1;
    });

    // Convert to array and sort
    const popular = Object.entries(counts)
        .map(([poem_id, save_count]) => ({ poem_id, save_count }))
        .sort((a, b) => b.save_count - a.save_count)
        .slice(0, limit);

    // Cache the results
    popularThisWeekCache = popular;
    popularThisWeekCacheTime = Date.now();

    return popular;
}

// Clear popular cache (call when a save is added/removed)
function clearPopularCache() {
    popularThisWeekCache = null;
    popularThisWeekCacheTime = null;
}

// =====================================
// APP SETTINGS (for admin panel)
// =====================================

// Get a setting by ID
async function getAppSetting(settingId) {
    if (!supabaseClient) return null;

    const { data, error } = await supabaseClient
        .from('app_settings')
        .select('value')
        .eq('id', settingId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        console.error('Error fetching setting:', error);
        return null;
    }

    return data?.value;
}

// Save a setting
async function saveAppSetting(settingId, value) {
    if (!supabaseClient) throw new Error('Supabase not initialized');

    const { error } = await supabaseClient
        .from('app_settings')
        .upsert({
            id: settingId,
            value: value,
            updated_at: new Date().toISOString()
        }, {
            onConflict: 'id'
        });

    if (error) {
        console.error('Error saving setting:', error);
        throw error;
    }
}

// Delete a setting
async function deleteAppSetting(settingId) {
    if (!supabaseClient) return;

    const { error } = await supabaseClient
        .from('app_settings')
        .delete()
        .eq('id', settingId);

    if (error) {
        console.error('Error deleting setting:', error);
        throw error;
    }
}

// Get all app settings at once (for initial load)
async function getAllAppSettings() {
    if (!supabaseClient) return {};

    const { data, error } = await supabaseClient
        .from('app_settings')
        .select('id, value');

    if (error) {
        console.error('Error fetching all settings:', error);
        return {};
    }

    // Convert array to object keyed by id
    const settings = {};
    for (const row of data || []) {
        settings[row.id] = row.value;
    }
    return settings;
}

// Verify admin password (stored in app_settings)
async function verifyAdminPassword(password) {
    const storedHash = await getAppSetting('secret_password_hash');
    if (!storedHash) {
        // No password configured in database
        return false;
    }
    // Simple comparison (in production, use proper hashing)
    return password === storedHash;
}

// =====================================
// POEMS TABLE (library management)
// =====================================

// Fetch all poems from the database
async function fetchAllPoems() {
    if (!supabaseClient) return null;

    const { data, error } = await supabaseClient
        .from('poems')
        .select('*')
        .order('author', { ascending: true })
        .order('title', { ascending: true });

    if (error) {
        console.error('Error fetching poems:', error);
        return null;
    }

    return data;
}

// Get a single poem by ID
async function fetchPoemById(poemId) {
    if (!supabaseClient) return null;

    const { data, error } = await supabaseClient
        .from('poems')
        .select('*')
        .eq('id', poemId)
        .single();

    if (error) {
        console.error('Error fetching poem:', error);
        return null;
    }

    return data;
}

// Add a new poem
async function addPoem(poem) {
    if (!supabaseClient) throw new Error('Supabase not initialized');

    const { data, error } = await supabaseClient
        .from('poems')
        .insert({
            id: poem.id,
            title: poem.title,
            author: poem.author,
            stanzas: poem.stanzas,
            themes: poem.themes || [],
            popularity: poem.popularity || null,
            collections: poem.collections || [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .select()
        .single();

    if (error) {
        console.error('Error adding poem:', error);
        throw error;
    }

    return data;
}

// Update an existing poem
async function updatePoem(poemId, updates) {
    if (!supabaseClient) throw new Error('Supabase not initialized');

    const { data, error } = await supabaseClient
        .from('poems')
        .update({
            ...updates,
            updated_at: new Date().toISOString()
        })
        .eq('id', poemId)
        .select()
        .single();

    if (error) {
        console.error('Error updating poem:', error);
        throw error;
    }

    return data;
}

// Delete a poem
async function deletePoem(poemId) {
    if (!supabaseClient) throw new Error('Supabase not initialized');

    const { error } = await supabaseClient
        .from('poems')
        .delete()
        .eq('id', poemId);

    if (error) {
        console.error('Error deleting poem:', error);
        throw error;
    }
}

// Bulk insert poems (for migration)
async function bulkInsertPoems(poems) {
    if (!supabaseClient) throw new Error('Supabase not initialized');

    const poemsWithTimestamps = poems.map(poem => ({
        id: poem.id,
        title: poem.title,
        author: poem.author,
        stanzas: poem.stanzas,
        themes: poem.themes || [],
        popularity: poem.popularity || null,
        collections: poem.collections || [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }));

    const { data, error } = await supabaseClient
        .from('poems')
        .upsert(poemsWithTimestamps, { onConflict: 'id' });

    if (error) {
        console.error('Error bulk inserting poems:', error);
        throw error;
    }

    return data;
}

// =====================================
// PROGRESS FUNCTIONS
// =====================================

async function saveProgress(poemId, progressData) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Must be logged in to save progress');

    const { data, error } = await supabaseClient
        .from('user_progress')
        .upsert({
            user_id: user.id,
            poem_id: poemId,
            stage: progressData.stage || 1,
            stage_repetition: progressData.stageRepetition || 1,
            last_practiced: progressData.lastPracticed ? new Date(progressData.lastPracticed).toISOString() : null,
            successful_reviews: progressData.successfulReviews || 0,
            hints_used: progressData.hintsUsed || 0,
            updated_at: new Date().toISOString()
        }, {
            onConflict: 'user_id,poem_id'
        });

    if (error) {
        console.error('Error saving progress:', error);
        throw error;
    }
    return data;
}

async function getProgress(poemId) {
    const user = await getCurrentUser();
    if (!user) return null;

    const { data, error } = await supabaseClient
        .from('user_progress')
        .select('*')
        .eq('user_id', user.id)
        .eq('poem_id', poemId)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('Error fetching progress:', error);
        return null;
    }

    if (!data) return null;

    return {
        stage: data.stage,
        stageRepetition: data.stage_repetition,
        lastPracticed: data.last_practiced ? new Date(data.last_practiced).getTime() : null,
        successfulReviews: data.successful_reviews,
        hintsUsed: data.hints_used
    };
}

async function getAllProgress() {
    const user = await getCurrentUser();
    if (!user) return {};

    const { data, error } = await supabaseClient
        .from('user_progress')
        .select('*')
        .eq('user_id', user.id);

    if (error) {
        console.error('Error fetching all progress:', error);
        return {};
    }

    const progressMap = {};
    data.forEach(item => {
        progressMap[item.poem_id] = {
            stage: item.stage,
            stageRepetition: item.stage_repetition,
            lastPracticed: item.last_practiced ? new Date(item.last_practiced).getTime() : null,
            successfulReviews: item.successful_reviews,
            hintsUsed: item.hints_used
        };
    });

    return progressMap;
}

// =====================================
// USER POEMS (simplified interface)
// =====================================

async function getUserPoems() {
    const user = await getCurrentUser();
    if (!user) return [];
    return fetchUserPoems(user.id);
}

// =====================================
// QUOTES FUNCTIONS
// =====================================

// Cache for user quotes
let userQuotesCache = null;

// Fetch user's quotes from Supabase
async function fetchUserQuotes(userId) {
    if (!supabaseClient) return [];

    const { data, error } = await supabaseClient
        .from('user_quotes')
        .select('*')
        .eq('user_id', userId)
        .order('saved_at', { ascending: false });

    if (error) {
        console.error('Error fetching quotes:', error);
        return [];
    }

    // Transform from DB format to app format
    return data.map(row => ({
        id: row.id,
        text: row.text,
        poemTitle: row.poem_title,
        author: row.author,
        poemId: row.poem_id,
        savedAt: row.saved_at
    }));
}

// Save a quote to Supabase
async function saveUserQuote(userId, quote) {
    if (!supabaseClient) return null;

    const { data, error } = await supabaseClient
        .from('user_quotes')
        .insert({
            id: quote.id,
            user_id: userId,
            text: quote.text,
            poem_title: quote.poemTitle,
            author: quote.author,
            poem_id: quote.poemId,
            saved_at: quote.savedAt || new Date().toISOString()
        })
        .select()
        .single();

    if (error) {
        console.error('Error saving quote:', error);
        throw error;
    }

    // Clear cache
    userQuotesCache = null;
    return data;
}

// Delete a quote from Supabase
async function deleteUserQuote(userId, quoteId) {
    if (!supabaseClient) return;

    const { error } = await supabaseClient
        .from('user_quotes')
        .delete()
        .eq('user_id', userId)
        .eq('id', quoteId);

    if (error) {
        console.error('Error deleting quote:', error);
        throw error;
    }

    // Clear cache
    userQuotesCache = null;
}

// Sync all quotes from localStorage to Supabase
async function syncAllQuotes(userId, quotes) {
    if (!supabaseClient || !quotes.length) return;

    const quotesWithUserId = quotes.map(quote => ({
        id: quote.id,
        user_id: userId,
        text: quote.text,
        poem_title: quote.poemTitle,
        author: quote.author,
        poem_id: quote.poemId,
        saved_at: quote.savedAt || new Date().toISOString()
    }));

    const { error } = await supabaseClient
        .from('user_quotes')
        .upsert(quotesWithUserId, { onConflict: 'id' });

    if (error) {
        console.error('Error syncing quotes:', error);
        throw error;
    }

    // Clear cache
    userQuotesCache = null;
}

// Clear quotes cache
function clearQuotesCache() {
    userQuotesCache = null;
}

// =====================================
// COLLECTIONS FUNCTIONS
// =====================================

// Fetch all collections from the database
async function fetchAllCollections() {
    if (!supabaseClient) return null;

    const { data, error } = await supabaseClient
        .from('collections')
        .select('id, name')
        .order('name', { ascending: true });

    if (error) {
        console.error('Error fetching collections:', error);
        return null;
    }

    // Transform to app format (poemIds no longer needed - counted dynamically from poems)
    return data.map(row => ({
        id: row.id,
        name: row.name
    }));
}

// Add a new collection
async function addCollection(id, name) {
    if (!supabaseClient) throw new Error('Supabase not initialized');

    const { data, error } = await supabaseClient
        .from('collections')
        .insert({ id, name })
        .select()
        .single();

    if (error) {
        console.error('Error adding collection:', error);
        throw error;
    }

    return data;
}

// Update a collection name
async function updateCollection(id, name) {
    if (!supabaseClient) throw new Error('Supabase not initialized');

    const { data, error } = await supabaseClient
        .from('collections')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error('Error updating collection:', error);
        throw error;
    }

    return data;
}

// Delete a collection
async function deleteCollection(id) {
    if (!supabaseClient) throw new Error('Supabase not initialized');

    const { error } = await supabaseClient
        .from('collections')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error deleting collection:', error);
        throw error;
    }
}

// Add a poem to a collection (updates the poem's collections array)
async function addPoemToCollection(poemId, collectionId) {
    if (!supabaseClient) throw new Error('Supabase not initialized');

    // First get the current collections
    const { data: poem, error: fetchError } = await supabaseClient
        .from('poems')
        .select('collections')
        .eq('id', poemId)
        .single();

    if (fetchError) throw fetchError;

    const currentCollections = poem.collections || [];
    if (currentCollections.includes(collectionId)) return; // Already in collection

    const newCollections = [...currentCollections, collectionId];

    const { error } = await supabaseClient
        .from('poems')
        .update({ collections: newCollections })
        .eq('id', poemId);

    if (error) throw error;
}

// Remove a poem from a collection
async function removePoemFromCollection(poemId, collectionId) {
    if (!supabaseClient) throw new Error('Supabase not initialized');

    // First get the current collections
    const { data: poem, error: fetchError } = await supabaseClient
        .from('poems')
        .select('collections')
        .eq('id', poemId)
        .single();

    if (fetchError) throw fetchError;

    const currentCollections = poem.collections || [];
    const newCollections = currentCollections.filter(c => c !== collectionId);

    const { error } = await supabaseClient
        .from('poems')
        .update({ collections: newCollections })
        .eq('id', poemId);

    if (error) throw error;
}

// =====================================
// UTILITY
// =====================================

function isSupabaseConfigured() {
    return SUPABASE_URL !== 'YOUR_SUPABASE_PROJECT_URL' &&
           SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY';
}

// =====================================
// ACCOUNT DELETION
// =====================================

// Delete all user data and account
async function deleteUserAccount(userId) {
    if (!supabaseClient || !userId) {
        throw new Error('Unable to delete account');
    }

    // Delete user poems
    const { error: poemsError } = await supabaseClient
        .from('user_poems')
        .delete()
        .eq('user_id', userId);
    if (poemsError) console.error('Error deleting user poems:', poemsError);

    // Delete poem saves (popularity tracking)
    const { error: savesError } = await supabaseClient
        .from('poem_saves')
        .delete()
        .eq('user_id', userId);
    if (savesError) console.error('Error deleting poem saves:', savesError);

    // Delete user progress
    const { error: progressError } = await supabaseClient
        .from('user_progress')
        .delete()
        .eq('user_id', userId);
    if (progressError) console.error('Error deleting user progress:', progressError);

    // Delete user quotes
    const { error: quotesError } = await supabaseClient
        .from('user_quotes')
        .delete()
        .eq('user_id', userId);
    if (quotesError) console.error('Error deleting user quotes:', quotesError);

    // Finally, delete the user auth account
    // Note: This requires the user to be signed in and uses the auth API
    const { error: authError } = await supabaseClient.auth.admin.deleteUser(userId);
    if (authError) {
        // If admin delete fails, try to sign out the user
        // The actual user deletion may need to be done via Supabase dashboard or edge function
        console.error('Error deleting auth user (may require admin access):', authError);
    }

    return true;
}

// =====================================
// INITIALIZE AND EXPORT
// =====================================

// Auto-initialize on load
if (typeof window !== 'undefined') {
    initSupabase();

    // Export all functions globally
    window.isSupabaseConfigured = isSupabaseConfigured;
    window.initSupabase = initSupabase;
    window.signUp = signUp;
    window.signIn = signIn;
    window.signOut = signOut;
    window.resetPassword = resetPassword;
    window.updatePassword = updatePassword;
    window.getCurrentUser = getCurrentUser;
    window.onAuthStateChange = onAuthStateChange;
    window.fetchAllPoems = fetchAllPoems;
    window.fetchPoemById = fetchPoemById;
    window.addPoem = addPoem;
    window.updatePoem = updatePoem;
    window.deletePoem = deletePoem;
    window.bulkInsertPoems = bulkInsertPoems;
    window.fetchUserPoems = fetchUserPoems;
    window.saveUserPoem = saveUserPoem;
    window.removeUserPoem = removeUserPoem;
    window.getUserPoems = getUserPoems;
    window.syncAllPoems = syncAllPoems;
    window.recordPoemSave = recordPoemSave;
    window.removePoemSave = removePoemSave;
    window.getPopularThisWeek = getPopularThisWeek;
    window.clearPopularCache = clearPopularCache;
    window.saveProgress = saveProgress;
    window.getProgress = getProgress;
    window.getAllProgress = getAllProgress;
    window.getAppSetting = getAppSetting;
    window.saveAppSetting = saveAppSetting;
    window.deleteAppSetting = deleteAppSetting;
    window.getAllAppSettings = getAllAppSettings;
    window.verifyAdminPassword = verifyAdminPassword;
    window.fetchUserQuotes = fetchUserQuotes;
    window.saveUserQuote = saveUserQuote;
    window.deleteUserQuote = deleteUserQuote;
    window.syncAllQuotes = syncAllQuotes;
    window.clearQuotesCache = clearQuotesCache;
    window.fetchAllCollections = fetchAllCollections;
    window.addCollection = addCollection;
    window.updateCollection = updateCollection;
    window.deleteCollection = deleteCollection;
    window.addPoemToCollection = addPoemToCollection;
    window.removePoemFromCollection = removePoemFromCollection;
    window.deleteUserAccount = deleteUserAccount;

    console.log('Supabase.js loaded and initialized');
}
