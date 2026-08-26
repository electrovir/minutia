// cspell:words glibc ucrt minikin fdlibm libsystem tanh atob kansainvälistyminen constitutionalibus scrapfly spoofable aosp hyphenator aarch64 amd64 wow64 farble farbles
// cspell:words chancery calibri cambria segoe dejavu nimbus roboto droid lucida mmmmmmmmmmlli

import {check, checkWrap} from '@augment-vir/assert';
import {getObjectTypedKeys, getObjectTypedValues} from '@augment-vir/common';
import Bowser from 'bowser';

/**
 * Side-channel OS fingerprints ported from the Scrapfly write-ups. Each one measures browser
 * behavior that reveals the real operating system or engine. The measurement is then checked
 * against a reference of what the browser + OS the user agent _claims_ should produce: if the
 * fingerprint belongs to a different browser + OS, the user agent is lying.
 *
 * - Hyphenation: https://scrapfly.dev/posts/browser-hyphenation-os-fingerprint/
 * - Math libm: https://scrapfly.dev/posts/browser-math-os-fingerprint/
 * - Audio: https://scrapfly.dev/posts/audio-fingerprint-math/
 *
 * Font enumeration is the same idea applied to the font collection each OS ships, the technique
 * FingerprintJS uses as its highest-entropy source: https://github.com/fingerprintjs/fingerprintjs
 *
 * @category Internal
 */
export enum OsFingerprintType {
    Hyphenation = 'hyphenation',
    MathLibm = 'mathLibm',
    Audio = 'audio',
    Fonts = 'fonts',
}

/**
 * The source of a browser's hyphenation dictionaries.
 *
 * @category Internal
 */
export enum HyphenationDictionary {
    /** MacOS and iOS: Apple CoreFoundation dictionaries (hyphenate Finnish, not Latin). */
    Apple = 'apple',
    /** Windows, Linux, Android, ChromeOS: AOSP Minikin dictionaries (hyphenate Latin, not Finnish). */
    Minikin = 'minikin',
    /**
     * The browser ships its own dictionaries instead of using the OS hyphenator (Firefox hyphenates
     * both Finnish and Latin everywhere), so hyphenation reveals nothing about the operating
     * system.
     */
    Bundled = 'bundled',
}

/**
 * The font collection an operating system ships. Unlike hyphenation, which cannot separate the
 * three Minikin platforms from each other, fonts tell Windows, Linux, and Android apart.
 *
 * @category Internal
 */
export enum FontPlatform {
    /** MacOS and iOS. */
    Apple = 'apple',
    Windows = 'windows',
    /** Desktop Linux distributions and ChromeOS. */
    Linux = 'linux',
    Android = 'android',
}

/**
 * The C math library a JS engine's `Math.tanh` routes to, distinguishable by its exact rounding.
 *
 * @category Internal
 */
export enum LibmSignature {
    /** Linux glibc. Also the signature of the fdlibm implementation Firefox bundles everywhere. */
    Glibc = 'glibc',
    /** MacOS libsystem_m. */
    AppleLibm = 'appleLibm',
    /** Windows UCRT. */
    Ucrt = 'ucrt',
}

/**
 * CPU instruction-set family, the axis the audio fingerprint actually varies along.
 *
 * @category Internal
 */
export enum CpuArchitecture {
    /** Apple Silicon and other ARM machines. Matches the UA client-hint `architecture: 'arm'`. */
    Arm = 'arm',
    /** Intel and AMD machines. Matches the UA client-hint `architecture: 'x86'` (32- and 64-bit). */
    X86 = 'x86',
}

/**
 * What the user agent claims about itself, before any fingerprint is measured against it.
 *
 * @category Internal
 */
export type BrowserGroundTruth = Readonly<{
    userAgent: string;
    /** Bowser `os.name`, e.g. 'macOS', 'Windows', 'Linux', 'iOS', 'Android', 'Chrome OS'. */
    osName: string | undefined;
    /** Bowser `browser.name`, e.g. 'Chrome', 'Safari', 'Firefox'. */
    browserName: string | undefined;
    /** Bowser `browser.version`, e.g. '149.0.0.0'. */
    browserVersion: string | undefined;
}>;

