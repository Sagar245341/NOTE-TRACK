// --- Global Variables ---
const canvas = document.getElementById('noteCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

// State
let drawing = false;
let currentTool = 'pen';
let brushSize = 3;
let brushColor = '#000000';
let currentNoteId = null;
let snapshot; // For shapes
let startX, startY;

// History (Undo/Redo)
let history = [];
let historyStep = -1;
const MAX_HISTORY = 20;

// --- Initialization ---
window.addEventListener('load', () => {
    resizeCanvas();
    saveState(); // Save initial blank state
    renderSidebar(); // Load notes from Supabase
    window.addEventListener('resize', resizeCanvas);

    // Check for saved theme preference
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-mode');
    }
});

function resizeCanvas() {
    const container = document.getElementById('canvas-container');
    if (container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight; // Or set to 1100 for fixed A4 height
    }
}

// --- Tool Management ---
window.setTool = function(tool) {
    currentTool = tool;
    // Update UI
    document.querySelectorAll('.tool-group button').forEach(btn => btn.classList.remove('active'));
    const btnId = (tool === 'rectangle' || tool === 'circle') ? null : `${tool}-tool`;
    if (document.getElementById(`${tool}-tool`)) {
        document.getElementById(`${tool}-tool`).classList.add('active');
    }
};

// Inputs
document.getElementById('colorPicker').addEventListener('input', (e) => brushColor = e.target.value);
document.getElementById('lineWidth').addEventListener('input', (e) => brushSize = parseInt(e.target.value, 10));
document.getElementById('bgColorPicker').addEventListener('input', (e) => canvas.style.backgroundColor = e.target.value);

// --- Drawing Logic ---
function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
        x: clientX - rect.left,
        y: clientY - rect.top
    };
}

canvas.addEventListener('pointerdown', (e) => {
    const pos = getPos(e);
    if (currentTool === 'text') {
        const text = prompt("Enter text:");
        if (text) {
            ctx.font = "20px Arial";
            ctx.fillStyle = brushColor;
            ctx.fillText(text, pos.x, pos.y);
            saveState();
        }
        return; // Don't start drawing
    }

    drawing = true;
    ctx.beginPath();
    startX = pos.x;
    startY = pos.y;
    ctx.moveTo(pos.x, pos.y);
    
    // Save snapshot for shapes to avoid trails
    if (['rectangle', 'circle'].includes(currentTool)) {
        snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
        ctx.beginPath(); // Reset path for the shape
    }
});

canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const pos = getPos(e);

    ctx.lineWidth = currentTool === 'highlighter' ? 20 : brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = brushColor;

    if (currentTool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = brushSize * 5;
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    } else if (['pen', 'highlighter'].includes(currentTool)) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = currentTool === 'highlighter' ? 0.4 : 1.0;
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    } else if (['rectangle', 'circle'].includes(currentTool)) {
        ctx.putImageData(snapshot, 0, 0); // Restore previous frame
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        
        if (currentTool === 'rectangle') {
            ctx.rect(startX, startY, pos.x - startX, pos.y - startY);
            ctx.stroke();
        }
        else if (currentTool === 'circle') {
            const radius = Math.sqrt(Math.pow(pos.x - startX, 2) + Math.pow(pos.y - startY, 2));
            ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
            ctx.stroke();
        }
    }
});

canvas.addEventListener('pointerup', () => {
    if (drawing) {
        drawing = false;
        ctx.closePath();
        saveState();
    }
});

// --- Undo / Redo ---
function saveState() {
    historyStep++;
    if (historyStep < history.length) {
        history.length = historyStep; // Truncate redo history
    }
    history.push(canvas.toDataURL());
    if (history.length > MAX_HISTORY) {
        history.shift();
        historyStep--;
    }
}

window.undo = function() {
    if (historyStep > 0) {
        historyStep--;
        restoreState();
    }
};

window.redo = function() {
    if (historyStep < history.length - 1) {
        historyStep++;
        restoreState();
    }
};

function restoreState() {
    const img = new Image();
    img.src = history[historyStep];
    img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
    };
}

window.clearCanvas = function() {
    if (confirm("Clear canvas?")) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        saveState();
    }
};

window.triggerOCR = async function() {
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
        saveState();
    };
    input.click();
}

window.toggleDarkMode = function() {
    document.body.classList.toggle('dark-mode');
    // Save preference
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
};

window.downloadPDF = function() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'px', format: [canvas.width, canvas.height] });
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
    doc.save('note.pdf');
};

// --- Cloud Integration (Calls storage.js) ---
document.getElementById('save-btn').addEventListener('click', async () => {
    const title = prompt("Note Title:", "My Note");
    if (title) {
        const saved = await saveNoteToCloud(currentNoteId, title, canvas);
        if (saved) {
            currentNoteId = saved.id;
            alert("Saved!");
            renderSidebar();
        }
    }
});

document.getElementById('add-note-btn').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    currentNoteId = null;
    saveState();
});

window.deleteCurrentNote = async function() {
    if (currentNoteId && confirm("Delete this note?")) {
        await deleteNoteFromCloud(currentNoteId);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        currentNoteId = null;
        renderSidebar();
    }
};

// Helper to render sidebar (uses storage.js)
async function renderSidebar() {
    const notes = await fetchAllNotes();
    const list = document.getElementById('note-list');
    list.innerHTML = '';
    notes.forEach(note => {
        const div = document.createElement('div');
        div.className = 'note-item';
        div.innerText = note.title;
        div.onclick = async () => {
            const fullNote = await loadNoteDetail(note.id);
            if (fullNote) {
                currentNoteId = fullNote.id;
                const img = new Image();
                img.onload = () => {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0);
                    saveState();
                };
                img.src = fullNote.drawing_data;
            }
        };
        list.appendChild(div);
    });
}