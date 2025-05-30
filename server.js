import express from "express";
import { Server, EVENTS } from "@tus/server";
import { FileStore } from "@tus/file-store";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const SERVER_CONFIG = {
  port: process.env.PORT || 1080,
  stagingDir: process.env.STAGING_DIR || "./staging",
  mountPath: process.env.MOUNT_PATH || "./test_volume",
  filenameSanitizeRegex: /[^a-zA-Z0-9._-]/g
};

const app = express();
app.set('trust proxy', true);
app.use(express.static("public"));

// Utility functions
const ensureDir = (dir) => !fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true });

const parseMetadata = (header) => {
  if (!header) return {};
  return Object.fromEntries(
    header.split(",")
      .map(item => item.split(" "))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, Buffer.from(value, "base64").toString("utf8")])
  );
};

const sanitizeFilename = (filename) => filename.replace(SERVER_CONFIG.filenameSanitizeRegex, "_");

const getUniqueFilename = (filename, dir) => {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let i = 1, candidate = filename;
  
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base}(${i++})${ext}`;
  }
  return candidate;
};

const moveFile = (from, to, jsonPath, keepJson = false) => {
  try {
    // Try fast rename first
    fs.renameSync(from, to);
  } catch (error) {
    if (error.code === 'EXDEV') {
      // Cross-device link error - use copy and delete
      try {
        fs.copyFileSync(from, to);
        fs.unlinkSync(from);
      } catch (copyError) {
        console.error(`Copy failed: ${copyError.message}`);
        return false;
      }
    } else {
      console.error(`Move failed: ${error.message}`);
      return false;
    }
  }
  
  // Handle JSON metadata file with same cross-device logic
  try {
    if (fs.existsSync(jsonPath)) {
      if (keepJson) {
        const jsonDestination = `${to}.json`;
        try {
          fs.renameSync(jsonPath, jsonDestination);
        } catch (error) {
          if (error.code === 'EXDEV') {
            fs.copyFileSync(jsonPath, jsonDestination);
            fs.unlinkSync(jsonPath);
          } else {
            throw error;
          }
        }
      } else {
        fs.unlinkSync(jsonPath);
      }
    }
    return true;
  } catch (error) {
    console.error(`JSON file handling failed: ${error.message}`);
    return false;
  }
};

// Multipart Manager
class MultipartManager {
  constructor() {
    this.assemblies = new Map();
  }

  isMultipartUpload(metadata) {
    return metadata.multipartId && metadata.partIndex && metadata.totalParts;
  }

  async handlePartCompletion(upload) {
    const meta = upload.metadata;
    const multipartId = meta.multipartId;
    
    // Initialize assembly tracking
    if (!this.assemblies.has(multipartId)) {
      this.assemblies.set(multipartId, {
        parts: new Map(),
        totalParts: parseInt(meta.totalParts),
        metadata: meta
      });
    }

    // Track this part
    const assembly = this.assemblies.get(multipartId);
    assembly.parts.set(parseInt(meta.partIndex), upload.id);

    // Assemble when all parts are complete
    if (assembly.parts.size === assembly.totalParts) {
      await this.assembleFile(multipartId, assembly);
      this.assemblies.delete(multipartId);
    }
  }

  async assembleFile(multipartId, assembly) {
    const meta = assembly.metadata;
    const firstPartId = assembly.parts.get(1);
    
    try {
      // Append remaining parts to first part
      const writeStream = fs.createWriteStream(
        path.join(SERVER_CONFIG.stagingDir, firstPartId),
        { flags: 'a' }
      );
      
      for (let i = 2; i <= assembly.totalParts; i++) {
        const partId = assembly.parts.get(i);
        const partPath = path.join(SERVER_CONFIG.stagingDir, partId);
        
        await this.appendFile(writeStream, partPath);
        this.cleanupPartFiles(partId);
      }
      
      writeStream.end();
      
      // Update first part's metadata to represent complete file
      this.updateMetadata(firstPartId, meta);
      
      // Process assembled file with existing logic
      this.processAssembledFile({
        id: firstPartId,
        metadata: {
          filename: meta.filename,
          filetype: meta.filetype,
          useOriginalFilename: meta.useOriginalFilename,
          onDuplicateFiles: meta.onDuplicateFiles
        }
      });
      
    } catch (error) {
      console.error(`Assembly failed for ${multipartId}:`, error);
    }
  }

  appendFile(writeStream, filePath) {
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(filePath);
      readStream.pipe(writeStream, { end: false });
      readStream.on('end', resolve);
      readStream.on('error', reject);
    });
  }

  cleanupPartFiles(partId) {
    const partPath = path.join(SERVER_CONFIG.stagingDir, partId);
    const jsonPath = path.join(SERVER_CONFIG.stagingDir, `${partId}.json`);
    
    if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
  }

  updateMetadata(fileId, meta) {
    const jsonPath = path.join(SERVER_CONFIG.stagingDir, `${fileId}.json`);
    const originalJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    
    const updatedMetadata = {
      id: fileId,
      metadata: {
        filename: meta.filename,
        filetype: meta.filetype,
        useOriginalFilename: meta.useOriginalFilename,
        onDuplicateFiles: meta.onDuplicateFiles
      },
      size: parseInt(meta.originalFileSize),
      offset: parseInt(meta.originalFileSize),
      creation_date: originalJson.creation_date
    };
    
    fs.writeFileSync(jsonPath, JSON.stringify(updatedMetadata, null, 2));
  }

  processAssembledFile(upload) {
    const meta = upload.metadata || {};
    const useOriginal = meta.useOriginalFilename === "true" && meta.filename;
    
    const finalFilename = useOriginal
      ? (meta.onDuplicateFiles === "number"
          ? getUniqueFilename(sanitizeFilename(meta.filename), SERVER_CONFIG.mountPath)
          : sanitizeFilename(meta.filename))
      : upload.id;

    const stagingPath = path.join(SERVER_CONFIG.stagingDir, upload.id);
    const destinationPath = path.join(SERVER_CONFIG.mountPath, finalFilename);
    const jsonPath = path.join(SERVER_CONFIG.stagingDir, `${upload.id}.json`);

    moveFile(stagingPath, destinationPath, jsonPath, !useOriginal);
  }
}

// Initialize directories
ensureDir(SERVER_CONFIG.stagingDir);
ensureDir(SERVER_CONFIG.mountPath);

// Initialize multipart manager
const multipartManager = new MultipartManager();

// Initialize TUS server
const fileStore = new FileStore({ directory: SERVER_CONFIG.stagingDir });
const tusServer = new Server({
  path: "/files",
  datastore: fileStore,
  respectForwardedHeaders: true,
  generateUrl: (req, { proto, host, path, id }) => {
    const protocol = req.headers["x-forwarded-proto"] || proto || "https";
    const hostname = req.headers["x-forwarded-host"] || req.headers.host || host;
    return `${protocol}://${hostname}${path}/${id}`;
  }
});

