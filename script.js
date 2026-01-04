// --- Global Variables ---
const canvas = document.getElementById('noteCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

// State
let drawing = false;
let currentTool = 'pen';
let brushSize = 3;
let brushColor = '#000000';
let currentNoteId = null;
let currentFontFamily = 'Arial'; // Default font
let currentFontSize = 20; // Default font size
let snapshot; // For shapes
let startX, startY;
let activeNoteItem = null; // To keep track of the currently active note div in the sidebar

// History (Undo/Redo)
let history = [];
let historyStep = -1;
const MAX_HISTORY = 20;

// --- Initialization ---
window.addEventListener('load', async () => {
    resizeCanvas();
    saveState(); // Save initial blank state
    await renderSidebar(); // Load notes from Supabase
    window.addEventListener('resize', resizeCanvas);

    // Check for saved theme preference
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-mode');
    }

    // Load the last active note or create a new one
    const lastActiveNoteId = localStorage.getItem('lastActiveNoteId');
    if (lastActiveNoteId) {
        const fullNote = await loadNoteDetail(lastActiveNoteId);
        if (fullNote) {
            loadNoteIntoCanvas(fullNote);
        } else {
            // Last active note not found, create a new one
            createNewNote();
        }
    } else {
        // No last active note, create a new one
        createNewNote();
    }

    // Auto-save every 10 seconds
    setInterval(autoSaveCurrentNote, 10000);
});

function resizeCanvas() {
    // Set canvas dimensions to A4 size (approx 794px x 1122px at 96 DPI)
    const a4Width = 794;
    const a4Height = 1122;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    canvas.width = a4Width;
    canvas.height = a4Height;

    ctx.putImageData(imageData, 0, 0);
    // Ensure the container allows scrolling if the canvas is larger than viewport
    // This is primarily handled by CSS (`#canvas-container { overflow: auto; }`)
}


// --- Tool Management ---
window.setTool = function(tool) {
    currentTool = tool;
    // Update UI
    document.querySelectorAll('.tool-group button').forEach(btn => btn.classList.remove('active'));
    // The previous logic for btnId was not robust enough. Let's simplify.
    const activeBtn = document.getElementById(`${tool}-tool`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    // Also highlight the text tool if a font family is selected
    if (tool === 'text') {
        document.getElementById('text-tool').classList.add('active');
    }
};

window.setFontFamily = function(font) {
    currentFontFamily = font;
    ctx.font = `${currentFontSize}px ${currentFontFamily}`; // Update context font immediately
    setTool('text'); // Automatically switch to text tool
};

window.setPenColor = function(color) {
    brushColor = color;
    document.getElementById('colorPicker').value = color; // Update color picker UI
    setTool('pen'); // Automatically switch to pen tool
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
        const text = prompt("Enter text:", "");
        if (text) {
            ctx.font = `${currentFontSize}px ${currentFontFamily}`;
            ctx.fillStyle = brushColor;
            
            // Basic text wrapping
            const maxWidth = canvas.width - pos.x - 20; // 20px padding
            let currentLine = '';
            let y = pos.y;
            const lineHeight = currentFontSize * 1.2;

            const words = text.split(' ');
            for (let i = 0; i < words.length; i++) {
                const testLine = currentLine + words[i] + ' ';
                const metrics = ctx.measureText(testLine);
                const testWidth = metrics.width;
                if (testWidth > maxWidth && i > 0) {
                    ctx.fillText(currentLine, pos.x, y);
                    currentLine = words[i] + ' ';
                    y += lineHeight;
                } else {
                    currentLine = testLine;
                }
            }
            ctx.fillText(currentLine, pos.x, y);

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
    } else if (['rectangle', 'circle', 'arrow'].includes(currentTool)) {
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
        else if (currentTool === 'arrow') {
            ctx.moveTo(startX, startY);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
            drawArrowhead(ctx, startX, startY, pos.x, pos.y, brushSize * 2);
        }
    }
});

