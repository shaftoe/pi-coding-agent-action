import * as core from '@actions/core';
import { run } from './run';

run().catch(error => {
  core.setFailed(error as Error);
});
