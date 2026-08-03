import {assert, assertWrap, waitUntil} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {MinutiaSummary} from './minutia-summary.element.js';

/** Attaches the element to the document and removes it once the test ends. */
async function renderSummary(): Promise<Element> {
    const element = document.createElement(MinutiaSummary.tagName);
    document.body.append(element);
    await waitUntil.isDefined(() => element.shadowRoot);
    return element;
}

/** The four groups the element renders, in the order it shows them. */
const expectedCardHeaders: ReadonlyArray<string> = [
    'Bot signals',
    'Automation checks',
    'OS fingerprints',
    'Storage persistence',
];

describe(MinutiaSummary.tagName, () => {
    it('shows one card per check group once the checks resolve', async () => {
        const element = await renderSummary();

        const headers = await waitUntil.isLengthExactly(
            expectedCardHeaders.length,
            () => element.shadowRoot?.querySelectorAll('.card-header') ?? [],
        );

        assert.deepEquals(
            /** The verdict tag renders into a nested element, so only the leading text is compared. */
            Array.from(headers, (header) => header.textContent.trim().split('\n')[0]?.trim() || ''),
            [...expectedCardHeaders],
        );
        element.remove();
    });

    it('labels and explains every assessment in every group', async () => {
        const element = await renderSummary();

        const rows = await waitUntil.isLengthAtLeast(
            1,
            () => element.shadowRoot?.querySelectorAll('tr') ?? [],
        );

        Array.from(rows).forEach((row) => {
            assert.isNotEmpty(
                assertWrap.isDefined(row.querySelector('.assessment-label')).textContent.trim(),
            );
            assert.isNotEmpty(assertWrap.isDefined(row.querySelector('.note')).textContent.trim());
        });
        element.remove();
    });
});
