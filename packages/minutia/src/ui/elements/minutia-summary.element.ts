import {randomString} from '@augment-vir/common';
import {css, defineElement, html, listen} from 'element-vir';
import {
    ViraButton,
    ViraCollapsibleCard,
    ViraColorVariant,
    ViraSize,
    ViraTag,
    viraTheme,
} from 'vira';
import {
    Verdict,
    verdictLabels,
    type Assessment,
    type AssessmentGroup,
} from '../../checks/assessment.js';
import {
    PersistenceMode,
    runPersistenceChecks,
    type PersistenceReport,
} from '../../checks/persistence-checks.js';
import {startUpdatingMinutia, type MinutiaReport} from '../../minutia-report.js';

/**
 * Search param the persistence marker is stored in, so reloading the page (the only way to make the
 * two-visit test meaningful) keeps testing the same marker.
 */
const markerSearchParam = 'minutiaPersistenceMarker';

const verdictColors: Record<Verdict, ViraColorVariant> = {
    [Verdict.Pass]: ViraColorVariant.Positive,
    [Verdict.Unknown]: ViraColorVariant.Neutral,
    [Verdict.Warning]: ViraColorVariant.Warning,
    [Verdict.Fail]: ViraColorVariant.Danger,
};

function renderVerdict(verdict: Verdict) {
    return html`
        <${ViraTag.assign({
            text: verdictLabels[verdict],
            color: verdictColors[verdict],
            size: ViraSize.Small,
        })}></${ViraTag}>
    `;
}

function renderAssessments(assessments: ReadonlyArray<Assessment>) {
    return html`
        <table>
            <tbody>
                ${assessments.map(
                    (assessment) => html`
                        <tr>
                            <td class="assessment-label">${assessment.label}</td>
                            <td>${renderVerdict(assessment.verdict)}</td>
                            <td class="note">${assessment.note}</td>
                        </tr>
                    `,
                )}
            </tbody>
        </table>
    `;
}

function renderGroup({title, group}: Readonly<{title: string; group: AssessmentGroup}>) {
    return html`
        <${ViraCollapsibleCard}>
            <span
                class="card-header"
                slot=${ViraCollapsibleCard.slotNames['vira-collapsible-card-header']}
            >
                ${title} ${renderVerdict(group.verdict)}
            </span>
            ${renderAssessments(group.assessments)}
        </${ViraCollapsibleCard}>
    `;
}

/**
 * The full live browser report: every check this package can run, grouped by domain, plus controls
 * for the two-visit storage persistence test.
 *
 * Everything it renders comes from {@link startUpdatingMinutia}, so it re-renders on its own as
 * automation checks are triggered. Call {@link startUpdatingMinutia} directly instead when you want
 * the data without the UI.
 *
 * The persistence marker is written into the page's `minutiaPersistenceMarker` search param, so
 * that reloading (or closing and returning to) the page verifies the same marker that was seeded.
 *
 * @category UI
 * @example
 *
 * ```html
 * <minutia-summary></minutia-summary>
 * ```
 */
export const MinutiaSummary = defineElement<{
    /**
     * Cross-origin script URL for the CSP bypass check. Without it that check reports
     * {@link Verdict.Warning} telling you to set it.
     */
    cspProbeScriptUrl?: string | undefined;
    /** Overrides the marker used for the storage persistence test. */
    persistenceMarker?: string | undefined;
}>()({
    tagName: 'minutia-summary',
    styles: css`
        :host {
            display: flex;
            flex-direction: column;
            gap: 16px;
            font-family: sans-serif;
        }

        .card-header {
            display: flex;
            gap: 8px;
            align-items: center;
            font-weight: bold;
        }

        .note,
        .pending {
            color: ${viraTheme.colors['vira-grey-foreground-non-body'].foreground.value};
            font-size: 13px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
        }

        td {
            padding: 4px 12px 4px 0;
            text-align: left;
            vertical-align: top;
        }

        .assessment-label {
            white-space: nowrap;
        }

        /**
         * Auto table layout spreads surplus width across every column, which would push the label,
         * verdict, and note far apart. Giving the note column all of it keeps the first two columns
         * sized to their contents.
         */
        .note {
            width: 100%;
        }

        nav {
            display: flex;
            gap: 8px;
            align-items: center;
            margin-bottom: 8px;
        }
    `,
    state: () => {
        return {
            report: undefined as MinutiaReport | undefined,
            marker: '',
            persistence: undefined as PersistenceReport | undefined,
            isPersistenceRunning: false,
        };
    },
    init({inputs, updateState}) {
        const searchParams = new URLSearchParams(window.location.search);
        const marker =
            inputs.persistenceMarker || searchParams.get(markerSearchParam) || randomString();
        if (searchParams.get(markerSearchParam) !== marker) {
            searchParams.set(markerSearchParam, marker);
            window.history.replaceState(undefined, '', `?${searchParams.toString()}`);
        }
        updateState({
            marker,
        });

        startUpdatingMinutia(
            (report) => {
                updateState({
                    report,
                });
            },
            {
                cspProbeScriptUrl: inputs.cspProbeScriptUrl,
            },
        );
    },
    render({state, updateState}) {
        function startPersistence(mode: PersistenceMode): void {
            updateState({
                isPersistenceRunning: true,
            });
            void runPersistenceChecks({
                mode,
                marker: state.marker,
            }).then((persistence) => {
                updateState({
                    persistence,
                    isPersistenceRunning: false,
                });
            });
        }

        const report = state.report;
        if (!report) {
            return html`
                <p class="pending">Running checks…</p>
            `;
        }

        return html`
            ${renderGroup({
                title: 'Bot signals',
                group: report.bot,
            })}
            ${renderGroup({
                title: 'Automation checks',
                group: report.automation,
            })}
            ${renderGroup({
                title: 'OS fingerprints',
                group: report.fingerprint,
            })}

            <${ViraCollapsibleCard}>
                <span
                    class="card-header"
                    slot=${ViraCollapsibleCard.slotNames['vira-collapsible-card-header']}
                >
                    Storage persistence
                    ${state.persistence ? renderVerdict(state.persistence.verdict) : ''}
                </span>
                <p class="note">
                    Seed the marker, then reload the page (or close it and come back) and verify it.
                    Whatever still passes survived in between. Current marker:
                    <code>${state.marker}</code>
                </p>
                <nav>
                    <${ViraButton.assign({
                        text: 'Seed storage',
                        isDisabled: state.isPersistenceRunning,
                        color: ViraColorVariant.Info,
                    })}
                        ${listen('click', () => {
                            startPersistence(PersistenceMode.Seed);
                        })}
                    ></${ViraButton}>
                    <${ViraButton.assign({
                        text: 'Verify storage',
                        isDisabled: state.isPersistenceRunning,
                        color: ViraColorVariant.Info,
                    })}
                        ${listen('click', () => {
                            startPersistence(PersistenceMode.Verify);
                        })}
                    ></${ViraButton}>
                </nav>
                ${state.persistence ? renderAssessments(state.persistence.assessments) : ''}
            </${ViraCollapsibleCard}>
        `;
    },
});
