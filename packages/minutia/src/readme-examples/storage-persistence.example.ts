import {PersistenceMode, runMinutia} from '../index.js';

// first visit
await runMinutia({
    persistence: {
        mode: PersistenceMode.Seed,
        marker: 'abc',
    },
});

// later visit, same marker
const report = await runMinutia({
    persistence: {
        mode: PersistenceMode.Verify,
        marker: 'abc',
    },
});

report.persistence?.survived; // the mechanisms that kept the marker
