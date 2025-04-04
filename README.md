# Joplin to Nostr (JP2N)

A Joplin plugin that allows you to publish your notes to the Nostr network.

## What is Nostr?

[Nostr](https://nostr.com/) (Notes and Other Stuff Transmitted by Relays) is a simple, open protocol that enables global, decentralized, and censorship-resistant social media. It allows users to publish content to multiple relays, which then distribute that content to other users.

## Features

- Publish Joplin notes to one or more Nostr relays
- Configure your NSEC private key for signing notes
- Specify multiple relays to publish to
- Upload embedded images to Blossom media servers
- Support for both regular notes and long-form articles (NIP-23)
- Simple one-click publishing from the editor toolbar
- Detailed success/failure reporting

## CAVEATS/known BUGS

1. ~~Currently just one relay atm~~
3. The popup dialog for publishing should go away after send, but its not. Click cancel for now.
4. ~~Not sure if I should .gitignore the api directory~~
5. Have to add the nsec locally into the plugin settings, need to understand more Apps (not in a browser apps using a bunker or plugin or something 🤷‍♀️ )
6. excessive console logging
7. Polish it to submit to the Joplin plugins directory

## TODO
1. Anything from the bugs above
2. ~~No images to blossom yet~~ ✅ Implemented in latest version
3. ~~If the note is longer than 256 characters, then prompt the option to be NIP-23 long-form content (blog post) so kind 1 stream is not polluted~~ ✅ Implemented in latest version


## Installation

1. Open Joplin
2. Go to Tools > Options > Plugins or on MacOS Settings > Plugins 
3. ~~Search for "jp2n"~~ (not really, you have to build this locally and then add the .jpl file yourself, this will comelater if I get it submitted to the Joplin plugins directory)
4. Click Install
5. Restart Joplin

## Setup

Before you can publish notes to Nostr, you need to configure the plugin:

1. Go to Tools > Options > JP2N Settings
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
4. Configure image upload settings (optional):
   - **Enable Image Upload**: Toggle this option to enable uploading images to Blossom servers
   - **Blossom Server URL**: Enter the URL of the Blossom server to use for image uploads
     - Default: `https://blossom.nostr.wine/upload`
     - You can use other Blossom-compatible servers if preferred

## Usage

1. Open a note you want to publish to Nostr
2. Click the "Publish to Nostr" button in the editor toolbar (bullhorn icon)
3. Confirm that you want to publish the note
   - If your note contains images and image upload is enabled, you'll see how many images will be uploaded
   - If your note is longer than 256 characters, you'll be given the option to publish as:
     - **Regular Note**: Standard Nostr post (kind 1)
     - **Long-form Article**: NIP-23 blog post format (kind 30023)
4. Wait for the publishing process to complete
   - If any image uploads fail, you'll be given the option to proceed without those images or cancel
   - You can cancel the loading dialog if you want, and the publishing will continue in the background
5. View the results showing which relays successfully received your note and how many images were uploaded

## Note Format

When publishing to Nostr, your note will be formatted as follows:

### Regular Notes (kind 1)

```
[Note Title]

[Note Body]
```

Regular notes will include any embedded images as direct URLs for maximum client compatibility.

### Long-form Articles (kind 30023)

Long-form articles follow the NIP-23 format with:
- A unique slug derived from the title
- The note title as the article title
- The first paragraph or first 100 characters as the summary
- The full note content with embedded images in Markdown format

Both formats include a client tag identifying the note as published from the jp2n plugin.

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

### Image Upload Issues

If image uploads fail:
- Verify that the "Enable Image Upload" option is enabled in settings
- Check that the Blossom Server URL is correct and accessible
- Ensure your NSEC key has permission to upload to the Blossom server
- Try a different Blossom server if the current one is unavailable
- For large images, be patient as uploads may take longer

## Privacy and Security

- Your NSEC private key is stored in Joplin's settings and never sent anywhere except to sign Nostr events
- Notes are published publicly to the Nostr network - anyone can read them
- Consider the content carefully before publishing, as Nostr posts are permanent and difficult to remove once published to relays

## License

This plugin is released under the MIT license.

## Development

For information on how to build or modify the plugin, please see [GENERATOR_DOC.md](./GENERATOR_DOC.md)
