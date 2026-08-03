// cspell:words swiftshader llvmpipe mesa offscreen phantom nightmare sequentum fxdriver webdriver cdc chromium headlesschrome slimerjs scrapy reimplementation

import {check} from '@augment-vir/assert';
import {wait} from '@augment-vir/common';
import Bowser from 'bowser';
import {
    buildAssessmentGroup,
    countAssessmentsWithVerdict,
    Verdict,
    type AssessmentGroup,
    type AssessmentResult,
} from './assessment.js';

/**
 * The client-side bot signals evaluated by https://deviceandbrowserinfo.com/are_you_a_bot, ported
 * here, plus the `navigator.vendor` and Apple Pay consistency checks that FingerprintJS collects as
 * entropy sources. Each is a faithful reimplementation of the documented check (their source is not
 * public). The verdict is derived entirely in the browser: no IP reputation, no behavioral data.
 *
 * @category Internal
 */
export enum BotCheckId {
    UserAgent = 'userAgent',
    WebDriver = 'webDriver',
    AutomationGlobals = 'automationGlobals',
    HeadlessChrome = 'headlessChrome',
    WindowChrome = 'windowChrome',
    Webgl = 'webgl',
    Cdp = 'cdp',
    ClientHints = 'clientHints',
    HardwareConcurrency = 'hardwareConcurrency',
    ScreenResolution = 'screenResolution',
    WorkerConsistency = 'workerConsistency',
    IframeOverrides = 'iframeOverrides',
    NavigatorVendor = 'navigatorVendor',
    ApplePay = 'applePay',
}

/**
 * User-facing text for each {@link BotCheckId}.
 *
 * @category Internal
 */
export const botCheckLabels: Record<BotCheckId, string> = {
    [BotCheckId.UserAgent]: 'user agent',
    [BotCheckId.WebDriver]: 'navigator.webdriver',
    [BotCheckId.AutomationGlobals]: 'automation framework globals',
    [BotCheckId.HeadlessChrome]: 'headless chrome indicators',
    [BotCheckId.WindowChrome]: 'window.chrome consistency',
    [BotCheckId.Webgl]: 'webgl / gpu renderer',
    [BotCheckId.Cdp]: 'chrome devtools protocol',
    [BotCheckId.ClientHints]: 'client hints consistency',
    [BotCheckId.HardwareConcurrency]: 'hardware concurrency',
    [BotCheckId.ScreenResolution]: 'screen resolution',
    [BotCheckId.WorkerConsistency]: 'web worker consistency',
    [BotCheckId.IframeOverrides]: 'iframe / native function overrides',
    [BotCheckId.NavigatorVendor]: 'navigator.vendor consistency',
    [BotCheckId.ApplePay]: 'apple pay availability',
};

/**
 * Every bot assessment plus the single verdict that summarizes them.
 *
 * @category Internal
 */
export type BotReport = AssessmentGroup<BotCheckId>;

/** Bowser `engine.name === 'Blink'` marks every Chromium-based browser (Chrome, Edge, Opera, …). */
function isBlinkEngine(): boolean {
    return Bowser.parse(navigator.userAgent).engine.name === 'Blink';
}

/** A function is native (unpatched) when its source stringifies to the `[native code]` sentinel. */
function isNativeFunction(candidate: unknown): boolean {
    return (
        check.isFunction(candidate) &&
        Function.prototype.toString.call(candidate).includes('[native code]')
    );
}

const botUserAgentPatterns: ReadonlyArray<string> = [
    'headlesschrome',
    'phantomjs',
    'slimerjs',
    'electron',
    'nightmare',
    'selenium',
    'webdriver',
    'crawler',
    'spider',
    'crawling',
    'slurp',
    'scrapy',
    'python',
    'curl/',
    'wget',
    'jsdom',
    'bot',
];

function detectUserAgent(): AssessmentResult {
    const userAgent = navigator.userAgent.toLowerCase();
    const matched = botUserAgentPatterns.find((pattern) => userAgent.includes(pattern));

    if (matched) {
        return {
            verdict: Verdict.Fail,
            note: `The user agent contains "${matched}", a known bot or automation marker.`,
            debug: `userAgent = ${navigator.userAgent}`,
        };
    }

    return {
        verdict: Verdict.Pass,
        note: 'The user agent contains no known bot or automation markers.',
        debug: `userAgent = ${navigator.userAgent}`,
    };
}

