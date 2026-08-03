// cspell:words pptr

import {check} from '@augment-vir/assert';
import {createArray, wait} from '@augment-vir/common';
import Bowser from 'bowser';
import {
    buildAssessmentGroup,
    Verdict,
    type AssessmentGroup,
    type AssessmentResult,
} from './assessment.js';

/**
 * Both names are deliberately prefixed: this block widens `Window` in every consuming project, so a
 * generic name like `dummyFn` would collide with whatever the consumer already has.
 *
 * Playwright's own `__pwInitScripts` is absent here on purpose. That name belongs to Playwright,
 * not to this package, so it is read reflectively rather than declared.
 */
declare global {
    interface Window {
        /**
         * Exposed for the main-world object access check; automation calls it to prove main-world
         * access.
         */
        minutiaReportMainWorldAccess?: (() => boolean) | undefined;
        /**
         * Populated by `page.exposeFunction('minutiaExposedFunction', ...)`; inspected for
         * automation binding leaks.
         */
        minutiaExposedFunction?: ((...args: ReadonlyArray<unknown>) => unknown) | undefined;
    }
}

/**
 * Every automation-detection check ported from https://bot-detector.rebrowser.net/.
 *
 * @category Internal
 */
export enum AutomationCheckId {
    MainWorldObjectAccess = 'mainWorldObjectAccess',
    SourceUrlLeak = 'sourceUrlLeak',
    MainWorldExecution = 'mainWorldExecution',
    RuntimeEnableLeak = 'runtimeEnableLeak',
    ExposeFunctionLeak = 'exposeFunctionLeak',
    NavigatorWebdriver = 'navigatorWebdriver',
    BypassCsp = 'bypassCsp',
    Viewport = 'viewport',
    UserAgentData = 'userAgentData',
    UserAgent = 'userAgent',
    PwInitScripts = 'pwInitScripts',
}

/**
 * User-facing text for each {@link AutomationCheckId}.
 *
 * @category Internal
 */
export const automationCheckLabels: Record<AutomationCheckId, string> = {
    [AutomationCheckId.MainWorldObjectAccess]: 'main-world object access',
    [AutomationCheckId.SourceUrlLeak]: 'sourceUrl stack leak',
    [AutomationCheckId.MainWorldExecution]: 'main-world execution',
    [AutomationCheckId.RuntimeEnableLeak]: 'cdp runtime.enable leak',
    [AutomationCheckId.ExposeFunctionLeak]: 'exposeFunction binding leak',
    [AutomationCheckId.NavigatorWebdriver]: 'navigator.webdriver',
    [AutomationCheckId.BypassCsp]: 'content security policy bypass',
    [AutomationCheckId.Viewport]: 'automation default viewport',
    [AutomationCheckId.UserAgentData]: 'userAgentData chrome version',
    [AutomationCheckId.UserAgent]: 'userAgent chrome version',
    [AutomationCheckId.PwInitScripts]: 'playwright init scripts',
};

/**
 * Every automation assessment plus the single verdict that summarizes them.
 *
 * @category Internal
 */
export type AutomationReport = AssessmentGroup<AutomationCheckId>;

/**
 * Called with a fresh {@link AutomationReport} each time an automation check changes.
 *
 * @category Internal
 */
export type AutomationReportListener = (report: AutomationReport) => void;

type ReportAssessment = (id: AutomationCheckId, result: AssessmentResult) => void;

type RunState = Readonly<{isStopped: boolean}>;

/**
 * Several of these checks only resolve when automation itself trips them (by evaluating a script,
 * by calling an exposed binding), so every check starts here rather than appearing later. A report
 * is therefore complete from the first emission and consumers never have to handle a missing
 * check.
 */
function pendingResult(note: string): AssessmentResult {
    return {
        verdict: Verdict.Unknown,
        note,
        debug: undefined,
    };
}

/**
 * A missing `cspProbeScriptUrl` is the one unset option that warns rather than leaving its check
 * pending: without a probe URL the check can never run at all, so leaving it silent would let a
 * page believe its CSP was verified when nothing was ever loaded.
 */
const missingCspUrlResult: AssessmentResult = {
    verdict: Verdict.Warning,
    note: 'This check did not run. Set cspProbeScriptUrl to a cross-origin script that your page’s script-src forbids.',
    debug: 'cspProbeScriptUrl is unset',
};

