import express from "express";
import { Server, EVENTS } from "@tus/server";
import { FileStore } from "@tus/file-store";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Configuration
const CONFIG = {
  port: process.env.PORT || 1080,
  stagingDir: process.env.STAGING_DIR || "./staging",
  mountPath: process.env.MOUNT_PATH || "./workspace",
  filenameSanitizeRegex: /[^a-zA-Z0-9._-]/g
};

const app = express();
app.use(express.static("public"));

// Utility functions
const ensureDirectoryExists = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const parseMetadata = (metadataHeader) => {
  if (!metadataHeader) return {};
  
  const metadata = {};
  metadataHeader.split(",").forEach(item => {
    const [key, value] = item.split(" ");
    if (key && value) {
      metadata[key] = Buffer.from(value, "base64").toString("utf8");
    }
  });
  return metadata;
};

const sanitizeFilename = (filename) => {
  return filename.replace(CONFIG.filenameSanitizeRegex, "_");
};

const generateUniqueFilename = (originalFilename, mountPath) => {
  const ext = path.extname(originalFilename);
  const base = path.basename(originalFilename, ext);
  let i = 1;
  let candidate = originalFilename;
  
  while (fs.existsSync(path.join(mountPath, candidate))) {
    candidate = `${base}(${i})${ext}`;
    i++;
  }
  return candidate;
};

const moveFileToDestination = (stagingFilePath, destinationFilePath, jsonFilePath) => {
  try {
    if (!fs.existsSync(stagingFilePath)) {
      throw new Error(`File not found at ${stagingFilePath}`);
    }

    console.log(`Moving ${stagingFilePath} to ${destinationFilePath}`);
    fs.renameSync(stagingFilePath, destinationFilePath);

    // Clean up JSON metadata file
    if (fs.existsSync(jsonFilePath)) {
      console.log(`Deleting JSON file: ${jsonFilePath}`);
      fs.unlinkSync(jsonFilePath);
    }

    return true;
  } catch (error) {
    console.error(`Error during file move: ${error.message}`);
    return false;
  }
};

// Initialize directories
ensureDirectoryExists(CONFIG.stagingDir);
ensureDirectoryExists(CONFIG.mountPath);

// Initialize TUS server
const fileStore = new FileStore({ directory: CONFIG.stagingDir });
const tusServer = new Server({
  path: "/files",
  datastore: fileStore
});

// Duplicate file check middleware
app.use("/files", (req, res, next) => {
  if (req.method !== "POST") {
    return next();
  }

  console.log("Checking for duplicate files before upload starts");

  try {
    const metadata = parseMetadata(req.headers["upload-metadata"]);
    console.log("Metadata:", metadata);

    const shouldPreventDuplicates = metadata.useOriginalFilename === "true" &&
                                   metadata.filename &&
                                   metadata.onDuplicateFiles === "prevent";

    if (shouldPreventDuplicates) {
      const sanitizedFilename = sanitizeFilename(metadata.filename);
      const filePath = path.join(CONFIG.mountPath, sanitizedFilename);

      if (fs.existsSync(filePath)) {
        console.log(`File ${sanitizedFilename} already exists, preventing upload`);
        return res.status(409).json({
          error: {
            message: `File "${metadata.filename}" already exists and duplicates are not allowed`
          }
        });
      }
    }

    next();
  } catch (error) {
    console.error(`Error in duplicate file check middleware: ${error.message}`);
    next();
  }
});

// Handle upload completion
tusServer.on(EVENTS.POST_FINISH, async (req, res, upload) => {
  console.log(`Upload complete: ${upload.id}`);

  try {
    const meta = upload.metadata || {};
    console.log(`Metadata: ${JSON.stringify(meta)}`);

    const shouldUseOriginalFilename = meta.useOriginalFilename === "true" && meta.filename;
    
    if (!shouldUseOriginalFilename) {
      return;
    }

    const originalFilename = sanitizeFilename(meta.filename);
    const stagingFilePath = path.join(CONFIG.stagingDir, upload.id);
    const jsonFilePath = path.join(CONFIG.stagingDir, `${upload.id}.json`);

    let finalFilename = originalFilename;

    // Handle duplicate files with numbering
    if (meta.onDuplicateFiles === "number") {
      finalFilename = generateUniqueFilename(originalFilename, CONFIG.mountPath);
      if (finalFilename !== originalFilename) {
        console.log(`File ${originalFilename} already exists, using numbered filename: ${finalFilename}`);
      }
    }

    const destinationFilePath = path.join(CONFIG.mountPath, finalFilename);

    console.log(`Processing: ${originalFilename} -> ${CONFIG.mountPath}`);
    
    const success = moveFileToDestination(stagingFilePath, destinationFilePath, jsonFilePath);
    
    if (success) {
      console.log(`Successfully processed file: ${finalFilename}`);
    }

  } catch (error) {
    console.error(`Error in POST_FINISH event handler: ${error.message}`);
  }
});

// Mount TUS server
app.use("/files", (req, res) => {
  tusServer.handle(req, res);
});

// Start server
app.listen(CONFIG.port, () => {
  console.log(`TUS server is running at http://localhost:${CONFIG.port}/files`);
  console.log(`Staging directory: ${CONFIG.stagingDir}`);
  console.log(`Mount path: ${CONFIG.mountPath}`);
});