function detectWebDriver(): AssessmentResult {
    /** Typed as `unknown` because navigator.webdriver is routinely deleted at runtime to evade this. */
    const webdriverValue: unknown = Reflect.get(navigator, 'webdriver');

    if (webdriverValue === true) {
        return {
            verdict: Verdict.Fail,
            note: 'navigator.webdriver is true, a definitive automation flag.',
            debug: 'navigator.webdriver = true',
        };
    }

    return {
        verdict: Verdict.Pass,
        note: 'navigator.webdriver is not set.',
        debug: `navigator.webdriver = ${String(webdriverValue)}`,
    };
}

enum MarkerScope {
    Window = 'window',
    Document = 'document',
}

enum AutomationTool {
    PhantomJs = 'PhantomJS',
    Nightmare = 'Nightmare.js',
    Selenium = 'Selenium',
    ChromeAutomation = 'Chrome automation',
    Playwright = 'Playwright',
    Sequentum = 'Sequentum',
}

const automationGlobalMarkers: ReadonlyArray<
    Readonly<{key: string; scope: MarkerScope; tool: AutomationTool}>
> = [
    {
        key: '_phantom',
        scope: MarkerScope.Window,
        tool: AutomationTool.PhantomJs,
    },
    {
        key: 'callPhantom',
        scope: MarkerScope.Window,
        tool: AutomationTool.PhantomJs,
    },
    {
        key: '__nightmare',
        scope: MarkerScope.Window,
        tool: AutomationTool.Nightmare,
    },
    {
        key: '__selenium_unwrapped',
        scope: MarkerScope.Window,
        tool: AutomationTool.Selenium,
    },
    {
        key: '__webdriver_evaluate',
        scope: MarkerScope.Document,
        tool: AutomationTool.Selenium,
    },
    {
        key: '__driver_evaluate',
        scope: MarkerScope.Document,
        tool: AutomationTool.Selenium,
    },
    {
        key: '__selenium_evaluate',
        scope: MarkerScope.Document,
        tool: AutomationTool.Selenium,
    },
    {
        key: '__fxdriver_evaluate',
        scope: MarkerScope.Document,
        tool: AutomationTool.Selenium,
    },
    {
        key: '__webdriver_script_fn',
        scope: MarkerScope.Document,
        tool: AutomationTool.Selenium,
    },
    {
        key: 'domAutomation',
        scope: MarkerScope.Window,
        tool: AutomationTool.ChromeAutomation,
    },
    {
        key: 'domAutomationController',
        scope: MarkerScope.Window,
        tool: AutomationTool.ChromeAutomation,
    },
    {
        key: '__playwright',
        scope: MarkerScope.Window,
        tool: AutomationTool.Playwright,
    },
    {
        key: '__pw_manual',
        scope: MarkerScope.Window,
        tool: AutomationTool.Playwright,
    },
    {
        key: '__pwInitScripts',
        scope: MarkerScope.Window,
        tool: AutomationTool.Playwright,
    },
    {
        key: '__playwright__binding__',
        scope: MarkerScope.Window,
        tool: AutomationTool.Playwright,
    },
    {
        key: 'Sequentum',
        scope: MarkerScope.Window,
        tool: AutomationTool.Sequentum,
    },
];

function detectAutomationGlobals(): AssessmentResult {
    const markerHit = automationGlobalMarkers.find(
        (marker) =>
            Reflect.get(marker.scope === MarkerScope.Window ? window : document, marker.key) !=
            undefined,
    );
    /** Selenium injects a `$cdc_…` property whose exact name varies, so match it by prefix. */
    const cdcKey = Object.keys(document).find((key) => key.startsWith('$cdc_'));

    if (markerHit) {
        return {
            verdict: Verdict.Fail,
            note: `${markerHit.scope}.${markerHit.key} is present, a marker left by ${markerHit.tool}.`,
            debug: `${markerHit.scope}.${markerHit.key}`,
        };
    } else if (cdcKey) {
        return {
            verdict: Verdict.Fail,
            note: `document.${cdcKey} is present, a marker left by Selenium/ChromeDriver.`,
            debug: `document.${cdcKey}`,
        };
    } else {
        return {
            verdict: Verdict.Pass,
            note: 'No automation framework globals were found.',
            debug: undefined,
        };
    }
}

