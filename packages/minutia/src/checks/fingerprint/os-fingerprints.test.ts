// cspell:words tanh libm calibri cambria segoe dejavu roboto

import {assert, checkWrap} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {
    archFromUserAgent,
    browserRandomizesAudio,
    computeAudioFingerprint,
    CpuArchitecture,
    detectBrave,
    detectCpuArch,
    detectFontPlatform,
    detectHyphenationDictionary,
    detectMathLibm,
    FontPlatform,
    platformFromInstalledFonts,
    tanhAnchorValue,
} from './os-fingerprints.js';

describe('os fingerprint detection', () => {
    it('produces a deterministic, well-formed audio fingerprint', async () => {
        const first = await computeAudioFingerprint();
        const second = await computeAudioFingerprint();

        if (first == undefined) {
            /** Some engines (Playwright's WebKit on Windows) expose no OfflineAudioContext. */
            assert.isUndefined(second);
            return;
        }

        assert.isDefined(second);
        assert.strictEquals(first.sampleCount, 5000);
        assert.isFinite(first.sum);
        assert.isAbove(first.sum, 0);
        /** Determinism ("no noise") is the property the technique relies on. */
        assert.strictEquals(first.sum, second.sum);
    });

    it('detects a deterministic hyphenation dictionary', () => {
        const result = detectHyphenationDictionary();

        assert.deepEquals(result, detectHyphenationDictionary());
        [
            result.finnishAutoHeight,
            result.finnishBaselineHeight,
            result.latinAutoHeight,
            result.latinBaselineHeight,
        ].forEach((height) => {
            assert.isFinite(height);
            assert.isAbove(height, 0);
        });
    });

    it('flags browsers that randomize their audio fingerprint', () => {
        assert.isTrue(browserRandomizesAudio('Safari'));
        assert.isTrue(browserRandomizesAudio('Brave'));
        assert.isFalse(browserRandomizesAudio('Chrome'));
        assert.isFalse(browserRandomizesAudio('Firefox'));
        assert.isFalse(browserRandomizesAudio(undefined));
    });

    it('detects brave deterministically', async () => {
        const first = await detectBrave();
        const second = await detectBrave();

        assert.strictEquals(first, second);
        assert.isBoolean(first);
    });

    it('parses cpu architecture from firefox user agents but not frozen macOS ones', () => {
        assert.strictEquals(
            archFromUserAgent(
                'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:152.0) Gecko/20100101 Firefox/152.0',
            ),
            CpuArchitecture.X86,
        );
        assert.strictEquals(
            archFromUserAgent(
                'Mozilla/5.0 (X11; Linux aarch64; rv:152.0) Gecko/20100101 Firefox/152.0',
            ),
            CpuArchitecture.Arm,
        );
        assert.strictEquals(
            archFromUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0',
            ),
            CpuArchitecture.X86,
        );
        /** MacOS Firefox and Safari freeze the platform to a fake "Intel Mac"; no real arch shows. */
        assert.isUndefined(
            archFromUserAgent(
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0',
            ),
        );
    });

    it('detects a deterministic, valid cpu architecture when one is exposed', async () => {
        const first = await detectCpuArch();
        const second = await detectCpuArch();

        assert.strictEquals(first, second);
        if (first != undefined) {
            /** Engines without UA client hints (Safari, Firefox) return undefined instead. */
            assert.isDefined(checkWrap.isEnumValue(first, CpuArchitecture));
        }
    });

    it('detects a deterministic font platform', () => {
        const result = detectFontPlatform();

        assert.deepEquals(result, detectFontPlatform());
        if (result.detected != undefined) {
            assert.isEnumValue(result.detected, FontPlatform);
            /** A platform is only ever claimed on the strength of a marker font it actually found. */
            assert.isNotEmpty(result.installedFonts);
        }
    });

    it('picks the platform whose marker fonts are present', () => {
        assert.strictEquals(
            platformFromInstalledFonts([
                'Geneva',
                'Helvetica Neue',
            ]),
            FontPlatform.Apple,
        );
        assert.strictEquals(
            platformFromInstalledFonts([
                'Calibri',
                'Cambria',
                'Segoe UI',
            ]),
            FontPlatform.Windows,
        );
        assert.strictEquals(
            platformFromInstalledFonts([
                'DejaVu Sans',
                'Ubuntu',
            ]),
            FontPlatform.Linux,
        );
        assert.strictEquals(platformFromInstalledFonts(['Roboto Condensed']), FontPlatform.Android);
    });

    it('claims no font platform without unambiguous evidence', () => {
        assert.isUndefined(platformFromInstalledFonts([]));
        /** An unknown family belongs to no platform's marker list. */
        assert.isUndefined(platformFromInstalledFonts(['Comic Sans MS']));
        /**
         * One marker font from each of two platforms is a tie, which a machine with cross-platform
         * fonts installed (Office on macOS ships Calibri) genuinely produces.
         */
        assert.isUndefined(
            platformFromInstalledFonts([
                'Geneva',
                'Calibri',
            ]),
        );
    });

    it('detects a deterministic math libm signature', () => {
        const result = detectMathLibm();

        assert.deepEquals(result, detectMathLibm());
        assert.strictEquals(result.anchorTanh, tanhAnchorValue);
        result.probeTanh.forEach((value) => {
            assert.isFinite(value);
            assert.isAbove(value, 0);
            assert.isBelow(value, 1);
        });
    });
});
