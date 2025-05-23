import { FileStore } from "@tus/file-store";
import fs from "fs";
import path from "path";

// Custom error class for HTTP errors
class HTTPError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = 'HTTPError';
  }
}

/**
 * CustomFileStore extends the tus FileStore to add functionality for:
 * 1. Using original filenames for uploaded files
 * 2. Deleting JSON metadata files after upload completion when useOriginalFilename is true
 */
export class CustomFileStore extends FileStore {
  constructor(options) {
    super(options);
    this.directory = options.directory;
    this.processedFiles = new Set();
    this._setupFileWatcher();
  }
  
  /**
   * Sets up a file watcher to monitor the uploads directory for JSON files
   * that indicate tus uploads in progress
   */
  _setupFileWatcher() {
    try {
      fs.watch(this.directory, (eventType, filename) => {
        // Only process JSON files that we haven't seen before
        if (filename && filename.endsWith('.json')) {
          const jsonFilePath = path.join(this.directory, filename);
          
          if (!this.processedFiles.has(jsonFilePath)) {
            this._monitorJsonFile(jsonFilePath, filename);
          }
        }
      });
    } catch (error) {
      console.error("Error setting up file watcher:", error);
    }
  }
  
  /**
   * Monitors a JSON file periodically to detect when an upload is complete
   * @param {string} jsonFilePath - Full path to the JSON file
   * @param {string} jsonFilename - Just the filename portion
   */
  _monitorJsonFile(jsonFilePath, jsonFilename) {
    if (!fs.existsSync(jsonFilePath)) return;
    
    const checkInterval = setInterval(() => {
      try {
        // Stop monitoring if the file no longer exists
        if (!fs.existsSync(jsonFilePath)) {
          clearInterval(checkInterval);
          return;
        }
        
        // Read and parse the JSON file
        const data = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));
        const uuidFilePath = path.join(this.directory, data.id);
        const fileExists = fs.existsSync(uuidFilePath);
        
        // Check if upload is complete (by offset or file existence)
        if (data.offset === data.size || fileExists) {
          // Mark as processed and stop monitoring
          this.processedFiles.add(jsonFilePath);
          clearInterval(checkInterval);
          
          // Handle the completed upload
          this._processCompletedUpload(data, jsonFilePath, uuidFilePath);
        }
      } catch (error) {
        clearInterval(checkInterval);
      }
    }, 1000);
  }
  
  /**
   * Processes a completed upload - renames the file if needed and deletes JSON
   * @param {Object} data - The parsed JSON data
   * @param {string} jsonFilePath - Path to the JSON file
   * @param {string} uuidFilePath - Path to the uploaded file with UUID name
   */
  _processCompletedUpload(data, jsonFilePath, uuidFilePath) {
    try {
      const meta = data.metadata || {};
      
      // Only process if useOriginalFilename is true
      if (meta.useOriginalFilename === "true" && meta.filename) {
        const originalFilename = this._sanitize(meta.filename);
        let finalFilename = originalFilename;
        const originalFilePath = path.join(this.directory, originalFilename);
        
        // Handle duplicate filenames
        if (fs.existsSync(originalFilePath)) {
          const onDuplicate = meta.onDuplicateFiles || "number";
          
          if (onDuplicate === "prevent") {
            // Keep UUID filename and don't rename
            return;
          } else if (onDuplicate === "number") {
            const ext = path.extname(originalFilename);
            const base = path.basename(originalFilename, ext);
            finalFilename = this._getNumberedFilename(base, ext, this.directory);
          }
        }
        
        const newFilePath = path.join(this.directory, finalFilename);
        
        // Wait to ensure file is fully written
        setTimeout(() => {
          if (fs.existsSync(uuidFilePath)) {
            // Rename file and delete JSON
            fs.renameSync(uuidFilePath, newFilePath);
            fs.unlinkSync(jsonFilePath);
          }
        }, 1000);
      }
    } catch (error) {
      console.error("Error processing completed upload:", error);
    }
  }

  /**
   * Sanitizes a filename to ensure it's safe for the filesystem
   * @param {string} filename - The original filename
   * @returns {string} - A sanitized filename
   */
  _sanitize(filename) {
    return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  /**
   * Gets a numbered filename when a duplicate exists
   * @param {string} base - The base filename without extension
   * @param {string} ext - The file extension
   * @param {string} directory - The directory path
   * @returns {string} - A unique filename with numbering
   */
  _getNumberedFilename(base, ext, directory) {
    let i = 1;
    let candidate = `${base}${ext}`;
    while (fs.existsSync(path.join(directory, candidate))) {
      candidate = `${base}(${i})${ext}`;
      i++;
    }
    return candidate;
  }

  /**
   * Override create to handle duplicate file prevention before upload starts
   * @param {Object} upload - The upload object
   * @returns {Promise} - The result of the create operation
   */
  async create(upload) {
    const meta = upload.metadata || {};
    const useOriginal = meta.useOriginalFilename === "true";
    const onDuplicate = meta.onDuplicateFiles || "number";
    
    // Only check for duplicates if using original filename
    if (useOriginal && meta.filename) {
      const originalFilename = this._sanitize(meta.filename);
      const filePath = path.join(this.directory, originalFilename);
      
      // Check if file already exists
      if (fs.existsSync(filePath)) {
        if (onDuplicate === "prevent") {
          // Create a custom error with status code and message
          const error = new Error(`File "${meta.filename}" already exists and duplicates are not allowed`);
          error.status = 409; // Conflict status code
          throw error;
        }
        // For "number" option, we'll handle the renaming after upload completes
      }
    }
    
    // Use default UUID for initial upload
    // We'll rename it after completion if needed
    return super.create(upload);
  }
}