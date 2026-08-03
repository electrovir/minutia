import {assert} from '@augment-vir/assert';
import {randomString} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {Verdict} from './assessment.js';
import {PersistenceMode, runPersistenceChecks} from './persistence-checks.js';
import {PersistenceMechanism} from './persistence-mechanisms.js';

describe('runPersistenceChecks', () => {
    it('reports every mechanism exactly once', async () => {
        const report = await runPersistenceChecks({
            mode: PersistenceMode.Seed,
            marker: randomString(),
        });

        assert.isLengthExactly(report.assessments, Object.values(PersistenceMechanism).length);
        assert.deepEquals(
            report.assessments.map((check) => check.id).toSorted(),
            Object.values(PersistenceMechanism).toSorted(),
        );
    });

    it('reads back every marker it managed to write', async () => {
        const marker = randomString();
        const seeded = await runPersistenceChecks({
            mode: PersistenceMode.Seed,
            marker,
        });
        const verified = await runPersistenceChecks({
            mode: PersistenceMode.Verify,
            marker,
        });

        /**
         * Some mechanisms are unavailable depending on the engine and context (service workers need
         * a served script, OPFS is not everywhere), so the invariant is not "everything survives"
         * but "whatever was successfully written can be read back".
         */
        assert.isNotEmpty(seeded.survived);
        seeded.survived.forEach((mechanism) => {
            assert.isIn(
                mechanism,
                verified.survived,
                `${mechanism} accepted the marker but could not read it back`,
            );
        });
    });

    it('does not report a different run’s marker as surviving', async () => {
        await runPersistenceChecks({
            mode: PersistenceMode.Seed,
            marker: randomString(),
        });
        const verified = await runPersistenceChecks({
            mode: PersistenceMode.Verify,
            marker: randomString(),
        });

        /**
         * Service worker registration is the one mechanism with no marker to compare: it can only
         * report whether a registration exists at all, so it legitimately survives any marker.
         */
        const markerBackedSurvivors = verified.survived.filter(
            (mechanism) => mechanism !== PersistenceMechanism.ServiceWorker,
        );
        assert.isEmpty(markerBackedSurvivors);
    });

    it('treats a lost mechanism as a warning rather than a failure', async () => {
        const verified = await runPersistenceChecks({
            mode: PersistenceMode.Verify,
            marker: randomString(),
        });

        /** Losing storage is the browser protecting the user, never evidence of wrongdoing. */
        assert.notStrictEquals(verified.verdict, Verdict.Fail);
        verified.assessments.forEach((check) => {
            assert.notStrictEquals(check.verdict, Verdict.Fail);
        });
    });

    it('records the marker and mode it ran with', async () => {
        const marker = randomString();
        const report = await runPersistenceChecks({
            mode: PersistenceMode.Seed,
            marker,
        });

        assert.strictEquals(report.marker, marker);
        assert.strictEquals(report.mode, PersistenceMode.Seed);
    });
});
