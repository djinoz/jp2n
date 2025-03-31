# Joplin to Nostr (JP2N)

A Joplin plugin that allows you to publish your notes to the Nostr network.

## What is Nostr?

[Nostr](https://nostr.com/) (Notes and Other Stuff Transmitted by Relays) is a simple, open protocol that enables global, decentralized, and censorship-resistant social media. It allows users to publish content to multiple relays, which then distribute that content to other users.

## Features

- Publish Joplin notes to one or more Nostr relays
- Configure your NSEC private key for signing notes
- Specify multiple relays to publish to
- Simple one-click publishing from the editor toolbar
- Detailed success/failure reporting

## CAVEATS/known BUGS

1. Currently just one relay atm
2. No images to blossom yet
3. The popup dialog for publishing should go away after send, but its not. Click cancel for now.
4. Not sure if I should .gitignore the api directory
5. Have to add the nsec locally into the plugin settings, need to understand more Apps (not in a browser apps using a bunker or plugin or something 🤷‍♀️ )

## Installation

1. Open Joplin
2. Go to Tools > Options > Plugins or on MacOS Settings > Plugins 
3. Search for "jp2n"
4. Click Install
5. Restart Joplin

## Setup

Before you can publish notes to Nostr, you need to configure the plugin:

1. Go to Tools > Options > Joplin2Nostr Settings
2. Enter your NSEC private key
   - This is your Nostr private key, which starts with "nsec1"
   - If you don't have one, you can create one using a Nostr client like [Damus](https://damus.io/), [Amethyst](https://github.com/vitorpamplona/amethyst), or [Iris](https://iris.to/)
   - **IMPORTANT**: Keep your NSEC private key secure. Anyone with this key can post as you on Nostr.
   - After entering a valid NSEC, your public key (npub) will be automatically derived and displayed
3. Choose your relay source:
   - **Manual Relays**: Enter a comma-separated list of relays in the Manual Relay List field
     - Example: `wss://relay.damus.io,wss://relay.nostr.info,wss://nos.lol`
     - These are the servers your note will be published to
     - You can find popular relays at [nostr.watch](https://nostr.watch/)
   - **NIP-65 Relays**: Use default relays (currently wss://relay.damus.io and wss://nos.lol)
     - In future versions, this will fetch your relay list from your NIP-65 metadata

## Usage

1. Open a note you want to publish to Nostr
2. Click the "Publish to Nostr" button in the editor toolbar (bullhorn icon)
3. Confirm that you want to publish the note
4. Wait for the publishing process to complete
   - You can cancel the loading dialog if you want, and the publishing will continue in the background
5. View the results showing which relays successfully received your note

## Note Format

When publishing to Nostr, your note will be formatted as follows:

```
[Note Title]

[Note Body]
```

The note will be published as a regular Nostr text note (kind 1) with a client tag identifying it as published from the jp2n plugin.

## Troubleshooting

### Invalid NSEC Key

If you receive an "Invalid NSEC" error:
- Make sure your private key starts with "nsec1"
- Verify that you've copied the entire key without any extra spaces
- Try generating a new key if problems persist

### Relay Connection Issues

If you have trouble connecting to relays:
- Check that the relay URLs are correct and include the "wss://" prefix
- Verify that the relays are online using [nostr.watch](https://nostr.watch/)
- Try using more established relays like `wss://relay.damus.io` or `wss://nos.lol`

### Publishing Failures

If publishing fails:
- Check your internet connection
- Verify that your NSEC key is valid
- Try publishing to different relays
- Check the detailed error messages in the result dialog

## Privacy and Security

- Your NSEC private key is stored in Joplin's settings and never sent anywhere except to sign Nostr events
- Notes are published publicly to the Nostr network - anyone can read them
- Consider the content carefully before publishing, as Nostr posts are permanent and difficult to remove once published to relays

## License

This plugin is released under the MIT license.

## Development

For information on how to build or modify the plugin, please see [GENERATOR_DOC.md](./GENERATOR_DOC.md)
