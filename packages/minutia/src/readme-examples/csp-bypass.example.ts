import {runMinutia} from '../index.js';

await runMinutia({
    /** Must be on an origin that this page's `script-src` forbids. */
    cspProbeScriptUrl: 'https://your-other-origin.example/probe.js',
});