const initialResults: Record<AutomationCheckId, AssessmentResult> = {
    [AutomationCheckId.MainWorldObjectAccess]: pendingResult(
        'Call window.minutiaReportMainWorldAccess() from the main context to test main-world object access.',
    ),
    [AutomationCheckId.SourceUrlLeak]: pendingResult(
        'Call document.getElementById to test for a sourceUrl leak.',
    ),
    [AutomationCheckId.MainWorldExecution]: pendingResult(
        'Call document.getElementsByClassName("div") to trigger this check. If it never fires, scripts run in a safe isolated world.',
    ),
    [AutomationCheckId.RuntimeEnableLeak]: pendingResult('Probing for a CDP Runtime.enable leak…'),
    [AutomationCheckId.ExposeFunctionLeak]: pendingResult(
        'No window.minutiaExposedFunction is present. Call page.exposeFunction("minutiaExposedFunction", …) to trigger this check.',
    ),
    [AutomationCheckId.NavigatorWebdriver]: pendingResult('Reading navigator.webdriver…'),
    [AutomationCheckId.BypassCsp]: missingCspUrlResult,
    [AutomationCheckId.Viewport]: pendingResult('Measuring the viewport…'),
    [AutomationCheckId.UserAgentData]: pendingResult(
        'Comparing against the latest Chrome release…',
    ),
    [AutomationCheckId.UserAgent]: pendingResult('Comparing against the latest Chrome release…'),
    [AutomationCheckId.PwInitScripts]: pendingResult('Watching for window.__pwInitScripts…'),
};

function initMainWorldObjectAccess(report: ReportAssessment): void {
    window.minutiaReportMainWorldAccess = function reportMainWorldAccess() {
        report(AutomationCheckId.MainWorldObjectAccess, {
            verdict: Verdict.Fail,
            note: 'window.minutiaReportMainWorldAccess() was called, so scripts can reach main-world objects.',
            debug: undefined,
        });
        return true;
    };
}

function initSourceUrlLeak(report: ReportAssessment): void {
    const suspiciousMarkers: ReadonlyArray<Readonly<{marker: string; note: string}>> = [
        {
            marker: 'pptr:',
            note: 'The error stack contains "pptr:", which indicates unpatched Puppeteer.',
        },
        {
            marker: 'UtilityScript.',
            note: 'The error stack contains "UtilityScript.", which indicates unpatched Playwright.',
        },
    ];

    function reportSourceUrlLeak(): void {
        const stack = new Error('Detection Error').stack ?? '';
        const detectedMarker = suspiciousMarkers.find((entry) => stack.includes(entry.marker));

        report(
            AutomationCheckId.SourceUrlLeak,
            detectedMarker
                ? {
                      verdict: Verdict.Fail,
                      note: detectedMarker.note,
                      debug: stack,
                  }
                : {
                      verdict: Verdict.Pass,
                      note: 'The error stack contains nothing suspicious.',
                      debug: stack,
                  },
        );
    }

    /** The wrapper fires on any getElementById call, so automation triggers it from its own world. */
    const originalGetElementById = document.getElementById.bind(document);
    document.getElementById = function patchedGetElementById(elementId: string) {
        reportSourceUrlLeak();
        return originalGetElementById(elementId);
    };
}

function initMainWorldExecution(report: ReportAssessment): void {
    const originalGetElementsByClassName = document.getElementsByClassName.bind(document);
    document.getElementsByClassName = function patchedGetElementsByClassName(classNames: string) {
        report(AutomationCheckId.MainWorldExecution, {
            verdict: Verdict.Fail,
            note: 'document.getElementsByClassName() ran in the main world. Use rebrowser-patches to run scripts in an isolated world.',
            debug: `classNames = ${classNames}`,
        });
        return originalGetElementsByClassName(classNames);
    };
}

/**
 * Guards the Runtime.enable probe so it logs to the console at most once per page load, no matter
 * how many times the checks are (re)started.
 */
const runtimeEnableProbeState = {
    hasProbed: false,
};

