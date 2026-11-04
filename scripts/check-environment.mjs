import {checkEnvironment} from './test-environment.mjs';

const result = await checkEnvironment();
for (const check of result.checks) console.log(`${check.status.padEnd(8)} ${check.name}: ${check.detail}`);
console.log(JSON.stringify({status: result.status, failures: result.failures, optionalMissing: result.python.optionalMissing}, null, 2));
if (result.status === 'FAIL') process.exitCode = 1;
