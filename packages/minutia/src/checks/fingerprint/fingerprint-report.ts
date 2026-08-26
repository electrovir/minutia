import {check} from '@augment-vir/assert';
import {filterMap} from '@augment-vir/common';
import {
    buildAssessmentGroup,
    Verdict,
    worstVerdict,
    type AssessmentGroup,
    type AssessmentResult,
} from '../assessment.js';
import {
    audioSumsForArch,
    osFingerprintReference,
    summarizeObservations,
    type FingerprintReferenceEntry,
} from './os-fingerprint-reference.js';
import {
    browserRandomizesAudio,
    computeAudioFingerprint,
    detectCpuArch,
    detectFontPlatform,
    detectHyphenationDictionary,
    detectMathLibm,
    getBrowserGroundTruth,
    OsFingerprintType,
    type BrowserGroundTruth,
    type CpuArchitecture,
    type FontPlatform,
    type HyphenationDictionary,
    type LibmSignature,
} from './os-fingerprints.js';

/**
 * User-facing text for each {@link OsFingerprintType}.
 *
 * @category Internal
 */
export const fingerprintCheckLabels: Record<OsFingerprintType, string> = {
    [OsFingerprintType.Hyphenation]: 'hyphenation dictionary',
    [OsFingerprintType.Fonts]: 'font platform',
    [OsFingerprintType.MathLibm]: 'math libm signature',
    [OsFingerprintType.Audio]: 'audio fingerprint',
};

/**
 * One fingerprint's live value set against everything the claimed browser + OS is known to produce.
 *
 * @category Internal
 */
export type FingerprintComparison = Readonly<{
    type: OsFingerprintType;
    label: string;
    /** The live measured value, as a display string. */
    detected: string;
    /** Every value the claimed browser + OS is known to produce, as display strings. */
    expected: ReadonlyArray<string>;
    /** The browser randomizes this signal (Safari and Brave audio), so there is no value to expect. */
    randomized: boolean;
    verdict: Verdict;
}>;

/**
 * Every fingerprint assessment plus the measurements and reference row behind it.
 *
 * @category Internal
 */
export type FingerprintReport = AssessmentGroup<OsFingerprintType> &
    Readonly<{
        groundTruth: BrowserGroundTruth;
        /** The live CPU architecture, when the engine exposes it (Chromium only). */
        detectedCpuArch: CpuArchitecture | undefined;
        /** The marker fonts actually found, so a `none` font platform can be explained. */
        installedFonts: ReadonlyArray<string>;
        /** The reference row for the browser + OS the user agent claims, if it has been captured. */
        claimedReference: FingerprintReferenceEntry | undefined;
        comparisons: ReadonlyArray<FingerprintComparison>;
        /** When something mismatches, the browser + OS the measured fingerprints most resemble. */
        actualGuess: string | undefined;
    }>;

/**
 * Audio sums are bit-stable within a browser build on a given CPU architecture. A live sum is only
 * ever compared against same-architecture references, so this window just needs to absorb
 * stored-precision rounding (sums are stored to four decimals) and minor cross-version jitter while
 * still separating engine families (Firefox ~766 vs Chromium/WebKit ~956).
 */
const audioMatchTolerance = 0.0001;

/**
 * Weights for the actual-combo guess. Audio, hyphenation, and fonts pin down the OS far more
 * strongly than the libm signature, which glibc alone shares between Linux and every Firefox.
 */
const guessWeights = {
    hyphenation: 2,
    audio: 2,
    /** Fonts are the only signal that separates Windows, Linux, and Android from each other. */
    fonts: 2,
    libm: 1,
};

/**
 * Classifies a live value against every value the claimed browser + OS is known to produce, across
 * all captured versions (the exact version need not be in the reference):
 *
 * - Matches a value the claimed browser + OS produces → pass.
 * - Detected, but not a value the claimed browser + OS produces → the user agent is lying.
 * - No live value, yet the claimed browser + OS does produce one → also a lie.
 * - No reference captured for the claimed browser + OS → nothing to compare.
 *
 * @category Internal
 */