async function reportRuntimeEnableLeak(report: ReportAssessment): Promise<void> {
    report(AutomationCheckId.RuntimeEnableLeak, {
        verdict: Verdict.Pass,
        note: 'No Runtime.enable (CDP) leak detected.',
        debug: undefined,
    });

    if (runtimeEnableProbeState.hasProbed) {
        return;
    }
    runtimeEnableProbeState.hasProbed = true;

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
     * Logging the error to the console once is the actual probe: an active CDP Runtime.enable (or
     * open devtools) reads the `stack` getter to format the log, which increments the counter. A
     * single log avoids console noise on a normal browser where the stack is never read.
     */
    // eslint-disable-next-line no-console
    console.debug(probeError);

    await wait({
        milliseconds: 500,
    });

    if (stackLookup.count > 0) {
        report(AutomationCheckId.RuntimeEnableLeak, {
            verdict: Verdict.Fail,
            note: 'A Runtime.enable (CDP) leak was detected. Devtools may be open, or CDP Runtime.enable is active.',
            debug: `stackLookupCount = ${stackLookup.count}`,
        });
    }
}

function detectExposeFunctionLeak(): AssessmentResult {
    const exposedFunction = window.minutiaExposedFunction;
    if (check.isUndefined(exposedFunction)) {
        return initialResults[AutomationCheckId.ExposeFunctionLeak];
    }

    const exposedFunctionSource = exposedFunction.toString();
    if (exposedFunctionSource.includes('This is the Puppeteer binding')) {
        return {
            verdict: Verdict.Fail,
            note: 'window.minutiaExposedFunction is the unpatched Puppeteer page.exposeFunction binding.',
            debug: exposedFunctionSource,
        };
    } else if (exposedFunctionSource.includes('exposeBindingHandle supports a single argument')) {
        return {
            verdict: Verdict.Fail,
            note: 'window.minutiaExposedFunction is the unpatched Playwright page.exposeFunction binding.',
            debug: exposedFunctionSource,
        };
    }

    const suspiciousWindowKey = Object.keys(window).find((key) => {
        if (key.startsWith('puppeteer_') || key === '__playwright__binding__') {
            return true;
        }

        const value = Reflect.get(window, key);
        return check.isFunction(value) && Reflect.get(value, '__installed') === true;
    });
    if (suspiciousWindowKey != undefined) {
        return {
            verdict: Verdict.Fail,
            note: `window.${suspiciousWindowKey} indicates an unpatched page.exposeFunction leak.`,
            debug: `windowKey = ${suspiciousWindowKey}`,
        };
    }

    return {
        verdict: Verdict.Pass,
        note: 'No exposeFunction leak was detected.',
        debug: undefined,
    };
}

async function pollExposeFunctionLeak(report: ReportAssessment, runState: RunState): Promise<void> {
    while (!runState.isStopped) {
        report(AutomationCheckId.ExposeFunctionLeak, detectExposeFunctionLeak());
        await wait({
            milliseconds: 100,
        });
    }
}

function getNavigatorWebdriverNote(): Readonly<{note: string; debug: string}> | undefined {
    /** Typed as `unknown` because navigator.webdriver can be deleted at runtime to evade detection. */
    const webdriverValue: unknown = Reflect.get(navigator, 'webdriver');

    if (webdriverValue === true) {
        return {
            note: 'navigator.webdriver is true, which flags automation. Launch Chrome with --disable-blink-features=AutomationControlled.',
            debug: 'navigator.webdriver = true',
        };
    } else if (check.isUndefined(webdriverValue)) {
        return {
            note: 'navigator.webdriver is undefined, which is abnormal and may indicate it was deleted manually.',
            debug: 'navigator.webdriver = undefined',
        };
    } else if (Object.getOwnPropertyNames(navigator).length > 0) {
        return {
            note: 'Object.getOwnPropertyNames(navigator) should be empty for a normal browser.',
            debug: `Object.getOwnPropertyNames(navigator) = ${JSON.stringify(Object.getOwnPropertyNames(navigator))}`,
        };
    } else if (check.isDefined(Object.getOwnPropertyDescriptor(navigator, 'webdriver'))) {
        return {
            note: 'The own property descriptor for navigator.webdriver should be undefined.',
            debug: 'own webdriver descriptor is present',
        };
    } else {
        return undefined;
    }
}