async function detectHeadlessChrome(): Promise<AssessmentResult> {
    if (!isBlinkEngine()) {
        return {
            verdict: Verdict.Unknown,
            note: 'Headless Chrome checks only apply to Chromium-based browsers.',
            debug: undefined,
        };
    } else if (navigator.userAgent.includes('HeadlessChrome')) {
        return {
            verdict: Verdict.Fail,
            note: 'The user agent contains "HeadlessChrome".',
            debug: `userAgent = ${navigator.userAgent}`,
        };
    }

    /**
     * The classic headless tell: the permission is reported as denied while the Permissions API
     * still says it can be prompted, an inconsistency real browsers never produce.
     */
    const permissionState = await navigator.permissions
        .query({
            name: 'notifications',
        })
        .then((permissionStatus) => permissionStatus.state)
        .catch(() => undefined);
    if (permissionState === 'prompt' && Notification.permission === 'denied') {
        return {
            verdict: Verdict.Fail,
            note: 'Notification.permission is "denied" while the Permissions API reports "prompt", a headless Chrome inconsistency.',
            debug: `Notification.permission = ${Notification.permission}, query.state = ${permissionState}`,
        };
    }

    return {
        verdict: Verdict.Pass,
        note: 'No headless Chrome indicators were found.',
        debug: undefined,
    };
}

function detectWindowChrome(): AssessmentResult {
    const hasWindowChrome = check.isObject(Reflect.get(window, 'chrome'));

    if (isBlinkEngine() && !hasWindowChrome) {
        return {
            verdict: Verdict.Fail,
            note: 'A Chromium-based browser is missing window.chrome, typical of a headless or spoofed environment.',
            debug: 'window.chrome = undefined',
        };
    } else if (!isBlinkEngine() && hasWindowChrome) {
        return {
            verdict: Verdict.Warning,
            note: 'window.chrome exists on a non-Chromium browser, an inconsistency.',
            debug: 'window.chrome is present',
        };
    } else {
        return {
            verdict: Verdict.Pass,
            note: 'window.chrome is consistent with the browser engine.',
            debug: undefined,
        };
    }
}

const softwareRendererMarkers: ReadonlyArray<string> = [
    'swiftshader',
    'llvmpipe',
    'mesa offscreen',
    'software',
];

function detectWebgl(): AssessmentResult {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) {
        return {
            verdict: Verdict.Warning,
            note: 'No WebGL context is available, which is unusual for a real browser.',
            debug: undefined,
        };
    }

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : '';
    const debug = `renderer = ${renderer || 'unknown'}`;

    if (softwareRendererMarkers.some((marker) => renderer.toLowerCase().includes(marker))) {
        return {
            verdict: Verdict.Fail,
            note: `WebGL uses a software renderer (${renderer}), typical of headless or virtualized environments.`,
            debug,
        };
    }

    return {
        verdict: Verdict.Pass,
        note: 'The WebGL renderer looks like real hardware.',
        debug,
    };
}

async function detectCdp(): Promise<AssessmentResult> {
    if (!isBlinkEngine()) {
        return {
            verdict: Verdict.Unknown,
            note: 'CDP detection only applies to Chromium-based browsers.',
            debug: undefined,
        };
    }

    const stackLookup = {
        count: 0,
    };
    const probeError = new Error();
    Object.defineProperty(probeError, 'stack', {
        configurable: false,
        enumerable: false,
        get() {
            stackLookup.count += 1;
            return '';
        },
    });
    /**
     * An active CDP client with Runtime.enable (or open devtools) reads the `stack` getter to
     * format a logged error, which increments the counter. A single log avoids console noise.
     */
    // eslint-disable-next-line no-console
    console.debug(probeError);

    await wait({
        milliseconds: 300,
    });

    if (stackLookup.count > 0) {
        return {
            verdict: Verdict.Fail,
            note: 'A Chrome DevTools Protocol client read the error stack (Runtime.enable is active or devtools are open).',
            debug: `stack reads = ${stackLookup.count}`,
        };
    }

    return {
        verdict: Verdict.Pass,
        note: 'No Chrome DevTools Protocol activity was detected.',
        debug: undefined,
    };
}

type UserAgentDataLike = Readonly<{
    getHighEntropyValues: (hints: ReadonlyArray<string>) => Promise<Readonly<{platform?: string}>>;
}>;

