// cspell:words ucrt farble farbles

import {check} from '@augment-vir/assert';
import {filterMap} from '@augment-vir/common';
import {
    braveBrowserName,
    CpuArchitecture,
    FontPlatform,
    HyphenationDictionary,
    LibmSignature,
} from './os-fingerprints.js';

/**
 * One captured fingerprint from a specific browser build.
 *
 * @category Internal
 */
export type FingerprintObservation = Readonly<{
    /** Browser major version this was captured on (e.g. '149'); documentation only. */
    majorVersion: string;
    /** The CPU architecture this was captured on. Only the audio sum depends on it. */
    cpuArch: CpuArchitecture | undefined;
    hyphenationDictionary: HyphenationDictionary | undefined;
    libmSignature: LibmSignature | undefined;
    audioSum: number | undefined;
    /** Left unset on rows whose font set has not actually been measured yet. */
    fontPlatform: FontPlatform | undefined;
}>;

/**
 * A reference of the fingerprints each OS + browser is known to produce, stored as one observation
 * per captured browser build. A live value is compared against every value the OS + browser is
 * known to produce across all captured versions, so the exact version need not be present. Fill
 * placeholder combos in from the `OS_FINGERPRINT_DATA` lines the tests print in the GitHub Actions
 * logs by adding an observation.
 *
 * @category Internal
 */
export type FingerprintReferenceEntry = Readonly<{
    /** Bowser `os.name`. */
    os: string;
    /** Bowser `browser.name`. */
    browser: string;
    observations: ReadonlyArray<FingerprintObservation>;
}>;

/**
 * Every browser + OS combination whose fingerprints have been captured, one entry each.
 *
 * @category Internal
 */