function reportNavigatorWebdriver(report: ReportAssessment): void {
    const suspiciousNote = getNavigatorWebdriverNote();

    report(
        AutomationCheckId.NavigatorWebdriver,
        suspiciousNote
            ? {
                  verdict: Verdict.Fail,
                  note: suspiciousNote.note,
                  debug: suspiciousNote.debug,
              }
            : {
                  verdict: Verdict.Pass,
                  note: 'No navigator.webdriver flag is present.',
                  debug: undefined,
              },
    );
}

/**
 * Loading a cross-origin script only succeeds when the page's Content Security Policy was bypassed,
 * so this check is only meaningful on a page that actually sets a restrictive `script-src`.
 */
function initBypassCsp(report: ReportAssessment, probeScriptUrl: string): void {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = probeScriptUrl;
    script.addEventListener('error', () => {
        report(AutomationCheckId.BypassCsp, {
            verdict: Verdict.Pass,
            note: 'Content Security Policy is enforced, which is expected for a normal browser.',
            debug: undefined,
        });
    });
    script.addEventListener('load', () => {
        report(AutomationCheckId.BypassCsp, {
            verdict: Verdict.Fail,
            note: 'Content Security Policy was bypassed. You may be using Page.setBypassCSP (Puppeteer) or bypassCSP: true (Playwright).',
            debug: undefined,
        });
    });
    document.head.append(script);
}

function getDefaultViewportNote({
    width,
    height,
}: Readonly<{width: number; height: number}>): string | undefined {
    if (width === 800 && height === 600) {
        return 'Viewport matches the Puppeteer default of 800x600. Set defaultViewport: null.';
    } else if (width === 1280 && height === 720) {
        return 'Viewport matches the Playwright default of 1280x720. Set viewport: null.';
    } else {
        return undefined;
    }
}

function reportViewport(report: ReportAssessment): void {
    const width = Math.max(document.documentElement.clientWidth, window.innerWidth);
    const height = Math.max(document.documentElement.clientHeight, window.innerHeight);
    const debug = `width = ${width}, height = ${height}`;

    const defaultViewportNote = getDefaultViewportNote({
        width,
        height,
    });

    report(
        AutomationCheckId.Viewport,
        defaultViewportNote
            ? {
                  verdict: Verdict.Fail,
                  note: defaultViewportNote,
                  debug,
              }
            : {
                  verdict: Verdict.Pass,
                  note: 'Viewport does not match automation-library defaults.',
                  debug,
              },
    );
}

type UserAgentBrandVersion = Readonly<{brand: string; version: string}>;

type HighEntropyResult = Readonly<{
    fullVersionList?: ReadonlyArray<UserAgentBrandVersion> | undefined;
}>;

type UserAgentData = Readonly<{
    getHighEntropyValues: (hints: ReadonlyArray<string>) => Promise<HighEntropyResult>;
}>;

function getUserAgentData(): UserAgentData | undefined {
    const candidate = Reflect.get(navigator, 'userAgentData');
    if (candidate && check.isFunction(Reflect.get(candidate, 'getHighEntropyValues'))) {
        /** Navigator.userAgentData is not in the DOM lib types, so this untyped read is unavoidable. */
        return candidate as UserAgentData;
    }
    return undefined;
}

function fetchLatestStableChromeVersion(): Promise<string | undefined> {
    return fetch(
        'https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Windows&num=1&offset=0',
    )
        .then((response) =>
            response.ok
                ? response.json()
                : Promise.reject(new Error(`${response.status} ${response.statusText}`)),
        )
        .then((releases: ReadonlyArray<{version: string}>) => releases[0]?.version)
        .catch(() => undefined);
}

/**
 * Compares two dotted Chrome version strings, returning a negative number when `installed` is
 * older, zero when they are equal, and a positive number when `installed` is newer.
 *
 * @category Internal
 */
export function compareChromeVersions({
    installed,
    latestStable,
}: Readonly<{installed: string; latestStable: string}>): number {
    const installedParts = installed.split('.').map(Number);
    const stableParts = latestStable.split('.').map(Number);
    const partCount = Math.max(installedParts.length, stableParts.length);
    const differences = createArray(
        partCount,
        (index) => (installedParts[index] ?? 0) - (stableParts[index] ?? 0),
    );
    return differences.find((difference) => difference !== 0) ?? 0;
}