export function classifyFingerprint<Value>({
    live,
    claimedValues,
    isMatch,
}: Readonly<{
    live: Value | undefined;
    claimedValues: ReadonlyArray<Value>;
    isMatch: (candidate: Value) => boolean;
}>): Verdict {
    if (claimedValues.length === 0) {
        return Verdict.Unknown;
    } else if (live != undefined && claimedValues.some(isMatch)) {
        return Verdict.Pass;
    } else {
        return Verdict.Fail;
    }
}

/**
 * The live fingerprint measurements, before they are compared against any reference.
 *
 * @category Internal
 */
export type DetectedFingerprints = Readonly<{
    hyphenation: HyphenationDictionary | undefined;
    libm: LibmSignature | undefined;
    audio: number | undefined;
    fonts: FontPlatform | undefined;
}>;

function audioMatches({candidate, live}: Readonly<{candidate: number; live: number}>): boolean {
    return Math.abs(candidate - live) <= audioMatchTolerance;
}

/**
 * Scores how well one reference entry matches the measured fingerprints. Unlike the claimed-browser
 * verdict, the audio sum is compared against every captured architecture's sum rather than only the
 * detected one: this guess is computed precisely because the user agent is already lying, and a
 * user agent that fakes its platform string can just as trivially fake its `architecture` client
 * hint, whereas the audio sum comes from the real render pipeline and is far harder to forge.
 * Scoping by the arch here would let a spoofed hint discard the strongest honest signal (e.g. an
 * x86 Chromium audio sum reported alongside a faked `arm` hint, which with glibc uniquely
 * identifies Linux Chrome).
 */
function scoreEntryAgainstDetected({
    entry,
    detected,
}: Readonly<{entry: FingerprintReferenceEntry; detected: DetectedFingerprints}>): number {
    const summary = summarizeObservations(entry.observations);
    const liveAudio = detected.audio;
    const weightedMatches: ReadonlyArray<number> = [
        detected.hyphenation != undefined &&
        summary.hyphenationDictionaries.includes(detected.hyphenation)
            ? guessWeights.hyphenation
            : 0,
        detected.libm != undefined && summary.libmSignatures.includes(detected.libm)
            ? guessWeights.libm
            : 0,
        detected.fonts != undefined && summary.fontPlatforms.includes(detected.fonts)
            ? guessWeights.fonts
            : 0,
        liveAudio != undefined &&
        summary.audioSums.some((sum) => {
            return audioMatches({
                candidate: sum,
                live: liveAudio,
            });
        })
            ? guessWeights.audio
            : 0,
    ];
    return weightedMatches.reduce((total, weight) => total + weight, 0);
}

/**
 * Finds the browser + OS (other than the one claimed) whose known fingerprints best match what was
 * actually measured, so a spoofed user agent can be told what it really looks like.
 *
 * @category Internal
 */
export function guessActualCombo({
    detected,
    claimedOsName,
    claimedBrowserName,
}: Readonly<{
    detected: DetectedFingerprints;
    claimedOsName: string | undefined;
    claimedBrowserName: string | undefined;
}>): string | undefined {
    const scored = filterMap(
        osFingerprintReference,
        (entry) => {
            const isClaimed = entry.os === claimedOsName && entry.browser === claimedBrowserName;
            const score = isClaimed
                ? 0
                : scoreEntryAgainstDetected({
                      entry,
                      detected,
                  });
            return score > 0
                ? {
                      entry,
                      score,
                  }
                : undefined;
        },
        check.isDefined,
    );
    const best = scored.toSorted((first, second) => second.score - first.score)[0];
    return best ? `${best.entry.os} ${best.entry.browser}` : undefined;
}

