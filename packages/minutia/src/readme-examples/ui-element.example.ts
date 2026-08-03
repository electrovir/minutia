import {defineElement, html} from 'element-vir';
import {MinutiaSummary} from '../index.js';

export const MyPage = defineElement()({
    tagName: 'my-page',
    render() {
        return html`
            <h1>Browser checks</h1>
            <${MinutiaSummary.assign({
                /** Must be on an origin that this page's `script-src` forbids. */
                cspProbeScriptUrl: 'https://your-other-origin.example/probe.js',
            })}></${MinutiaSummary}>
        `;
    },
});
