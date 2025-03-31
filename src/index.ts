import joplin from 'api';
import { SettingItemType, SettingItemSubType, ToolbarButtonLocation } from 'api/types';

joplin.plugins.register({
    onStart: async function () {
        console.log('Registering settings section...');
        await joplin.settings.registerSection('jp2nSettings', {
            label: 'jp2n Settings',
            iconName: 'fas fa-bullhorn',
        });

        // Register the "nsec" text field setting
        await joplin.settings.registerSettings({
            'nsecString': {
                value: '',
                type: SettingItemType.String,
                section: 'jp2nSettings',
                public: true,
                label: 'NSEC String',
                description: 'Enter your NSEC string here.',
            },
        });
        
        // Register the relay list setting
        await joplin.settings.registerSettings({
            'relayList': {
                value: 'wss://relay.damus.io',
                type: SettingItemType.String,
                section: 'jp2nSettings',
                public: true,
                label: 'Relay List',
                description: 'Enter a comma-separated list of relays to publish to.',
            },
        });
        console.log('Settings registration complete.');

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
                const relayListSetting = await joplin.settings.value('relayList') || '';
                const relays = relayListSetting.split(',').map(r => r.trim()).filter(r => r);

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
                    await joplin.views.dialogs.showMessageBox('Please enter at least one relay in the plugin settings.');
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

                // Create a dialog for confirmation
                const dialog = await joplin.views.dialogs.create('publishConfirmDialog');
                await joplin.views.dialogs.setButtons(dialog, [
                    {
                        id: 'cancel',
                        title: 'Cancel',
                    },
                    {
                        id: 'publish',
                        title: 'Publish',
                    },
                ]);
                
                await joplin.views.dialogs.setHtml(dialog, `
                    <p>Are you sure you want to publish "${note.title}" to ${relays.length} relay(s)?</p>
                `);
                
                const result = await joplin.views.dialogs.open(dialog);
                
                if (result.id === 'cancel') {
                    // User clicked Cancel
                    return;
                }

                try {
                    // Create a loading dialog with a cancel button
                    const loadingDialog = await joplin.views.dialogs.create('loadingDialog');
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
                        
                        // Create event template
                        const event = {
                            kind: 1, // Regular note
                            created_at: Math.floor(Date.now() / 1000),
                            tags: [
                                ['client', 'joplin-plugin-jp2n'],
                            ],
                            content: `${note.title}\n\n${note.body}`,
                        };
                        
                        // Sign the event
                        const signedEvent = nostrTools.finalizeEvent(event, secretKey);
                        
                        // Track successful publishes
                        let successCount = 0;
                        let errorMessages: string[] = [];
                        
                        // Publish to relays
                        for (const relayUrl of relays) {
                            try {
                                console.log(`Connecting to relay: ${relayUrl}`);
                                const relay = await nostrTools.Relay.connect(relayUrl);
                                
                                await relay.publish(signedEvent);
                                console.log(`Published to ${relayUrl}`);
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
                            // Create a result dialog
                            const resultDialog = await joplin.views.dialogs.create('resultDialog');
                            await joplin.views.dialogs.setButtons(resultDialog, [
                                {
                                    id: 'ok',
                                    title: 'OK',
                                },
                            ]);
                            
                            let resultHtml = '';
                            if (successCount > 0) {
                                resultHtml = `<p>Note published successfully to ${successCount} relay(s)!</p>`;
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
                    
                    // Create an error dialog
                    const errorDialog = await joplin.views.dialogs.create('errorDialog');
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