/**
 * Bowser reports Brave as 'Chrome'; this is the brand name the report uses once Brave is detected.
 *
 * @category Internal
 */
export const braveBrowserName = 'Brave';

/** Brave's namespace on `navigator`; present only in Brave and absent from the DOM lib types. */
type NavigatorBrave = Readonly<{
    isBrave: () => Promise<boolean>;
}>;

function getNavigatorBrave(): NavigatorBrave | undefined {
    const candidate: unknown = Reflect.get(navigator, 'brave');
    if (!check.isObject(candidate)) {
        return undefined;
    }
    return check.isFunction(Reflect.get(candidate, 'isBrave'))
        ? (candidate satisfies object as NavigatorBrave)
        : undefined;
}

/**
 * Whether the current browser is Brave. Brave masquerades as Chrome in its user agent, so its own
 * `navigator.brave.isBrave()` is the only reliable way to tell it apart.
 *
 * @category Internal
 */
export async function detectBrave(): Promise<boolean> {
    const brave = getNavigatorBrave();
    return brave ? brave.isBrave() : false;
}

/**
 * Reads the browser and OS the user agent claims, with Brave resolved out of band.
 *
 * @category Internal
 */
export async function getBrowserGroundTruth(): Promise<BrowserGroundTruth> {
    const parsed = Bowser.parse(navigator.userAgent);
    return {
        userAgent: navigator.userAgent,
        osName: parsed.os.name,
        /** Brave masquerades as Chrome in its user agent, so it is detected out of band. */
        browserName: (await detectBrave()) ? braveBrowserName : parsed.browser.name,
        browserVersion: parsed.browser.version,
    };
}

/**
 * Raw hyphenation measurements plus the dictionary they identify.
 *
 * @category Internal
 */
export type HyphenationResult = Readonly<{
    finnishAutoHeight: number;
    finnishBaselineHeight: number;
    latinAutoHeight: number;
    latinBaselineHeight: number;
    /** Apple ships a Finnish dictionary; Minikin does not. */
    finnishHyphenates: boolean;
    /** Minikin ships a Latin dictionary; Apple does not. */
    latinHyphenates: boolean;
    detected: HyphenationDictionary | undefined;
}>;

const hyphenationFontSizePx = 20;
const finnishProbeWord = 'kansainvälistyminen';
const latinProbeWord = 'constitutionalibus';

/** Renders `word` in a narrow box and returns its rendered height in pixels. */
function measureWrapHeight({
    lang,
    word,
    enableHyphens,
}: Readonly<{lang: string; word: string; enableHyphens: boolean}>): number {
    const hyphensValue = enableHyphens ? 'auto' : 'none';
    const element = document.createElement('div');
    element.setAttribute('lang', lang);
    element.style.cssText = [
        'position:absolute',
        'left:-9999px',
        'top:0',
        'width:6ch',
        `font:${hyphenationFontSizePx}px serif`,
        `hyphens:${hyphensValue}`,
        `-webkit-hyphens:${hyphensValue}`,
        'overflow-wrap:normal',
        'word-break:normal',
    ].join(';');
    element.textContent = word;
    document.body.append(element);
    const height = element.getBoundingClientRect().height;
    element.remove();
    return height;
}

/**
 * Compares the word's height with hyphenation enabled against its single-line baseline. A jump to
 * roughly double the height means the browser broke it across lines, which only happens when a
 * hyphenation dictionary exists for that language.
 */
function probeHyphenation({lang, word}: Readonly<{lang: string; word: string}>): Readonly<{
    autoHeight: number;
    baselineHeight: number;
    hyphenates: boolean;
}> {
    const autoHeight = measureWrapHeight({
        lang,
        word,
        enableHyphens: true,
    });
    const baselineHeight = measureWrapHeight({
        lang,
        word,
        enableHyphens: false,
    });
    return {
        autoHeight,
        baselineHeight,
        hyphenates: autoHeight > baselineHeight * 1.5,
    };
}

