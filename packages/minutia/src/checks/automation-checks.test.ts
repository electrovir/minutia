import {assert} from '@augment-vir/assert';
import {wait} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {Verdict} from './assessment.js';
import {
    AutomationCheckId,
    compareChromeVersions,
    getAutomationReport,
    startAutomationChecks,
    type AutomationReport,
} from './automation-checks.js';

describe('startAutomationChecks', () => {
    it('emits a complete report immediately, before any check has resolved', () => {
        const reports: AutomationReport[] = [];
        startAutomationChecks((report) => {
            reports.push(report);
        });

        const first = reports[0];
        assert.isDefined(first);
        /**
         * Several checks only resolve when automation trips them, so a consumer must never have to
         * handle a check that is simply absent from the report.
         */
        assert.isLengthExactly(first.assessments, Object.values(AutomationCheckId).length);
        assert.deepEquals(
            first.assessments.map((check) => check.id).toSorted(),
            Object.values(AutomationCheckId).toSorted(),
        );
    });

    it('replays the latest results to a listener attached after the checks started', () => {
        const reports: AutomationReport[] = [];
        startAutomationChecks((report) => {
            reports.push(report);
        });

        assert.isLengthAtLeast(reports, 1);
        assert.deepEquals(reports[0], getAutomationReport());
    });

    it('warns rather than staying silent when no CSP probe URL was given', () => {
        startAutomationChecks(() => {});
        const bypassCsp = getAutomationReport().assessments.find(
            (candidate) => candidate.id === AutomationCheckId.BypassCsp,
        );

        assert.isDefined(bypassCsp);
        assert.strictEquals(bypassCsp.verdict, Verdict.Warning);
    });

    it('resolves the checks that do not need an external trigger', async () => {
        startAutomationChecks(() => {});
        /** The viewport and webdriver checks are synchronous; the poll-based ones need a moment. */
        await wait({
            milliseconds: 300,
        });
        const report = getAutomationReport();

        [
            AutomationCheckId.NavigatorWebdriver,
            AutomationCheckId.Viewport,
            AutomationCheckId.PwInitScripts,
        ].forEach((id) => {
            const check = report.assessments.find((candidate) => candidate.id === id);
            assert.isDefined(check);
            assert.notStrictEquals(
                check.verdict,
                Verdict.Unknown,
                `${id} should have resolved without an external trigger`,
            );
        });
    });
});

describe('compareChromeVersions', () => {
    it('detects a version newer than the latest stable release', () => {
        assert.isAbove(
            compareChromeVersions({
                installed: '150.0.7900.10',
                latestStable: '149.0.7827.55',
            }),
            0,
        );
    });

    it('treats equal versions as neither newer nor older', () => {
        assert.strictEquals(
            compareChromeVersions({
                installed: '149.0.7827.55',
                latestStable: '149.0.7827.55',
            }),
            0,
        );
    });

    it('compares part by part rather than as a whole number', () => {
        /** A naive numeric parse would call 149.0.7827.55 older than 149.0.999.0. */
        assert.isAbove(
            compareChromeVersions({
                installed: '149.0.7827.55',
                latestStable: '149.0.999.0',
            }),
            0,
        );
    });
});
