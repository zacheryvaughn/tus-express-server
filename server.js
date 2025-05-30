import express from "express";
import { Server, EVENTS } from "@tus/server";
import { FileStore } from "@tus/file-store";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const CONFIG = {
  port: process.env.PORT || 1080,
  stagingDir: process.env.STAGING_DIR || "./staging",
  mountPath: process.env.MOUNT_PATH || "./workspace",
  filenameSanitizeRegex: /[^a-zA-Z0-9._-]/g
};

const app = express();
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

const sanitizeFilename = (filename) => filename.replace(CONFIG.filenameSanitizeRegex, "_");

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
    fs.renameSync(from, to);
    if (fs.existsSync(jsonPath)) {
      keepJson ? fs.renameSync(jsonPath, `${to}.json`) : fs.unlinkSync(jsonPath);
    }
    return true;
  } catch (error) {
    console.error(`Move failed: ${error.message}`);
    return false;
  }
};

// Initialize directories
ensureDir(CONFIG.stagingDir);
ensureDir(CONFIG.mountPath);

// Initialize TUS server
const fileStore = new FileStore({ directory: CONFIG.stagingDir });
const tusServer = new Server({
  path: "/files",
  datastore: fileStore
});

// Duplicate file check middleware
app.use("/files", (req, res, next) => {
  if (req.method !== "POST") return next();

  const metadata = parseMetadata(req.headers["upload-metadata"]);
  const shouldPrevent = metadata.useOriginalFilename === "true" &&
                       metadata.filename &&
                       metadata.onDuplicateFiles === "prevent";

  if (shouldPrevent && fs.existsSync(path.join(CONFIG.mountPath, sanitizeFilename(metadata.filename)))) {
    return res.status(409).json({
      error: { message: `File "${metadata.filename}" already exists and duplicates are not allowed` }
    });
  }
  next();
});

// Handle upload completion
tusServer.on(EVENTS.POST_FINISH, (req, res, upload) => {
  const meta = upload.metadata || {};
  const useOriginal = meta.useOriginalFilename === "true" && meta.filename;
  
  const finalFilename = useOriginal
    ? (meta.onDuplicateFiles === "number"
        ? getUniqueFilename(sanitizeFilename(meta.filename), CONFIG.mountPath)
        : sanitizeFilename(meta.filename))
    : upload.id;

  const stagingPath = path.join(CONFIG.stagingDir, upload.id);
  const destinationPath = path.join(CONFIG.mountPath, finalFilename);
  const jsonPath = path.join(CONFIG.stagingDir, `${upload.id}.json`);

  moveFile(stagingPath, destinationPath, jsonPath, !useOriginal);
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
