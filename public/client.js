// Configuration
const CLIENT_CONFIG = {
    maxFileSelection: 5,
    endpoint: "http://localhost:1080/files/",
    chunkSize: 8 * 1024 * 1024,
    retryDelays: [0, 1000, 3000, 5000],
    useOriginalFilename: "true",
    onDuplicateFiles: "prevent"
};

// Queue management
let fileQueue = [];
let uploading = false;

// DOM elements
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const queueList = document.getElementById('queueList');
const message = document.getElementById('message');

// File selection handler
fileInput.addEventListener('change', (e) => {
    let files = Array.from(e.target.files);
    
    if (files.length > CLIENT_CONFIG.maxFileSelection) {
        message.textContent = `You can select up to ${CLIENT_CONFIG.maxFileSelection} files.`;
        files = files.slice(0, CLIENT_CONFIG.maxFileSelection);
    } else {
        message.textContent = '';
    }
    
    fileQueue = files;
    renderQueue();
});

// Upload button handler
uploadBtn.addEventListener('click', () => {
    if (!uploading && fileQueue.length > 0) {
        fileInput.value = '';
        processQueue();
    }
});

// Render the file queue
function renderQueue() {
    queueList.innerHTML = '';
    fileQueue.forEach((file, index) => {
        const li = document.createElement('li');
        li.textContent = `${index + 1}. ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`;
        queueList.appendChild(li);
    });
}

// Process the queue sequentially
function processQueue() {
    if (fileQueue.length === 0) {
        uploading = false;
        message.textContent = 'All files uploaded.';
        return;
    }
    
    uploading = true;
    const file = fileQueue.shift();
    message.textContent = `Uploading: ${file.name}`;
    renderQueue();
    
    uploadFile(file).then(() => {
        processQueue();
    }).catch((error) => {
        console.error('Upload failed:', error);
        message.textContent = `Upload failed: ${file.name}`;
        uploading = false;
    });
}

// Upload a single file
function uploadFile(file) {
    return new Promise((resolve, reject) => {
        const totalParts = getPartCount(file.size);
        const multipartId = generateMultipartId();
        const partSize = Math.ceil(file.size / totalParts);
        
        console.log(`Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB) in ${totalParts} parts`);
        
        let completedParts = 0;
        
        for (let i = 0; i < totalParts; i++) {
            uploadPart(file, i, partSize, multipartId, totalParts, () => {
                completedParts++;
                if (completedParts === totalParts) {
                    resolve();
                }
            }, reject);
        }
    });
}

// Upload individual part
function uploadPart(file, partIndex, partSize, multipartId, totalParts, onPartComplete, onError) {
    const start = partIndex * partSize;
    const end = Math.min(start + partSize, file.size);
    const partBlob = file.slice(start, end);
    const partNumber = partIndex + 1;

    const upload = new tus.Upload(partBlob, {
        endpoint: CLIENT_CONFIG.endpoint,
        chunkSize: CLIENT_CONFIG.chunkSize,
        retryDelays: CLIENT_CONFIG.retryDelays,
        metadata: {
            filename: file.name,
            filetype: file.type,
            multipartId: multipartId,
            partIndex: partNumber.toString(),
            totalParts: totalParts.toString(),
            originalFileSize: file.size.toString(),
            useOriginalFilename: CLIENT_CONFIG.useOriginalFilename,
            onDuplicateFiles: CLIENT_CONFIG.onDuplicateFiles
        },
        onError: (error) => {
            console.error(`Part ${partNumber} failed:`, error);
            onError(error);
        },
        onProgress: (bytesUploaded, bytesTotal) => {
            const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
            console.log(`Part ${partNumber}: ${percentage}% (${bytesUploaded}/${bytesTotal} bytes)`);
        },
        onSuccess: () => {
            console.log(`Part ${partNumber} completed!`);
            onPartComplete();
        }
    });

    upload.start();
}

// Generate random ID for grouping parts
function generateMultipartId() {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
}

// Determine number of parts based on file size
function getPartCount(fileSize) {
    const MB = 1024 * 1024;
    
    if (fileSize < 512 * MB) return 1;
    if (fileSize < 1024 * MB) return 2;
    if (fileSize < 2048 * MB) return 4;
    return 6;
}