export const osFingerprintReference: ReadonlyArray<FingerprintReferenceEntry> = [
    {
        os: 'macOS',
        browser: 'Chrome',
        observations: [
            {
                majorVersion: '140',
                cpuArch: CpuArchitecture.Arm,
                hyphenationDictionary: HyphenationDictionary.Apple,
                libmSignature: LibmSignature.Glibc,
                audioSum: 956.316634,
                fontPlatform: FontPlatform.Apple,
            },
            {
                majorVersion: '149',
                cpuArch: CpuArchitecture.Arm,
                hyphenationDictionary: HyphenationDictionary.Apple,
                libmSignature: LibmSignature.AppleLibm,
                audioSum: 956.3166342371878,
                fontPlatform: FontPlatform.Apple,
            },
            {
                /** Intel Macs share the x86 Chromium audio sum (956.3164) with Windows and Linux. */
                majorVersion: '149',
                cpuArch: CpuArchitecture.X86,
                hyphenationDictionary: HyphenationDictionary.Apple,
                libmSignature: LibmSignature.AppleLibm,
                audioSum: 956.3164,
                fontPlatform: FontPlatform.Apple,
            },
        ],
    },
    {
        os: 'macOS',
        browser: 'Safari',
        observations: [
            {
                /**
                 * Safari re-seeds its audio noise every session, so its audio sum is randomized and
                 * left unset; hyphenation and libm remain stable, usable signals.
                 */
                majorVersion: '26',
                cpuArch: CpuArchitecture.Arm,
                hyphenationDictionary: HyphenationDictionary.Apple,
                libmSignature: LibmSignature.AppleLibm,
                audioSum: undefined,
                fontPlatform: FontPlatform.Apple,
            },
            {
                /** Intel Mac Safari randomizes its audio too, so the sum is left unset. */
                majorVersion: '18',
                cpuArch: CpuArchitecture.X86,
                hyphenationDictionary: HyphenationDictionary.Apple,
                libmSignature: LibmSignature.AppleLibm,
                audioSum: undefined,
                fontPlatform: FontPlatform.Apple,
            },
        ],
    },
    {
        os: 'macOS',
        browser: 'Firefox',
        observations: [
            {
                majorVersion: '148',
                cpuArch: CpuArchitecture.Arm,
                hyphenationDictionary: HyphenationDictionary.Bundled,
                libmSignature: LibmSignature.Glibc,
                audioSum: 766.597307,
                fontPlatform: FontPlatform.Apple,
            },
            {
                majorVersion: '151',
                cpuArch: CpuArchitecture.Arm,
                hyphenationDictionary: HyphenationDictionary.Bundled,
                libmSignature: LibmSignature.Glibc,
                audioSum: 766.5973066808656,
                fontPlatform: FontPlatform.Apple,
            },
            {
                /** Intel Mac Firefox; its audio sum barely differs from Apple Silicon Firefox. */
                majorVersion: '152',
                cpuArch: CpuArchitecture.X86,
                hyphenationDictionary: HyphenationDictionary.Bundled,
                libmSignature: LibmSignature.Glibc,
                audioSum: 766.5973,
                fontPlatform: FontPlatform.Apple,
            },
        ],
    },
    {
        os: 'macOS',
        browser: 'Opera',
        observations: [
            {
                /** Opera is Chromium and does not farble, so it shares the x86 Chromium audio sum. */
                majorVersion: '132',
                cpuArch: CpuArchitecture.X86,
                hyphenationDictionary: HyphenationDictionary.Apple,
                libmSignature: LibmSignature.AppleLibm,
                audioSum: 956.3164,
                fontPlatform: FontPlatform.Apple,
            },
        ],
    },
    {
        os: 'macOS',
        browser: braveBrowserName,
        observations: [
            {
                /** Brave farbles the audio render per install, so its sum is left unset. */
                majorVersion: '149',
                cpuArch: CpuArchitecture.X86,
                hyphenationDictionary: HyphenationDictionary.Apple,
                libmSignature: LibmSignature.AppleLibm,
                audioSum: undefined,
                fontPlatform: FontPlatform.Apple,
            },
        ],
    },
    {
        os: 'Windows',
        browser: 'Chrome',
        observations: [
            {
                majorVersion: '149',
                cpuArch: CpuArchitecture.X86,
                hyphenationDictionary: HyphenationDictionary.Minikin,
                libmSignature: LibmSignature.Ucrt,
                audioSum: 956.3164,
                fontPlatform: undefined,
            },
        ],
    },
    {
        os: 'Windows',
        browser: 'Firefox',
        observations: [
            {
                majorVersion: '151',
                cpuArch: CpuArchitecture.X86,
                hyphenationDictionary: HyphenationDictionary.Bundled,
                libmSignature: LibmSignature.Glibc,
                audioSum: 766.5973,
                fontPlatform: undefined,
            },
        ],
    },
    {
        os: 'Linux',
        browser: 'Chrome',
        observations: [
            {
                majorVersion: '149',
                cpuArch: CpuArchitecture.X86,
                hyphenationDictionary: HyphenationDictionary.Minikin,
                libmSignature: LibmSignature.Glibc,
                audioSum: 956.3164,
                fontPlatform: undefined,
            },
        ],
    },
    {
        os: 'Linux',
        browser: 'Firefox',
        observations: [
            {
                majorVersion: '151',
                cpuArch: CpuArchitecture.X86,
                hyphenationDictionary: HyphenationDictionary.Bundled,
                libmSignature: LibmSignature.Glibc,
                audioSum: 766.5973,
                fontPlatform: undefined,
            },
            {
                majorVersion: '152',
                cpuArch: CpuArchitecture.X86,
                hyphenationDictionary: HyphenationDictionary.Bundled,
                libmSignature: LibmSignature.Glibc,
                audioSum: 766.5973,
                fontPlatform: undefined,
            },
        ],
    },
    {
        os: 'Android',
        browser: 'Chrome',
        observations: [
            {
                majorVersion: '150',
                cpuArch: CpuArchitecture.Arm,
                hyphenationDictionary: HyphenationDictionary.Minikin,
                libmSignature: LibmSignature.Glibc,
                audioSum: 956.572,
                fontPlatform: undefined,
            },
        ],
    },
    {
        os: 'Windows',
        browser: 'Microsoft Edge',
        observations: [
            {
                /** Edge is Chromium, so it matches Windows Chrome: minikin, ucrt, and the same sum. */
                majorVersion: '150',
                cpuArch: CpuArchitecture.X86,
                hyphenationDictionary: HyphenationDictionary.Minikin,
                libmSignature: LibmSignature.Ucrt,
                audioSum: 956.3164,
                fontPlatform: undefined,
            },
        ],
    },
    {
        os: 'Linux',
        browser: braveBrowserName,
        observations: [
            {
                /**
                 * Brave farbles the audio render with a per-session, per-install seed (observed as
                 * 955.3808, 955.4175, and 955.4578 on three machines), so its sum is left unset;
                 * hyphenation and libm are untouched and stay reliable signals.
                 */
                majorVersion: '149',
                cpuArch: CpuArchitecture.X86,
                hyphenationDictionary: HyphenationDictionary.Minikin,
                libmSignature: LibmSignature.Glibc,
                audioSum: undefined,
                fontPlatform: undefined,
            },
        ],
    },
    {
        os: 'Windows',
        browser: braveBrowserName,
        observations: [
            {
                /** Brave farbles the audio render per install, so its sum is left unset. */
                majorVersion: '149',
                cpuArch: CpuArchitecture.X86,
                hyphenationDictionary: HyphenationDictionary.Minikin,
                libmSignature: LibmSignature.Ucrt,
                audioSum: undefined,
                fontPlatform: undefined,
            },
        ],
    },
    {
        os: 'Android',
        browser: braveBrowserName,
        observations: [
            {
                /** Brave farbles the audio render per install, so its sum is left unset. */
                majorVersion: '150',
                cpuArch: CpuArchitecture.Arm,
                hyphenationDictionary: HyphenationDictionary.Minikin,
                libmSignature: LibmSignature.Glibc,
                audioSum: undefined,
                fontPlatform: undefined,
            },
        ],
    },
];

