import {css, defineElement, html} from 'element-vir';
import {MinutiaSummary} from 'minutia';

/** A `data:` script URL, which this page's `script-src` omits and therefore forbids. */
const cspProbeScriptUrl = 'data:text/javascript,void 0;';

export const MinutiaDemo = defineElement()({
    tagName: 'minutia-demo',
    styles: css`
        :host {
            display: block;
            padding: 24px;
            font-family: sans-serif;
            max-width: 1400px;
        }
    `,
    render() {
        return html`
            <h1>Minutia</h1>
            <${MinutiaSummary.assign({
                cspProbeScriptUrl,
            })}></${MinutiaSummary}>
        `;
    },
});