canvas.addEventListener('pointerup', () => {
    if (drawing) {
        drawing = false;
        ctx.closePath();
        
        // For shapes and arrows, finalize the drawing on pointerup
        if (['rectangle', 'circle', 'arrow'].includes(currentTool) && snapshot) {
            // Redraw the final shape/arrow without snapshot to save it permanently
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const img = new Image();
            img.src = history[historyStep]; // Get last saved state
            img.onload = () => {
                ctx.drawImage(img, 0, 0);
                ctx.strokeStyle = brushColor;
                ctx.lineWidth = brushSize;
                ctx.globalCompositeOperation = 'source-over';
                ctx.globalAlpha = 1.0;

                ctx.beginPath();
                if (currentTool === 'rectangle') {
                    ctx.rect(startX, startY, getPos(event).x - startX, getPos(event).y - startY);
                    ctx.stroke();
                } else if (currentTool === 'circle') {
                    const radius = Math.sqrt(Math.pow(getPos(event).x - startX, 2) + Math.pow(getPos(event).y - startY, 2));
                    ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
                    ctx.stroke();
                } else if (currentTool === 'arrow') {
                    ctx.moveTo(startX, startY);
                    ctx.lineTo(getPos(event).x, getPos(event).y);
                    ctx.stroke();
                    drawArrowhead(ctx, startX, startY, getPos(event).x, getPos(event).y, brushSize * 2);
                }
                saveState();
            };
        } else {
            saveState();
        }
    }
});

// Helper function to draw an arrowhead
function drawArrowhead(ctx, fromX, fromY, toX, toY, arrowWidth) {
    const headlen = arrowWidth || 10; // length of head in pixels
    const dx = toX - fromX;
    const dy = toY - fromY;
    const angle = Math.atan2(dy, dx);

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
}

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
        autoSaveCurrentNote(); // Clear canvas means a change that should be saved
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
        ctx.font = `${currentFontSize}px ${currentFontFamily}`; // Use current font settings
        ctx.fillStyle = document.body.classList.contains('dark-mode') ? "white" : "black";
        
        // Wrap text logic
        const lines = text.split('\n');
        let currentY = 100; // Starting Y position for OCR text
        const lineHeight = currentFontSize * 1.2;
        const startXOCR = 50;
        const maxWidthOCR = canvas.width - startXOCR - 20;

        lines.forEach(line => {
            let currentLine = '';
            const words = line.split(' ');
            for (let i = 0; i < words.length; i++) {
                const testLine = currentLine + words[i] + ' ';
                const metrics = ctx.measureText(testLine);
                const testWidth = metrics.width;
                if (testWidth > maxWidthOCR && i > 0) {
                    ctx.fillText(currentLine, startXOCR, currentY);
                    currentLine = words[i] + ' ';
                    currentY += lineHeight;
                } else {
                    currentLine = testLine;
                }
            }
            ctx.fillText(currentLine, startXOCR, currentY);
            currentY += lineHeight;
        });
        
        await worker.terminate();
        document.getElementById('loading-overlay').style.display = 'none';
        saveState();
        autoSaveCurrentNote();
    };
    input.click();
}

window.setPageStyle = function(style) {
    const canvasContainer = document.getElementById('canvas-container');
    // Remove existing background classes
    canvasContainer.classList.remove('lined', 'grid');

    if (style === 'lined') {
        canvasContainer.classList.add('lined');
    } else if (style === 'grid') {
        canvasContainer.classList.add('grid');
    }
    currentBackgroundStyle = style;
};

// Global variable to store current background style
let currentBackgroundStyle = 'white'; // Default to white


window.downloadPDF = function() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'px', format: [canvas.width, canvas.height] });
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
    doc.save('note.pdf');
};

// --- Cloud Integration (Calls storage.js) ---
async function saveCurrentNote() {
    const title = prompt("Note Title:", "My Note");
    if (title) {
        const saved = await saveNoteToCloud(currentNoteId, title, canvas);
        if (saved) {
            currentNoteId = saved.id;
            localStorage.setItem('lastActiveNoteId', currentNoteId);
            alert("Saved!");
            renderSidebar();
        }
    }
}
document.getElementById('save-btn').addEventListener('click', saveCurrentNote);

