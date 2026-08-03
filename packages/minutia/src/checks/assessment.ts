import {getObjectTypedKeys} from '@augment-vir/common';

/**
 * The single result vocabulary every check in this package reports through. The underlying
 * techniques disagree about what a result means natively (a fingerprint either matches a reference
 * or does not, an automation probe may never fire at all, a bot signal is weak or strong), so each
 * domain maps its own outcome onto these four values and consumers only ever handle one scale.
 *
 * @category Internal
 */
export enum Verdict {
    /** Nothing wrong was found. */
    Pass = 'pass',
    /**
     * The check could not reach a conclusion: it does not apply to this browser, it is waiting on
     * an external trigger, or no reference data exists to compare against. Never an accusation.
     */
    Unknown = 'unknown',
    /** Suspicious, but explainable by an unusual yet honest browser. */
    Warning = 'warning',
    /** Conclusive: automation, spoofing, or tampering was found. */
    Fail = 'fail',
}

/**
 * User-facing text for each {@link Verdict}.
 *
 * @category Internal
 */
export const verdictLabels: Record<Verdict, string> = {
    [Verdict.Pass]: 'pass',
    [Verdict.Unknown]: 'unknown',
    [Verdict.Warning]: 'warning',
    [Verdict.Fail]: 'fail',
};

/** Severity order, used to reduce many assessments down to a single group verdict. */
const verdictSeverity: Record<Verdict, number> = {
    [Verdict.Pass]: 0,
    [Verdict.Unknown]: 1,
    [Verdict.Warning]: 2,
    [Verdict.Fail]: 3,
};

/**
 * The outcome of one check, before it is labelled and identified.
 *
 * @category Internal
 */
export type AssessmentResult = Readonly<{
    verdict: Verdict;
    /** A complete sentence explaining the outcome, safe to show a user directly. */
    note: string;
    /** The raw measured values behind the outcome, for debugging. */
    debug: string | undefined;
}>;

/**
 * One fully identified check within a group.
 *
 * @category Internal
 */
export type Assessment<Id extends string = string> = AssessmentResult &
    Readonly<{
        id: Id;
        label: string;
    }>;

/**
 * A domain's assessments plus the single verdict that summarizes them. Every domain in this package
 * produces this shape, which is what lets one UI render all of them without special cases.
 *
 * @category Internal
 */
export type AssessmentGroup<Id extends string = string> = Readonly<{
    verdict: Verdict;
    assessments: ReadonlyArray<Assessment<Id>>;
}>;

/**
 * The most severe verdict present, or {@link Verdict.Pass} when there is nothing to reduce. The
 * default aggregation: one conclusive failure condemns the whole group.
 *
 * @category Internal
 */
export function worstVerdict(verdicts: ReadonlyArray<Verdict>): Verdict {
    return verdicts.reduce(
        (worst, verdict) => (verdictSeverity[verdict] > verdictSeverity[worst] ? verdict : worst),
        Verdict.Pass,
    );
}

/**
 * How many of `assessments` currently hold the given verdict.
 *
 * @category Internal
 */
export function countAssessmentsWithVerdict({
    assessments,
    verdict,
}: Readonly<{assessments: ReadonlyArray<Assessment>; verdict: Verdict}>): number {
    return assessments.filter((entry) => entry.verdict === verdict).length;
}

/**
 * Assembles a group from a per-id result map and a per-id label map. Keying both maps by the same
 * id enum is what guarantees at compile time that every check has a label and none is left
 * unreported.
 *
 * @category Internal
 */
export function buildAssessmentGroup<Id extends string>({
    results,
    labels,
    aggregate = worstVerdict,
}: Readonly<{
    results: Readonly<Record<Id, AssessmentResult>>;
    labels: Readonly<Record<Id, string>>;
    /** Overrides the default worst-of reduction when a domain weighs its checks differently. */
    aggregate?: ((verdicts: ReadonlyArray<Verdict>) => Verdict) | undefined;
}>): AssessmentGroup<Id> {
    const assessments: ReadonlyArray<Assessment<Id>> = getObjectTypedKeys(results).map((id) => {
        return {
            id,
            label: labels[id],
            ...results[id],
        };
    });

    return {
        verdict: aggregate(assessments.map((entry) => entry.verdict)),
        assessments,
    };
}