function dictionaryFromProbes({
    finnishHyphenates,
    latinHyphenates,
}: Readonly<{finnishHyphenates: boolean; latinHyphenates: boolean}>):
    | HyphenationDictionary
    | undefined {
    if (finnishHyphenates && latinHyphenates) {
        /** Both wrap only when the browser ships its own comprehensive dictionaries (Firefox). */
        return HyphenationDictionary.Bundled;
    } else if (!finnishHyphenates && !latinHyphenates) {
        /** Neither wraps: the browser has no dictionary for these languages at all. */
        return undefined;
    } else {
        return finnishHyphenates ? HyphenationDictionary.Apple : HyphenationDictionary.Minikin;
    }
}

/**
 * Measures which hyphenation dictionary the browser ships, which is set by the OS.
 *
 * @category Internal
 */
export function detectHyphenationDictionary(): HyphenationResult {
    const finnish = probeHyphenation({
        lang: 'fi',
        word: finnishProbeWord,
    });
    const latin = probeHyphenation({
        lang: 'la',
        word: latinProbeWord,
    });
    return {
        finnishAutoHeight: finnish.autoHeight,
        finnishBaselineHeight: finnish.baselineHeight,
        latinAutoHeight: latin.autoHeight,
        latinBaselineHeight: latin.baselineHeight,
        finnishHyphenates: finnish.hyphenates,
        latinHyphenates: latin.hyphenates,
        detected: dictionaryFromProbes({
            finnishHyphenates: finnish.hyphenates,
            latinHyphenates: latin.hyphenates,
        }),
    };
}

/**
 * The marker fonts found plus the OS family they identify.
 *
 * @category Internal
 */
export type FontPlatformResult = Readonly<{
    /** Every probed marker font the browser was able to render, for display and debugging. */
    installedFonts: ReadonlyArray<string>;
    detected: FontPlatform | undefined;
}>;

/**
 * Marker fonts each platform ships and the others do not. Probing families exclusive to one
 * platform (rather than hashing a full font list) keeps the signal stable across OS versions, since
 * a single missing family only weakens its platform's score instead of changing the result
 * outright.
 */
const platformMarkerFonts: Record<FontPlatform, ReadonlyArray<string>> = {
    [FontPlatform.Apple]: [
        'Apple Chancery',
        'Geneva',
        'Helvetica Neue',
        'Lucida Grande',
    ],
    [FontPlatform.Windows]: [
        'Calibri',
        'Cambria',
        'Segoe UI',
        'Franklin Gothic Medium',
    ],
    [FontPlatform.Linux]: [
        'DejaVu Sans',
        'Liberation Sans',
        'Nimbus Sans',
        'Ubuntu',
    ],
    [FontPlatform.Android]: [
        'Droid Sans Mono',
        'Roboto Condensed',
    ],
};

/**
 * Wide, mixed-width text so a substituted font almost certainly renders at a different width than
 * the fallback. The large size amplifies per-glyph differences beyond subpixel rounding.
 */
const fontProbeText = 'mmmmmmmmmmlli';
const fontProbeSizePx = 72;

/** Generic families the browser always resolves, used as the "font not found" baselines. */
const fontBaselineFamilies: ReadonlyArray<string> = [
    'monospace',
    'sans-serif',
    'serif',
];

/** Renders {@link fontProbeText} in `fontFamily` and returns its rendered width in pixels. */
function measureTextWidth(fontFamily: string): number {
    const element = document.createElement('span');
    element.textContent = fontProbeText;
    element.style.cssText = [
        'position:absolute',
        'left:-9999px',
        'top:0',
        'white-space:nowrap',
        `font:${fontProbeSizePx}px ${fontFamily}`,
    ].join(';');
    document.body.append(element);
    const width = element.getBoundingClientRect().width;
    element.remove();
    return width;
}

/**
 * Picks the platform whose marker fonts are present. A tie means the evidence points at more than
 * one platform at once, so no claim is made rather than guessing at the wrong one.
 *
 * @category Internal
 */
