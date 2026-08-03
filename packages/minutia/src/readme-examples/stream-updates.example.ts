import {startUpdatingMinutia, Verdict} from '../index.js';

startUpdatingMinutia((report) => {
    if (report.verdict === Verdict.Fail) {
        // automation, spoofing, or tampering was found
    }
});
