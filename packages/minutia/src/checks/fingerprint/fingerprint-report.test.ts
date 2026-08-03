import {assert, assertWrap} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {Verdict} from '../assessment.js';
import {
    classifyFingerprint,
    formatFingerprintReport,
    guessActualCombo,
    runFingerprintChecks,
} from './fingerprint-report.js';
import {
    browserRandomizesAudio,
    FontPlatform,
    HyphenationDictionary,
    LibmSignature,
    OsFingerprintType,
} from './os-fingerprints.js';

describe('runFingerprintChecks', () => {
    /**
     * Emits every measurement for the current OS + browser to the console. Reading the "Browser
     * logs" section of the CI matrix (macOS/Ubuntu/Windows × chromium/webkit/firefox) yields the
     * full cross-platform table to fill the reference with.
     */
    it('logs raw fingerprint data for the current os and browser', async () => {
        const report = await runFingerprintChecks();
        // eslint-disable-next-line no-console
        console.log('OS_FINGERPRINT_DATA ' + JSON.stringify(report));
        assert.isNotEmpty(report.groundTruth.userAgent);
    });

    it('reports every fingerprint exactly once', async () => {
        const report = await runFingerprintChecks();

        assert.isLengthExactly(report.assessments, Object.values(OsFingerprintType).length);
        assert.deepEquals(
            report.assessments.map((check) => check.id).toSorted(),
            Object.values(OsFingerprintType).toSorted(),
        );
    });

    it('never flags a real, unaltered browser as a mismatch', async () => {
        const report = await runFingerprintChecks();

        /**
         * Playwright's WebKit build reports a macOS Safari user agent on every host OS, so on the
         * Linux and Windows CI runners it is a genuinely spoofed environment (a non-Apple machine
         * claiming to be macOS Safari) that the checks are correct to flag. Real Safari only runs
         * on Apple platforms, where this engine reports a pass.
         */
        if (report.groundTruth.browserName === 'Safari') {
            return;
        }

        report.assessments.forEach((check) => {
            assert.notStrictEquals(check.verdict, Verdict.Fail);
        });
        assert.isUndefined(report.actualGuess);
    });

    it('marks a randomized audio signal as unknown, never a mismatch', async () => {
        const report = await runFingerprintChecks();
        const audio = assertWrap.isDefined(
            report.comparisons.find((comparison) => comparison.type === OsFingerprintType.Audio),
        );

        assert.strictEquals(
            audio.randomized,
            browserRandomizesAudio(report.groundTruth.browserName),
        );
        if (audio.randomized) {
            /** Randomized audio has nothing to compare against, so it can never be conclusive. */
            assert.strictEquals(audio.verdict, Verdict.Unknown);
        }
        assert.notStrictEquals(audio.verdict, Verdict.Fail);
    });
});

describe('classifyFingerprint', () => {
    it('passes a value the claimed browser + os is known to produce', () => {
        assert.strictEquals(
            classifyFingerprint({
                live: HyphenationDictionary.Apple,
                claimedValues: [HyphenationDictionary.Apple],
                isMatch: (candidate) => candidate === HyphenationDictionary.Apple,
            }),
            Verdict.Pass,
        );
    });

    it('fails a value the claimed browser + os never produces', () => {
        assert.strictEquals(
            classifyFingerprint({
                live: HyphenationDictionary.Minikin,
                claimedValues: [HyphenationDictionary.Apple],
                isMatch: (candidate) => candidate === HyphenationDictionary.Minikin,
            }),
            Verdict.Fail,
        );
    });

    it('fails when nothing was measured but the claimed browser + os does produce a value', () => {
        assert.strictEquals(
            classifyFingerprint({
                live: undefined,
                claimedValues: [HyphenationDictionary.Apple],
                isMatch: () => false,
            }),
            Verdict.Fail,
        );
    });

    it('stays unknown when no reference has been captured', () => {
        assert.strictEquals(
            classifyFingerprint({
                live: HyphenationDictionary.Apple,
                claimedValues: [],
                isMatch: (candidate) => candidate === HyphenationDictionary.Apple,
            }),
            Verdict.Unknown,
        );
    });
});

describe('guessActualCombo', () => {
    it('guesses the real browser + os behind a spoofed user agent', () => {
        assert.strictEquals(
            guessActualCombo({
                detected: {
                    hyphenation: HyphenationDictionary.Minikin,
                    libm: LibmSignature.Glibc,
                    audio: 956.3164,
                    fonts: undefined,
                },
                claimedOsName: 'macOS',
                claimedBrowserName: 'Chrome',
            }),
            'Linux Chrome',
        );
    });

    it('trusts the hard-to-fake audio sum over an architecture hint', () => {
        /**
         * A headless x86 Chrome claiming to be an Intel Mac reports a faked `arm` architecture hint
         * alongside the x86 Chromium audio sum and no hyphenation dictionary. The guess must follow
         * the audio sum, which with glibc is unique to Linux Chrome.
         */
        assert.strictEquals(
            guessActualCombo({
                detected: {
                    hyphenation: undefined,
                    libm: LibmSignature.Glibc,
                    audio: 956.3164,
                    fonts: undefined,
                },
                claimedOsName: 'macOS',
                claimedBrowserName: 'Chrome',
            }),
            'Linux Chrome',
        );
    });

    it('names the real platform when only the font set gives it away', () => {
        /**
         * Hyphenation cannot tell the three Minikin platforms apart and this audio sum is shared by
         * Windows, Linux, and Intel macOS Chromium, so the Apple font set is the only signal that
         * pins the machine to macOS.
         */
        assert.strictEquals(
            guessActualCombo({
                detected: {
                    hyphenation: HyphenationDictionary.Apple,
                    libm: LibmSignature.AppleLibm,
                    audio: 956.3164,
                    fonts: FontPlatform.Apple,
                },
                claimedOsName: 'Windows',
                claimedBrowserName: 'Chrome',
            }),
            'macOS Chrome',
        );
    });
});

describe('formatFingerprintReport', () => {
    it('formats a copyable plain-text report of everything measured', () => {
        const text = formatFingerprintReport({
            verdict: Verdict.Unknown,
            assessments: [],
            groundTruth: {
                userAgent: 'test-ua',
                osName: 'macOS',
                browserName: 'Safari',
                browserVersion: '26.5.2',
            },
            detectedCpuArch: undefined,
            installedFonts: [
                'Geneva',
                'Helvetica Neue',
            ],
            claimedReference: undefined,
            comparisons: [
                {
                    type: OsFingerprintType.Audio,
                    label: 'audio fingerprint',
                    detected: '956.1319',
                    expected: [],
                    randomized: true,
                    verdict: Verdict.Unknown,
                },
                {
                    type: OsFingerprintType.Hyphenation,
                    label: 'hyphenation dictionary',
                    detected: 'apple',
                    expected: ['apple'],
                    randomized: false,
                    verdict: Verdict.Pass,
                },
            ],
            actualGuess: undefined,
        });

        assert.strictEquals(
            text,
            [
                'OS Fingerprint Report',
                '',
                'User agent: test-ua',
                'OS: macOS',
                'Browser: Safari',
                'Version: 26.5.2',
                'CPU architecture: unknown',
                'Installed marker fonts: Geneva, Helvetica Neue',
                '',
                'Fingerprints:',
                '- audio fingerprint: randomized (expected: random) → unknown',
                '- hyphenation dictionary: apple (expected: apple) → pass',
            ].join('\n'),
        );
    });
});
