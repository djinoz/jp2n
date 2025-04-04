import joplin from 'api';
import { ToolbarButtonLocation } from 'api/types';
import { getRelays } from './settings';
import { extractLocalImagePaths, uploadImages, replaceImageUrls } from './imageUploader';

/**
 * Register the publish command and toolbar button
 */
export async function registerPublishCommand() {
    // Register a new command
    await joplin.commands.register({
        name: 'nostrButtonClick',
        label: 'Publish to Nostr',
        iconName: 'fas fa-bullhorn',
        execute: publishToNostr,
    });

    // Create a new toolbar button
    await joplin.views.toolbarButtons.create(
        'nostrToolbarButton', 
        'nostrButtonClick', 
        ToolbarButtonLocation.EditorToolbar
    );
}

/**
 * Publish the current note to Nostr
 */
async function publishToNostr() {
    // Get the currently selected note
    const note = await joplin.workspace.selectedNote();
    if (!note) {
        console.log('No note is currently open.');
        return;
    }

    const nsec = await joplin.settings.value('nsecString');
    const relays = await getRelays();

    console.log('Note to publish:', note.title);
    console.log('Body:', note.body);
    console.log('NSEC:', nsec);
    console.log('Relays:', relays);

    // Validate inputs
    if (!nsec) {
        await joplin.views.dialogs.showMessageBox('Please enter your NSEC private key in the plugin settings.');
        return;
    }

    if (!relays.length) {
        const relaySource = await joplin.settings.value('relaySource');
        if (relaySource === 'manual') {
            await joplin.views.dialogs.showMessageBox('Please enter at least one relay in the Manual Relay List setting.');
        } else {
            await joplin.views.dialogs.showMessageBox('No NIP-65 relays found. Please switch to manual relay mode or update your NIP-65 relay list on Nostr.');
        }
        return;
    }

    // Basic validation of NSEC before showing the loading dialog
    // NSEC keys are bech32 encoded and start with "nsec1"
    if (!nsec.startsWith('nsec1')) {
        await joplin.views.dialogs.showMessageBox('Invalid NSEC provided. NSEC keys should start with "nsec1". Please check your private key.');
        return;
    }
    
    // NSEC keys should be around 63 characters long (may vary slightly)
    if (nsec.length < 50 || nsec.length > 70) {
        await joplin.views.dialogs.showMessageBox('Invalid NSEC provided. The key length appears incorrect. Please check your private key.');
        return;
    }

    // Check if the note is longer than 256 characters for NIP-23 option
    console.log('Note body length:', note.body.length);
    const isLongNote = note.body.length > 256;
    console.log('Is long note:', isLongNote);
    let publishMode = 'regular'; // Default to regular note (kind 1)
    
    // Check if image upload is enabled
    const enableImageUpload = await joplin.settings.value('enableImageUpload');
    const blossomServerUrl = await joplin.settings.value('blossomServerUrl');
    
    // Count images in the note if image upload is enabled
    let imageCount = 0;
    if (enableImageUpload && blossomServerUrl) {
        const imagePaths = extractLocalImagePaths(note.body);
        imageCount = imagePaths.length;
    }
    
    // Create a dialog for confirmation with a unique ID
    const dialogId = `publishConfirmDialog-${Date.now()}`;
    const dialog = await joplin.views.dialogs.create(dialogId);
    
    if (isLongNote) {
        // If note is long, offer NIP-23 option
        await joplin.views.dialogs.setButtons(dialog, [
            {
                id: 'cancel',
                title: 'Cancel',
            },
            {
                id: 'regular',
                title: 'Regular Note',
            },
            {
                id: 'longform',
                title: 'Long-form Article',
            },
        ]);
        
        let dialogHtml = `
            <p>Your note is longer than 256 characters. How would you like to publish it?</p>
            <ul>
                <li><strong>Regular Note:</strong> Standard Nostr post (kind 1)</li>
                <li><strong>Long-form Article:</strong> NIP-23 blog post format (kind 30023)</li>
            </ul>
            <p>Publishing to ${relays.length} relay(s)</p>
        `;
        
        // Add image information if images are detected
        if (imageCount > 0 && enableImageUpload) {
            dialogHtml += `<p>${imageCount} image(s) will be uploaded to Blossom server: ${blossomServerUrl}</p>`;
        }
        
        await joplin.views.dialogs.setHtml(dialog, dialogHtml);
    } else {
        // For shorter notes, just show regular confirmation
        await joplin.views.dialogs.setButtons(dialog, [
            {
                id: 'cancel',
                title: 'Cancel',
            },
            {
                id: 'regular',
                title: 'Publish',
            },
        ]);
        
        let dialogHtml = `<p>Are you sure you want to publish "${note.title}" to ${relays.length} relay(s)?</p>`;
        
        // Add image information if images are detected
        if (imageCount > 0 && enableImageUpload) {
            dialogHtml += `<p>${imageCount} image(s) will be uploaded to Blossom server: ${blossomServerUrl}</p>`;
        }
        
        await joplin.views.dialogs.setHtml(dialog, dialogHtml);
    }
    
    const result = await joplin.views.dialogs.open(dialog);
    console.log('Dialog result:', result);
    
    if (result.id === 'cancel') {
        // User clicked Cancel
        return;
    } else if (result.id === 'longform') {
        // User chose long-form article
        publishMode = 'longform';
        console.log('Setting publish mode to longform');
    }

    try {
        // Create a loading dialog with a unique ID
        const loadingDialogId = `loadingDialog-${Date.now()}`;
        const loadingDialog = await joplin.views.dialogs.create(loadingDialogId);
        await joplin.views.dialogs.setButtons(loadingDialog, [
            {
                id: 'cancel',
                title: 'Cancel',
            },
        ]);
        await joplin.views.dialogs.setHtml(loadingDialog, `
            <p>Publishing to Nostr...</p>
            <p>Please wait while your note is being published. You can click Cancel to dismiss this dialog, but the publishing process will continue in the background.</p>
        `);
        
        // Open the loading dialog (don't await, as it would block execution)
        const loadingPromise = joplin.views.dialogs.open(loadingDialog);
        
        // Flag to track if we need to show the result dialog
        let showResultDialog = true;
        
        // Handle the loading dialog result
        loadingPromise.then(result => {
            if (result.id === 'cancel') {
                console.log('Loading dialog was cancelled by user');
                showResultDialog = false;
            }
        }).catch(error => {
            console.error('Error with loading dialog:', error);
        });
        
        // Dynamically import nostr-tools
        try {
            // Import the nostr-tools package
            const nostrTools = await import('nostr-tools');
            
            // Decode nsec
            const decoded = nostrTools.nip19.decode(nsec);
            
            if (decoded.type !== 'nsec') {
                await joplin.views.dialogs.showMessageBox('Invalid NSEC provided. Please check your private key.');
                return;
            }

            // Create a Nostr event
            const secretKey = decoded.data as Uint8Array; // The decoded nsec as Uint8Array
            const pubkey = nostrTools.getPublicKey(secretKey);
            
            // Check if image upload is enabled
            const enableImageUpload = await joplin.settings.value('enableImageUpload');
            const blossomServerUrl = await joplin.settings.value('blossomServerUrl');
            
            // Create a copy of the note content that we'll modify
            let noteContent = note.body;
            let uploadedImagesCount = 0;
            let uploadedImages: Record<string, string> = {};
            
            // Handle image uploads if enabled
            if (enableImageUpload && blossomServerUrl) {
                // Extract local image paths from the note content
                const imagePaths = extractLocalImagePaths(noteContent);
                
                if (imagePaths.length > 0) {
                    // Update loading dialog to show image upload progress
                    await joplin.views.dialogs.setHtml(loadingDialog, `
                        <p>Uploading ${imagePaths.length} image(s) to Blossom server...</p>
                        <p>Please wait while your images are being uploaded.</p>
                    `);
                    
                    console.log(`Found ${imagePaths.length} local images in note:`, imagePaths);
                    
                    // Upload images to Blossom server
                    uploadedImages = await uploadImages(imagePaths, blossomServerUrl, secretKey);
                    uploadedImagesCount = Object.keys(uploadedImages).length;
                    
                    console.log(`Uploaded ${uploadedImagesCount} images:`, uploadedImages);
                    
                    // Replace local image references with uploaded URLs
                    if (uploadedImagesCount > 0) {
                        noteContent = replaceImageUrls(noteContent, uploadedImages);
                        console.log('Note content with replaced image URLs:', noteContent);
                    }
                    
                    // Update loading dialog to show publishing progress
                    await joplin.views.dialogs.setHtml(loadingDialog, `
                        <p>Uploaded ${uploadedImagesCount} of ${imagePaths.length} image(s).</p>
                        <p>Now publishing note to Nostr...</p>
                    `);
                }
            }
            
            // Create event template based on publish mode
            let event;
            
            console.log('Selected publish mode:', publishMode);
            
            if (publishMode === 'longform') {
                // NIP-23 long-form content (kind 30023)
                // Create a unique slug from the title with timestamp to avoid duplicates
                const timestamp = Math.floor(Date.now() / 1000).toString();
                const slug = note.title
                    .toLowerCase()
                    .replace(/[^\w\s]/g, '') // Remove special characters
                    .replace(/\s+/g, '-')    // Replace spaces with hyphens
                    .substring(0, 30)        // Limit length
                    + '-' + timestamp;       // Add timestamp for uniqueness
                
                // Extract first paragraph or up to 100 chars for summary
                const firstParagraphEnd = noteContent.indexOf('\n\n');
                const summary = firstParagraphEnd > 0 
                    ? noteContent.substring(0, firstParagraphEnd).trim() 
                    : noteContent.substring(0, 100).trim() + (noteContent.length > 100 ? '...' : '');
                
                // Create event according to NIP-23 format
                // Content should be the article content directly, not a JSON object
                event = {
                    kind: 30023, // NIP-23 long-form content
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [
                        ['client', 'joplin-plugin-jp2n'],
                        ['d', slug], // Unique identifier for the article
                        ['title', note.title],
                        ['summary', summary],
                        ['published_at', Math.floor(Date.now() / 1000).toString()],
                    ],
                    content: noteContent, // Use the modified content with uploaded image URLs
                };
                
                console.log('Publishing as NIP-23 long-form content');
                console.log('Event object:', JSON.stringify(event, null, 2));
            } else {
                // Regular note (kind 1)
                event = {
                    kind: 1,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [
                        ['client', 'joplin-plugin-jp2n'],
                    ],
                    content: `${note.title}\n\n${noteContent}`, // Use the modified content with uploaded image URLs
                };
                
                console.log('Publishing as regular note');
            }
            
            // Sign the event
            const signedEvent = nostrTools.finalizeEvent(event, secretKey);
            console.log('Signed event:', JSON.stringify(signedEvent, null, 2));
            
            // Track successful publishes
            let successCount = 0;
            let errorMessages: string[] = [];
            
            // Publish to relays
            for (const relayUrl of relays) {
                try {
                    console.log(`Connecting to relay: ${relayUrl}`);
                    const relay = await nostrTools.Relay.connect(relayUrl);
                    
                    console.log(`About to publish to ${relayUrl}, event kind:`, signedEvent.kind);
                    await relay.publish(signedEvent);
                    console.log(`Published to ${relayUrl}, event:`, JSON.stringify(signedEvent, null, 2));
                    successCount++;
                    
                    // Close the relay connection
                    relay.close();
                } catch (relayError: any) {
                    console.error(`Failed to publish to ${relayUrl}:`, relayError);
                    errorMessages.push(`${relayUrl}: ${relayError.message}`);
                }
            }
            
            // Only show the result dialog if the loading dialog wasn't cancelled
            if (showResultDialog) {
                // Create a result dialog with a unique ID
                const resultDialogId = `resultDialog-${Date.now()}`;
                const resultDialog = await joplin.views.dialogs.create(resultDialogId);
                await joplin.views.dialogs.setButtons(resultDialog, [
                    {
                        id: 'ok',
                        title: 'OK',
                    },
                ]);
                
                let resultHtml = '';
                if (successCount > 0) {
                    // Show appropriate message based on publish mode
                    if (publishMode === 'longform') {
                        resultHtml = `<p>Long-form article published successfully to ${successCount} relay(s)!</p>`;
                    } else {
                        resultHtml = `<p>Note published successfully to ${successCount} relay(s)!</p>`;
                    }
                    
                    // Add information about uploaded images if any
                    if (uploadedImagesCount > 0) {
                        resultHtml += `<p>${uploadedImagesCount} image(s) were uploaded to Blossom server and included in the published note.</p>`;
                    }
                    
                    if (errorMessages.length > 0) {
                        resultHtml += `<p>Failed to publish to ${errorMessages.length} relay(s):</p><ul>`;
                        for (const error of errorMessages) {
                            resultHtml += `<li>${error}</li>`;
                        }
                        resultHtml += '</ul>';
                    }
                } else {
                    resultHtml = `<p>Failed to publish to any relays:</p><ul>`;
                    for (const error of errorMessages) {
                        resultHtml += `<li>${error}</li>`;
                    }
                    resultHtml += '</ul>';
                    
                    // Still show image upload results if any
                    if (uploadedImagesCount > 0) {
                        resultHtml += `<p>Note: ${uploadedImagesCount} image(s) were successfully uploaded to Blossom server, but the note could not be published.</p>`;
                    }
                }
                
                await joplin.views.dialogs.setHtml(resultDialog, resultHtml);
                await joplin.views.dialogs.open(resultDialog);
            } else {
                console.log('Result dialog not shown because loading dialog was cancelled');
            }
        } catch (importError: any) {
            console.error('Error importing nostr-tools:', importError);
            await joplin.views.dialogs.showMessageBox(`Error importing nostr-tools: ${importError.message}`);
        }
    } catch (err: any) {
        console.error('Error:', err);
        
        // Create an error dialog with a unique ID
        const errorDialogId = `errorDialog-${Date.now()}`;
        const errorDialog = await joplin.views.dialogs.create(errorDialogId);
        await joplin.views.dialogs.setButtons(errorDialog, [
            {
                id: 'ok',
                title: 'OK',
            },
        ]);
        await joplin.views.dialogs.setHtml(errorDialog, `
            <p>Error publishing to Nostr:</p>
            <p>${err.message}</p>
        `);
        await joplin.views.dialogs.open(errorDialog);
        return;
    }
}
