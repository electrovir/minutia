import {check} from '@augment-vir/assert';
import {typedObjectFromEntries} from '@augment-vir/common';
import {
    buildAssessmentGroup,
    Verdict,
    type AssessmentGroup,
    type AssessmentResult,
} from './assessment.js';
import {
    PersistenceMechanism,
    persistenceMechanismLabels,
    persistenceTests,
    type PersistenceTest,
} from './persistence-mechanisms.js';

/**
 * Persistence is inherently a two-visit test: one visit writes a marker, a later visit checks
 * whether it survived. Which half to run is the caller's decision because only the caller knows
 * whether storage was cleared in between.
 *
 * @category Internal
 */
export enum PersistenceMode {
    /** Write the marker into every mechanism. */
    Seed = 'seed',
    /** Read the marker back out of every mechanism. */
    Verify = 'verify',
}

/**
 * Storage diagnostics that help explain why a quota-managed mechanism was unavailable.
 *
 * @category Internal
 */
export type PersistenceEnvironment = Readonly<{
    persistentStorage: boolean | undefined;
    quotaBytes: number | undefined;
    usageBytes: number | undefined;
}>;

/**
 * Every persistence assessment plus the marker and mode that produced it.
 *
 * @category Internal
 */
export type PersistenceReport = AssessmentGroup<PersistenceMechanism> &
    Readonly<{
        mode: PersistenceMode;
        marker: string;
        environment: PersistenceEnvironment;
        /** Mechanisms that held the marker. In verify mode, the ones that survived. */
        survived: ReadonlyArray<PersistenceMechanism>;
    }>;

const modeRunners: Record<
    PersistenceMode,
    (test: PersistenceTest, marker: string) => Promise<boolean>
> = {
    [PersistenceMode.Seed]: async (test, marker) => {
        await test.seed(marker);
        return true;
    },
    [PersistenceMode.Verify]: (test, marker) => Promise.resolve(test.verify(marker)),
};

const successNotes: Record<PersistenceMode, (label: string) => string> = {
    [PersistenceMode.Seed]: (label) => `The marker was written to ${label}.`,
    [PersistenceMode.Verify]: (label) => `The marker survived in ${label}.`,
};

const failureNotes: Record<PersistenceMode, (label: string) => string> = {
    [PersistenceMode.Seed]: (label) => `The marker could not be written to ${label}.`,
    [PersistenceMode.Verify]: (label) => `The marker is gone from ${label}.`,
};

/**
 * A mechanism that did not hold the marker is reported as a warning, not a failure: unlike the
 * other domains in this package, losing storage is the browser behaving protectively rather than
 * evidence of anything wrong. The caller decides whether that matters.
 */
async function runMechanism({
    mode,
    marker,
    mechanism,
}: Readonly<{
    mode: PersistenceMode;
    marker: string;
    mechanism: PersistenceMechanism;
}>): Promise<AssessmentResult> {
    const label = persistenceMechanismLabels[mechanism];

    try {
        const held = await modeRunners[mode](persistenceTests[mechanism], marker);
        return {
            verdict: held ? Verdict.Pass : Verdict.Warning,
            note: held ? successNotes[mode](label) : failureNotes[mode](label),
            debug: `mode = ${mode}, marker = ${marker}`,
        };
    } catch (caught) {
        return {
            verdict: Verdict.Warning,
            note: `${label} is unavailable in this browser or context.`,
            debug: check.isError(caught) ? caught.message : 'unknown error',
        };
    }
}

/** Best-effort storage diagnostics that help explain why quota-managed stores may be unavailable. */
async function gatherEnvironment(): Promise<PersistenceEnvironment> {
    /** Navigator.storage is `undefined` outside HTTPS (dev HTTP on non-localhost). */
    const storage = navigator.storage as StorageManager | undefined;
    const persistentStorage = await storage?.persisted().catch(() => undefined);
    const estimate = await storage?.estimate().catch(() => undefined);
    return {
        persistentStorage,
        quotaBytes: estimate?.quota,
        usageBytes: estimate?.usage,
    };
}

/**
 * Writes (seed) or reads back (verify) the same marker across every storage mechanism a first-party
 * script can reach. Run seed, then clear storage or wait however long is under test, then run
 * verify with the identical marker: whatever still reports a pass survived.
 *
 * @category Internal
 */
export async function runPersistenceChecks({
    mode,
    marker,
}: Readonly<{mode: PersistenceMode; marker: string}>): Promise<PersistenceReport> {
    const results = typedObjectFromEntries(
        await Promise.all(
            Object.values(PersistenceMechanism).map(async (mechanism) => {
                return [
                    mechanism,
                    await runMechanism({
                        mode,
                        marker,
                        mechanism,
                    }),
                ] as const;
            }),
        ),
    );

    const group = buildAssessmentGroup({
        results,
        labels: persistenceMechanismLabels,
    });

    return {
        ...group,
        mode,
        marker,
        environment: await gatherEnvironment(),
        survived: group.assessments
            .filter((entry) => entry.verdict === Verdict.Pass)
            .map((entry) => entry.id),
    };
}
