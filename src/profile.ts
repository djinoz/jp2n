import joplin from 'api';

// Panel to display the profile picture
let profilePanel: string;

/**
 * Initialize the profile panel
 */
export async function initProfilePanel() {
    profilePanel = await joplin.views.panels.create('profilePanel');
    await joplin.views.panels.setHtml(profilePanel, '<div id="profile-container">No profile loaded yet</div>');
}

/**
 * Update derived values from NSEC
 */
export async function updateDerivedValues() {
    try {
        const nsec = await joplin.settings.value('nsecString');
        
        if (!nsec) {
            // Clear derived values if nsec is empty
            await joplin.settings.setValue('npubDisplay', '');
            await joplin.settings.setValue('profileName', '');
            await joplin.settings.setValue('profilePicture', '');
            await joplin.settings.setValue('nip65Relays', '');
            await joplin.views.panels.setHtml(profilePanel, '<div id="profile-container">No profile loaded yet</div>');
            return;
        }
        
        // Basic validation
        if (!nsec.startsWith('nsec1') || nsec.length < 50 || nsec.length > 70) {
            await joplin.settings.setValue('npubDisplay', 'Invalid NSEC format');
            await joplin.views.panels.setHtml(profilePanel, '<div id="profile-container">Invalid NSEC format</div>');
            return;
        }
        
        // Import nostr-tools
        try {
            const nostrTools = await import('nostr-tools');
            
            // Decode nsec
            const decoded = nostrTools.nip19.decode(nsec);
            
            if (decoded.type !== 'nsec') {
                await joplin.settings.setValue('npubDisplay', 'Invalid NSEC key');
                await joplin.views.panels.setHtml(profilePanel, '<div id="profile-container">Invalid NSEC key</div>');
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
            await joplin.views.panels.setHtml(profilePanel, '<div id="profile-container">Error deriving npub</div>');
        }
    } catch (error) {
        console.error('Error in updateDerivedValues:', error);
        await joplin.views.panels.setHtml(profilePanel, '<div id="profile-container">Error updating values</div>');
    }
}

/**
 * Fetch profile info (NIP-01 kind 0) and relay list (NIP-65 kind 10002)
 */
async function fetchProfileInfo(pubkey: string, nostrTools: any) {
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
            await joplin.views.panels.setHtml(profilePanel, '<div id="profile-container">Could not connect to any relays</div>');
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
                        onevent(event: any) {
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
                        onevent(event: any) {
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
        
        await joplin.views.panels.setHtml(profilePanel, panelHtml);
        
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
        await joplin.views.panels.setHtml(profilePanel, '<div id="profile-container">Error fetching profile</div>');
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