function getUserAgentData(): UserAgentDataLike | undefined {
    const candidate = Reflect.get(navigator, 'userAgentData');
    if (candidate && check.isFunction(Reflect.get(candidate, 'getHighEntropyValues'))) {
        /**
         * Navigator.userAgentData is absent from the DOM lib types, so this untyped read is
         * required.
         */
        return candidate as UserAgentDataLike;
    }
    return undefined;
}

async function detectClientHints(): Promise<AssessmentResult> {
    if (!isBlinkEngine()) {
        return {
            verdict: Verdict.Unknown,
            note: 'Client hints only apply to Chromium-based browsers.',
            debug: undefined,
        };
    }

    const userAgentData = getUserAgentData();
    if (!userAgentData) {
        return {
            verdict: Verdict.Warning,
            note: 'A Chromium-based browser is missing navigator.userAgentData.',
            debug: undefined,
        };
    }

    const hintsPlatform = await userAgentData
        .getHighEntropyValues(['platform'])
        .then((values) => values.platform)
        .catch(() => undefined);
    const userAgentOs = Bowser.parse(navigator.userAgent).os.name;
    const debug = `userAgentData.platform = ${String(hintsPlatform)}, userAgent os = ${String(userAgentOs)}`;

    if (
        check.isString(hintsPlatform) &&
        hintsPlatform.length > 0 &&
        check.isString(userAgentOs) &&
        hintsPlatform !== userAgentOs
    ) {
        return {
            verdict: Verdict.Fail,
            note: `The client hints platform (${hintsPlatform}) disagrees with the user agent OS (${userAgentOs}).`,
            debug,
        };
    }

    return {
        verdict: Verdict.Pass,
        note: 'The client hints platform agrees with the user agent.',
        debug,
    };
}

function detectHardwareConcurrency(): AssessmentResult {
    const cores = navigator.hardwareConcurrency;
    const debug = `navigator.hardwareConcurrency = ${cores}`;

    if (cores === 0) {
        return {
            verdict: Verdict.Fail,
            note: 'navigator.hardwareConcurrency is zero, which is abnormal.',
            debug,
        };
    } else if (cores > 32) {
        return {
            verdict: Verdict.Warning,
            note: `navigator.hardwareConcurrency is unusually high (${cores}).`,
            debug,
        };
    } else {
        return {
            verdict: Verdict.Pass,
            note: `navigator.hardwareConcurrency is a normal value (${cores}).`,
            debug,
        };
    }
}

function detectScreenResolution(): AssessmentResult {
    const width = window.screen.width;
    const height = window.screen.height;
    const debug = `screen = ${width}x${height}`;

    if (width === 0 || height === 0) {
        return {
            verdict: Verdict.Fail,
            note: 'Screen dimensions are zero, typical of a headless browser.',
            debug,
        };
    } else if (width === 800 && height === 600) {
        return {
            verdict: Verdict.Fail,
            note: 'Screen resolution is 800x600, a common headless default.',
            debug,
        };
    } else {
        return {
            verdict: Verdict.Pass,
            note: `Screen resolution (${width}x${height}) looks normal.`,
            debug,
        };
    }
}

type WorkerNavigatorSnapshot = Readonly<{
    userAgent: string;
    platform: string;
    languages: string;
    hardwareConcurrency: number;
}>;

function readWorkerNavigator(): Promise<WorkerNavigatorSnapshot | undefined> {
    return new Promise((resolve) => {
        const workerSource = [
            'self.postMessage({',
            'userAgent: navigator.userAgent,',
            'platform: navigator.platform,',
            'languages: (navigator.languages || []).join(","),',
            'hardwareConcurrency: navigator.hardwareConcurrency,',
            '});',
        ].join('');
        const workerUrl = URL.createObjectURL(
            new Blob([workerSource], {
                type: 'application/javascript',
            }),
        );
        const worker = new Worker(workerUrl);
        const timeout = window.setTimeout(() => {
            worker.terminate();
            URL.revokeObjectURL(workerUrl);
            resolve(undefined);
        }, 1000);
        worker.addEventListener('message', (event: MessageEvent<WorkerNavigatorSnapshot>) => {
            window.clearTimeout(timeout);
            worker.terminate();
            URL.revokeObjectURL(workerUrl);
            resolve(event.data);
        });
    });
}

