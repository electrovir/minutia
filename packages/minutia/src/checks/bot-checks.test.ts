import {assert, assertWrap} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {Verdict} from './assessment.js';
import {aggregateBotVerdict, BotCheckId, countBotSignals, runBotChecks} from './bot-checks.js';

describe('runBotChecks', () => {
    it('reports every check exactly once', async () => {
        const report = await runBotChecks();

        assert.isLengthExactly(report.assessments, Object.values(BotCheckId).length);
        assert.deepEquals(
            report.assessments.map((check) => check.id).toSorted(),
            Object.values(BotCheckId).toSorted(),
        );
        report.assessments.forEach((check) => {
            assert.isEnumValue(check.verdict, Verdict);
            assert.isNotEmpty(check.note);
            assert.isNotEmpty(check.label);
        });
    });

    it('accepts the navigator.vendor every real engine reports', async () => {
        const report = await runBotChecks();
        const vendor = assertWrap.isDefined(
            report.assessments.find((check) => check.id === BotCheckId.NavigatorVendor),
        );

        /** Chromium, WebKit, and Gecko each report their engine's constant, so none may be flagged. */
        assert.strictEquals(vendor.verdict, Verdict.Pass);
    });

    it('never calls a real browser out over apple pay', async () => {
        const report = await runBotChecks();
        const applePay = assertWrap.isDefined(
            report.assessments.find((check) => check.id === BotCheckId.ApplePay),
        );

        /**
         * Playwright's WebKit claims macOS Safari without shipping Apple Pay, which earns the weak
         * warning; the conclusive status is reserved for Apple Pay appearing where it cannot
         * exist.
         */
        assert.notStrictEquals(applePay.verdict, Verdict.Fail);
    });

    it('counts the signals behind the verdict', async () => {
        const report = await runBotChecks();
        const counts = countBotSignals(report);

        assert.strictEquals(
            counts.strong,
            report.assessments.filter((check) => check.verdict === Verdict.Fail).length,
        );
        assert.strictEquals(
            counts.weak,
            report.assessments.filter((check) => check.verdict === Verdict.Warning).length,
        );
    });
});

describe('aggregateBotVerdict', () => {
    it('condemns on one conclusive signal or two weak ones', () => {
        assert.strictEquals(aggregateBotVerdict([Verdict.Fail]), Verdict.Fail);
        assert.strictEquals(
            aggregateBotVerdict([
                Verdict.Warning,
                Verdict.Warning,
            ]),
            Verdict.Fail,
        );
    });

    it('treats a lone weak signal as only a warning', () => {
        assert.strictEquals(
            aggregateBotVerdict([
                Verdict.Warning,
                Verdict.Pass,
            ]),
            Verdict.Warning,
        );
    });

    it('ignores inconclusive checks entirely', () => {
        /** Unlike the default worst-of reduction, an unknown must never darken the bot verdict. */
        assert.strictEquals(
            aggregateBotVerdict([
                Verdict.Unknown,
                Verdict.Unknown,
                Verdict.Pass,
            ]),
            Verdict.Pass,
        );
    });
});