function unique<Value>(values: ReadonlyArray<Value>): ReadonlyArray<Value> {
    return values.filter((value, index) => values.indexOf(value) === index);
}

/**
 * The distinct value each field takes across a set of observations, for display and matching.
 *
 * @category Internal
 */
export type FingerprintFieldValues = Readonly<{
    cpuArchitectures: ReadonlyArray<CpuArchitecture>;
    hyphenationDictionaries: ReadonlyArray<HyphenationDictionary>;
    libmSignatures: ReadonlyArray<LibmSignature>;
    audioSums: ReadonlyArray<number>;
    fontPlatforms: ReadonlyArray<FontPlatform>;
}>;

/**
 * Collapses many observations of one browser + OS into the distinct values it is known to produce.
 *
 * @category Internal
 */
export function summarizeObservations(
    observations: ReadonlyArray<FingerprintObservation>,
): FingerprintFieldValues {
    return {
        cpuArchitectures: unique(
            filterMap(observations, (observation) => observation.cpuArch, check.isDefined),
        ),
        hyphenationDictionaries: unique(
            filterMap(
                observations,
                (observation) => observation.hyphenationDictionary,
                check.isDefined,
            ),
        ),
        libmSignatures: unique(
            filterMap(observations, (observation) => observation.libmSignature, check.isDefined),
        ),
        audioSums: unique(
            filterMap(observations, (observation) => observation.audioSum, check.isDefined),
        ),
        fontPlatforms: unique(
            filterMap(observations, (observation) => observation.fontPlatform, check.isDefined),
        ),
    };
}

/**
 * The audio sums the observations produced on a given CPU architecture. Audio varies with
 * architecture, so a live audio sum must only be compared against sums captured on the same one.
 * When the architecture is unknown (Safari and Firefox expose none), every captured sum is returned
 * so nothing is falsely flagged.
 *
 * @category Internal
 */
export function audioSumsForArch({
    observations,
    cpuArch,
}: Readonly<{
    observations: ReadonlyArray<FingerprintObservation>;
    cpuArch: CpuArchitecture | undefined;
}>): ReadonlyArray<number> {
    const scopedObservations =
        cpuArch == undefined
            ? observations
            : observations.filter((observation) => observation.cpuArch === cpuArch);
    return unique(
        filterMap(scopedObservations, (observation) => observation.audioSum, check.isDefined),
    );
}