async function reportUserAgentData(report: ReportAssessment): Promise<void> {
    const userAgentData = getUserAgentData();
    if (!userAgentData) {
        report(AutomationCheckId.UserAgentData, {
            verdict: Verdict.Unknown,
            note: 'navigator.userAgentData is unavailable, so the Chrome version cannot be checked. This check targets Chromium-based browsers.',
            debug: undefined,
        });
        return;
    }

    const relevantBrands = await userAgentData
        .getHighEntropyValues(['fullVersionList'])
        .then((values) => values.fullVersionList ?? [])
        .then((brands) =>
            brands.filter((item) =>
                [
                    'Chromium',
                    'Google Chrome',
                ].includes(item.brand),
            ),
        )
        .catch(() => []);
    const brandNames = relevantBrands.map((item) => item.brand);
    const debug = `fullVersionList = ${JSON.stringify(relevantBrands)}`;

    if (relevantBrands.length === 0) {
        report(AutomationCheckId.UserAgentData, {
            verdict: Verdict.Warning,
            note: 'Cannot detect a Chromium or Chrome brand. This check targets Chromium-based browsers.',
            debug,
        });
        return;
    } else if (brandNames.includes('Chromium') && !brandNames.includes('Google Chrome')) {
        report(AutomationCheckId.UserAgentData, {
            verdict: Verdict.Fail,
            note: 'Only the Chromium brand is present, which usually means Google Chrome for Testing. Point executablePath at stable Google Chrome.',
            debug,
        });
        return;
    }

    const installedVersion = relevantBrands.find((item) => item.brand === 'Google Chrome')?.version;
    const latestStableVersion = await fetchLatestStableChromeVersion();
    if (installedVersion == undefined || latestStableVersion == undefined) {
        report(AutomationCheckId.UserAgentData, {
            verdict: Verdict.Unknown,
            note: 'Cannot fetch the latest stable Chrome release to compare versions.',
            debug,
        });
        return;
    } else if (
        compareChromeVersions({
            installed: installedVersion,
            latestStable: latestStableVersion,
        }) > 0
    ) {
        report(AutomationCheckId.UserAgentData, {
            verdict: Verdict.Warning,
            note: `Chrome version ${installedVersion} is newer than the latest stable release ${latestStableVersion}, which is abnormal.`,
            debug,
        });
        return;
    }

    report(AutomationCheckId.UserAgentData, {
        verdict: Verdict.Pass,
        note: `Chrome version ${installedVersion} is not newer than the latest stable release ${latestStableVersion}.`,
        debug,
    });
}

/** Parses the browser name and version out of a raw userAgent string via the bowser package. */
function parseUserAgentBrowser(
    userAgent: string,
): Readonly<{name: string; version: string}> | undefined {
    const browser = Bowser.parse(userAgent).browser;
    if (browser.name == undefined || browser.version == undefined) {
        return undefined;
    }
    return {
        name: browser.name,
        version: browser.version,
    };
}

/**
 * The userAgentData-based sibling of {@link reportUserAgentData}: it derives the same Chrome version
 * comparison from the legacy navigator.userAgent string instead. It cannot detect Chrome for
 * Testing because that shares an identical userAgent with normal Chrome.
 */
async function reportUserAgent(report: ReportAssessment): Promise<void> {
    const browser = parseUserAgentBrowser(navigator.userAgent);
    const debug = `userAgent = ${navigator.userAgent}`;

    if (browser == undefined) {
        report(AutomationCheckId.UserAgent, {
            verdict: Verdict.Unknown,
            note: 'Could not parse a browser and version out of navigator.userAgent.',
            debug,
        });
        return;
    } else if (
        ![
            'Chrome',
            'Chromium',
        ].includes(browser.name)
    ) {
        report(AutomationCheckId.UserAgent, {
            verdict: Verdict.Unknown,
            note: `navigator.userAgent reports ${browser.name}, but this check targets Chromium-based browsers.`,
            debug,
        });
        return;
    }

    const latestStableVersion = await fetchLatestStableChromeVersion();
    if (latestStableVersion == undefined) {
        report(AutomationCheckId.UserAgent, {
            verdict: Verdict.Unknown,
            note: 'Cannot fetch the latest stable Chrome release to compare versions.',
            debug,
        });
        return;
    } else if (
        compareChromeVersions({
            installed: browser.version,
            latestStable: latestStableVersion,
        }) > 0
    ) {
        report(AutomationCheckId.UserAgent, {
            verdict: Verdict.Warning,
            note: `navigator.userAgent Chrome version ${browser.version} is newer than the latest stable release ${latestStableVersion}, which is abnormal.`,
            debug,
        });
        return;
    }

    report(AutomationCheckId.UserAgent, {
        verdict: Verdict.Pass,
        note: `navigator.userAgent Chrome version ${browser.version} is not newer than the latest stable release ${latestStableVersion}.`,
        debug,
    });
}

