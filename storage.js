// Replace these with your actual Supabase project credentials
const supabaseUrl = 'https://YOUR_PROJECT_ID.supabase.co';
const supabaseKey = 'YOUR_ANON_KEY';
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

/**
 * Saves or updates a note in the database
 */
async function saveNoteToCloud(id, title, canvasElement) {
    const drawingData = canvasElement.toDataURL("image/png");
    
    const { data, error } = await supabaseClient
        .from('notes')
        .upsert({ 
            id: id || undefined, 
            title: title, 
            drawing_data: drawingData,
            updated_at: new Date() 
        })
        .select();

    if (error) {
        console.error('Error saving note:', error);
        return null;
    }
    return data[0]; // Returns the saved note object
}

/**
 * Fetches all notes for the sidebar list
 */
async function fetchAllNotes() {
    const { data, error } = await supabaseClient
        .from('notes')
        .select('id, title, updated_at')
        .order('updated_at', { ascending: false });

    if (error) {
        console.error('Error fetching notes:', error);
        return [];
    }
    return data;
}

/**
 * Loads a specific note's drawing data
 */
async function loadNoteDetail(id) {
    const { data, error } = await supabaseClient
        .from('notes')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        console.error('Error loading note:', error);
        return null;
    }
    return data;
}

/**
 * Deletes a note (Feature: Page Management)
 */
async function deleteNoteFromCloud(id) {
    const { error } = await supabaseClient
        .from('notes')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error deleting note:', error);
        return false;
    }
    return true;
}