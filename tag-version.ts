#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import * as git from 'isomorphic-git';
import { join } from 'node:path';

function readVersionFile(): string {
  const versionPath = join(process.cwd(), 'VERSION');

  if (!fs.existsSync(versionPath)) {
    console.error('Error: VERSION file not found in project root');
    console.error('Expected file: ./VERSION (e.g., containing "1.2.3")');
    process.exit(1);
  }

  const version = readFileSync(versionPath, 'utf-8').trim();

  return version;
}

function validateVersion(version: string): string {
  // Validate semver format (X.Y.Z) - no 'v' prefix expected
  const semverRegex = /^\d+\.\d+\.\d+$/;
  if (!semverRegex.test(version)) {
    console.error(
      `Error: Invalid version format "${version}". Expected format: 1.2.3 (no 'v' prefix)`
    );
    process.exit(1);
  }

  return version;
}

function updatePackageJson(version: string): void {
  const packagePath = join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));

  packageJson.version = version;
  writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
}

async function createReleaseCommit(version: string): Promise<string> {
  try {
    const dir = process.cwd();
    const message = `chore: release v${version}`;

    await git.add({
      fs,
      dir,
      filepath: 'package.json',
    });

    await git.add({
      fs,
      dir,
      filepath: 'VERSION',
    });

    const authorName = await git.getConfig({
      fs,
      dir,
      path: 'user.name',
    });

    const authorEmail = await git.getConfig({
      fs,
      dir,
      path: 'user.email',
    });

    const commitOid = await git.commit({
      fs,
      dir,
      message,
      author: {
        name: authorName || 'Release Bot',
        email: authorEmail || 'release@bot.local',
      },
    });

    return commitOid;
  } catch (error) {
    console.error('Error: Failed to create release commit', error);
    process.exit(1);
  }
}

async function createGitTag(tag: string, targetOid: string): Promise<void> {
  try {
    const dir = process.cwd();

    await git.tag({
      fs,
      dir,
      ref: tag,
      object: targetOid,
    });
  } catch (error) {
    console.error('Error: Failed to create git tag', error);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  console.log('Reading version from ./VERSION...');
  const version = validateVersion(readVersionFile());
  const tag = `v${version}`;

  console.log(`Updating package.json version to ${version}...`);
  updatePackageJson(version);
  console.log(`✓ Version updated to ${version}`);

  console.log(`Creating release commit...`);
  const commitOid = await createReleaseCommit(version);
  console.log(`✓ Release commit created: ${commitOid}`);

  console.log(`Creating git tag ${tag}...`);
  await createGitTag(tag, commitOid);
  console.log(`✓ Git tag ${tag} created`);

  console.log('\nNext steps:');
  console.log('  git push && git push --tags');
}

main();