export function platformFromInstalledFonts(
    installedFonts: ReadonlyArray<string>,
): FontPlatform | undefined {
    const ranked = getObjectTypedKeys(platformMarkerFonts)
        .map((platform) => {
            return {
                platform,
                count: platformMarkerFonts[platform].filter((font) => installedFonts.includes(font))
                    .length,
            };
        })
        .toSorted((first, second) => second.count - first.count);
    const best = ranked[0];

    if (!best || best.count === 0 || ranked[1]?.count === best.count) {
        return undefined;
    }
    return best.platform;
}

/**
 * Probes each marker font by rendering the probe text in it with a generic family as the fallback.
 * A width that differs from the bare fallback's means the browser found the requested family, since
 * otherwise it would have rendered the fallback and produced an identical width.
 *
 * @category Internal
 */
export function detectFontPlatform(): FontPlatformResult {
    const baselineWidths = fontBaselineFamilies.map((family) => measureTextWidth(family));
    const installedFonts = getObjectTypedValues(platformMarkerFonts)
        .flat()
        .filter((font) => {
            return fontBaselineFamilies.some((family, index) => {
                return measureTextWidth(`"${font}",${family}`) !== baselineWidths[index];
            });
        });

    return {
        installedFonts,
        detected: platformFromInstalledFonts(installedFonts),
    };
}

/**
 * Raw `Math.tanh` measurements plus the libm implementation they identify.
 *
 * @category Internal
 */
export type MathLibmResult = Readonly<{
    /** `Math.tanh(0.5)`, identical across every known libm; a sanity anchor, not a discriminator. */
    anchorTanh: number;
    /** `Math.tanh` at the discriminating inputs 0.7, 0.8, and 0.9. */
    probeTanh: ReadonlyArray<number>;
    detected: LibmSignature | undefined;
}>;

const tanhAnchorInput = 0.5;
/**
 * The value every known libm returns for `Math.tanh(0.5)`, used to confirm the probe ran at all.
 *
 * @category Internal
 */
export const tanhAnchorValue = 0.46211715726000974;
const tanhProbeInputs: ReadonlyArray<number> = [
    0.7,
    0.8,
    0.9,
];

/** Exact `Math.tanh(0.7)`, `Math.tanh(0.8)`, `Math.tanh(0.9)` outputs per libm implementation. */
const libmTanhSignatures: Record<LibmSignature, ReadonlyArray<number>> = {
    [LibmSignature.Glibc]: [
        0.6043677771171636,
        0.6640367702678491,
        0.7162978701990245,
    ],
    [LibmSignature.AppleLibm]: [
        0.6043677771171635,
        0.664036770267849,
        0.7162978701990245,
    ],
    [LibmSignature.Ucrt]: [
        0.6043677771171635,
        0.6640367702678489,
        0.7162978701990244,
    ],
};

function libmFromTanh(measured: ReadonlyArray<number>): LibmSignature | undefined {
    return getObjectTypedKeys(libmTanhSignatures).find((signature) => {
        return libmTanhSignatures[signature].every((value, index) => value === measured[index]);
    });
}

/**
 * Measures `Math.tanh` at inputs where libm implementations disagree, which identifies the OS's
 * math library.
 *
 * @category Internal
 */
export function detectMathLibm(): MathLibmResult {
    const probeTanh = tanhProbeInputs.map((input) => Math.tanh(input));
    return {
        anchorTanh: Math.tanh(tanhAnchorInput),
        probeTanh,
        detected: libmFromTanh(probeTanh),
    };
}

/**
 * The rendered audio sum plus how many samples went into it.
 *
 * @category Internal
 */
export type AudioFingerprintResult = Readonly<{
    /** Sum of absolute rendered sample values. Deterministic per engine + platform. */
    sum: number;
    sampleCount: number;
}>;

const audioSampleCount = 5000;
const audioSampleRate = 44_100;

/**
 * Browsers that alter the audio render so its sum cannot be used as a stable signal. Safari
 * re-seeds per-session noise; Brave farbles the samples with a per-session, per-site seed. Both
 * differ per session and per machine, so no single sum can serve as a reference.
 */
const audioRandomizingBrowsers: ReadonlyArray<string> = [
    'Safari',
    braveBrowserName,
];

/**
 * Whether the browser randomizes its audio fingerprint. Safari re-seeds its noise every session and
 * Brave farbles the samples per session and site, so the same machine produces a different sum on
 * each session and the audio signal must be ignored.
 *
 * @category Internal
 */