async function pollPwInitScripts(report: ReportAssessment, runState: RunState): Promise<void> {
    report(AutomationCheckId.PwInitScripts, {
        verdict: Verdict.Pass,
        note: 'No window.__pwInitScripts object detected.',
        debug: undefined,
    });

    while (!runState.isStopped) {
        /** Playwright owns this name, so it is read reflectively rather than declared on `Window`. */
        const initScripts: unknown = Reflect.get(window, '__pwInitScripts');
        if (initScripts !== undefined) {
            report(AutomationCheckId.PwInitScripts, {
                verdict: Verdict.Fail,
                note: 'window.__pwInitScripts exists, which unpatched Playwright injects into every page.',
                debug: `__pwInitScripts = ${JSON.stringify(initScripts)}`,
            });
            return;
        }

        await wait({
            milliseconds: 100,
        });
    }
}

/**
 * Options for {@link startAutomationChecks}.
 *
 * @category Internal
 */
export type AutomationChecksOptions = Readonly<{
    /**
     * Cross-origin script the CSP bypass check tries to load. It must be a real, loadable URL on an
     * origin your page's `script-src` forbids, or the check cannot tell a bypass apart from an
     * ordinary network failure.
     *
     * There is deliberately no default: this is the only check that talks to the network, and
     * picking a third-party URL on the caller's behalf would make every consumer of this package
     * silently hit someone else's server. Leave it unset and the check reports
     * {@link Verdict.Warning} telling you to set it.
     */
    cspProbeScriptUrl?: string | undefined;
}>;

/**
 * Page-global controller. These checks hook `document`/`window` globals, so they must only ever be
 * installed once; this holds the single running instance and its most recent results.
 */
const controller = {
    isStarted: false,
    results: {
        ...initialResults,
    },
    latest: undefined as AutomationReport | undefined,
    listener: undefined as AutomationReportListener | undefined,
};

function buildAutomationReport(): AutomationReport {
    return buildAssessmentGroup({
        results: controller.results,
        labels: automationCheckLabels,
    });
}

/**
 * The most recent automation report, or the all-pending report if checks have not been started.
 *
 * @category Internal
 */
export function getAutomationReport(): AutomationReport {
    return controller.latest ?? buildAutomationReport();
}

/**
 * Starts every automation-detection check and reports through `onUpdate` whenever one changes.
 *
 * Safe to call more than once: the checks and their global hooks are only installed on the first
 * call, and later calls swap in the new listener and immediately replay the latest results. Several
 * checks stay {@link Verdict.Unknown} until automation itself trips them, so this streams rather
 * than resolving once.
 *
 * @category Internal
 */
export function startAutomationChecks(
    onUpdate: AutomationReportListener,
    {cspProbeScriptUrl}: AutomationChecksOptions = {},
): void {
    controller.listener = onUpdate;
    onUpdate(getAutomationReport());

    if (controller.isStarted) {
        return;
    }
    controller.isStarted = true;

    const runState = {
        isStopped: false,
    };

    const report: ReportAssessment = (id, result) => {
        const existing = controller.results[id];
        if (
            existing.verdict === result.verdict &&
            existing.note === result.note &&
            existing.debug === result.debug
        ) {
            return;
        }

        controller.results = {
            ...controller.results,
            [id]: result,
        };
        controller.latest = buildAutomationReport();
        controller.listener?.(controller.latest);
    };

    initMainWorldObjectAccess(report);
    initSourceUrlLeak(report);
    initMainWorldExecution(report);
    void reportRuntimeEnableLeak(report);
    void pollExposeFunctionLeak(report, runState);
    reportNavigatorWebdriver(report);
    if (cspProbeScriptUrl) {
        initBypassCsp(report, cspProbeScriptUrl);
    }
    reportViewport(report);
    void reportUserAgentData(report);
    void reportUserAgent(report);
    void pollPwInitScripts(report, runState);
}
