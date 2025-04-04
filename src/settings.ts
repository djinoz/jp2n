import joplin from 'api';
import { SettingItemType } from 'api/types';

/**
 * Register all plugin settings
 */
export async function registerSettings() {
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
    
    console.log('Settings registration complete.');
}

/**
 * Get relays based on the selected source (manual or NIP-65)
 */
export async function getRelays(): Promise<string[]> {
    const relaySource = await joplin.settings.value('relaySource');
    let relays: string[] = [];
    
    if (relaySource === 'manual') {
        const relayListSetting = await joplin.settings.value('relayList') || '';
        relays = relayListSetting.split(',').map(r => r.trim()).filter(r => r);
    } else if (relaySource === 'nip65') {
        const nip65RelaysSetting = await joplin.settings.value('nip65Relays') || '';
        relays = nip65RelaysSetting.split(',').map(r => r.trim()).filter(r => r);
    }
    
    return relays;
}
