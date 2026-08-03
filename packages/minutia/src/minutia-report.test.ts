import {assert} from '@augment-vir/assert';
import {randomString} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {Verdict, worstVerdict} from './checks/assessment.js';
import {PersistenceMode} from './checks/persistence-checks.js';
import {runMinutia, startUpdatingMinutia, type MinutiaReport} from './minutia-report.js';

describe('runMinutia', () => {
    it('returns all three live domains in one snapshot', async () => {
        const report = await runMinutia();

        assert.isNotEmpty(report.bot.assessments);
        assert.isNotEmpty(report.automation.assessments);
        assert.isNotEmpty(report.fingerprint.assessments);
    });

    it('skips storage persistence unless it is asked for', async () => {
        const report = await runMinutia();

        /** Persistence writes to storage, so it must never run as a side effect of a plain read. */
        assert.isUndefined(report.persistence);
    });

    it('runs storage persistence in the same call when asked', async () => {
        const marker = randomString();
        const seeded = await runMinutia({
            persistence: {
                mode: PersistenceMode.Seed,
                marker,
            },
        });
        const verified = await runMinutia({
            persistence: {
                mode: PersistenceMode.Verify,
                marker,
            },
        });

        assert.isDefined(seeded.persistence);
        assert.isDefined(verified.persistence);
        assert.isNotEmpty(seeded.persistence.survived);
        seeded.persistence.survived.forEach((mechanism) => {
            assert.isIn(mechanism, verified.persistence?.survived ?? []);
        });
    });

    it('does not let lost storage darken the verdict', async () => {
        const report = await runMinutia({
            persistence: {
                /** Verifying a marker that was never seeded loses every mechanism. */
                mode: PersistenceMode.Verify,
                marker: randomString(),
            },
        });

        assert.isDefined(report.persistence);
        assert.strictEquals(
            report.verdict,
            worstVerdict([
                report.bot.verdict,
                report.automation.verdict,
                report.fingerprint.verdict,
            ]),
        );
    });

    it('summarizes with the most severe status across the domains', async () => {
        const report = await runMinutia();

        assert.strictEquals(
            report.verdict,
            worstVerdict([
                report.bot.verdict,
                report.automation.verdict,
                report.fingerprint.verdict,
            ]),
        );
    });

    it('describes the browser it ran in', async () => {
        const report = await runMinutia();

        assert.isNotEmpty(report.fingerprint.groundTruth.userAgent);
        assert.isEnumValue(report.verdict, Verdict);
    });
});

describe('startMinutia', () => {
    it('emits a fully populated report rather than a partial one', async () => {
        const report = await new Promise<MinutiaReport>((resolve) => {
            startUpdatingMinutia(resolve);
        });

        /**
         * The first emission is held until the one-shot domains resolve, so no consumer ever sees a
         * report with a missing domain.
         */
        assert.isNotEmpty(report.bot.assessments);
        assert.isNotEmpty(report.automation.assessments);
        assert.isNotEmpty(report.fingerprint.assessments);
        assert.isEnumValue(report.verdict, Verdict);
    });
});
