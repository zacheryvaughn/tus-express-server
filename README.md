# TUS Express Server with Parallel Uploads

A TUS (resumable upload) server with added multipart functionality for parallel upload performance with pipe efficiency around 85%.

## What This Adds to Standard TUS

This extends the standard TUS protocol with:

- **Part Splitting**: Large files are automatically split into multiple parts
- **Parallel Part Uploading**: Parts upload simultaneously for better performance  
- **Automatic Part Assembly**: Server reassembles parts back into original files
- **Original Filename Resolution**: Files are optionally saved with their original names
- **Duplicate File Handling**: Configurable options for handling file conflicts
- **Queue Multiple Files**: Set maximum number of selectable files

## How It Works

1. **Client**: Splits large files into 1-6 parts based on file size
2. **Upload**: Each part uploads in parallel using standard TUS protocol
3. **Server**: Automatically detects when all parts are complete and reassembles them
4. **Result**: Original file appears in destination directory with proper filename

## File Splitting Logic

- **< 512MB**: 1 part
- **512MB - 1GB**: 2 parts
- **1GB - 2GB**: 4 parts
- **> 2GB**: 6 parts

## Quick Start

```bash
npm install
npm start
```

Open `http://localhost:1080` to upload files.

## Configuration

Environment variables:
- `PORT` (default: 1080)
- `STAGING_DIR` (default: ./staging) 
- `MOUNT_PATH` (default: ./test_volume)

## Docker

```bash
docker build -t tus-server .
docker run -p 1080:1080 -v $(pwd)/uploads:/app/test_volume tus-server
```

## Technology

- **Backend**: Express.js + [@tus/server](https://www.npmjs.com/package/@tus/server)
- **Frontend**: [tus-js-client](https://www.npmjs.com/package/tus-js-client)
- **Extensions**: Custom multipart manager for parallel uploads

## License

ISC License