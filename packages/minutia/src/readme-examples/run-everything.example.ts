import {runMinutia} from '../index.js';

const report = await runMinutia();

report.bot.verdict; // is this a bot?
report.automation.verdict; // is a framework driving this page?
report.fingerprint.verdict; // is the user agent lying about its OS?
report.verdict; // the worst of the three

// every individual assessment behind a verdict
report.bot.assessments.map((assessment) => `${assessment.label}: ${assessment.note}`);
