// Fire one production cron run (SEO scan + GEO cycle) and print the result.
import { loadEnv, runCron } from "./_env.mjs";

const run = await runCron(loadEnv().CRON_SECRET);
console.log(`HTTP ${run.status} in ${run.seconds}s`);
console.log(run.text.slice(0, 2000));
process.exitCode = run.ok ? 0 : 1;
