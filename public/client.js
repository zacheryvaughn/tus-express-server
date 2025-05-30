// Generate random ID for grouping parts
function generateMultipartId() {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
}

// Upload configuration
const UPLOAD_CONFIG = {
    endpoint: "http://localhost:1080/files/",
    chunkSize: 8 * 1024 * 1024,
    retryDelays: [0, 1000, 3000, 5000],
    useOriginalFilename: "false",
    onDuplicateFiles: "prevent"
};

// Determine number of parts based on file size
function getPartCount(fileSize) {
    const MB = 1024 * 1024;
    
    if (fileSize < 512 * MB) return 1;
    if (fileSize < 1024 * MB) return 2;
    if (fileSize < 2048 * MB) return 4;
    return 6;
}

// Upload file in parts
function uploadFile(file) {
    const totalParts = getPartCount(file.size);
    const multipartId = generateMultipartId();
    const partSize = Math.ceil(file.size / totalParts);
    
    console.log(`Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB) in ${totalParts} parts`);

    for (let i = 0; i < totalParts; i++) {
        uploadPart(file, i, partSize, multipartId, totalParts);
    }
}

// Upload individual part
function uploadPart(file, partIndex, partSize, multipartId, totalParts) {
    const start = partIndex * partSize;
    const end = Math.min(start + partSize, file.size);
    const partBlob = file.slice(start, end);
    const partNumber = partIndex + 1;

    const upload = new tus.Upload(partBlob, {
        endpoint: UPLOAD_CONFIG.endpoint,
        chunkSize: UPLOAD_CONFIG.chunkSize,
        retryDelays: UPLOAD_CONFIG.retryDelays,
        metadata: {
            filename: file.name,
            filetype: file.type,
            multipartId: multipartId,
            partIndex: partNumber.toString(),
            totalParts: totalParts.toString(),
            originalFileSize: file.size.toString(),
            useOriginalFilename: UPLOAD_CONFIG.useOriginalFilename,
            onDuplicateFiles: UPLOAD_CONFIG.onDuplicateFiles
        },
        onError: (error) => {
            console.error(`Part ${partNumber} failed:`, error);
        },
        onProgress: (bytesUploaded, bytesTotal) => {
            const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
            console.log(`Part ${partNumber}: ${percentage}% (${bytesUploaded}/${bytesTotal} bytes)`);
        },
        onSuccess: () => {
            console.log(`Part ${partNumber} completed!`);
        }
    });

    upload.start();
}

// File input handler
document.getElementById("fileInput").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) {
        uploadFile(file);
    }
});