import joplin from 'api';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Interface for uploaded image result
 */
interface UploadedImage {
    originalPath: string;
    url: string;
    success: boolean;
    error?: string;
}

/**
 * Interface for Blossom server response
 */
interface BlossomResponse {
    status?: string;
    url?: string;
}

/**
 * Extract local image paths from markdown content
 * @param content Markdown content
 * @returns Array of local image paths
 */
export function extractLocalImagePaths(content: string): string[] {
    // Regex to match markdown image syntax with file:// protocol
    const imageRegex = /!\[.*?\]\((file:\/\/.*?)\)/g;
    const imagePaths: string[] = [];
    
    let match;
    while ((match = imageRegex.exec(content)) !== null) {
        if (match[1]) {
            // Extract the file path and decode URI components
            const filePath = decodeURIComponent(match[1].replace('file://', ''));
            imagePaths.push(filePath);
        }
    }
    
    return imagePaths;
}

/**
 * Upload an image to a Blossom server
 * @param imagePath Local image path
 * @param blossomServerUrl Blossom server URL
 * @param privateKey Nostr private key (Uint8Array)
 * @returns Promise with upload result
 */
export async function uploadImageToBlossom(
    imagePath: string,
    blossomServerUrl: string,
    privateKey: Uint8Array
): Promise<UploadedImage> {
    try {
        // Check if file exists
        if (!fs.existsSync(imagePath)) {
            return {
                originalPath: imagePath,
                url: '',
                success: false,
                error: `File not found: ${imagePath}`
            };
        }
        
        // Read the file as buffer
        const fileBuffer = fs.readFileSync(imagePath);
        const filename = path.basename(imagePath);
        
        // Create SHA-256 hash of the file content
        const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        
        // Dynamically import nostr-tools
        const nostrTools = await import('nostr-tools');
        
        // Get public key from private key
        const publicKey = nostrTools.getPublicKey(privateKey);
        
        // Create Event for signing according to BUDS02 spec
        const now = Math.floor(Date.now() / 1000);
        const expirationTime = now + 5 * 60; // 5 minutes in the future
        
        const event = {
            kind: 24242,
            created_at: now,
            tags: [
                ['t', 'upload'],
                ['x', fileHash],
                ['expiration', expirationTime.toString()]
            ],
            content: `Upload ${filename}`,
            pubkey: publicKey
        };
        
        // Sign the event
        const signedEvent = nostrTools.finalizeEvent(event, privateKey);
        
        // Base64 encode the event JSON for the header
        const eventBase64 = Buffer.from(JSON.stringify(signedEvent)).toString('base64');
        
        // Determine correct content type based on file extension
        let contentType = 'application/octet-stream';
        const ext = path.extname(filename).toLowerCase();
        
        // Common image MIME types
        const mimeTypes: Record<string, string> = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml'
        };
        
        if (mimeTypes[ext]) {
            contentType = mimeTypes[ext];
        }
        
        // Dynamically import node-fetch
        const { default: fetch } = await import('node-fetch');
        
        // Set headers according to BUDS02 spec with NIP-98 auth
        const options = {
            method: 'PUT',
            headers: {
                'Content-Type': contentType,
                'Authorization': `Nostr ${eventBase64}`,
                'Accept': 'application/json'
            },
            body: fileBuffer
        };
        
        // Construct URL with SHA-256 hash
        const requestUrl = `${blossomServerUrl}/${fileHash}`;
        
        console.log(`Uploading ${filename} to ${requestUrl}`);
        
        // Send request
        const response = await fetch(requestUrl, options);
        
        // Check for errors
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server responded with ${response.status}: ${errorText}`);
        }
        
        // Parse response - Blossom responds with URL directly
        const data = await response.json() as BlossomResponse;
        
        // Extract URL from Blossom response format
        let url = '';
        if (data.status === 'success' && data.url) {
            url = data.url;
        } else if (data.url) {
            url = data.url;
        } else {
            throw new Error('Unable to parse Blossom server response: URL not found');
        }
        
        return {
            originalPath: imagePath,
            url,
            success: true
        };
        
    } catch (error: any) {
        console.error(`Error uploading image ${imagePath}:`, error);
        return {
            originalPath: imagePath,
            url: '',
            success: false,
            error: error.message
        };
    }
}

/**
 * Upload multiple images to a Blossom server
 * @param imagePaths Array of local image paths
 * @param blossomServerUrl Blossom server URL
 * @param privateKey Nostr private key (Uint8Array)
 * @returns Promise with upload results
 */
export async function uploadImages(
    imagePaths: string[],
    blossomServerUrl: string,
    privateKey: Uint8Array
): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    
    // Process images sequentially to avoid overwhelming the server
    for (const imagePath of imagePaths) {
        const result = await uploadImageToBlossom(imagePath, blossomServerUrl, privateKey);
        
        if (result.success && result.url) {
            // Store the mapping from original path to new URL
            results[imagePath] = result.url;
        }
    }
    
    return results;
}

/**
 * Replace local image references with uploaded URLs in markdown content
 * @param content Original markdown content
 * @param uploadedImages Record mapping original paths to uploaded URLs
 * @returns Modified markdown content
 */
export function replaceImageUrls(
    content: string,
    uploadedImages: Record<string, string>
): string {
    let modifiedContent = content;
    
    // Replace each image reference
    for (const [localPath, uploadedUrl] of Object.entries(uploadedImages)) {
        // Create the file:// URL format that would be in the markdown
        const fileUrl = `file://${encodeURIComponent(localPath)}`;
        
        // Create a regex to find this specific image reference
        // This matches ![any alt text](file://path/to/image.jpg)
        const regex = new RegExp(`!\\[(.*?)\\]\\(${escapeRegExp(fileUrl)}\\)`, 'g');
        
        // Replace with the new URL, preserving the alt text
        modifiedContent = modifiedContent.replace(regex, (match, altText) => {
            return `![${altText}](${uploadedUrl})`;
        });
    }
    
    return modifiedContent;
}

/**
 * Escape special characters in a string for use in a regular expression
 * @param string String to escape
 * @returns Escaped string
 */
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