async function detectWorkerConsistency(): Promise<AssessmentResult> {
    const workerNavigator = await readWorkerNavigator().catch(() => undefined);
    if (!workerNavigator) {
        return {
            verdict: Verdict.Unknown,
            note: 'Could not read navigator inside a web worker to compare against the main thread.',
            debug: undefined,
        };
    }

    const comparedFields: ReadonlyArray<Readonly<{name: string; worker: string; main: string}>> = [
        {
            name: 'userAgent',
            worker: workerNavigator.userAgent,
            main: navigator.userAgent,
        },
        {
            name: 'platform',
            worker: workerNavigator.platform,
            main: navigator.platform,
        },
        {
            name: 'languages',
            worker: workerNavigator.languages,
            main: navigator.languages.join(','),
        },
    ];
    const mismatch = comparedFields.find((field) => field.worker !== field.main);

    if (mismatch) {
        return {
            verdict: Verdict.Fail,
            note: `navigator.${mismatch.name} differs between the main thread and a web worker, a sign of incomplete spoofing.`,
            debug: `main = ${mismatch.main}, worker = ${mismatch.worker}`,
        };
    }

    return {
        verdict: Verdict.Pass,
        note: 'navigator is consistent between the main thread and a web worker.',
        debug: undefined,
    };
}

function detectIframeOverrides(): AssessmentResult {
    /** Read method references via Reflect so they stay `unknown` and are not called unbound. */
    const contentWindowDescriptor = Object.getOwnPropertyDescriptor(
        HTMLIFrameElement.prototype,
        'contentWindow',
    );
    const contentWindowGetter: unknown = contentWindowDescriptor
        ? Reflect.get(contentWindowDescriptor, 'get')
        : undefined;
    const permissions: unknown = Reflect.get(navigator, 'permissions');
    const nativeChecks: ReadonlyArray<Readonly<{name: string; candidate: unknown}>> = [
        {
            name: 'HTMLIFrameElement.contentWindow',
            candidate: contentWindowGetter,
        },
        {
            name: 'Function.prototype.toString',
            candidate: Reflect.get(Function.prototype, 'toString'),
        },
        {
            name: 'navigator.permissions.query',
            candidate: check.isObject(permissions) ? Reflect.get(permissions, 'query') : undefined,
        },
    ];
    const patched = nativeChecks.find(
        (entry) => entry.candidate != undefined && !isNativeFunction(entry.candidate),
    );

    if (patched) {
        return {
            verdict: Verdict.Fail,
            note: `${patched.name} is overridden (not native code), a sign of an anti-detection framework.`,
            debug: `${patched.name} is patched`,
        };
    }

    return {
        verdict: Verdict.Pass,
        note: 'Core native functions are intact (not overridden).',
        debug: undefined,
    };
}

/**
 * `navigator.vendor` is a fixed constant per engine rather than per browser or version, so any
 * deviation from the engine's constant is a spoofing artifact. Every Chromium browser reports
 * Google (Edge, Opera, and Brave included) and every WebKit browser reports Apple, so this catches
 * a user agent that claims one engine while running another.
 */
const vendorsByEngineName: Readonly<Record<string, string>> = {
    Blink: 'Google Inc.',
    WebKit: 'Apple Computer, Inc.',
    Gecko: '',
};

function detectNavigatorVendor(): AssessmentResult {
    const engineName = Bowser.parse(navigator.userAgent).engine.name;
    const expectedVendor = engineName == undefined ? undefined : vendorsByEngineName[engineName];
    const debug = `navigator.vendor = "${navigator.vendor}", engine = ${engineName || 'unknown'}`;

    if (expectedVendor == undefined) {
        return {
            verdict: Verdict.Unknown,
            note: `No known navigator.vendor value for the ${engineName || 'unrecognized'} engine.`,
            debug,
        };
    } else if (navigator.vendor === expectedVendor) {
        return {
            verdict: Verdict.Pass,
            note: `navigator.vendor matches the ${engineName} engine.`,
            debug,
        };
    } else {
        return {
            verdict: Verdict.Fail,
            note: `navigator.vendor is "${navigator.vendor}" but the ${engineName} engine always reports "${expectedVendor}".`,
            debug,
        };
    }
}

/** Bowser `os.name` values for the Apple platforms that ship Apple Pay. */
const applePlatformNames: ReadonlyArray<string> = [
    'macOS',
    'iOS',
];

/**
 * Apple Pay is exposed only by Safari on Apple hardware, so `ApplePaySession` is a hard tell for
 * the real browser and platform underneath a spoofed user agent. Non-Apple WebKit builds
 * (Playwright's WebKit, Epiphany) lack it, which is exactly what makes a claimed macOS Safari
 * without it suspicious.
 */
