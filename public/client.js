document.getElementById("fileInput").addEventListener("change", (event) => {
    const file = event.target.files[0];

    if (!file) {
        return;
    }

    const upload = new tus.Upload(file, {
        endpoint: "http://localhost:1080/files/",
        chunkSize: 8 * 1024 * 1024,
        retryDelays: [0, 1000, 3000, 5000],
        metadata: {
            filename: file.name,
            filetype: file.type,
            useOriginalFilename: "true",
            onDuplicateFiles: "prevent",
        },
        onError: (error) => {
            console.error("Upload failed:", error);
        },
        onProgress: (bytesUploaded, bytesTotal) => {
            const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
            console.log(
                `${bytesUploaded} / ${bytesTotal} bytes uploaded (${percentage}%)`
            );
        },
        onSuccess: () => {
            console.log("Upload completed:", upload.url);
        },
    });

    upload.start();
});