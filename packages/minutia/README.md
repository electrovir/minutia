# minutia

Browser fingerprinting, bot, automation, and storage-persistence checks behind a single API.

Everything runs in the browser. Nothing is sent anywhere, and no network request is made unless you explicitly opt into one.

## Install

```sh
npm i minutia
```

## Usage

Use `runMinutia`:

<!-- example-link: src/readme-examples/run-everything.example.ts -->

```TypeScript
import {runMinutia} from 'minutia';

const report = await runMinutia();

report.bot.verdict; // is this a bot?
report.automation.verdict; // is a framework driving this page?
report.fingerprint.verdict; // is the user agent lying about its OS?
report.verdict; // the worst of the three

// every individual assessment behind a verdict
report.bot.assessments.map((assessment) => `${assessment.label}: ${assessment.note}`);
```

Automation checks that wait on an external trigger cannot have fired yet in a one-shot snapshot, so they report `unknown`. Use `startUpdatingMinutia` to receive them as they land:

<!-- example-link: src/readme-examples/stream-updates.example.ts -->

```TypeScript
import {startUpdatingMinutia, Verdict} from 'minutia';

startUpdatingMinutia((report) => {
    if (report.verdict === Verdict.Fail) {
        // automation, spoofing, or tampering was found
    }
});
```

### Storage persistence

Persistence is a two-visit test: one visit writes a marker, a later visit checks whether it survived. It is off by default because it writes to storage rather than only reading it.

<!-- example-link: src/readme-examples/storage-persistence.example.ts -->

```TypeScript
import {PersistenceMode, runMinutia} from 'minutia';

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
```

A mechanism that lost the marker is a `warning`, not a `fail`, and persistence is excluded from the top-level verdict.

### UI element

Importing `MinutiaSummary` registers `<minutia-summary>`, so it can be used in any `element-vir` template:

<!-- example-link: src/readme-examples/ui-element.example.ts -->

```TypeScript
import {defineElement, html} from 'element-vir';
import {MinutiaSummary} from 'minutia';

export const MyPage = defineElement()({
    tagName: 'my-page',
    render() {
        return html`
            <h1>Browser checks</h1>
            <${MinutiaSummary.assign({
                /** Must be on an origin that this page's `script-src` forbids. */
                cspProbeScriptUrl: 'https://your-other-origin.example/probe.js',
            })}></${MinutiaSummary}>
        `;
    },
});
```

Plain HTML works too, as long as the module has been imported somewhere:

```html
<minutia-summary></minutia-summary>
```

Renders the test results. It updates itself as automation checks resolve.

The element takes no required inputs. `cspProbeScriptUrl`, `persistenceMarker`, and `startExpanded` are optional inputs. Set `startExpanded` to open every section on load.

### The CSP bypass check

`bypassCsp` is the one check that touches the network, and it has no default URL. Point it at a cross-origin script your page's `script-src` forbids:

<!-- example-link: src/readme-examples/csp-bypass.example.ts -->

```TypeScript
import {runMinutia} from 'minutia';

await runMinutia({
    /** Must be on an origin that this page's `script-src` forbids. */
    cspProbeScriptUrl: 'https://your-other-origin.example/probe.js',
});
```

Left unset, the check reports `warning` with a note telling you to set it. It cannot pass silently: without a probe URL nothing is ever loaded, so a page would otherwise believe its CSP was verified when the check never ran.

### OS fingerprint reference

Fingerprint checks compare live measurements against `osFingerprintReference`, a table of what each OS and browser is known to produce. A value the claimed browser never produces means the user agent is lying, and `report.fingerprint.actualGuess` names what the machine actually looks like.

The table only records fingerprints that have been observed, never inferred ones. Rows with `undefined` fields have not been captured yet and report `unknown` rather than risking a false accusation. To fill one in, run the tests and copy the `OS_FINGERPRINT_DATA` line they print.
