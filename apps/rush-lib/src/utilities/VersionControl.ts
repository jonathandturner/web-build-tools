// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as child_process from 'child_process';
import * as colors from 'colors';
import { Executable } from '@microsoft/node-core-library';

const DEFAULT_BRANCH: string = 'master';
const DEFAULT_REMOTE: string = 'origin';
const DEFAULT_FULLY_QUALIFIED_BRANCH: string = `${DEFAULT_REMOTE}/${DEFAULT_BRANCH}`;

export class VersionControl {
  public static getChangedFolders(
    targetBranch: string,
    skipFetch: boolean = false
  ): Array<string | undefined> | undefined {
    if (!skipFetch) {
      VersionControl._fetchNonDefaultBranch(targetBranch);
    }

    const output: string = child_process.execSync(`git diff ${targetBranch}... --dirstat=files,0`).toString();
    return output.split('\n').map((line) => {
      if (line) {
        const delimiterIndex: number = line.indexOf('%');
        if (delimiterIndex > 0 && delimiterIndex + 1 < line.length) {
          return line.substring(delimiterIndex + 1).trim();
        }
      }

      return undefined;
    });
  }

  /**
   * @param pathPrefix - An optional path prefix "git diff"s should be filtered by.
   * @returns
   * An array of paths of repo-root-relative paths of files that are different from
   * those in the provided {@param targetBranch}. If a {@param pathPrefix} is provided,
   * this function only returns reuslts under the that path.
   */
  public static getChangedFiles(targetBranch: string, skipFetch: boolean = false, pathPrefix?: string): string[] {
    if (!skipFetch) {
      VersionControl._fetchNonDefaultBranch(targetBranch);
    }

    const output: string = child_process.execSync(
      `git diff ${targetBranch}... --name-only --no-renames --diff-filter=A`
    ).toString();
    const regex: RegExp | undefined = pathPrefix ? new RegExp(`^${pathPrefix}`, 'i') : undefined;
    return output.split('\n').map((line) => {
      if (line) {
        const trimmedLine: string = line.trim();
        if (regex && trimmedLine.match(regex)) {
          return trimmedLine;
        }
      }

      return undefined;
    }).filter((line) => {
      return line && line.length > 0;
    }) as string[];
  }

  /**
   * Gets the remote master branch that maps to the provided repository url.
   * This method is used by 'Rush change' to find the default remote branch to compare against.
   * If repository url is not provided or if there is no match, returns the default remote
   * master branch 'origin/master'.
   * If there are more than one matches, returns the first remote's master branch.
   *
   * @param repositoryUrl - repository url
   */
  public static getRemoteMasterBranch(repositoryUrl?: string): string {
    let matchingRemotes: string[] = [];

    if (repositoryUrl) {
      const output: string = child_process
        .execSync(`git remote`)
        .toString();
      matchingRemotes = output.split('\n').filter(remoteName => {
        if (remoteName) {
          const remoteUrl: string = child_process.execSync(`git remote get-url ${remoteName}`)
            .toString()
            .trim();
          if (remoteUrl === repositoryUrl) {
            return true;
          }
          // When you copy a URL from the GitHub web site, they append the ".git" file extension to the URL.
          // So we allow that to be specified in rush.json, even though the file extension gets dropped
          // by "git clone".
          if (remoteUrl + '.git' === repositoryUrl) {
            return true;
          }
        }
        return false;
      });
    } else {
      console.log(colors.yellow(
        'A git remote URL has not been specified in rush.json. Setting the baseline remote URL is recommended.'
      ));
      return DEFAULT_FULLY_QUALIFIED_BRANCH;
    }

    if (matchingRemotes.length > 0) {
      if (matchingRemotes.length > 1) {
        console.log(
          `More than one git remote matches the repository URL. Using the first remote (${matchingRemotes[0]}).`
        );
      }

      return `${matchingRemotes[0]}/${DEFAULT_BRANCH}`;
    } else {
      console.log(colors.yellow(
        `Unable to find a git remote matching the repository URL (${matchingRemotes[0]}). ` +
        'Detected changes are likely to be incorrect.'
      ));
      return DEFAULT_FULLY_QUALIFIED_BRANCH;
    }
  }

  public static hasUncommittedChanges(): boolean {
    return VersionControl.getUncommittedChanges().length > 0;
  }

  /**
   * The list of files changed but not committed
   */
  public static getUncommittedChanges(): ReadonlyArray<string> {
    const changes: string[] = [];
    changes.push(...VersionControl._getUntrackedChanges());
    changes.push(...VersionControl._getDiffOnHEAD());

    return changes.filter(change => {
      return change.trim().length > 0;
    });
  }

  private static _getUntrackedChanges(): string[] {
    const output: string = child_process
      .execSync(`git ls-files --exclude-standard --others`)
      .toString();
    return output.trim().split('\n');
  }

  private static _getDiffOnHEAD(): string[] {
    const output: string = child_process
      .execSync(`git diff HEAD --name-only`)
      .toString();
    return output.trim().split('\n');
  }

  private static _tryFetchRemoteBranch(remoteBranchName: string): boolean {
    const firstSlashIndex: number = remoteBranchName.indexOf('/');
    if (firstSlashIndex === -1) {
      throw new Error(
        `Unexpected git remote branch format: ${remoteBranchName}. ` +
        'Expected branch to be in the <remote>/<branch name> format.'
      );
    }

    const remoteName: string = remoteBranchName.substr(0, firstSlashIndex);
    const branchName: string = remoteBranchName.substr(firstSlashIndex + 1);
    const spawnResult: child_process.SpawnSyncReturns<string> = Executable.spawnSync(
      'git',
      ['fetch', remoteName, branchName],
      {
        stdio: 'ignore'
      }
    );
    return spawnResult.status === 0;
  }

  private static _fetchNonDefaultBranch(remoteBranchName: string): void {
    if (remoteBranchName !== DEFAULT_FULLY_QUALIFIED_BRANCH) {
      console.log(`Checking for updates to ${remoteBranchName}...`);
      const fetchResult: boolean = VersionControl._tryFetchRemoteBranch(remoteBranchName);
      if (!fetchResult) {
        console.log(colors.yellow(
          `Error fetching git remote branch ${remoteBranchName}. Detected changed files may be incorrect.`
        ));
      }
    }
  }
}