export function browserRandomizesAudio(browserName: string | undefined): boolean {
    return browserName != undefined && audioRandomizingBrowsers.includes(browserName);
}

/**
 * Renders a triangle oscillator through a dynamics compressor offline and sums the output. The
 * result is bit-stable within a browser build; Firefox is far from Chromium/WebKit, which sit close
 * together, so it separates engine families more than individual browsers.
 *
 * @category Internal
 */
export async function computeAudioFingerprint(): Promise<AudioFingerprintResult | undefined> {
    /** Some engines (e.g. Playwright's WebKit on Windows) expose no Web Audio API at all. */
    if (!check.isFunction(globalThis.OfflineAudioContext)) {
        return undefined;
    }
    const context = new OfflineAudioContext(1, audioSampleCount, audioSampleRate);
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 1000;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -50;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.2;
    oscillator.connect(compressor);
    compressor.connect(context.destination);
    oscillator.start();
    const buffer = await context.startRendering();
    const samples = buffer.getChannelData(0);
    return {
        sum: samples.reduce((total, sample) => total + Math.abs(sample), 0),
        sampleCount: samples.length,
    };
}

/** Chromium's UA client-hints accessor; absent on Safari and Firefox and from the DOM lib types. */
type NavigatorUserAgentData = Readonly<{
    getHighEntropyValues: (
        hints: ReadonlyArray<string>,
    ) => Promise<Readonly<{architecture?: string | undefined}>>;
}>;

function getNavigatorUserAgentData(): NavigatorUserAgentData | undefined {
    const candidate: unknown = Reflect.get(navigator, 'userAgentData');
    if (!check.isObject(candidate)) {
        return undefined;
    }
    return check.isFunction(Reflect.get(candidate, 'getHighEntropyValues'))
        ? (candidate satisfies object as NavigatorUserAgentData)
        : undefined;
}

/** ARM CPU markers Firefox reports in its user agent on Windows and Linux. */
const armUserAgentTokens: ReadonlyArray<string> = [
    'aarch64',
    'arm64',
];
/** X86 CPU markers Firefox reports in its user agent on Windows and Linux. */
const x86UserAgentTokens: ReadonlyArray<string> = [
    'x86_64',
    'x64',
    'win64',
    'wow64',
    'amd64',
    'i686',
    'i386',
];

/**
 * Parses the CPU architecture out of a user agent string. Firefox reports the real platform on
 * Windows and Linux; macOS Firefox and Safari freeze the platform to a fake "Intel" token that
 * matches none of these markers, so they return undefined rather than a wrong guess.
 *
 * @category Internal
 */
export function archFromUserAgent(userAgent: string): CpuArchitecture | undefined {
    const normalized = userAgent.toLowerCase();
    if (armUserAgentTokens.some((token) => normalized.includes(token))) {
        return CpuArchitecture.Arm;
    } else if (x86UserAgentTokens.some((token) => normalized.includes(token))) {
        return CpuArchitecture.X86;
    } else {
        return undefined;
    }
}

/**
 * The audio fingerprint varies with CPU architecture (vector-math rounding differs on ARM vs x86),
 * so an audio sum is only meaningful alongside the architecture it was produced on. Chromium
 * exposes the architecture via UA client hints; Firefox has none but reports it in its user agent
 * (except on macOS, which it freezes); Safari exposes neither, so it returns undefined and the
 * report then matches audio across every architecture.
 *
 * @category Internal
 */
export async function detectCpuArch(): Promise<CpuArchitecture | undefined> {
    const userAgentData = getNavigatorUserAgentData();
    if (userAgentData) {
        const highEntropyValues = await userAgentData.getHighEntropyValues(['architecture']);
        const clientHintArch = checkWrap.isEnumValue(
            highEntropyValues.architecture,
            CpuArchitecture,
        );
        if (clientHintArch != undefined) {
            return clientHintArch;
        }
    }

    if (Bowser.parse(navigator.userAgent).browser.name === 'Firefox') {
        return archFromUserAgent(navigator.userAgent);
    }

    return undefined;
}
