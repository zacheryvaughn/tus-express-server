import express from "express";
import { Server, EVENTS } from "@tus/server";
import { FileStore } from "@tus/file-store";
import fs from "fs";
import path from "path";

const app = express();
const port = 1080;

// Serve static files from the public directory
app.use(express.static("public"));

// Create uploads directory if it doesn't exist
const uploadsDir = "./uploads";
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Initialize the tus server with FileStore
const fileStore = new FileStore({ directory: uploadsDir });

// Create the tus server
const tusServer = new Server({
  path: "/files",
  datastore: fileStore
});

// Custom middleware to check for duplicate files before the upload starts
app.use("/files", (req, res, next) => {
  // Only check POST requests (new uploads)
  if (req.method === "POST") {
    console.log("Checking for duplicate files before upload starts");
    
    try {
      // Get the metadata from the Upload-Metadata header
      const metadataHeader = req.headers["upload-metadata"];
      if (!metadataHeader) {
        return next();
      }
      
      // Parse the metadata
      const metadata = {};
      metadataHeader.split(",").forEach(item => {
        const [key, value] = item.split(" ");
        if (key && value) {
          metadata[key] = Buffer.from(value, "base64").toString("utf8");
        }
      });
      
      console.log("Metadata:", metadata);
      
      // Only check for duplicates if useOriginalFilename is true and onDuplicateFiles is prevent
      if (metadata.useOriginalFilename === "true" && metadata.filename && metadata.onDuplicateFiles === "prevent") {
        const originalFilename = metadata.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        const filePath = path.join(uploadsDir, originalFilename);
        
        // Check if file already exists
        if (fs.existsSync(filePath)) {
          console.log(`File ${originalFilename} already exists, preventing upload`);
          
          // Return a 409 Conflict status code
          return res.status(409).json({
            error: {
              message: `File "${metadata.filename}" already exists and duplicates are not allowed`
            }
          });
        }
      }
      
      // Allow the upload to proceed
      next();
    } catch (error) {
      console.error(`Error in duplicate file check middleware: ${error.message}`);
      next(); // Allow the upload to proceed in case of error
    }
  } else {
    next();
  }
});

// Listen for the POST_FINISH event which is emitted after an upload is completed
// and a response has been sent to the client
tusServer.on(EVENTS.POST_FINISH, async (req, res, upload) => {
  console.log(`Upload complete (POST_FINISH event): ${upload.id}`);
  
  try {
    // Get the metadata
    const meta = upload.metadata || {};
    console.log(`Metadata: ${JSON.stringify(meta)}`);
    
    // Only process if useOriginalFilename is true
    if (meta.useOriginalFilename === "true" && meta.filename) {
      const originalFilename = meta.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      let finalFilename = originalFilename;
      const originalFilePath = path.join(uploadsDir, originalFilename);
      const uuidFilePath = path.join(uploadsDir, upload.id);
      const jsonFilePath = path.join(uploadsDir, `${upload.id}.json`);
      
      console.log(`Original filename: ${originalFilename}`);
      console.log(`UUID file path: ${uuidFilePath}`);
      
      // Handle duplicate filenames for "number" option
      if (fs.existsSync(originalFilePath) && meta.onDuplicateFiles === "number") {
        const ext = path.extname(originalFilename);
        const base = path.basename(originalFilename, ext);
        let i = 1;
        let candidate = `${base}${ext}`;
        while (fs.existsSync(path.join(uploadsDir, candidate))) {
          candidate = `${base}(${i})${ext}`;
          i++;
        }
        finalFilename = candidate;
        console.log(`File ${originalFilename} already exists, using numbered filename: ${finalFilename}`);
      }
      
      const newFilePath = path.join(uploadsDir, finalFilename);
      
      // Wait a moment to ensure file is fully written
      // We need to use setTimeout with a Promise to make this work with async/await
      await new Promise(resolve => {
        setTimeout(() => {
          try {
            // Make sure the file exists before attempting to rename
            if (fs.existsSync(uuidFilePath)) {
              // Rename file
              console.log(`Renaming ${uuidFilePath} to ${newFilePath}`);
              fs.renameSync(uuidFilePath, newFilePath);
              
              // Delete JSON metadata file
              if (fs.existsSync(jsonFilePath)) {
                console.log(`Deleting JSON file: ${jsonFilePath}`);
                fs.unlinkSync(jsonFilePath);
              }
              
              console.log(`Successfully processed file: ${finalFilename}`);
            } else {
              console.error(`File not found at ${uuidFilePath}`);
            }
            resolve();
          } catch (err) {
            console.error(`Error during rename/delete: ${err.message}`);
            resolve();
          }
        }, 2000);
      });
    }
  } catch (error) {
    console.error(`Error in POST_FINISH event handler: ${error.message}`);
  }
});

// Use a middleware to handle all requests to /files
app.use("/files", (req, res) => {
  tusServer.handle(req, res);
});

// Start the server
app.listen(port, () => {
  console.log(`TUS server is running at http://localhost:${port}/files`);
});
