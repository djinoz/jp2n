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
 * Interface for Joplin resource
 */
interface JoplinResource {
    id: string;
    title: string;
    mime: string;
    filename: string;
    created_time: number;
    updated_time: number;
    user_created_time: number;
    user_updated_time: number;
    file_extension: string;
    encryption_cipher_text: string;
    encryption_applied: number;
    encryption_blob_encrypted: number;
    size: number;
    is_shared: number;
    share_id: string;
    type_: number;
}

/**
 * Extract Joplin resource IDs from markdown content
 * @param content Markdown content
 * @returns Array of resource IDs
 */
export function extractResourceIds(content: string): string[] {
    // Regex to match markdown image syntax with Joplin resource format: ![alt](:/resourceId)
    const resourceRegex = /!\[.*?\]\(\s*:\/([a-f0-9]+)\s*\)/g;
    const resourceIds: string[] = [];
    
    let match;
    while ((match = resourceRegex.exec(content)) !== null) {
        if (match[1]) {
            resourceIds.push(match[1]);
        }
    }
    
    console.log('Extracted resource IDs:', resourceIds);
    return resourceIds;
}

/**
 * Get resource data for a list of resource IDs
 * @param resourceIds Array of resource IDs
 * @returns Promise with a map of resource ID to resource data
 */
export async function getResourceData(resourceIds: string[]): Promise<Record<string, JoplinResource>> {
    const resources: Record<string, JoplinResource> = {};
    
    for (const id of resourceIds) {
        try {
            // Get resource data from Joplin API
            const resource = await joplin.data.get(['resources', id], { fields: ['id', 'title', 'mime', 'filename', 'file_extension'] });
            resources[id] = resource;
            console.log(`Resource data for ${id}:`, resource);
        } catch (error) {
            console.error(`Error getting resource data for ${id}:`, error);
        }
    }
    
    return resources;
}

/**
 * Get resource file for a resource ID
 * @param resourceId Resource ID
 * @returns Promise with the resource file path
 */
export async function getResourceFile(resourceId: string): Promise<Buffer> {
    try {
        // Get resource file from Joplin API
        const resourceFile = await joplin.data.resourcePath(resourceId);
        console.log(`Resource file path for ${resourceId}:`, resourceFile);
        
        // Read the file as buffer
        const fileBuffer = fs.readFileSync(resourceFile);
        return fileBuffer;
    } catch (error) {
        console.error(`Error getting resource file for ${resourceId}:`, error);
        throw error;
    }
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
 * Upload a Joplin resource to a Blossom server
 * @param resourceId Joplin resource ID
 * @param blossomServerUrl Blossom server URL
 * @param privateKey Nostr private key (Uint8Array)
 * @returns Promise with upload result
 */
export async function uploadResourceToBlossom(
    resourceId: string,
    blossomServerUrl: string,
    privateKey: Uint8Array
): Promise<UploadedImage> {
    try {
        // Get resource data
        const resource = await joplin.data.get(['resources', resourceId], { fields: ['id', 'title', 'mime', 'filename', 'file_extension'] });
        console.log(`Resource data for ${resourceId}:`, resource);
        
        if (!resource) {
            return {
                originalPath: resourceId,
                url: '',
                success: false,
                error: `Resource not found: ${resourceId}`
            };
        }
        
        // Get resource file path
        const resourcePath = await joplin.data.resourcePath(resourceId);
        console.log(`Resource path for ${resourceId}:`, resourcePath);
        
        // Read the file as buffer
        const fileBuffer = fs.readFileSync(resourcePath);
        const filename = resource.filename || `${resourceId}.${resource.file_extension}`;
        
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
        
        // Determine correct content type based on resource mime type
        let contentType = resource.mime || 'application/octet-stream';
        
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
        
        console.log(`Uploading resource ${resourceId} (${filename}) to ${requestUrl}`);
        
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
            originalPath: resourceId,
            url,
            success: true
        };
        
    } catch (error: any) {
        console.error(`Error uploading resource ${resourceId}:`, error);
        return {
            originalPath: resourceId,
            url: '',
            success: false,
            error: error.message
        };
    }
}

/**
 * Upload Joplin resources to a Blossom server
 * @param resourceIds Array of Joplin resource IDs
 * @param blossomServerUrl Blossom server URL
 * @param privateKey Nostr private key (Uint8Array)
 * @returns Promise with upload results
 */
export async function uploadResources(
    resourceIds: string[],
    blossomServerUrl: string,
    privateKey: Uint8Array
): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    
    // Process resources sequentially to avoid overwhelming the server
    for (const resourceId of resourceIds) {
        const result = await uploadResourceToBlossom(resourceId, blossomServerUrl, privateKey);
        
        if (result.success && result.url) {
            // Store the mapping from resource ID to new URL
            results[resourceId] = result.url;
        }
    }
    
    return results;
}

/**
 * Replace Joplin resource references with uploaded URLs in markdown content
 * @param content Original markdown content
 * @param uploadedResources Record mapping resource IDs to uploaded URLs
 * @param isLongForm Whether this is a long-form article (kind 30023) or regular note (kind 1)
 * @returns Modified markdown content
 */
export function replaceResourceUrls(
    content: string,
    uploadedResources: Record<string, string>,
    isLongForm: boolean = false
): string {
    let modifiedContent = content;
    
    // Replace each resource reference
    for (const [resourceId, uploadedUrl] of Object.entries(uploadedResources)) {
        // Trim any whitespace from the URL
        const trimmedUrl = uploadedUrl.trim();
        
        // Create a regex to find this specific resource reference with optional trailing whitespace and newlines
        // This matches ![any alt text](:/resourceId) followed by optional whitespace and newlines
        const regex = new RegExp(`!\\[(.*?)\\]\\(\\s*:\\/${escapeRegExp(resourceId)}\\s*\\)(\\s*\\n*)`, 'g');
        
        // Replace with the appropriate format based on note type
        modifiedContent = modifiedContent.replace(regex, (match, altText, trailingWhitespace) => {
            // If there are more than two newlines, reduce to just two
            let normalizedTrailing = trailingWhitespace || '';
            if (normalizedTrailing.includes('\n\n\n')) {
                normalizedTrailing = '\n\n';
            }
            
            // For long-form articles (kind 30023), keep the markdown image syntax
            // For regular notes (kind 1), just use the plain URL
            if (isLongForm) {
                return `![${altText}](${trimmedUrl})${normalizedTrailing}`;
            } else {
                return `${trimmedUrl}${normalizedTrailing}`;
            }
        });
    }
    
    // Additional cleanup for any remaining problematic patterns
    // Replace any sequence of more than two newlines with just two
    modifiedContent = modifiedContent.replace(/\n\n\n+/g, '\n\n');
    
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