// Duplicate file check middleware
app.use("/files", (req, res, next) => {
  if (req.method !== "POST") return next();

  const metadata = parseMetadata(req.headers["upload-metadata"]);
  const shouldPrevent = metadata.useOriginalFilename === "true" &&
                       metadata.filename &&
                       metadata.onDuplicateFiles === "prevent";

  if (shouldPrevent && fs.existsSync(path.join(SERVER_CONFIG.mountPath, sanitizeFilename(metadata.filename)))) {
    return res.status(409).json({
      error: { message: `File "${metadata.filename}" already exists and duplicates are not allowed` }
    });
  }
  next();
});

// Handle upload completion
tusServer.on(EVENTS.POST_FINISH, async (req, res, upload) => {
  const meta = upload.metadata || {};
  
  // Check if this is a multipart upload with more than 1 part
  if (multipartManager.isMultipartUpload(meta) && meta.totalParts !== "1") {
    await multipartManager.handlePartCompletion(upload);
    return; // Don't process as regular file
  }
  
  const useOriginal = meta.useOriginalFilename === "true" && meta.filename;
  
  const finalFilename = useOriginal
    ? (meta.onDuplicateFiles === "number"
        ? getUniqueFilename(sanitizeFilename(meta.filename), SERVER_CONFIG.mountPath)
        : sanitizeFilename(meta.filename))
    : upload.id;

  const stagingPath = path.join(SERVER_CONFIG.stagingDir, upload.id);
  const destinationPath = path.join(SERVER_CONFIG.mountPath, finalFilename);
  const jsonPath = path.join(SERVER_CONFIG.stagingDir, `${upload.id}.json`);

  moveFile(stagingPath, destinationPath, jsonPath, !useOriginal);
});

// Mount TUS server
app.use("/files", (req, res) => {
  tusServer.handle(req, res);
});

// Start server
app.listen(SERVER_CONFIG.port, () => {
  console.log(`TUS server is running at http://localhost:${SERVER_CONFIG.port}/files`);
  console.log(`Staging directory: ${SERVER_CONFIG.stagingDir}`);
  console.log(`Mount path: ${SERVER_CONFIG.mountPath}`);
});
