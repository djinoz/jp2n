import joplin from 'api';
import { registerSettings } from './settings';
import { initProfilePanel, updateDerivedValues } from './profile';
import { registerPublishCommand } from './publish';

joplin.plugins.register({
    onStart: async function () {
        // Register settings
        await registerSettings();
        
        // Initialize profile panel - commented out to disable profile panel
        // await initProfilePanel();
        
        // Update derived values when nsec changes - commented out to disable profile panel
        // await updateDerivedValues();
        
        // Watch for changes to nsec and update derived values - modified to disable profile panel
        await joplin.settings.onChange(async (event) => {
            if (event.keys.includes('nsecString')) {
                // await updateDerivedValues();
            }
        });

        // Register publish command and toolbar button
        await registerPublishCommand();
    }
});