/** Turns a comparison into the note a user reads, without restating the label. */
function comparisonNote(comparison: FingerprintComparison): string {
    if (comparison.randomized) {
        return 'This browser randomizes this signal every session, so there is nothing stable to compare.';
    } else if (comparison.expected.length === 0) {
        return 'No reference has been captured for the claimed browser and OS yet.';
    } else if (comparison.verdict === Verdict.Pass) {
        return `Measured ${comparison.detected}, which the claimed browser and OS is known to produce.`;
    } else {
        return `Measured ${comparison.detected}, but the claimed browser and OS produces ${comparison.expected.join(' or ')}.`;
    }
}

function comparisonToAssessmentResult(comparison: FingerprintComparison): AssessmentResult {
    return {
        verdict: comparison.verdict,
        note: comparisonNote(comparison),
        debug: `detected = ${comparison.detected}, expected = ${comparison.expected.join(', ') || 'none'}`,
    };
}

/**
 * An inconclusive fingerprint means the browser randomizes that signal or no reference has been
 * captured for it yet. Neither is evidence against the user agent, so unlike the default worst-of
 * reduction they must not hold the whole group below a pass: only a real mismatch accuses.
 *
 * @category Internal
 */
export function aggregateFingerprintVerdict(verdicts: ReadonlyArray<Verdict>): Verdict {
    return worstVerdict(verdicts.filter((verdict) => verdict !== Verdict.Unknown));
}

/**
 * Measures every OS fingerprint and compares each against what the user agent's claimed browser +
 * OS is known to produce. A mismatch means the user agent is lying about the platform it runs on.
 *
 * @category Internal
 */
