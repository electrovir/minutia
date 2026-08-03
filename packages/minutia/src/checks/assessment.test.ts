import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {
    buildAssessmentGroup,
    countAssessmentsWithVerdict,
    Verdict,
    worstVerdict,
    type AssessmentResult,
} from './assessment.js';

enum TestAssessmentId {
    First = 'first',
    Second = 'second',
}

const testLabels: Record<TestAssessmentId, string> = {
    [TestAssessmentId.First]: 'first assessment',
    [TestAssessmentId.Second]: 'second assessment',
};

function result(verdict: Verdict): AssessmentResult {
    return {
        verdict,
        note: `verdict is ${verdict}`,
        debug: undefined,
    };
}

describe('worstVerdict', () => {
    it('ranks a conclusive failure above every other verdict', () => {
        assert.strictEquals(
            worstVerdict([
                Verdict.Pass,
                Verdict.Warning,
                Verdict.Fail,
                Verdict.Unknown,
            ]),
            Verdict.Fail,
        );
    });

    it('ranks an inconclusive assessment above a pass but below a warning', () => {
        assert.strictEquals(
            worstVerdict([
                Verdict.Pass,
                Verdict.Unknown,
            ]),
            Verdict.Unknown,
        );
        assert.strictEquals(
            worstVerdict([
                Verdict.Unknown,
                Verdict.Warning,
            ]),
            Verdict.Warning,
        );
    });

    it('passes when there is nothing to reduce', () => {
        assert.strictEquals(worstVerdict([]), Verdict.Pass);
    });
});

describe('buildAssessmentGroup', () => {
    it('labels every assessment and summarizes them with the worst verdict', () => {
        const group = buildAssessmentGroup({
            results: {
                [TestAssessmentId.First]: result(Verdict.Pass),
                [TestAssessmentId.Second]: result(Verdict.Warning),
            },
            labels: testLabels,
        });

        assert.strictEquals(group.verdict, Verdict.Warning);
        assert.deepEquals(group.assessments, [
            {
                id: TestAssessmentId.First,
                label: 'first assessment',
                verdict: Verdict.Pass,
                note: 'verdict is pass',
                debug: undefined,
            },
            {
                id: TestAssessmentId.Second,
                label: 'second assessment',
                verdict: Verdict.Warning,
                note: 'verdict is warning',
                debug: undefined,
            },
        ]);
    });

    it('lets a domain override how its assessments are weighed', () => {
        const group = buildAssessmentGroup({
            results: {
                [TestAssessmentId.First]: result(Verdict.Fail),
                [TestAssessmentId.Second]: result(Verdict.Fail),
            },
            labels: testLabels,
            /** A domain that treats its assessments as advisory rather than condemning. */
            aggregate: () => Verdict.Warning,
        });

        assert.strictEquals(group.verdict, Verdict.Warning);
    });
});

describe('countAssessmentsWithVerdict', () => {
    it('counts only the assessments holding the requested verdict', () => {
        const group = buildAssessmentGroup({
            results: {
                [TestAssessmentId.First]: result(Verdict.Fail),
                [TestAssessmentId.Second]: result(Verdict.Pass),
            },
            labels: testLabels,
        });

        assert.strictEquals(
            countAssessmentsWithVerdict({
                assessments: group.assessments,
                verdict: Verdict.Fail,
            }),
            1,
        );
        assert.strictEquals(
            countAssessmentsWithVerdict({
                assessments: group.assessments,
                verdict: Verdict.Unknown,
            }),
            0,
        );
    });
});