async function autoSaveCurrentNote() {
    if (currentNoteId) { // Only auto-save if a note is currently active
        // Get the current title from the sidebar item, or a default if new
        let title = "Auto-saved Note";
        if (activeNoteItem && activeNoteItem.innerText) {
            title = activeNoteItem.innerText;
        } else {
            // If currentNoteId exists but no activeNoteItem (e.g., first auto-save of a new note)
            // Try to fetch title from Supabase or use a placeholder
            const note = await loadNoteDetail(currentNoteId);
            if (note && note.title) {
                title = note.title;
            }
        }
        await saveNoteToCloud(currentNoteId, title, canvas);
        console.log(`Auto-saved note: ${title} (${currentNoteId})`);
        renderSidebar(); // Refresh sidebar to show updated timestamp/title
    } else {
        console.log("No active note to auto-save.");
    }
}

document.getElementById('add-note-btn').addEventListener('click', createNewNote);

function createNewNote() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    currentNoteId = null; // Mark as new note
    saveState();

    // Add current date to the new note
    const today = new Date();
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const formattedDate = today.toLocaleDateString(undefined, dateOptions);
    const defaultTitle = prompt("Enter note title (or leave blank for date):", formattedDate);
    const noteTitle = defaultTitle ? defaultTitle : formattedDate;

    ctx.font = `bold ${currentFontSize + 4}px ${currentFontFamily}`;
    ctx.fillStyle = brushColor;
    ctx.fillText(noteTitle, 50, 50); // Place title at top-left
    saveState(); // Save state after adding the date

    // Temporarily save a blank note to get an ID and make it active
    saveNoteToCloud(null, noteTitle, canvas).then(saved => {
        if (saved) {
            currentNoteId = saved.id;
            localStorage.setItem('lastActiveNoteId', currentNoteId);
            renderSidebar();
            console.log(`Created new note with ID: ${currentNoteId} and title: ${noteTitle}`);
        }
    });
}

window.deleteCurrentNote = async function() {
    if (currentNoteId && confirm("Delete this note?")) {
        await deleteNoteFromCloud(currentNoteId);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        currentNoteId = null;
        localStorage.removeItem('lastActiveNoteId'); // Clear last active note
        renderSidebar();
        createNewNote(); // Create a new blank note after deleting
    }
};

function loadNoteIntoCanvas(fullNote) {
    currentNoteId = fullNote.id;
    localStorage.setItem('lastActiveNoteId', currentNoteId);
    const img = new Image();
    img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        saveState();
        // Highlight the active note in the sidebar
        if (activeNoteItem) {
            activeNoteItem.classList.remove('active');
        }
        activeNoteItem = document.querySelector(`.note-item[data-id="${currentNoteId}"]`);
        if (activeNoteItem) {
            activeNoteItem.classList.add('active');
        }
    };
    img.src = fullNote.drawing_data;
}

// Helper to render sidebar (uses storage.js)
async function renderSidebar() {
    const notes = await fetchAllNotes();
    const list = document.getElementById('note-list');
    list.innerHTML = '';
    notes.forEach(note => {
        const div = document.createElement('div');
        div.className = 'note-item';
        div.dataset.id = note.id; // Store note ID on the element
        div.innerText = note.title;
        div.onclick = async () => {
            if (currentNoteId !== note.id) { // Only load if not already active
                const fullNote = await loadNoteDetail(note.id);
                if (fullNote) {
                    loadNoteIntoCanvas(fullNote);
                }
            }
        };
        list.appendChild(div);

        // If this note is the currently active one, highlight it
        if (note.id === currentNoteId) {
            if (activeNoteItem) {
                activeNoteItem.classList.remove('active');
            }
            activeNoteItem = div;
            activeNoteItem.classList.add('active');
        }
    });
    // If no notes or currentNoteId is null, ensure "New Note" or first note is active
    if (!currentNoteId && notes.length > 0) {
        loadNoteIntoCanvas(notes[0]);
    } else if (!currentNoteId && notes.length === 0) {
        // No notes in DB and no currentNoteId, ensure a blank canvas state
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        saveState();
    }
}