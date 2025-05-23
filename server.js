import express from "express";
import { Server } from "@tus/server";
import { FileStore } from "@tus/file-store";

const app = express();
const port = 1080;

// Serve static files from the public directory
app.use(express.static("public"));

// Initialize the tus server
const tusServer = new Server({
  path: "/files",
  datastore: new FileStore({ directory: "./uploads" }),
});

// Use a middleware to handle all requests to /files
app.use("/files", (req, res) => {
  tusServer.handle(req, res);
});

// Start the server
app.listen(port, () => {
  console.log(`TUS server is running at http://localhost:${port}/files`);
});
