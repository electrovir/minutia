import {worstVerdict, type Verdict} from './checks/assessment.js';
import {
    getAutomationReport,
    startAutomationChecks,
    type AutomationChecksOptions,
    type AutomationReport,
} from './checks/automation-checks.js';
import {runBotChecks, type BotReport} from './checks/bot-checks.js';
import {
    runFingerprintChecks,
    type FingerprintReport,
} from './checks/fingerprint/fingerprint-report.js';
import {
    runPersistenceChecks,
    type PersistenceMode,
    type PersistenceReport,
} from './checks/persistence-checks.js';

/**
 * Everything this package can determine about a browser.
 *
 * @category Internal
 */
export type MinutiaReport = Readonly<{
    /** Whether this looks like a bot rather than a person. */
    bot: BotReport;
    /** Whether a browser-automation framework is driving this page. */
    automation: AutomationReport;
    /** Whether the user agent is telling the truth about its OS and browser. */
    fingerprint: FingerprintReport;
    /** Which storage mechanisms held a marker. Only present when `persistence` was requested. */
    persistence: PersistenceReport | undefined;
    /**
     * The most severe verdict across bot, automation, and fingerprint.
     *
     * Persistence is excluded on purpose: losing storage is the browser protecting the user, so it
     * says nothing about whether this visitor is suspicious and must not darken the verdict.
     */
    verdict: Verdict;
}>;

/**
 * Called with a fresh {@link MinutiaReport} each time any check changes.
 *
 * @category Internal
 */
export type MinutiaReportListener = (report: MinutiaReport) => void;

/**
 * Options for {@link runMinutia} and {@link startUpdatingMinutia}.
 *
 * @category Internal
 */
export type MinutiaOptions = AutomationChecksOptions &
    Readonly<{
        /**
         * Also exercise storage persistence, which is otherwise skipped because it writes to
         * storage rather than only reading it.
         *
         * Pass {@link PersistenceMode.Seed} on the first visit and {@link PersistenceMode.Verify}
         * with the identical marker on a later one; whatever still passes survived in between.
         */
        persistence?: Readonly<{mode: PersistenceMode; marker: string}> | undefined;
    }>;

function combineReports({
    bot,
    automation,
    fingerprint,
    persistence,
}: Readonly<{
    bot: BotReport;
    automation: AutomationReport;
    fingerprint: FingerprintReport;
    persistence: PersistenceReport | undefined;
}>): MinutiaReport {
    return {
        bot,
        automation,
        fingerprint,
        persistence,
        verdict: worstVerdict([
            bot.verdict,
            automation.verdict,
            fingerprint.verdict,
        ]),
    };
}

/**
 * Runs every check once and returns a single snapshot. Pass `persistence` to exercise storage too,
 * which makes this one call cover everything this package can measure.
 *
 * Automation checks that wait on an external trigger (a script evaluating in the main world, an
 * exposed binding being called) cannot have fired yet at snapshot time, so they report
 * {@link Verdict.Unknown} here. Use {@link startUpdatingMinutia} to receive those as they land.
 *
 * @category Main
 * @example
 *
 * ```ts
 * import {runMinutia} from 'minutia';
 *
 * const report = await runMinutia();
 *
 * report.bot.verdict;
 * report.automation.verdict;
 * report.fingerprint.verdict;
 * report.verdict;
 * ```
 */
export async function runMinutia(options: MinutiaOptions = {}): Promise<MinutiaReport> {
    startAutomationChecks(() => {}, options);

    const [
        bot,
        fingerprint,
        persistence,
    ] = await Promise.all([
        runBotChecks(),
        runFingerprintChecks(),
        options.persistence ? runPersistenceChecks(options.persistence) : undefined,
    ]);

    return combineReports({
        bot,
        fingerprint,
        persistence,
        automation: getAutomationReport(),
    });
}

/**
 * Runs every check and calls `onUpdate` with a fresh report each time any of them changes.
 *
 * The first call arrives once the bot and fingerprint checks resolve; automation checks continue to
 * stream in afterwards as they are triggered, which is the reason to prefer this over
 * {@link runMinutia}. Safe to call more than once per page: the global hooks are installed only on
 * the first call.
 *
 * @category Main
 * @example
 *
 * ```ts
 * import {startMinutia} from 'minutia';
 *
 * startMinutia((report) => {
 *     report.verdict;
 * });
 * ```
 */
export function startUpdatingMinutia(
    onUpdate: MinutiaReportListener,
    options: MinutiaOptions = {},
): void {
    const state = {
        bot: undefined as BotReport | undefined,
        fingerprint: undefined as FingerprintReport | undefined,
        persistence: undefined as PersistenceReport | undefined,
        /** Persistence is optional, so nothing waits on it when it was not requested. */
        isPersistencePending: options.persistence != undefined,
        automation: getAutomationReport(),
    };

    function emit(): void {
        if (!state.bot || !state.fingerprint || state.isPersistencePending) {
            /** Holding the first emission keeps every requested field of the report populated. */
            return;
        }
        onUpdate(
            combineReports({
                bot: state.bot,
                fingerprint: state.fingerprint,
                persistence: state.persistence,
                automation: state.automation,
            }),
        );
    }

    startAutomationChecks((automation) => {
        state.automation = automation;
        emit();
    }, options);

    void runBotChecks().then((bot) => {
        state.bot = bot;
        emit();
    });

    void runFingerprintChecks().then((fingerprint) => {
        state.fingerprint = fingerprint;
        emit();
    });

    if (options.persistence) {
        void runPersistenceChecks(options.persistence).then((persistence) => {
            state.persistence = persistence;
            state.isPersistencePending = false;
            emit();
        });
    }
}
