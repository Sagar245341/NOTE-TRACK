// 1. Database Configuration (Replace with your Supabase URL/Key)
const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';
const supabase = supabase.createClient(supabaseUrl, supabaseKey);

const canvas = document.getElementById('noteCanvas');
const ctx = canvas.getContext('2d');
let drawing = false;
let currentTool = 'pen';
let currentNoteId = null;

// Initialize Canvas
canvas.width = 800;
canvas.height = 1100;

// 2. Drawing Functions
function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return { x, y };
}

canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
});

canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const pos = getPos(e);
    ctx.lineWidth = currentTool === 'highlighter' ? 20 : 2;
    ctx.globalAlpha = currentTool === 'highlighter' ? 0.3 : 1.0;
    ctx.strokeStyle = document.getElementById('colorPicker').value;
    ctx.lineCap = 'round';
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
});

window.addEventListener('pointerup', () => drawing = false);

// 3. Photo to Written Note (OCR)
function triggerOCR() { document.getElementById('imageInput').click(); }

document.getElementById('imageInput').onchange = async (e) => {
    const file = e.target.files[0];
    const { data: { text } } = await Tesseract.recognize(file, 'eng');
    
    // Draw text onto canvas
    ctx.globalAlpha = 1.0;
    ctx.font = "20px Arial";
    ctx.fillStyle = "black";
    ctx.fillText(text, 50, 100); 
};

// 4. Database Actions
async function saveNote() {
    const drawingData = canvas.toDataURL(); // Converts canvas to image string
    const title = prompt("Note Title", "Untitled Note");

    const { data, error } = await supabase
        .from('notes')
        .upsert({ title, drawing_data: drawingData })
        .select();

    if (error) console.log('Error saving:', error);
    else alert('Saved to Cloud!');
}

document.getElementById('save-btn').addEventListener('click', saveNote);
document.getElementById('add-note-btn').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    currentNoteId = null;
});

function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-group button').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`${tool}-tool`).classList.add('active');
}

function toggleLining() {
    document.getElementById('canvas-container').classList.toggle('lining');
}
// --- 1. Enhanced Drawing (Eraser & Pressure Support) ---
function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    // Support for Apple Pencil Pressure
    const force = e.pressure || 1.0; 
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { 
        x: clientX - rect.left, 
        y: clientY - rect.top,
        pressure: force
    };
}

canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const pos = getPos(e);
    
    if (currentTool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out'; // "Cuts" through the ink
        ctx.lineWidth = 30;
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = currentTool === 'highlighter' ? 30 : (2 * pos.pressure); 
        ctx.globalAlpha = currentTool === 'highlighter' ? 0.3 : 1.0;
        ctx.strokeStyle = document.getElementById('colorPicker').value;
    }
    
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
});

// --- 2. Export to PDF ---
// Note: Requires adding <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
async function downloadPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'px', [canvas.width, canvas.height]);
    const imgData = canvas.toDataURL("image/png");
    doc.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
    doc.save("iPad-Note.pdf");
}

// --- 3. Dark Mode Toggle ---
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    // Save preference
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// --- 4. Intelligent OCR Placement ---
async function triggerOCR() {
    const input = document.getElementById('imageInput');
    input.onchange = async (e) => {
        document.getElementById('loading-overlay').style.display = 'block';
        const file = e.target.files[0];
        
        const worker = await Tesseract.createWorker('eng');
        const { data: { text } } = await worker.recognize(file);
        
        // Smart placement: find an empty spot or bottom of note
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;
        ctx.font = "20px 'Segoe UI', sans-serif";
        ctx.fillStyle = document.body.classList.contains('dark-mode') ? "white" : "black";
        
        // Wrap text logic
        const lines = text.split('\n');
        lines.forEach((line, i) => {
            ctx.fillText(line, 50, 100 + (i * 25));
        });
        
        await worker.terminate();
        document.getElementById('loading-overlay').style.display = 'none';
        autoSave();
    };
    input.click();
}
// When the user clicks "Save"
document.getElementById('save-btn').addEventListener('click', async () => {
    const title = document.getElementById('current-note-title').innerText;
    const savedNote = await saveNoteToCloud(currentNoteId, title, canvas);
    
    if (savedNote) {
        currentNoteId = savedNote.id; // Update global ID if it's a new note
        alert("Synced to Cloud!");
        renderSidebar(); // Refresh the list
    }
});

// When the app starts, load the list
async function renderSidebar() {
    const notes = await fetchAllNotes();
    const listContainer = document.getElementById('note-list');
    
    listContainer.innerHTML = notes.map(note => `
        <div class="note-item" onclick="openNote('${note.id}')">
            <strong>${note.title}</strong>
            <small>${new Date(note.updated_at).toLocaleDateString()}</small>
        </div>
    `).join('');
}

// When a user clicks a note in the sidebar
async function openNote(id) {
    const note = await loadNoteDetail(id);
    if (note) {
        currentNoteId = note.id;
        document.getElementById('current-note-title').innerText = note.title;
        
        // Clear canvas and draw the saved image
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0);
        img.src = note.drawing_data;
    }
}