export async function runFingerprintChecks(): Promise<FingerprintReport> {
    const groundTruth = await getBrowserGroundTruth();
    const claimedReference = osFingerprintReference.find(
        (entry) => entry.os === groundTruth.osName && entry.browser === groundTruth.browserName,
    );
    const claimedSummary = summarizeObservations(claimedReference?.observations ?? []);

    const detectedCpuArch = await detectCpuArch();
    const hyphenation = detectHyphenationDictionary();
    const mathLibm = detectMathLibm();
    const fonts = detectFontPlatform();
    const audio = await computeAudioFingerprint();
    /** Safari and Brave both alter the audio render each session, so the sum is not comparable. */
    const audioRandomized = browserRandomizesAudio(groundTruth.browserName);

    /** Audio depends on CPU architecture, so it is only compared against same-architecture sums. */
    const claimedAudioSums = audioSumsForArch({
        observations: claimedReference?.observations ?? [],
        cpuArch: detectedCpuArch,
    });

    const comparisonsByType: Record<OsFingerprintType, FingerprintComparison> = {
        [OsFingerprintType.Hyphenation]: {
            type: OsFingerprintType.Hyphenation,
            label: fingerprintCheckLabels[OsFingerprintType.Hyphenation],
            detected: hyphenation.detected ?? 'none',
            expected: claimedSummary.hyphenationDictionaries,
            randomized: false,
            verdict: classifyFingerprint({
                live: hyphenation.detected,
                claimedValues: claimedSummary.hyphenationDictionaries,
                isMatch: (candidate) => candidate === hyphenation.detected,
            }),
        },
        [OsFingerprintType.Fonts]: {
            type: OsFingerprintType.Fonts,
            label: fingerprintCheckLabels[OsFingerprintType.Fonts],
            detected: fonts.detected ?? 'none',
            expected: claimedSummary.fontPlatforms,
            randomized: false,
            verdict: classifyFingerprint({
                live: fonts.detected,
                claimedValues: claimedSummary.fontPlatforms,
                isMatch: (candidate) => candidate === fonts.detected,
            }),
        },
        [OsFingerprintType.MathLibm]: {
            type: OsFingerprintType.MathLibm,
            label: fingerprintCheckLabels[OsFingerprintType.MathLibm],
            detected: mathLibm.detected ?? 'none',
            expected: claimedSummary.libmSignatures,
            randomized: false,
            verdict: classifyFingerprint({
                live: mathLibm.detected,
                claimedValues: claimedSummary.libmSignatures,
                isMatch: (candidate) => candidate === mathLibm.detected,
            }),
        },
        [OsFingerprintType.Audio]: {
            type: OsFingerprintType.Audio,
            label: fingerprintCheckLabels[OsFingerprintType.Audio],
            detected: audio == undefined ? 'none' : audio.sum.toFixed(4),
            expected: claimedAudioSums.map((sum) => sum.toFixed(4)),
            randomized: audioRandomized,
            /** Randomized audio has nothing stable to reference, so it is never comparable. */
            verdict: audioRandomized
                ? Verdict.Unknown
                : classifyFingerprint({
                      live: audio?.sum,
                      claimedValues: claimedAudioSums,
                      isMatch: (candidate) => {
                          return (
                              audio != undefined &&
                              audioMatches({
                                  candidate,
                                  live: audio.sum,
                              })
                          );
                      },
                  }),
        },
    };

    const group = buildAssessmentGroup({
        results: {
            [OsFingerprintType.Hyphenation]: comparisonToAssessmentResult(
                comparisonsByType[OsFingerprintType.Hyphenation],
            ),
            [OsFingerprintType.Fonts]: comparisonToAssessmentResult(
                comparisonsByType[OsFingerprintType.Fonts],
            ),
            [OsFingerprintType.MathLibm]: comparisonToAssessmentResult(
                comparisonsByType[OsFingerprintType.MathLibm],
            ),
            [OsFingerprintType.Audio]: comparisonToAssessmentResult(
                comparisonsByType[OsFingerprintType.Audio],
            ),
        },
        labels: fingerprintCheckLabels,
        aggregate: aggregateFingerprintVerdict,
    });

    const comparisons = Object.values(comparisonsByType);
    const actualGuess = comparisons.some((comparison) => comparison.verdict === Verdict.Fail)
        ? guessActualCombo({
              detected: {
                  hyphenation: hyphenation.detected,
                  libm: mathLibm.detected,
                  audio: audioRandomized ? undefined : audio?.sum,
                  fonts: fonts.detected,
              },
              claimedOsName: groundTruth.osName,
              claimedBrowserName: groundTruth.browserName,
          })
        : undefined;

    return {
        ...group,
        groundTruth,
        detectedCpuArch,
        installedFonts: fonts.installedFonts,
        claimedReference,
        comparisons,
        actualGuess,
    };
}

/**
 * Renders the report as plain text for the clipboard, so a fingerprint captured on another machine
 * (for example a coworker's browser) can be pasted back and added to the reference.
 *
 * @category Internal
 */
export function formatFingerprintReport(report: FingerprintReport): string {
    const fingerprintLines = report.comparisons
        .toSorted((first, second) => first.label.localeCompare(second.label))
        .map((comparison) => {
            const detected = comparison.randomized ? 'randomized' : comparison.detected;
            const expected = comparison.randomized
                ? 'random'
                : comparison.expected.join(', ') || 'no reference';
            return `- ${comparison.label}: ${detected} (expected: ${expected}) → ${comparison.verdict}`;
        });
    const guessLines = report.actualGuess
        ? [
              '',
              `These fingerprints actually look like: ${report.actualGuess}`,
          ]
        : [];

    return [
        'OS Fingerprint Report',
        '',
        `User agent: ${report.groundTruth.userAgent}`,
        `OS: ${report.groundTruth.osName || 'unknown'}`,
        `Browser: ${report.groundTruth.browserName || 'unknown'}`,
        `Version: ${report.groundTruth.browserVersion || 'unknown'}`,
        `CPU architecture: ${report.detectedCpuArch || 'unknown'}`,
        `Installed marker fonts: ${report.installedFonts.join(', ') || 'none'}`,
        '',
        'Fingerprints:',
        ...fingerprintLines,
        ...guessLines,
    ].join('\n');
}
