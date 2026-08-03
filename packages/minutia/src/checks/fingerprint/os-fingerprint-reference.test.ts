import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {audioSumsForArch, type FingerprintObservation} from './os-fingerprint-reference.js';
import {CpuArchitecture} from './os-fingerprints.js';

describe('audioSumsForArch', () => {
    const observations: ReadonlyArray<FingerprintObservation> = [
        {
            majorVersion: '1',
            cpuArch: CpuArchitecture.Arm,
            hyphenationDictionary: undefined,
            libmSignature: undefined,
            fontPlatform: undefined,
            audioSum: 100,
        },
        {
            majorVersion: '2',
            cpuArch: CpuArchitecture.X86,
            hyphenationDictionary: undefined,
            libmSignature: undefined,
            fontPlatform: undefined,
            audioSum: 200,
        },
    ];

    it('returns only the sums captured on the requested architecture', () => {
        assert.deepEquals(
            audioSumsForArch({
                observations,
                cpuArch: CpuArchitecture.X86,
            }),
            [200],
        );
    });

    it('returns every sum when the architecture is unknown', () => {
        assert.deepEquals(
            audioSumsForArch({
                observations,
                cpuArch: undefined,
            }),
            [
                100,
                200,
            ],
        );
    });
});