function detectApplePay(): AssessmentResult {
    const hasApplePay = Reflect.get(window, 'ApplePaySession') != undefined;
    const parsed = Bowser.parse(navigator.userAgent);
    const claimsAppleSafari =
        parsed.browser.name === 'Safari' &&
        parsed.os.name != undefined &&
        applePlatformNames.includes(parsed.os.name);
    const debug = `window.ApplePaySession ${hasApplePay ? 'present' : 'absent'}, claimed = ${parsed.os.name || 'unknown'} ${parsed.browser.name || 'unknown'}`;

    if (hasApplePay && !claimsAppleSafari) {
        return {
            verdict: Verdict.Fail,
            note: 'window.ApplePaySession exists, but only Safari on macOS or iOS exposes it, so the user agent is not the real browser.',
            debug,
        };
    } else if (!hasApplePay && claimsAppleSafari && window.isSecureContext) {
        return {
            /**
             * Weak rather than conclusive: a managed or stripped-down Safari build can lack Apple
             * Pay without being automated.
             */
            verdict: Verdict.Warning,
            note: 'The user agent claims Safari on an Apple platform, but window.ApplePaySession is missing.',
            debug,
        };
    } else if (window.isSecureContext) {
        return {
            verdict: Verdict.Pass,
            note: 'Apple Pay availability is consistent with the claimed browser and platform.',
            debug,
        };
    } else {
        return {
            verdict: Verdict.Unknown,
            note: 'Apple Pay is only exposed in a secure context, so its absence here means nothing.',
            debug,
        };
    }
}

/**
 * Bot detection weighs its checks rather than taking the worst: one conclusive signal condemns, and
 * so do two independent weak ones, but a single weak signal only reaches a warning because plenty
 * of honest browsers trip exactly one.
 *
 * @category Internal
 */
export function aggregateBotVerdict(verdicts: ReadonlyArray<Verdict>): Verdict {
    const failed = verdicts.filter((verdict) => verdict === Verdict.Fail).length;
    const warned = verdicts.filter((verdict) => verdict === Verdict.Warning).length;

    if (failed > 0 || warned >= 2) {
        return Verdict.Fail;
    } else if (warned === 1) {
        return Verdict.Warning;
    } else {
        return Verdict.Pass;
    }
}

/**
 * How many checks currently accuse the browser, for callers that want the raw counts.
 *
 * @category Internal
 */
export function countBotSignals(report: BotReport): Readonly<{strong: number; weak: number}> {
    return {
        strong: countAssessmentsWithVerdict({
            assessments: report.assessments,
            verdict: Verdict.Fail,
        }),
        weak: countAssessmentsWithVerdict({
            assessments: report.assessments,
            verdict: Verdict.Warning,
        }),
    };
}

/**
 * Runs every bot signal once and reduces them to a single verdict.
 *
 * @category Internal
 */
export async function runBotChecks(): Promise<BotReport> {
    const [
        headlessChrome,
        cdp,
        clientHints,
        workerConsistency,
    ] = await Promise.all([
        detectHeadlessChrome(),
        detectCdp(),
        detectClientHints(),
        detectWorkerConsistency(),
    ]);

    return buildAssessmentGroup({
        results: {
            [BotCheckId.UserAgent]: detectUserAgent(),
            [BotCheckId.WebDriver]: detectWebDriver(),
            [BotCheckId.AutomationGlobals]: detectAutomationGlobals(),
            [BotCheckId.HeadlessChrome]: headlessChrome,
            [BotCheckId.WindowChrome]: detectWindowChrome(),
            [BotCheckId.Webgl]: detectWebgl(),
            [BotCheckId.Cdp]: cdp,
            [BotCheckId.ClientHints]: clientHints,
            [BotCheckId.HardwareConcurrency]: detectHardwareConcurrency(),
            [BotCheckId.ScreenResolution]: detectScreenResolution(),
            [BotCheckId.WorkerConsistency]: workerConsistency,
            [BotCheckId.IframeOverrides]: detectIframeOverrides(),
            [BotCheckId.NavigatorVendor]: detectNavigatorVendor(),
            [BotCheckId.ApplePay]: detectApplePay(),
        },
        labels: botCheckLabels,
        aggregate: aggregateBotVerdict,
    });
}
