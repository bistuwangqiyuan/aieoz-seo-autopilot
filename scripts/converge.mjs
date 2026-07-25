// Drive production cycles until the maintenance backlog is empty.
//
// Each GEO cycle does bounded work: it must finish inside the function's time
// budget, so backfill and the integrity sweep process a slice per run and defer
// the rest. That is correct for unattended operation - the 4-hourly schedule
// drains the queue on its own - but after a rule change or a link migration we
// want the corpus consistent now rather than a day from now, and we want proof
// that the queue actually drains instead of merely assuming it.
//
// Stops on: nothing left queued, no progress for two rounds, or the round cap.
import { loadEnv, fetchStatus, runCron } from "./_env.mjs";

const env = loadEnv();
const MAX_ROUNDS = Number(process.env.ROUNDS ?? 12);

const backlog = (d) => ({
  backfill: d.geo.backlinks.pendingBackfill,
  stale: d.effect.integrity.staleForRules,
  flagged: d.effect.integrity.articlesFlagged,
});
const total = (b) => b.backfill + b.stale + b.flagged;
const show = (b) => `backfill ${b.backfill}, stale-for-rules ${b.stale}, flagged ${b.flagged}`;

let previous = null;
let stalled = 0;

for (let round = 1; round <= MAX_ROUNDS; round += 1) {
  const before = backlog(await fetchStatus(env.CRON_SECRET));

  if (total(before) === 0) {
    console.log(`\nconverged: ${show(before)}`);
    process.exitCode = 0;
    break;
  }

  // A cycle that made no headway twice running will not fix itself by being
  // called a third time; something is wrong and a human should see the numbers.
  if (previous !== null && total(before) >= previous) {
    stalled += 1;
    if (stalled >= 2) {
      console.error(`\nstalled at ${show(before)} - two rounds without progress`);
      process.exitCode = 1;
      break;
    }
  } else {
    stalled = 0;
  }
  previous = total(before);

  console.log(`round ${round}: ${show(before)} -> running cycle`);
  const run = await runCron(env.CRON_SECRET);
  console.log(`  HTTP ${run.status} in ${run.seconds}s`);
  if (!run.ok) {
    console.error(`  cycle failed: ${run.text.slice(0, 500)}`);
    process.exitCode = 1;
    break;
  }

  if (round === MAX_ROUNDS) {
    const after = backlog(await fetchStatus(env.CRON_SECRET));
    console.error(`\nnot converged after ${MAX_ROUNDS} rounds: ${show(after)}`);
    process.exitCode = 1;
  }
}
