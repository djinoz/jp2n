import joplin from 'api';
import { SettingItemType, SettingItemSubType, ToolbarButtonLocation } from 'api/types';

joplin.plugins.register({
    onStart: async function () {
        console.log('Registering settings section...');
        await joplin.settings.registerSection('joplin2nostrSettings', {
            label: 'JP2N Settings',
            iconName: 'fas fa-bullhorn',
        });

        // Register the "nsec" text field setting
        await joplin.settings.registerSettings({
            'nsecString': {
                value: '',
                type: SettingItemType.String,
                section: 'joplin2nostrSettings',
                public: true,
                label: 'NSEC String',
                description: 'Enter your NSEC string here.',
            },
        });
        
        // Register the relay source setting (manual or NIP-65)
        await joplin.settings.registerSettings({
            'relaySource': {
                value: 'manual',
                type: SettingItemType.String,
                section: 'joplin2nostrSettings',
                public: true,
                label: 'Relay Source',
                description: 'Choose whether to use manually entered relays or fetch from NIP-65 metadata.',
                isEnum: true,
                options: {
                    'manual': 'Manually entered relays',
                    'nip65': 'Fetch from NIP-65 metadata',
                }
            },
        });
        
        // Register the relay list setting
        await joplin.settings.registerSettings({
            'relayList': {
                value: 'wss://relay.damus.io',
                type: SettingItemType.String,
                section: 'joplin2nostrSettings',
                public: true,
                label: 'Manual Relay List',
                description: 'Enter a comma-separated list of relays to publish to.',
            },
        });
        
        // Register the npub display setting (read-only)
        await joplin.settings.registerSettings({
            'npubDisplay': {
                value: '',
                type: SettingItemType.String,
                section: 'joplin2nostrSettings',
                public: true,
                label: 'Your Public Key (npub)',
                description: 'This is your Nostr public key derived from your NSEC. (Read-only)',
                advanced: false,
            },
        });
        
        // Register the profile name display setting (read-only)
        await joplin.settings.registerSettings({
            'profileName': {
                value: '',
                type: SettingItemType.String,
                section: 'joplin2nostrSettings',
                public: true,
                label: 'Profile Name',
                description: 'Your Nostr profile name (fetched from NIP-01 kind 0 metadata). (Read-only)',
                advanced: false,
            },
        });
        
        // Register the profile picture display setting (read-only)
        await joplin.settings.registerSettings({
            'profilePicture': {
                value: '',
                type: SettingItemType.String,
                section: 'joplin2nostrSettings',
                public: true,
                label: 'Profile Picture URL',
                description: 'Your Nostr profile picture URL (fetched from NIP-01 kind 0 metadata). (Read-only)',
                advanced: false,
            },
        });
        
        // Register the NIP-65 relays display setting (read-only)
        await joplin.settings.registerSettings({
            'nip65Relays': {
                value: '',
                type: SettingItemType.String,
                section: 'joplin2nostrSettings',
                public: true,
                label: 'NIP-65 Relays',
                description: 'Relays fetched from your NIP-65 metadata. (Read-only)',
                advanced: false,
            },
        });
        
        // Create a panel to display the profile picture
        const panel = await joplin.views.panels.create('profilePanel');
        await joplin.views.panels.setHtml(panel, '<div id="profile-container">No profile loaded yet</div>');
        
        // Update derived values when nsec changes
        await updateDerivedValues();
        
        console.log('Settings registration complete.');
        
        // Function to update derived values from nsec
        async function updateDerivedValues() {
            try {
                const nsec = await joplin.settings.value('nsecString');
                
                if (!nsec) {
                    // Clear derived values if nsec is empty
                    await joplin.settings.setValue('npubDisplay', '');
                    await joplin.settings.setValue('profileName', '');
                    await joplin.settings.setValue('profilePicture', '');
                    await joplin.settings.setValue('nip65Relays', '');
                    await joplin.views.panels.setHtml(panel, '<div id="profile-container">No profile loaded yet</div>');
                    return;
                }
                
                // Basic validation
                if (!nsec.startsWith('nsec1') || nsec.length < 50 || nsec.length > 70) {
                    await joplin.settings.setValue('npubDisplay', 'Invalid NSEC format');
                    await joplin.views.panels.setHtml(panel, '<div id="profile-container">Invalid NSEC format</div>');
                    return;
                }
                
                // Import nostr-tools
                try {
                    const nostrTools = await import('nostr-tools');
                    
                    // Decode nsec
                    const decoded = nostrTools.nip19.decode(nsec);
                    
                    if (decoded.type !== 'nsec') {
                        await joplin.settings.setValue('npubDisplay', 'Invalid NSEC key');
                        await joplin.views.panels.setHtml(panel, '<div id="profile-container">Invalid NSEC key</div>');
                        return;
                    }
                    
                    // Get public key
                    const secretKey = decoded.data as Uint8Array;
                    const pubkey = nostrTools.getPublicKey(secretKey);
                    
                    // Encode as npub
                    const npub = nostrTools.nip19.npubEncode(pubkey);
                    await joplin.settings.setValue('npubDisplay', npub);
                    
                    // Fetch profile and relay information
                    await fetchProfileInfo(pubkey, nostrTools);
                    
                } catch (error) {
                    console.error('Error updating derived values:', error);
                    await joplin.settings.setValue('npubDisplay', 'Error deriving npub');
                    await joplin.views.panels.setHtml(panel, '<div id="profile-container">Error deriving npub</div>');
                }
            } catch (error) {
                console.error('Error in updateDerivedValues:', error);
                await joplin.views.panels.setHtml(panel, '<div id="profile-container">Error updating values</div>');
            }
        }
        
        // Function to fetch profile info (NIP-01 kind 0) and relay list (NIP-65 kind 10002)
        async function fetchProfileInfo(pubkey, nostrTools) {
            console.log('Fetching profile info and relay list for pubkey:', pubkey);
            
            // Hardcoded list of popular relays to fetch data from
            const relays = [
                'wss://relay.damus.io',
                'wss://nos.lol',
                'wss://relay.nostr.band'
            ];
            
            let profileName = '';
            let profilePicture = '';
            let nip65RelayList: string[] = [];
            
            // Connect to relays and fetch data
            const relayConnections: any[] = [];
            
            try {
                // Connect to all relays
                for (const relayUrl of relays) {
                    try {
                        console.log(`Connecting to relay: ${relayUrl}`);
                        const relay = await nostrTools.Relay.connect(relayUrl);
                        relayConnections.push(relay);
                    } catch (error) {
                        console.error(`Failed to connect to relay ${relayUrl}:`, error);
                        // Continue with other relays if one fails
                    }
                }
                
                if (relayConnections.length === 0) {
                    console.error('Could not connect to any relays');
                    await joplin.settings.setValue('profileName', 'Could not connect to any relays');
                    await joplin.settings.setValue('profilePicture', '');
                    await joplin.settings.setValue('nip65Relays', '');
                    await joplin.views.panels.setHtml(panel, '<div id="profile-container">Could not connect to any relays</div>');
                    return;
                }
                
                // Create a promise that resolves after a timeout
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Fetch timeout')), 10000); // 10 second timeout
                });
                
                // Fetch profile metadata (kind 0)
                const profilePromise = new Promise(async (resolve) => {
                    let profileFound = false;
                    
                    for (const relay of relayConnections) {
                        try {
                            // Create a filter for the subscription
                            const filter = {
                                kinds: [0],
                                authors: [pubkey],
                                limit: 1
                            };
                            
                            // In nostr-tools v2.11.0, the subscription pattern is different
                            // We need to use the event and eose callbacks directly
                            relay.subscribe([filter], {
                                onevent(event) {
                                    try {
                                        if (event.kind === 0 && !profileFound) {
                                            profileFound = true;
                                            
                                            // Parse the content as JSON
                                            const metadata = JSON.parse(event.content);
                                            
                                            // Extract name and picture
                                            profileName = metadata.name || metadata.display_name || '';
                                            profilePicture = metadata.picture || '';
                                            
                                            console.log('Found profile:', { profileName, profilePicture });
                                            resolve(true);
                                        }
                                    } catch (error) {
                                        console.error('Error parsing profile metadata:', error);
                                    }
                                },
                                oneose() {
                                    if (!profileFound) {
                                        console.log(`No profile found on ${relay.url}`);
                                    }
                                }
                            });
                        } catch (error) {
                            console.error(`Error subscribing to ${relay.url}:`, error);
                        }
                    }
                    
                    // Resolve after checking all relays if no profile was found
                    setTimeout(() => {
                        if (!profileFound) {
                            console.log('No profile found on any relay');
                            resolve(false);
                        }
                    }, 5000); // 5 second timeout for profile search
                });
                
                // Fetch NIP-65 relay list (kind 10002)
                const relayListPromise = new Promise(async (resolve) => {
                    let relayListFound = false;
                    
                    for (const relay of relayConnections) {
                        try {
                            // Create a filter for the subscription
                            const filter = {
                                kinds: [10002],
                                authors: [pubkey],
                                limit: 1
                            };
                            
                            // In nostr-tools v2.11.0, the subscription pattern is different
                            // We need to use the event and eose callbacks directly
                            relay.subscribe([filter], {
                                onevent(event) {
                                    try {
                                        if (event.kind === 10002 && !relayListFound) {
                                            relayListFound = true;
                                            
                                            // Extract relay URLs from tags
                                            const relays = event.tags
                                                .filter((tag: string[]) => tag[0] === 'r')
                                                .map((tag: string[]) => tag[1]);
                                            
                                            // Filter out empty or invalid relay URLs
                                            nip65RelayList = relays.filter((url: string) => 
                                                url && url.startsWith('wss://'));
                                            
                                            console.log('Found NIP-65 relay list:', nip65RelayList);
                                            resolve(true);
                                        }
                                    } catch (error) {
                                        console.error('Error parsing relay list:', error);
                                    }
                                },
                                oneose() {
                                    if (!relayListFound) {
                                        console.log(`No relay list found on ${relay.url}`);
                                    }
                                }
                            });
                        } catch (error) {
                            console.error(`Error subscribing to ${relay.url}:`, error);
                        }
                    }
                    
                    // Resolve after checking all relays if no relay list was found
                    setTimeout(() => {
                        if (!relayListFound) {
                            console.log('No relay list found on any relay');
                            resolve(false);
                        }
                    }, 5000); // 5 second timeout for relay list search
                });
                
                // Wait for both fetches or timeout
                try {
                    await Promise.race([
                        Promise.all([profilePromise, relayListPromise]),
                        timeoutPromise
                    ]);
                } catch (error) {
                    console.error('Fetch operation timed out:', error);
                }
                
                // Update settings with fetched data
                await joplin.settings.setValue('profileName', profileName || 'No profile found');
                await joplin.settings.setValue('profilePicture', profilePicture || '');
                
                // Update the panel with the profile information
                let panelHtml = '';
                if (profilePicture) {
                    panelHtml = `
                        <div id="profile-container" style="padding: 10px;">
                            <div style="display: flex; align-items: center; margin-bottom: 10px;">
                                <img src="${profilePicture}" alt="Profile Picture" 
                                     style="width: 50px; height: 50px; border-radius: 25px; margin-right: 10px; object-fit: cover;" 
                                     onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'50\\' height=\\'50\\' viewBox=\\'0 0 50 50\\'><rect width=\\'50\\' height=\\'50\\' fill=\\'%23ccc\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'20\\' text-anchor=\\'middle\\' dy=\\'.3em\\' fill=\\'%23fff\\'>?</text></svg>';" />
                                <div>
                                    <strong>${profileName || 'Anonymous'}</strong>
                                </div>
                            </div>
                        </div>
                    `;
                } else {
                    // Placeholder image if no profile picture is available
                    panelHtml = `
                        <div id="profile-container" style="padding: 10px;">
                            <div style="display: flex; align-items: center; margin-bottom: 10px;">
                                <div style="width: 50px; height: 50px; border-radius: 25px; margin-right: 10px; background-color: #ccc; display: flex; justify-content: center; align-items: center; color: white; font-weight: bold;">?</div>
                                <div>
                                    <strong>${profileName || 'Anonymous'}</strong>
                                </div>
                            </div>
                        </div>
                    `;
                }
                
                await joplin.views.panels.setHtml(panel, panelHtml);
                
                if (nip65RelayList.length > 0) {
                    await joplin.settings.setValue('nip65Relays', nip65RelayList.join(','));
                } else {
                    await joplin.settings.setValue('nip65Relays', '');
                }
            } catch (error) {
                console.error('Error fetching profile info:', error);
                await joplin.settings.setValue('profileName', 'Error fetching profile');
                await joplin.settings.setValue('profilePicture', '');
                await joplin.settings.setValue('nip65Relays', '');
                await joplin.views.panels.setHtml(panel, '<div id="profile-container">Error fetching profile</div>');
            } finally {
                // Close all relay connections
                for (const relay of relayConnections) {
                    try {
                        relay.close();
                    } catch (error) {
                        console.error('Error closing relay connection:', error);
                    }
                }
            }
        }
        
        // Watch for changes to nsec and update derived values
        await joplin.settings.onChange(async (event) => {
            if (event.keys.includes('nsecString')) {
                await updateDerivedValues();
            }
        });

        // Register a new command
        await joplin.commands.register({
            name: 'nostrButtonClick',
            label: 'Publish to Nostr',
            iconName: 'fas fa-bullhorn',
            execute: async () => {
                // Get the currently selected note
                const note = await joplin.workspace.selectedNote();
                if (!note) {
                    console.log('No note is currently open.');
                    return;
                }

                const nsec = await joplin.settings.value('nsecString');
                const relaySource = await joplin.settings.value('relaySource');
                
                // Get relays based on selected source
                let relays: string[] = [];
                if (relaySource === 'manual') {
                    const relayListSetting = await joplin.settings.value('relayList') || '';
                    relays = relayListSetting.split(',').map(r => r.trim()).filter(r => r);
                } else if (relaySource === 'nip65') {
                    const nip65RelaysSetting = await joplin.settings.value('nip65Relays') || '';
                    relays = nip65RelaysSetting.split(',').map(r => r.trim()).filter(r => r);
                }

                console.log('Note to publish:', note.title);
                console.log('Body:', note.body);
                console.log('NSEC:', nsec);
                console.log('Relay source:', relaySource);
                console.log('Relays:', relays);

                // Validate inputs
                if (!nsec) {
                    await joplin.views.dialogs.showMessageBox('Please enter your NSEC private key in the plugin settings.');
                    return;
                }

                if (!relays.length) {
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
                    
                    await joplin.views.dialogs.setHtml(dialog, `
                        <p>Your note is longer than 256 characters. How would you like to publish it?</p>
                        <ul>
                            <li><strong>Regular Note:</strong> Standard Nostr post (kind 1)</li>
                            <li><strong>Long-form Article:</strong> NIP-23 blog post format (kind 30023)</li>
                        </ul>
                        <p>Publishing to ${relays.length} relay(s)</p>
                    `);
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
                    
                    await joplin.views.dialogs.setHtml(dialog, `
                        <p>Are you sure you want to publish "${note.title}" to ${relays.length} relay(s)?</p>
                    `);
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
                            const firstParagraphEnd = note.body.indexOf('\n\n');
                            const summary = firstParagraphEnd > 0 
                                ? note.body.substring(0, firstParagraphEnd).trim() 
                                : note.body.substring(0, 100).trim() + (note.body.length > 100 ? '...' : '');
                            
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
                                content: note.body, // Direct content, not JSON
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
                                content: `${note.title}\n\n${note.body}`,
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
        });

        // Create a new toolbar button
        await joplin.views.toolbarButtons.create('nostrToolbarButton', 'nostrButtonClick', ToolbarButtonLocation.EditorToolbar);
    }
});
